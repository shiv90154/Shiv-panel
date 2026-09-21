import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertWithinPackage } from "@/lib/tenancy";
import { cronMatches, minIntervalMinutes, parseCron } from "@/lib/cron";
import { agentCall } from "./agent";

export const MIN_INTERVAL_MIN = 5; // shared hosts: no every-minute jobs
const TIMEOUT_SEC = 300;
const KEEP_RUNS = 20;
const MAX_PARALLEL = 4;

export const scheduleSchema = z.string().trim().min(1, "Schedule required").max(100).superRefine((v, ctx) => {
  try {
    const f = parseCron(v);
    if (minIntervalMinutes(f) < MIN_INTERVAL_MIN) ctx.addIssue({ code: "custom", message: `Jobs can run at most every ${MIN_INTERVAL_MIN} minutes` });
  } catch (e) { ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Invalid schedule" }); }
});
export const commandSchema = z.string().trim().min(1, "Command required").max(1000).regex(/^[^\0]+$/, "Invalid command");

export async function createCronJob(a: { accountId: string; siteId: string; schedule: string; command: string }) {
  const schedule = scheduleSchema.parse(a.schedule), command = commandSchema.parse(a.command);
  const site = await prisma.site.findFirst({ where: { id: a.siteId, accountId: a.accountId } });
  if (!site) throw new Error("Site not found in that account");
  await assertWithinPackage(a.accountId, "cron");
  return prisma.cronJob.create({ data: { accountId: a.accountId, siteId: site.id, schedule, command } });
}

/** Execute one job now (scheduled or manual) and record the outcome. A job that is already running is not started twice. */
export async function runCronJob(id: string) {
  const claimed = await prisma.cronJob.updateMany({ where: { id, OR: [{ runningSince: null }, { runningSince: { lt: new Date(Date.now() - (TIMEOUT_SEC + 120) * 1000) } }] }, data: { runningSince: new Date() } });
  if (!claimed.count) throw new Error("This job is already running");
  const job = await prisma.cronJob.findUniqueOrThrow({ where: { id }, include: { site: true } });
  const started = new Date();
  let exitCode: number | null = null, output = "", durationMs = 0;
  try {
    const r = await agentCall("cron.run", { siteId: job.siteId, runtime: job.site.runtime, command: job.command, timeoutSec: TIMEOUT_SEC }, job.accountId, (TIMEOUT_SEC + 60) * 1000);
    exitCode = r.exitCode; output = r.output + (r.truncated ? "\n[output truncated]" : ""); durationMs = r.durationMs;
  } catch (e) {
    output = e instanceof Error ? e.message : "Failed to run"; durationMs = Date.now() - started.getTime();
  }
  await prisma.cronRun.create({ data: { jobId: id, startedAt: started, durationMs, exitCode, output: output.slice(0, 70_000) } });
  await prisma.cronJob.update({ where: { id }, data: { lastRunAt: started, lastExitCode: exitCode, runningSince: null } });
  const old = await prisma.cronRun.findMany({ where: { jobId: id }, orderBy: { startedAt: "desc" }, skip: KEEP_RUNS, select: { id: true } });
  if (old.length) await prisma.cronRun.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  return { exitCode, output };
}

/** Called once a minute: starts every enabled job whose schedule matches this UTC minute (suspended accounts and stopped sites are skipped). */
export async function tickCron(now = new Date()) {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const jobs = await prisma.cronJob.findMany({ where: { enabled: true, account: { status: "active" }, site: { status: "running" }, OR: [{ lastRunAt: null }, { lastRunAt: { lt: minute } }] } });
  const due = jobs.filter((j) => { try { return cronMatches(parseCron(j.schedule), minute); } catch { return false; } });
  let next = 0;
  const worker = async () => { while (next < due.length) { const j = due[next++]; await runCronJob(j.id).catch((e) => console.error(`[cron] ${j.id}:`, e instanceof Error ? e.message : e)); } };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, due.length) }, worker));
}
