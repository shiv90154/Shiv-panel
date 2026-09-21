"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import type { Account } from "@prisma/client";
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { seal, sha256, unseal } from "@/lib/crypto";
import { hashAdminPassword, verifyAdminPassword } from "@/lib/password";
import { clearAttempts, recordAttempt, tooManyAttempts } from "@/lib/ratelimit";
import { clearPendingLogin, clientIp, createPendingLogin, createSession, destroySession, getSession, readPendingLogin, requireSession, setRecoveryFlash } from "@/lib/session";
import { homeFor, type Role } from "@/lib/tenancy-core";
import { generateSecret, verifyTotp } from "@/lib/totp";
import { passwordSchema } from "@/server/domains";

// Compared against when the account does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = "$2b$12$tUZrwecmg0Jd/MbO3OEfCeLnXbauCMKKn6sqFA2PmSSImDb1Getxm";
const fail = (path: string, msg: string): never => redirect(`${path}?error=${encodeURIComponent(msg)}`);

async function finishLogin(acc: Account) {
  await prisma.account.update({ where: { id: acc.id }, data: { lastLoginAt: new Date() } });
  await createSession(acc);
  await audit({ account: acc, actor: null }, "auth.login");
  redirect(homeFor(acc.role as Role));
}

export async function login(fd: FormData) {
  const ident = s(fd, "login").toLowerCase();
  const key = `login:${await clientIp()}:${ident}`;
  if (tooManyAttempts(key)) fail("/login", "Too many attempts, try again in 15 minutes");
  const acc = await prisma.account.findFirst({ where: { OR: [{ email: ident }, { username: ident }] } });
  const okPw = await verifyAdminPassword(s(fd, "password"), acc?.passwordHash ?? DUMMY_HASH);
  if (!acc || !okPw) {
    recordAttempt(key);
    await audit(null, "auth.login_failed", { actorName: ident.slice(0, 80), accountId: acc?.id ?? null });
    fail("/login", "Invalid username or password");
  }
  const a = acc!;
  if (a.status !== "active") fail("/login", "This account is suspended" + (a.suspendReason ? `: ${a.suspendReason}` : ""));
  clearAttempts(key);
  if (a.totpEnabled) {
    await createPendingLogin(a.id);
    redirect("/login/2fa");
  }
  return finishLogin(a);
}

/** Verifies a TOTP code (replay-protected) or burns a one-time recovery code. */
async function consumeSecondFactor(acc: Account, raw: string): Promise<"totp" | "recovery" | null> {
  const secret = acc.totpSecret ? unseal(acc.totpSecret) : null;
  if (secret) {
    const step = verifyTotp(secret, raw, acc.totpLastStep);
    if (step !== null) {
      const r = await prisma.account.updateMany({ where: { id: acc.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
      return r.count === 1 ? "totp" : null;
    }
  }
  const h = sha256(raw.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (acc.recoveryCodes.includes(h)) {
    const r = await prisma.account.updateMany({ where: { id: acc.id, recoveryCodes: { has: h } }, data: { recoveryCodes: acc.recoveryCodes.filter((c) => c !== h) } });
    return r.count === 1 ? "recovery" : null;
  }
  return null;
}

export async function verifySecondFactor(fd: FormData) {
  const id = await readPendingLogin();
  if (!id) redirect("/login");
  const key = `2fa:${id}`;
  if (tooManyAttempts(key, 6)) fail("/login/2fa", "Too many attempts, sign in again in 15 minutes");
  const acc = await prisma.account.findUnique({ where: { id: id! } });
  if (!acc || acc.status !== "active") redirect("/login");
  const how = await consumeSecondFactor(acc!, s(fd, "code"));
  if (!how) {
    recordAttempt(key);
    await audit({ account: acc!, actor: null }, "auth.2fa_failed");
    fail("/login/2fa", "Invalid code");
  }
  clearAttempts(key);
  await clearPendingLogin();
  if (how === "recovery") await audit({ account: acc!, actor: null }, "auth.recovery_code_used");
  return finishLogin(acc!);
}

export async function logout() {
  const sess = await getSession();
  if (sess) await audit(sess, "auth.logout");
  await destroySession();
  redirect("/login");
}

/** Security settings belong to the real account owner - never to someone impersonating it. */
async function requireOwnSession() {
  const sess = await requireSession();
  if (sess.impersonating) throw new Error("Not available while logged in as another account");
  return sess;
}

export async function changePassword(fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/account`, async () => {
    if (sess.impersonating) throw new Error("Not available while logged in as another account");
    if (!(await verifyAdminPassword(s(fd, "current"), sess.account.passwordHash))) throw new Error("Current password is wrong");
    const pw = passwordSchema.parse(s(fd, "next"));
    const updated = await prisma.account.update({ where: { id: sess.account.id }, data: { passwordHash: await hashAdminPassword(pw) } });
    await createSession(updated); // the old cookie is now invalid (password fingerprint changed)
    await audit(sess, "account.password_changed");
    return "Password changed";
  });
}

// ---------- TOTP 2FA ----------
export async function startTotpSetup() {
  const sess = await requireSession();
  return run(`${sess.base}/account`, async () => {
    await requireOwnSession();
    if (sess.account.totpEnabled) throw new Error("Two-factor authentication is already enabled");
    await prisma.account.update({ where: { id: sess.account.id }, data: { totpSecret: seal(generateSecret()) } });
  });
}

export async function confirmTotpSetup(fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/account`, async () => {
    await requireOwnSession();
    const secret = sess.account.totpSecret ? unseal(sess.account.totpSecret) : null;
    if (sess.account.totpEnabled || !secret) throw new Error("Start the setup first");
    const step = verifyTotp(secret, s(fd, "code"), null);
    if (step === null) throw new Error("That code is not valid - check the time on your phone and try again");
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").replace(/^(.{5})(.{5})$/, "$1-$2"));
    await prisma.account.update({ where: { id: sess.account.id }, data: { totpEnabled: true, totpLastStep: step, recoveryCodes: codes.map((c) => sha256(c.replace("-", ""))) } });
    await setRecoveryFlash(codes);
    await audit(sess, "account.2fa_enabled");
    return "Two-factor authentication enabled - save your recovery codes below";
  });
}

export async function cancelTotpSetup() {
  const sess = await requireSession();
  return run(`${sess.base}/account`, async () => {
    await requireOwnSession();
    if (!sess.account.totpEnabled) await prisma.account.update({ where: { id: sess.account.id }, data: { totpSecret: null } });
  });
}

export async function disableTotp(fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/account`, async () => {
    await requireOwnSession();
    if (!(await verifyAdminPassword(s(fd, "password"), sess.account.passwordHash))) throw new Error("Password is wrong");
    if (!(await consumeSecondFactor(sess.account, s(fd, "code")))) throw new Error("Invalid code");
    await prisma.account.update({ where: { id: sess.account.id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: [] } });
    await audit(sess, "account.2fa_disabled");
    return "Two-factor authentication disabled";
  });
}

// ---------- impersonation ----------
export async function stopImpersonating() {
  const sess = await requireSession();
  if (!sess.actor) redirect(sess.base);
  const actor = sess.actor!;
  await audit(sess, "impersonate.stop", { target: sess.account.username });
  await createSession(actor);
  redirect(`/admin/accounts/${sess.account.id}`);
}
