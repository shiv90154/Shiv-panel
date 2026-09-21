import "server-only";
import type { Package } from "@prisma/client";
import { prisma } from "./db";
import type { Session } from "./session";
import { canImpersonate, creatableRoles, scopeWhere, visibleAccountIds, withinLimit, type Role } from "./tenancy-core";

export { creatableRoles, canImpersonate };

/** Account ids the session may see (admin: null = all; reseller: self + users below; user: self). */
export async function scopeIds(s: Session): Promise<string[] | null> {
  if (s.role === "admin") return null;
  const nodes = s.role === "reseller" ? await prisma.account.findMany({ select: { id: true, parentId: true } }) : [];
  return visibleAccountIds(s.role, s.account.id, nodes);
}

/** Prisma `where` fragment for any model with an `accountId` column: `prisma.domain.findMany({ where: { ...(await scopeFor(s)) } })`. */
export async function scopeFor(s: Session) {
  return scopeWhere(await scopeIds(s));
}

const notFound = () => new Error("Not found");

/** Accounts the session may manage (not itself, never another admin). Not-found (not "forbidden") on purpose: don't leak existence. */
export async function getManagedAccount(s: Session, id: string) {
  if (s.role === "user" || id === s.account.id) throw notFound();
  const ids = await scopeIds(s);
  const a = await prisma.account.findFirst({ where: { id, role: { not: "admin" }, ...(ids && { AND: [{ id: { in: ids } }] }) }, include: { package: true } });
  if (!a) throw notFound();
  return a;
}
/** Is `accountId` inside the session's scope (including the session's own account)? */
export async function assertInScope(s: Session, accountId: string) {
  const ids = await scopeIds(s);
  if (ids && !ids.includes(accountId)) throw notFound();
}

export async function getOwnedDomain(s: Session, id: string) {
  const d = await prisma.domain.findFirst({ where: { id, ...(await scopeFor(s)) } });
  if (!d) throw notFound();
  return d;
}
export async function getOwnedMailbox(s: Session, id: string) {
  const m = await prisma.mailbox.findFirst({ where: { id, ...(await scopeFor(s)) }, include: { domain: true } });
  if (!m) throw notFound();
  return m;
}
export async function getOwnedSite(s: Session, id: string) {
  const site = await prisma.site.findFirst({ where: { id, ...(await scopeFor(s)) }, include: { domains: { orderBy: { name: "asc" } } } });
  if (!site) throw notFound();
  return site;
}
export async function getOwnedDatabase(s: Session, id: string) {
  const d = await prisma.database.findFirst({ where: { id, ...(await scopeFor(s)) } });
  if (!d) throw notFound();
  return d;
}
export async function getOwnedCron(s: Session, id: string) {
  const j = await prisma.cronJob.findFirst({ where: { id, ...(await scopeFor(s)) }, include: { site: true } });
  if (!j) throw notFound();
  return j;
}
export async function getOwnedZone(s: Session, id: string) {
  const z = await prisma.dnsZone.findFirst({ where: { id, ...(await scopeFor(s)) } });
  if (!z) throw notFound();
  return z;
}
export async function getOwnedAlias(s: Session, id: string) {
  const a = await prisma.alias.findFirst({ where: { id, ...(await scopeFor(s)) } });
  if (!a) throw notFound();
  return a;
}

/** Packages the session may assign or edit: admin all, reseller only its own. */
export const packageScope = (s: Session) => (s.role === "admin" ? {} : { ownerId: s.account.id });

// ---------- package limits ----------
export type Limited = "domains" | "mailboxes" | "sites" | "databases" | "cron";

/** Throws when `accountId`'s package forbids creating one more resource. Accounts without a package are unlimited. */
export async function assertWithinPackage(accountId: string, kind: Limited) {
  const acc = await prisma.account.findUnique({ where: { id: accountId }, include: { package: true } });
  const pkg: Package | null | undefined = acc?.package;
  if (!pkg) return;
  const [limit, used] = kind === "domains" ? [pkg.maxDomains, await prisma.domain.count({ where: { accountId } })]
    : kind === "sites" ? [pkg.maxSites, await prisma.site.count({ where: { accountId } })]
    : kind === "cron" ? [pkg.maxCronJobs, await prisma.cronJob.count({ where: { accountId } })]
    : kind === "databases" ? [pkg.maxDatabases, await prisma.database.count({ where: { accountId } })]
    : [pkg.maxMailboxes, await prisma.mailbox.count({ where: { accountId } })];
  if (!withinLimit(limit, used)) throw new Error(`Package limit reached: ${limit} ${kind} allowed by "${pkg.name}"`);
}

export const isRole = (v: string): v is Role => v === "admin" || v === "reseller" || v === "user";
