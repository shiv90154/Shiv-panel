import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { Session } from "@/lib/session";
import { deleteDomain } from "./domains";
import { deleteSite } from "./sites";
import { deleteDatabase } from "./databases";
import { purgeAccountBackups } from "./backups";
import { deleteZone } from "./dns";
import { emitAccountEvent } from "./webhooks";

type Acc = { id: string; username: string; email: string; role: string; parentId: string | null; packageId: string | null };
type Actor = Pick<Session, "account" | "actor">;

export async function setAccountStatus(sess: Actor, acc: Acc, suspend: boolean, reason?: string | null) {
  await prisma.account.update({ where: { id: acc.id }, data: suspend ? { status: "suspended", suspendReason: reason ?? null } : { status: "active", suspendReason: null } });
  await audit(sess, suspend ? "account.suspend" : "account.unsuspend", { target: acc.username, accountId: acc.id, detail: suspend ? { reason: reason ?? null } : undefined });
  emitAccountEvent(suspend ? "account.suspended" : "account.unsuspended", acc, suspend ? { reason: reason ?? null } : {});
}

export async function terminateAccountCore(sess: Actor, acc: Acc) {
  if (await prisma.account.count({ where: { parentId: acc.id } })) throw new Error("This account still owns other accounts - terminate or move them first");
  const owned = await prisma.package.findMany({ where: { ownerId: acc.id }, select: { id: true } });
  if (owned.length && (await prisma.account.count({ where: { packageId: { in: owned.map((p) => p.id) }, id: { not: acc.id } } }))) throw new Error("Its packages are still assigned to other accounts");
  for (const st of await prisma.site.findMany({ where: { accountId: acc.id }, select: { id: true } })) await deleteSite(st.id, true);
  for (const d of await prisma.database.findMany({ where: { accountId: acc.id } })) await deleteDatabase(d.id);
  for (const zn of await prisma.dnsZone.findMany({ where: { accountId: acc.id }, select: { id: true } })) await deleteZone(zn.id);
  for (const d of await prisma.domain.findMany({ where: { accountId: acc.id }, select: { id: true } })) await deleteDomain(d.id);
  await purgeAccountBackups(acc.id);
  await prisma.account.update({ where: { id: acc.id }, data: { packageId: null } });
  await prisma.package.deleteMany({ where: { ownerId: acc.id } });
  await prisma.account.delete({ where: { id: acc.id } });
  await audit(sess, "account.terminate", { target: acc.username, accountId: sess.account.id, detail: { role: acc.role } });
  emitAccountEvent("account.terminated", acc);
}
