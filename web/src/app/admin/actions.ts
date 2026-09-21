"use server";

// Mail-management actions, shared by the WHM shell (/admin: admin + reseller) and the cPanel shell (/cpanel: user).
// Every action: session first, then an ownership lookup (getOwned*/assertInScope) BEFORE touching the record.
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireRole, requireSession } from "@/lib/session";
import { assertInScope, getOwnedAlias, getOwnedDomain, getOwnedMailbox } from "@/lib/tenancy";
import { hashMailboxPassword } from "@/lib/password";
import { applyRecordsToCloudflare, cloudflareEnabled } from "@/lib/cloudflare";
import { expectedRecords } from "@/lib/dns";
import { syncDkimFiles } from "@/lib/dkim";
import { createAlias, createDomain, createMailbox, deleteDomain, deleteMailbox, passwordSchema, rotateDkim, verifyDomainDns } from "@/server/domains";

// ---------- domains ----------
export async function addDomain(fd: FormData) {
  const sess = await requireSession();
  let id = "";
  await run(`${sess.base}/domains`, async () => {
    const ownerId = s(fd, "ownerId") || sess.account.id;
    await assertInScope(sess, ownerId);
    const d = await createDomain(s(fd, "name"), { accountId: ownerId, defaultQuotaMb: Number(s(fd, "quota")) || 1024 });
    id = d.id;
    await audit(sess, "domain.create", { target: d.name, accountId: ownerId });
  }).catch((e) => { if (id) redirect(`${sess.base}/domains/${id}?ok=${encodeURIComponent("Domain added - now publish the DNS records below")}`); throw e; });
}

export async function updateDomain(id: string, fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/domains/${id}`, async () => {
    const dom = await getOwnedDomain(sess, id);
    const data = z.object({
      dmarcPolicy: z.enum(["none", "quarantine", "reject"]),
      spfQualifier: z.enum(["~all", "-all"]),
      dmarcReportEmail: z.string().email().or(z.literal("")),
      defaultQuotaMb: z.coerce.number().int().min(0).max(1_000_000),
      maxMailboxes: z.coerce.number().int().min(0).max(100000),
    }).parse({ dmarcPolicy: s(fd, "dmarcPolicy"), spfQualifier: s(fd, "spfQualifier"), dmarcReportEmail: s(fd, "dmarcReportEmail"), defaultQuotaMb: s(fd, "defaultQuotaMb"), maxMailboxes: s(fd, "maxMailboxes") });
    await prisma.domain.update({ where: { id: dom.id }, data: { ...data, dmarcReportEmail: data.dmarcReportEmail || null, active: fd.get("active") === "on", dnsVerified: false } });
    await audit(sess, "domain.update", { target: dom.name, accountId: dom.accountId });
    return "Domain updated (DNS values changed? re-publish and re-verify)";
  });
}

export async function removeDomain(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/domains`, async () => {
    const dom = await getOwnedDomain(sess, id);
    await deleteDomain(dom.id);
    await audit(sess, "domain.delete", { target: dom.name, accountId: dom.accountId });
    return "Domain and all its mailboxes deleted";
  });
}

export async function verifyDns(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/domains/${id}`, async () => { const dom = await getOwnedDomain(sess, id); await verifyDomainDns(dom.id); return "DNS re-checked"; });
}

export async function newDkim(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/domains/${id}`, async () => {
    const dom = await getOwnedDomain(sess, id);
    await rotateDkim(dom.id);
    await audit(sess, "domain.dkim_rotate", { target: dom.name, accountId: dom.accountId });
    return "New DKIM key generated - publish the new DNS record";
  });
}

// The Cloudflare token belongs to the server owner, so only admins may use it.
export async function pushToCloudflare(id: string) {
  const sess = await requireRole("admin");
  return run(`${sess.base}/domains/${id}`, async () => {
    if (!cloudflareEnabled()) throw new Error("CLOUDFLARE_API_TOKEN is not configured");
    const d = await getOwnedDomain(sess, id);
    const r = await applyRecordsToCloudflare(d.name, expectedRecords(d));
    await audit(sess, "domain.cloudflare_push", { target: d.name, accountId: d.accountId });
    return `Cloudflare: ${r.map((x) => `${x.key} ${x.action}`).join(", ")}. DNS may take a minute to propagate.`;
  });
}

// ---------- mailboxes ----------
export async function addMailbox(back: string, fd: FormData) {
  const sess = await requireSession();
  return run(back, async () => {
    const dom = await getOwnedDomain(sess, s(fd, "domainId"));
    const m = await createMailbox(dom.id, { localPart: s(fd, "localPart"), password: s(fd, "password"), displayName: s(fd, "displayName"), quotaMb: s(fd, "quota") === "" ? undefined : Number(s(fd, "quota")) });
    await audit(sess, "mailbox.create", { target: m.email, accountId: dom.accountId });
    return `Created ${m.email}`;
  });
}

export async function editMailbox(id: string, back: string, fd: FormData) {
  const sess = await requireSession();
  return run(back, async () => {
    const box = await getOwnedMailbox(sess, id);
    const quotaMb = z.coerce.number().int().min(0).parse(s(fd, "quota"));
    const data: { displayName: string | null; quotaMb: number; active: boolean; passwordHash?: string } = { displayName: s(fd, "displayName") || null, quotaMb, active: fd.get("active") === "on" };
    if (s(fd, "password")) data.passwordHash = await hashMailboxPassword(passwordSchema.parse(s(fd, "password")));
    const m = await prisma.mailbox.update({ where: { id: box.id }, data });
    await audit(sess, "mailbox.update", { target: m.email, accountId: box.accountId, detail: { passwordChanged: !!data.passwordHash } });
    return `Updated ${m.email}`;
  });
}

export async function removeMailbox(id: string, back: string, fd: FormData) {
  const sess = await requireSession();
  return run(back, async () => {
    const box = await getOwnedMailbox(sess, id);
    await deleteMailbox(box.id, { purge: fd.get("purge") !== "keep" });
    await audit(sess, "mailbox.delete", { target: box.email, accountId: box.accountId });
    return "Mailbox deleted";
  });
}

// ---------- aliases ----------
export async function addAlias(back: string, fd: FormData) {
  const sess = await requireSession();
  return run(back, async () => {
    const dom = await getOwnedDomain(sess, s(fd, "domainId"));
    const a = await createAlias(dom.id, s(fd, "source"), s(fd, "destinations"));
    await audit(sess, "alias.create", { target: a.source, accountId: dom.accountId });
    return `Alias ${a.source} created`;
  });
}
export async function toggleAlias(id: string, back: string) {
  const sess = await requireSession();
  return run(back, async () => {
    const a = await getOwnedAlias(sess, id);
    await prisma.alias.update({ where: { id: a.id }, data: { active: !a.active } });
    await audit(sess, a.active ? "alias.disable" : "alias.enable", { target: a.source, accountId: a.accountId });
  });
}
export async function removeAlias(id: string, back: string) {
  const sess = await requireSession();
  return run(back, async () => {
    const a = await getOwnedAlias(sess, id);
    await prisma.alias.delete({ where: { id: a.id } });
    await audit(sess, "alias.delete", { target: a.source, accountId: a.accountId });
    return "Alias deleted";
  });
}

export async function resyncDkim() {
  const sess = await requireRole("admin");
  return run("/admin/server", async () => { await syncDkimFiles(); await audit(sess, "server.dkim_resync"); return "DKIM key files re-written"; });
}
