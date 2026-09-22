import "server-only";
import { prisma } from "./db";
import type { Session } from "./session";

export type Brand = { name: string; logoUrl: string | null };

/**
 * The reseller brand to show for this session: the reseller's own for its WHM shell, or its owning reseller's for a
 * user's cPanel shell. Admins always see the platform default. `brandDomain` is stored (see the Account model) but not
 * resolved here - no request reaches the panel on that host yet (DECISIONS #24), so it cannot identify a session pre-login.
 */
export async function getBrand(s: Session): Promise<Brand | null> {
  if (s.role === "reseller") return s.account.brandName ? { name: s.account.brandName, logoUrl: s.account.brandLogoUrl } : null;
  if (s.role === "user" && s.account.parentId) {
    const parent = await prisma.account.findUnique({ where: { id: s.account.parentId }, select: { role: true, brandName: true, brandLogoUrl: true } });
    if (parent?.role === "reseller" && parent.brandName) return { name: parent.brandName, logoUrl: parent.brandLogoUrl };
  }
  return null;
}
