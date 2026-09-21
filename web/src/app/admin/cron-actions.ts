"use server";

// Cron actions, shared by WHM (/admin) and cPanel (/cpanel). Session -> getOwnedCron / assertInScope -> mutate.
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { assertInScope, getOwnedCron } from "@/lib/tenancy";
import { createCronJob, runCronJob } from "@/server/cron";

export async function addCronJob(fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/cron`, async () => {
    const site = await prisma.site.findUnique({ where: { id: s(fd, "siteId") }, select: { id: true, accountId: true, name: true } });
    if (!site) throw new Error("Not found");
    await assertInScope(sess, site.accountId); // the account is taken from the site, never from the form
    const job = await createCronJob({ accountId: site.accountId, siteId: site.id, schedule: s(fd, "schedule"), command: s(fd, "command") });
    await audit(sess, "cron.create", { target: `${site.name}: ${job.schedule}`, accountId: site.accountId, detail: { command: job.command } });
    return "Cron job added";
  });
}

export async function toggleCronJob(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/cron`, async () => {
    const j = await getOwnedCron(sess, id);
    await prisma.cronJob.update({ where: { id: j.id }, data: { enabled: !j.enabled } });
    await audit(sess, j.enabled ? "cron.disable" : "cron.enable", { target: `${j.site.name}: ${j.schedule}`, accountId: j.accountId });
    return j.enabled ? "Job disabled" : "Job enabled";
  });
}

export async function runCronNow(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/cron`, async () => {
    const j = await getOwnedCron(sess, id);
    const r = await runCronJob(j.id);
    await audit(sess, "cron.run", { target: `${j.site.name}: ${j.schedule}`, accountId: j.accountId, detail: { exitCode: r.exitCode } });
    return r.exitCode === 0 ? "Job ran successfully (see history below)" : `Job finished with exit code ${r.exitCode ?? "n/a"} (see history below)`;
  });
}

export async function removeCronJob(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/cron`, async () => {
    const j = await getOwnedCron(sess, id);
    await prisma.cronJob.delete({ where: { id: j.id } });
    await audit(sess, "cron.delete", { target: `${j.site.name}: ${j.schedule}`, accountId: j.accountId, detail: { command: j.command } });
    return "Job deleted";
  });
}
