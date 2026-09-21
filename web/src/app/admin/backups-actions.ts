"use server";

// Backup actions, shared by WHM and cPanel. The account is always checked with assertInScope, and restore targets are
// re-derived from the account's own snapshots + own resources (the form only names a snapshot id).
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { assertInScope } from "@/lib/tenancy";
import { describeTag, listSnapshots, policySchema, removeSnapshot, restoreSnapshot, runBackup, savePolicy } from "@/server/backups";

const back = (base: string, accountId: string, own: string) => `${base}/backups${accountId === own ? "" : `?account=${accountId}`}`;

export async function saveBackupPolicy(fd: FormData) {
  const sess = await requireSession();
  const accountId = s(fd, "accountId");
  return run(back(sess.base, accountId, sess.account.id), async () => {
    await assertInScope(sess, accountId);
    const on = (k: string) => fd.get(k) === "on";
    const p = policySchema.parse({
      enabled: on("enabled"), frequency: s(fd, "frequency"), hour: s(fd, "hour"), keepDaily: s(fd, "keepDaily"), keepWeekly: s(fd, "keepWeekly"), keepMonthly: s(fd, "keepMonthly"),
      includeSites: on("includeSites"), includeDatabases: on("includeDatabases"), includeMail: on("includeMail"),
    });
    await savePolicy(accountId, p);
    await audit(sess, "backup.policy", { target: accountId, accountId, detail: p });
    return "Backup schedule saved";
  });
}

export async function backupNow(fd: FormData) {
  const sess = await requireSession();
  const accountId = s(fd, "accountId");
  return run(back(sess.base, accountId, sess.account.id), async () => {
    await assertInScope(sess, accountId);
    await runBackup(accountId, "manual");
    await audit(sess, "backup.run", { target: accountId, accountId });
    return "Backup started. It runs in the background; refresh this page to see the result.";
  });
}

/** Resolve a snapshot id to the account's own snapshot + the resource it refers to, or throw. */
async function ownSnapshot(accountId: string, snapshotId: string) {
  const snap = (await listSnapshots(accountId)).find((x) => x.fullId === snapshotId || x.id === snapshotId);
  if (!snap) throw new Error("Not found");
  return snap;
}

export async function restoreBackup(fd: FormData) {
  const sess = await requireSession();
  const accountId = s(fd, "accountId");
  return run(back(sess.base, accountId, sess.account.id), async () => {
    await assertInScope(sess, accountId);
    const snap = await ownSnapshot(accountId, s(fd, "snapshotId"));
    if (s(fd, "confirm") !== "restore") throw new Error("Type restore to confirm");
    const tag = snap.tags.map((t) => describeTag(t, { sites: new Map() })).find(Boolean);
    if (!tag) throw new Error("Unknown snapshot type");
    // the resource must still exist and belong to this account
    if (tag.kind === "site" && !(await prisma.site.findFirst({ where: { id: tag.key, accountId } }))) throw new Error("That site no longer exists");
    if (tag.kind === "db") {
      const [engine, ...n] = tag.key.split(":");
      if (!(await prisma.database.findFirst({ where: { accountId, engine, name: n.join(":") } }))) throw new Error("That database no longer exists");
    }
    if (tag.kind === "mail" && !(await prisma.domain.findFirst({ where: { accountId, name: tag.key } }))) throw new Error("That mail domain no longer exists");
    await restoreSnapshot(accountId, snap.fullId, tag.kind, tag.key);
    await audit(sess, "backup.restore", { target: tag.key, accountId, detail: { kind: tag.kind, snapshot: snap.id } });
    return "Restore finished";
  });
}

export async function deleteBackup(fd: FormData) {
  const sess = await requireSession();
  const accountId = s(fd, "accountId");
  return run(back(sess.base, accountId, sess.account.id), async () => {
    await assertInScope(sess, accountId);
    const snap = await ownSnapshot(accountId, s(fd, "snapshotId"));
    await removeSnapshot(accountId, snap.fullId);
    await audit(sess, "backup.delete", { target: snap.id, accountId, detail: { tags: snap.tags } });
    return "Snapshot deleted";
  });
}
