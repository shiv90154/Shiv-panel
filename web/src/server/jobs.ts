import { prisma } from "@/lib/db";
import { syncDkimFiles } from "@/lib/dkim";
import { hashAdminPassword } from "@/lib/password";
import { ingestLogs, pruneLogs } from "./logs";
import { refreshUsage } from "./usage";
import { verifyDomainDns } from "./domains";
import { tickCron } from "./cron";
import { tickBackups } from "./backups";
import { collectMetricSample, nightlyScanDue, pruneMetricSamples, runNightlySiteScans } from "./security";
import { agentConfigured } from "./agent";
import { processDueWebhookDeliveries } from "./webhooks";

const safe = (name: string, fn: () => Promise<unknown>) => async () => {
  try { await fn(); } catch (e) { console.error(`[jobs] ${name} failed:`, e); }
};

export async function startJobs() {
  const g = globalThis as { __jobs?: boolean };
  if (g.__jobs) return;
  g.__jobs = true;

  // Bootstrap: first admin from env, DKIM key files for every domain.
  await safe("bootstrap", async () => {
    const email = process.env.ADMIN_EMAIL?.toLowerCase(), pw = process.env.ADMIN_PASSWORD;
    if (email && pw && (await prisma.account.count({ where: { role: "admin" } })) === 0) {
      await prisma.account.create({ data: { username: "admin", email, role: "admin", passwordHash: await hashAdminPassword(pw) } });
      console.log(`[jobs] created initial admin ${email}`);
    }
    await syncDkimFiles();
  })();

  setInterval(safe("logs", ingestLogs), 5_000);
  setInterval(safe("usage", refreshUsage), 5 * 60_000);
  setTimeout(safe("usage", refreshUsage), 15_000);
  setInterval(safe("prune", () => pruneLogs(30)), 6 * 3600_000);
  setInterval(safe("prune-metrics", pruneMetricSamples), 6 * 3600_000);
  // Cron + backup schedules: tick on the minute (UTC); each has its own guard so a slow cron tick never delays backups (or vice versa).
  const guarded = (name: string, fn: () => Promise<unknown>) => { let busy = false; return safe(name, async () => { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }); };
  const ticks = [
    guarded("cron", () => tickCron()), guarded("backups", () => tickBackups()), guarded("metrics", collectMetricSample),
    guarded("nightly-scan", async () => { if (agentConfigured() && await nightlyScanDue()) await runNightlySiteScans(); }),
    guarded("webhook-retry", processDueWebhookDeliveries),
  ];
  setTimeout(() => { const go = () => ticks.forEach((t) => void t()); go(); setInterval(go, 60_000); }, 60_000 - (Date.now() % 60_000));
  setInterval(safe("dns", async () => {
    for (const d of await prisma.domain.findMany({ select: { id: true } })) await verifyDomainDns(d.id);
  }), 12 * 3600_000);
}
