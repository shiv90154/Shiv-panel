// Pure tenancy rules (no DB, no Next) so they can be unit-tested: tests/tenancy.test.ts

export type Role = "admin" | "reseller" | "user";
export const ROLES: readonly Role[] = ["admin", "reseller", "user"];
export type Node = { id: string; parentId: string | null };

/** All accounts below `rootId` in the account tree (root excluded). Cycle-safe. */
export function descendantIds(nodes: Node[], rootId: string): string[] {
  const byParent = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n.id]);
  const out: string[] = [], seen = new Set<string>([rootId]), queue = [rootId];
  while (queue.length) {
    for (const c of byParent.get(queue.shift()!) ?? []) if (!seen.has(c)) { seen.add(c); out.push(c); queue.push(c); }
  }
  return out;
}

/** Roles an account of `role` may create. Admins are only created by bootstrap. */
export const creatableRoles = (role: Role): Role[] => (role === "admin" ? ["reseller", "user"] : role === "reseller" ? ["user"] : []);

export const canImpersonate = (actor: Role, target: Role) => (actor === "admin" ? target !== "admin" : actor === "reseller" ? target === "user" : false);

/** Account ids whose resources `role`/`self` may see. null = everything (admin). */
export function visibleAccountIds(role: Role, selfId: string, nodes: Node[]): string[] | null {
  if (role === "admin") return null;
  return role === "reseller" ? [selfId, ...descendantIds(nodes, selfId)] : [selfId];
}

export const scopeWhere = (ids: string[] | null): { accountId?: { in: string[] } } => (ids === null ? {} : { accountId: { in: ids } });

/** 0 = unlimited. `used` is the current count BEFORE the new resource is added. */
export const withinLimit = (limit: number | null | undefined, used: number) => !limit || used < limit;

export const homeFor = (role: Role) => (role === "user" ? "/cpanel" : "/admin");

export const PACKAGE_LIMIT_KEYS = ["diskMb", "bandwidthMb", "maxDomains", "maxSites", "maxMailboxes", "maxDatabases", "maxFtpUsers", "maxCronJobs", "cpuPercent", "ramMb"] as const;
export type PackageLimits = Record<(typeof PACKAGE_LIMIT_KEYS)[number], number>;

/** Names of limits where `child` exceeds what the reseller's own package allows (0 = unlimited on both sides). Empty = fits. */
export function packageOverruns(child: PackageLimits, parent: PackageLimits | null | undefined): string[] {
  if (!parent) return [];
  return PACKAGE_LIMIT_KEYS.filter((k) => parent[k] > 0 && (child[k] === 0 || child[k] > parent[k]));
}
