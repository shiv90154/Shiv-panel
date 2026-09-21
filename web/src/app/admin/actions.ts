"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { clearAttempts, recordAttempt, tooManyAttempts } from "@/lib/ratelimit";
import { clientIp, createAdminSession, destroyAdminSession, requireAdmin } from "@/lib/session";
import { hashAdminPassword, hashMailboxPassword, verifyAdminPassword } from "@/lib/password";
import { applyRecordsToCloudflare, cloudflareEnabled } from "@/lib/cloudflare";
import { expectedRecords } from "@/lib/dns";
import { syncDkimFiles } from "@/lib/dkim";
import { createAlias, createDomain, createMailbox, deleteDomain, deleteMailbox, passwordSchema, rotateDkim, verifyDomainDns } from "@/server/domains";

export async function login(fd: FormData) {
  const email = s(fd, "email").toLowerCase();
  const key = `admin:${await clientIp()}:${email}`;
  if (tooManyAttempts(key)) redirect("/admin/login?error=" + encodeURIComponent("Too many attempts, try again in 15 minutes"));
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !(await verifyAdminPassword(s(fd, "password"), admin.passwordHash))) {
    recordAttempt(key);
    redirect("/admin/login?error=" + encodeURIComponent("Invalid email or password"));
  }
  clearAttempts(key);
  await createAdminSession(admin.id);
  redirect("/admin");
}

export async function logout() {
  await destroyAdminSession();
  redirect("/admin/login");
}

export async function changeAdminPassword(fd: FormData) {
  const admin = await requireAdmin();
  return run("/admin/account", async () => {
    if (!(await verifyAdminPassword(s(fd, "current"), admin.passwordHash))) throw new Error("Current password is wrong");
    const pw = passwordSchema.parse(s(fd, "next"));
    await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hashAdminPassword(pw) } });
    return "Password changed";
  });
}

// ---------- domains ----------
export async function addDomain(fd: FormData) {
  await requireAdmin();
  let id = "";
  await run("/admin/domains", async () => {
    const d = await createDomain(s(fd, "name"), { defaultQuotaMb: Number(s(fd, "quota")) || 1024 });
    id = d.id;
  }).catch((e) => { if (id) redirect(`/admin/domains/${id}?ok=${encodeURIComponent("Domain added - now publish the DNS records below")}`); throw e; });
}

export async function updateDomain(id: string, fd: FormData) {
  await requireAdmin();
  return run(`/admin/domains/${id}`, async () => {
    const data = z.object({
      dmarcPolicy: z.enum(["none", "quarantine", "reject"]),
      spfQualifier: z.enum(["~all", "-all"]),
      dmarcReportEmail: z.string().email().or(z.literal("")),
      defaultQuotaMb: z.coerce.number().int().min(0).max(1_000_000),
      maxMailboxes: z.coerce.number().int().min(0).max(100000),
    }).parse({ dmarcPolicy: s(fd, "dmarcPolicy"), spfQualifier: s(fd, "spfQualifier"), dmarcReportEmail: s(fd, "dmarcReportEmail"), defaultQuotaMb: s(fd, "defaultQuotaMb"), maxMailboxes: s(fd, "maxMailboxes") });
    await prisma.domain.update({ where: { id }, data: { ...data, dmarcReportEmail: data.dmarcReportEmail || null, active: fd.get("active") === "on", dnsVerified: false } });
    return "Domain updated (DNS values changed? re-publish and re-verify)";
  });
}

export async function removeDomain(id: string) {
  await requireAdmin();
  return run("/admin/domains", async () => { await deleteDomain(id); return "Domain and all its mailboxes deleted"; });
}

export async function verifyDns(id: string) {
  await requireAdmin();
  return run(`/admin/domains/${id}`, async () => { await verifyDomainDns(id); return "DNS re-checked"; });
}

export async function newDkim(id: string) {
  await requireAdmin();
  return run(`/admin/domains/${id}`, async () => { await rotateDkim(id); return "New DKIM key generated - publish the new DNS record"; });
}

export async function pushToCloudflare(id: string) {
  await requireAdmin();
  return run(`/admin/domains/${id}`, async () => {
    if (!cloudflareEnabled()) throw new Error("CLOUDFLARE_API_TOKEN is not configured");
    const d = await prisma.domain.findUniqueOrThrow({ where: { id } });
    const r = await applyRecordsToCloudflare(d.name, expectedRecords(d));
    return `Cloudflare: ${r.map((x) => `${x.key} ${x.action}`).join(", ")}. DNS may take a minute to propagate.`;
  });
}

// ---------- mailboxes ----------
export async function addMailbox(back: string, fd: FormData) {
  await requireAdmin();
  return run(back, async () => {
    const m = await createMailbox(s(fd, "domainId"), { localPart: s(fd, "localPart"), password: s(fd, "password"), displayName: s(fd, "displayName"), quotaMb: s(fd, "quota") === "" ? undefined : Number(s(fd, "quota")) });
    return `Created ${m.email}`;
  });
}

export async function editMailbox(id: string, back: string, fd: FormData) {
  await requireAdmin();
  return run(back, async () => {
    const quotaMb = z.coerce.number().int().min(0).parse(s(fd, "quota"));
    const data: { displayName: string | null; quotaMb: number; active: boolean; passwordHash?: string } = { displayName: s(fd, "displayName") || null, quotaMb, active: fd.get("active") === "on" };
    if (s(fd, "password")) data.passwordHash = await hashMailboxPassword(passwordSchema.parse(s(fd, "password")));
    const m = await prisma.mailbox.update({ where: { id }, data });
    return `Updated ${m.email}`;
  });
}

export async function removeMailbox(id: string, back: string, fd: FormData) {
  await requireAdmin();
  return run(back, async () => { await deleteMailbox(id, { purge: fd.get("purge") !== "keep" }); return "Mailbox deleted"; });
}

// ---------- aliases ----------
export async function addAlias(back: string, fd: FormData) {
  await requireAdmin();
  return run(back, async () => { const a = await createAlias(s(fd, "domainId"), s(fd, "source"), s(fd, "destinations")); return `Alias ${a.source} created`; });
}
export async function toggleAlias(id: string, back: string) {
  await requireAdmin();
  return run(back, async () => { const a = await prisma.alias.findUniqueOrThrow({ where: { id } }); await prisma.alias.update({ where: { id }, data: { active: !a.active } }); });
}
export async function removeAlias(id: string, back: string) {
  await requireAdmin();
  return run(back, async () => { await prisma.alias.delete({ where: { id } }); return "Alias deleted"; });
}

export async function resyncDkim() {
  await requireAdmin();
  return run("/admin/server", async () => { await syncDkimFiles(); return "DKIM key files re-written"; });
}
