"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { hashAdminPassword } from "@/lib/password";
import { createSession, requireRole } from "@/lib/session";
import { canImpersonate, creatableRoles, getManagedAccount, packageScope } from "@/lib/tenancy";
import { homeFor, type Role } from "@/lib/tenancy-core";
import { passwordSchema } from "@/server/domains";
import { setAccountStatus, terminateAccountCore } from "@/server/accounts";
import { emitAccountEvent } from "@/server/webhooks";

const RESERVED = new Set(["root", "postmaster", "mail", "www", "ftp", "webmaster", "hostmaster", "abuse", "support", "nobody", "system"]);
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9]{2,15}$/, "Username: 3-16 letters/digits, starting with a letter").refine((u) => !RESERVED.has(u), "That username is reserved");

async function pickPackage(sess: Awaited<ReturnType<typeof requireRole>>, id: string) {
  if (!id) return null;
  const pkg = await prisma.package.findFirst({ where: { id, ...packageScope(sess) } });
  if (!pkg) throw new Error("Package not found");
  return pkg;
}

export async function createAccount(fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  let newId = "";
  await run("/admin/accounts", async () => {
    const d = z.object({ username: usernameSchema, email: z.string().trim().toLowerCase().email(), password: passwordSchema, role: z.enum(["reseller", "user"]) })
      .parse({ username: s(fd, "username"), email: s(fd, "email"), password: s(fd, "password"), role: s(fd, "role") || "user" });
    if (!creatableRoles(sess.role).includes(d.role as Role)) throw new Error("You cannot create that type of account");
    let parentId = sess.account.id;
    if (sess.role === "admin" && d.role === "user" && s(fd, "parentId")) {
      const parent = await prisma.account.findFirst({ where: { id: s(fd, "parentId"), role: "reseller" } });
      if (!parent) throw new Error("Owner must be a reseller");
      parentId = parent.id;
    }
    const pkg = await pickPackage(sess, s(fd, "packageId"));
    if (!pkg && sess.role !== "admin") throw new Error("Choose a package");
    if (await prisma.account.findFirst({ where: { OR: [{ username: d.username }, { email: d.email }] } })) throw new Error("Username or email is already in use");
    const acc = await prisma.account.create({ data: { username: d.username, email: d.email, role: d.role, parentId, packageId: pkg?.id ?? null, passwordHash: await hashAdminPassword(d.password) } });
    newId = acc.id;
    emitAccountEvent("account.created", acc);
    await audit(sess, "account.create", { target: acc.username, accountId: acc.id, detail: { role: acc.role, package: pkg?.name ?? null } });
  }).catch((e) => { if (newId) redirect(`/admin/accounts/${newId}?ok=${encodeURIComponent("Account created")}`); throw e; });
}

export async function updateAccount(id: string, fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  return run(`/admin/accounts/${id}`, async () => {
    const acc = await getManagedAccount(sess, id);
    const email = z.string().trim().toLowerCase().email().parse(s(fd, "email"));
    const pkg = await pickPackage(sess, s(fd, "packageId"));
    if (!pkg && sess.role !== "admin") throw new Error("Choose a package");
    if (email !== acc.email && (await prisma.account.findUnique({ where: { email } }))) throw new Error("Email is already in use");
    await prisma.account.update({ where: { id: acc.id }, data: { email, packageId: pkg?.id ?? null } });
    if (pkg?.id !== acc.packageId) emitAccountEvent("account.package_changed", acc, { package: pkg?.name ?? null });
    await audit(sess, "account.update", { target: acc.username, accountId: acc.id, detail: { package: pkg?.name ?? null } });
    return "Account updated";
  });
}

export async function setAccountPassword(id: string, fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  return run(`/admin/accounts/${id}`, async () => {
    const acc = await getManagedAccount(sess, id);
    await prisma.account.update({ where: { id: acc.id }, data: { passwordHash: await hashAdminPassword(passwordSchema.parse(s(fd, "password"))) } }); // also signs the account out everywhere
    await audit(sess, "account.password_reset", { target: acc.username, accountId: acc.id });
    return "Password changed";
  });
}

export async function suspendAccount(id: string, fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  return run(`/admin/accounts/${id}`, async () => {
    const acc = await getManagedAccount(sess, id);
    const reason = s(fd, "reason").slice(0, 200) || null;
    await setAccountStatus(sess, acc, true, reason);
    return "Account suspended (panel login blocked)";
  });
}

export async function unsuspendAccount(id: string) {
  const sess = await requireRole("admin", "reseller");
  return run(`/admin/accounts/${id}`, async () => {
    const acc = await getManagedAccount(sess, id);
    await setAccountStatus(sess, acc, false);
    return "Account unsuspended";
  });
}

export async function resetTwoFactor(id: string) {
  const sess = await requireRole("admin", "reseller");
  return run(`/admin/accounts/${id}`, async () => {
    const acc = await getManagedAccount(sess, id);
    await prisma.account.update({ where: { id: acc.id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: [] } });
    await audit(sess, "account.2fa_reset", { target: acc.username, accountId: acc.id });
    return "Two-factor authentication removed";
  });
}

export async function terminateAccount(id: string, fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  let gone = "";
  return run(`/admin/accounts/${id}`, async () => {
    const acc = await getManagedAccount(sess, id);
    if (s(fd, "confirm") !== acc.username) throw new Error("Type the username to confirm");
    await terminateAccountCore(sess, acc);
    gone = acc.username;
  }).catch((e) => { if (gone) redirect(`/admin/accounts?ok=${encodeURIComponent(`Account ${gone} terminated`)}`); throw e; });
}

export async function impersonate(id: string) {
  const sess = await requireRole("admin", "reseller");
  if (sess.impersonating) redirect(sess.base);
  const target = await getManagedAccount(sess, id).catch(() => null);
  if (!target || !canImpersonate(sess.role, target.role as Role)) redirect("/admin/accounts?error=" + encodeURIComponent("Not found"));
  await audit(sess, "impersonate.start", { target: target!.username, accountId: target!.id });
  await createSession(target!, sess.account.id);
  redirect(homeFor(target!.role as Role));
}
