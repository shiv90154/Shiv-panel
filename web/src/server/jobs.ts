import { prisma } from "@/lib/db";
import { syncDkimFiles } from "@/lib/dkim";
import { hashAdminPassword } from "@/lib/password";
import { ingestLogs, pruneLogs } from "./logs";
import { refreshUsage } from "./usage";
import { verifyDomainDns } from "./domains";

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
    if (email && pw && (await prisma.adminUser.count()) === 0) {
      await prisma.adminUser.create({ data: { email, passwordHash: await hashAdminPassword(pw) } });
      console.log(`[jobs] created initial admin ${email}`);
    }
    await syncDkimFiles();
  })();

  setInterval(safe("logs", ingestLogs), 5_000);
  setInterval(safe("usage", refreshUsage), 5 * 60_000);
  setTimeout(safe("usage", refreshUsage), 15_000);
  setInterval(safe("prune", () => pruneLogs(30)), 6 * 3600_000);
  setInterval(safe("dns", async () => {
    for (const d of await prisma.domain.findMany({ select: { id: true } })) await verifyDomainDns(d.id);
  }), 12 * 3600_000);
}
