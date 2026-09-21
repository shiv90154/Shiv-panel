import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { config } from "./config";
import { prisma } from "./db";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: config.secureCookies, path: "/" };

// ---------- Admin session (signed JWT) ----------
const jwtKey = () => new TextEncoder().encode(config.sessionSecret);

export async function createAdminSession(adminId: string) {
  const token = await new SignJWT({ sub: adminId }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("12h").sign(jwtKey());
  (await cookies()).set("admin_session", token, { ...cookieOpts, maxAge: 12 * 3600 });
}
export async function destroyAdminSession() {
  (await cookies()).delete("admin_session");
}
export async function requireAdmin() {
  const token = (await cookies()).get("admin_session")?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwtKey());
      const admin = await prisma.adminUser.findUnique({ where: { id: String(payload.sub) } });
      if (admin) return admin;
    } catch {}
  }
  redirect("/admin/login");
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
