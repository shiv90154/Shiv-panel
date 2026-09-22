import "server-only";
import { prisma } from "@/lib/db";
import { cidrContains, downsample, nightlyDue, parseCidr, parsePortSpec, RANGES, toSample, type RangeKey, type RawMetrics } from "@/lib/security-core";
import { agentCall, agentConfigured, type FirewallParams } from "./agent";

const KEEP_SCAN_RUNS = 10;

// ---------- firewall ----------
async function buildFirewallParams(): Promise<FirewallParams> {
  const rules = await prisma.firewallRule.findMany();
  return {
    openPorts: rules.filter((r) => r.kind === "port").map((r) => ({ proto: r.proto as "tcp" | "udp", from: r.portFrom!, to: r.portTo!, source: r.cidr })),
    blocked: rules.filter((r) => r.kind === "block").map((r) => r.cidr!),
  };
}

/** Re-sends every stored rule to the host; called after every add/remove so the DB and the live ruleset never drift apart. */
export async function applyFirewallRules() {
  return agentCall("firewall.apply", await buildFirewallParams(), null, 30_000);
}

export async function addOpenPortRule(input: { proto: string; port: string; source: string; comment: string }) {
  if (input.proto !== "tcp" && input.proto !== "udp") throw new Error("Protocol must be tcp or udp");
  const { from, to } = parsePortSpec(input.port);
  const source = input.source.trim() ? parseCidr(input.source.trim()).text : null;
  await prisma.firewallRule.create({ data: { kind: "port", proto: input.proto, portFrom: from, portTo: to, cidr: source, comment: input.comment.trim().slice(0, 200) } });
  await applyFirewallRules();
}

export async function addBlockRule(input: { cidr: string; comment: string }, requesterIp: string) {
  const c = parseCidr(input.cidr, { block: true });
  if (requesterIp !== "unknown" && cidrContains(c.text, requesterIp)) throw new Error("Refusing to block a range that includes your own address");
  await prisma.firewallRule.create({ data: { kind: "block", cidr: c.text, comment: input.comment.trim().slice(0, 200) } });
  await applyFirewallRules();
}

export async function removeFirewallRule(id: string) {
  await prisma.firewallRule.delete({ where: { id } });
  await applyFirewallRules();
}

export const getFirewallStatus = () => agentCall("firewall.status", {}, null, 8000);
export const disableFirewall = () => agentCall("firewall.disable", {}, null, 15_000);

// ---------- fail2ban ----------
export const getFail2banStatus = () => agentCall("fail2ban.status", {}, null, 15_000);
export const banIp = (jail: string, ip: string) => agentCall("fail2ban.ban", { jail, ip }, null, 10_000);
export const unbanIp = (jail: string, ip: string) => agentCall("fail2ban.unban", { jail, ip }, null, 10_000);

// ---------- clamav ----------
async function pruneScanRuns(siteId: string) {
  const old = await prisma.scanRun.findMany({ where: { siteId }, orderBy: { startedAt: "desc" }, skip: KEEP_SCAN_RUNS, select: { id: true } });
  if (old.length) await prisma.scanRun.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

async function performScan(site: { id: string; accountId: string }, runId: string) {
  try {
    const r = await agentCall("clamav.scan", { siteId: site.id }, site.accountId, 35 * 60_000);
    await prisma.scanRun.update({ where: { id: runId }, data: { status: r.infected ? "infected" : "clean", finishedAt: new Date(), findings: r.findings, total: r.total } });
  } catch (e) {
    await prisma.scanRun.update({ where: { id: runId }, data: { status: "error", finishedAt: new Date(), error: e instanceof Error ? e.message.slice(0, 300) : "Scan failed" } });
  } finally {
    await pruneScanRuns(site.id);
  }
}

/** Fire-and-forget: a scan can take a couple of minutes (signature DB load + walk), so the caller gets "started" immediately. */
export async function startSiteScan(site: { id: string; accountId: string }, trigger: "manual" | "nightly") {
  const active = await prisma.scanRun.findFirst({ where: { siteId: site.id, status: "running" } });
  if (active) throw new Error("A scan is already running for this site");
  const run = await prisma.scanRun.create({ data: { accountId: site.accountId, siteId: site.id, trigger } });
  void performScan(site, run.id);
  return run;
}

/** Sequential (one clamscan at a time: each run loads its own signature DB, ~1 GB RAM), called from the nightly job. */
export async function runNightlySiteScans() {
  const sites = await prisma.site.findMany({ select: { id: true, accountId: true } });
  for (const site of sites) {
    const active = await prisma.scanRun.findFirst({ where: { siteId: site.id, status: "running" } });
    if (active) continue;
    const run = await prisma.scanRun.create({ data: { accountId: site.accountId, siteId: site.id, trigger: "nightly" } });
    await performScan(site, run.id);
  }
}

/** Should the nightly scan sweep run now? Derived from the last nightly run's date so no extra table is needed. */
export async function nightlyScanDue(now = new Date()) {
  const last = await prisma.scanRun.findFirst({ where: { trigger: "nightly" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  return nightlyDue(now, last ? last.startedAt.toISOString().slice(0, 10) : null);
}

// ---------- metrics ----------
let prevRaw: RawMetrics | null = null;

/** Called once a minute by the job ticker. No-op if the agent is not configured or unreachable. */
export async function collectMetricSample() {
  if (!agentConfigured()) return;
  const raw = await agentCall("system.metrics", {}, null, 10_000);
  const sample = toSample(prevRaw, raw);
  prevRaw = raw;
  await prisma.metricSample.create({ data: { ts: new Date(raw.time), cpuPct: sample.cpuPct, load1: sample.load1, memPct: sample.memPct, diskPct: sample.diskPct, netRxBps: sample.netRxBps, netTxBps: sample.netTxBps } });
}

export const pruneMetricSamples = () => prisma.metricSample.deleteMany({ where: { ts: { lt: new Date(Date.now() - 9 * 86400_000) } } });

export type MetricSeries = Record<"cpu" | "mem" | "disk" | "load" | "netRx" | "netTx", { ts: number; v: number | null }[]>;

export async function getMetricSeries(range: RangeKey): Promise<MetricSeries> {
  const to = Date.now(), from = to - RANGES[range];
  const rows = await prisma.metricSample.findMany({ where: { ts: { gte: new Date(from) } }, orderBy: { ts: "asc" } });
  const series = (pick: (r: (typeof rows)[number]) => number | null) => downsample(rows.map((r) => ({ ts: r.ts.getTime(), v: pick(r) })), from, to, 60);
  return {
    cpu: series((r) => r.cpuPct), mem: series((r) => r.memPct), disk: series((r) => r.diskPct),
    load: series((r) => r.load1), netRx: series((r) => r.netRxBps), netTx: series((r) => r.netTxBps),
  };
}

// ---------- self-update ----------
export const checkForUpdate = () => agentCall("update.check", {}, null, 30_000);
export const getUpdateStatus = () => agentCall("update.status", {}, null, 8000);
export const applyUpdateNow = (expect: string) => agentCall("update.apply", { expect }, null, 15_000);
