import "server-only";
import crypto from "node:crypto";
import { prisma } from "./db";
import { sha256 } from "./crypto";
import type { Session } from "./session";
import type { Role } from "./tenancy-core";

/** New key: shown once, only its sha256 is stored. */
export function generateApiKey() {
  const key = "shk_" + crypto.randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, 12), keyHash: sha256(key) };
}

/** Resolves a Bearer key to an acting session. Only active admin/reseller accounts may use the API. */
export async function authenticateKey(header: string | null): Promise<Session | null> {
  const m = header?.match(/^Bearer\s+(shk_[A-Za-z0-9_-]{20,80})$/);
  if (!m) return null;
  const row = await prisma.apiKey.findUnique({ where: { keyHash: sha256(m[1]) }, include: { account: true } });
  if (!row || row.revokedAt) return null;
  const a = row.account;
  if (a.status !== "active" || (a.role !== "admin" && a.role !== "reseller")) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { account: a, actor: null, role: a.role as Role, impersonating: false, base: "/admin" };
}
