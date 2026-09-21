import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isBackupDue } from "@/lib/backup-schedule";
import { agentCall, type BackupItemResult, type BackupRunParams, type SnapshotInfo } from "./agent";

const RUN_TIMEOUT_MS = 6 * 3600_000;

export const policySchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly"]),
  hour: z.coerce.number().int().min(0).max(23),
  keepDaily: z.coerce.number().int().min(0).max(60),
  keepWeekly: z.coerce.number().int().min(0).max(52),
  keepMonthly: z.coerce.number().int().min(0).max(24),
  includeSites: z.boolean(), includeDatabases: z.boolean(), includeMail: z.boolean(),
}).refine((p) => p.keepDaily + p.keepWeekly + p.keepMonthly > 0, "Keep at least one snapshot")
  .refine((p) => p.includeSites || p.includeDatabases || p.includeMail, "Select something to back up");

export const DEFAULT_POLICY = { enabled: false, frequency: "daily", hour: 3, keepDaily: 7, keepWeekly: 4, keepMonthly: 3, includeSites: true, includeDatabases: true, includeMail: true };
export const getPolicy = async (accountId: string) => (await prisma.backupPolicy.findUnique({ where: { accountId } })) ?? { accountId, lastRunAt: null, ...DEFAULT_POLICY };

export async function savePolicy(accountId: string, input: z.infer<typeof policySchema>) {
  await prisma.backupPolicy.upsert({ where: { accountId }, create: { accountId, ...input }, update: input });
}

/** What a snapshot tag refers to, in words. */
export function describeTag(tag: string, names: { sites: Map<string, string> }) {
  const [kind, ...rest] = tag.split(":");
  if (kind === "site") return { kind: "site" as const, key: rest.join(":"), label: `Files: ${names.sites.get(rest.join(":")) ?? "deleted site"}` };
  if (kind === "db") return { kind: "db" as const, key: rest.join(":"), label: `Database: ${rest[1] ?? rest.join(":")} (${rest[0]})` };
  if (kind === "mail") return { kind: "mail" as const, key: rest.join(":"), label: `Mail: ${rest.join(":")}` };
  return null;
}

export async function listSnapshots(accountId: string): Promise<SnapshotInfo[]> {
  const { snapshots } = await agentCall("backup.list", {}, accountId, 120_000);
  return snapshots.sort((a, b) => b.time.localeCompare(a.time));
}

/** Runs a backup for one account; resolves when finished. Never runs two at once for the same account. */
export async function runBackup(accountId: string, trigger: "manual" | "schedule") {
  const active = await prisma.backupRun.findFirst({ where: { accountId, status: "running", startedAt: { gt: new Date(Date.now() - RUN_TIMEOUT_MS) } } });
  if (active) throw new Error("A backup is already running for this account");
  const policy = await getPolicy(accountId);
  const [sites, dbs, domains] = await Promise.all([
    policy.includeSites ? prisma.site.findMany({ where: { accountId }, select: { id: true } }) : [],
    policy.includeDatabases ? prisma.database.findMany({ where: { accountId }, select: { engine: true, name: true } }) : [],
    policy.includeMail ? prisma.domain.findMany({ where: { accountId }, select: { name: true } }) : [],
  ]);
  const params: BackupRunParams = {
    sites: sites.map((s) => s.id), databases: dbs.map((d) => ({ engine: d.engine as "mariadb" | "postgres", name: d.name })), mailDomains: domains.map((d) => d.name),
    keep: { daily: policy.keepDaily, weekly: policy.keepWeekly, monthly: policy.keepMonthly },
  };
  if (!params.sites.length && !params.databases.length && !params.mailDomains.length) throw new Error("Nothing to back up yet (no sites, databases or mail domains selected)");
  const run = await prisma.backupRun.create({ data: { accountId, trigger } });
  await prisma.backupPolicy.upsert({ where: { accountId }, create: { accountId, ...DEFAULT_POLICY, lastRunAt: new Date() }, update: { lastRunAt: new Date() } });
  // fire and forget for the caller: backups can take hours
  void (async () => {
    let results: BackupItemResult[] = [], error: string | null = null;
    try { results = (await agentCall("backup.run", params, accountId, RUN_TIMEOUT_MS)).results; } catch (e) { error = e instanceof Error ? e.message : "Backup failed"; }
    const failed = results.filter((r) => !r.ok).length;
    const status = error ? "error" : failed === 0 ? "ok" : failed === results.length ? "error" : "partial";
    await prisma.backupRun.update({ where: { id: run.id }, data: { status, results, error, finishedAt: new Date() } }).catch((e) => console.error("[backup] could not record result:", e));
  })();
  return run;
}

export async function tickBackups(now = new Date()) {
  // runs that were interrupted (web restarted mid-backup) must not block the account forever
  await prisma.backupRun.updateMany({ where: { status: "running", startedAt: { lt: new Date(now.getTime() - RUN_TIMEOUT_MS) } }, data: { status: "error", error: "Interrupted", finishedAt: now } });
  const policies = await prisma.backupPolicy.findMany({ where: { enabled: true, account: { status: "active" } } });
  for (const p of policies) {
    if (!isBackupDue(p, now)) continue;
    await runBackup(p.accountId, "schedule").catch((e) => console.error(`[backup] ${p.accountId}:`, e instanceof Error ? e.message : e));
  }
}

export async function restoreSnapshot(accountId: string, snapshotId: string, kind: "site" | "db" | "mail", name: string) {
  await agentCall("backup.restore", { snapshotId, kind, name }, accountId, RUN_TIMEOUT_MS);
}
export async function removeSnapshot(accountId: string, snapshotId: string) {
  await agentCall("backup.deleteSnapshot", { snapshotId }, accountId, 30 * 60_000);
}
/** Account termination: drop the account's whole repository and history. */
export async function purgeAccountBackups(accountId: string) {
  await agentCall("backup.purgeAccount", {}, accountId, 60_000);
  await prisma.backupRun.deleteMany({ where: { accountId } });
  await prisma.backupPolicy.deleteMany({ where: { accountId } });
}
