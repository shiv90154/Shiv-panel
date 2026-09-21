import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import type { Account } from "@prisma/client";
import { config } from "./config";
import { prisma } from "./db";
import { seal, sha256, unseal } from "./crypto";
import { canImpersonate, homeFor, type Role } from "./tenancy-core";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: config.secureCookies, path: "/" };

// ---------- Panel session (signed JWT, all roles) ----------
// Cookie `panel_session` = { sub: effective account id, imp?: real actor id when impersonating, pv: password fingerprint }.
// `pv` changes with the password hash, so changing a password signs out every other session of that account.
const jwtKey = () => new TextEncoder().encode(config.sessionSecret);
const pvOf = (passwordHash: string) => sha256(passwordHash).slice(0, 16);

export type Session = {
  account: Account; // the account whose data is being viewed (the impersonated one, if any)
  actor: Account | null; // the real admin/reseller while impersonating
  role: Role;
  impersonating: boolean;
  base: string; // "/admin" (admin, reseller) or "/cpanel" (user)
};

export async function createSession(account: Pick<Account, "id" | "passwordHash">, actorId?: string) {
  const token = await new SignJWT({ sub: account.id, pv: pvOf(account.passwordHash), ...(actorId && { imp: actorId }) })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime(actorId ? "2h" : "12h").sign(jwtKey());
  (await cookies()).set("panel_session", token, { ...cookieOpts, maxAge: (actorId ? 2 : 12) * 3600 });
}
export async function destroySession() {
  const c = await cookies();
  c.delete("panel_session"); c.delete("login_2fa");
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("panel_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtKey());
    const account = await prisma.account.findUnique({ where: { id: String(payload.sub) } });
    if (!account || payload.pv !== pvOf(account.passwordHash)) return null;
    let actor: Account | null = null;
    if (payload.imp) {
      actor = await prisma.account.findUnique({ where: { id: String(payload.imp) } });
      // Re-validated on every request: the actor must still be active and still allowed to manage the target.
      if (!actor || actor.status !== "active" || !canImpersonate(actor.role as Role, account.role as Role)) return null;
      if (actor.role === "reseller" && account.parentId !== actor.id) return null;
    } else if (account.status !== "active") return null;
    const role = account.role as Role;
    return { account, actor, role, impersonating: !!actor, base: homeFor(role) };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
/** Guard for pages and server actions: signed in AND one of `roles`. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const s = await requireSession();
  if (!roles.includes(s.role)) redirect(s.base);
  return s;
}

// ---------- Two-step login: password ok, TOTP still pending (5 min) ----------
export async function createPendingLogin(accountId: string) {
  const token = await new SignJWT({ sub: accountId, purpose: "2fa" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("5m").sign(jwtKey());
  (await cookies()).set("login_2fa", token, { ...cookieOpts, maxAge: 300 });
}
export async function readPendingLogin(): Promise<string | null> {
  const token = (await cookies()).get("login_2fa")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtKey());
    return payload.purpose === "2fa" ? String(payload.sub) : null;
  } catch {
    return null;
  }
}
export async function clearPendingLogin() {
  (await cookies()).delete("login_2fa");
}

// One-time recovery codes are shown once, right after 2FA is enabled: sealed in a 2-minute cookie.
export async function setRecoveryFlash(codes: string[]) {
  (await cookies()).set("rc_flash", seal(JSON.stringify(codes)), { ...cookieOpts, maxAge: 120 });
}
export async function readRecoveryFlash(): Promise<string[] | null> {
  const raw = (await cookies()).get("rc_flash")?.value;
  const json = raw ? unseal(raw) : null;
  return json ? (JSON.parse(json) as string[]) : null;
}

// ---------- Webmail session (AES-256-GCM encrypted cookie holding credentials for IMAP/SMTP) ----------
const aesKey = () => crypto.createHash("sha256").update("webmail:" + config.sessionSecret).digest();

export type WebmailSession = { email: string; password: string; exp: number };

export async function createWebmailSession(email: string, password: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify({ email, password, exp: Date.now() + 8 * 3600_000 })), c.final()]);
  const val = Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
  (await cookies()).set("wm_session", val, { ...cookieOpts, maxAge: 8 * 3600 });
}
export async function destroyWebmailSession() {
  (await cookies()).delete("wm_session");
}
export async function getWebmailSession(): Promise<WebmailSession | null> {
  const raw = (await cookies()).get("wm_session")?.value;
  if (!raw) return null;
  try {
    const b = Buffer.from(raw, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", aesKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const s = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString()) as WebmailSession;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}
export async function requireWebmail() {
  const s = await getWebmailSession();
  if (!s) redirect("/webmail/login");
  return s;
}

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}
