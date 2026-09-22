"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { generateApiKey } from "@/lib/apikey";
import { seal } from "@/lib/crypto";
import { requireRole } from "@/lib/session";
import { checkWebhookUrl } from "@/lib/webhook-core";
import { newWebhookSecret } from "@/server/webhooks";

const PATH = "/admin/api";

const EXPIRY_DAYS = { "": null, "30": 30, "90": 90, "365": 365 } as const;

export async function createApiKey(fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  return run(PATH, async () => {
    if (sess.impersonating) throw new Error("Not available while impersonating");
    const name = z.string().trim().min(1, "Name is required").max(60).parse(s(fd, "name"));
    const scope = z.enum(["full", "read"]).parse(s(fd, "scope") || "full");
    const days = z.enum(["", "30", "90", "365"]).parse(s(fd, "expires"));
    const expiresAt = EXPIRY_DAYS[days] ? new Date(Date.now() + EXPIRY_DAYS[days]! * 86400_000) : null;
    if ((await prisma.apiKey.count({ where: { accountId: sess.account.id, revokedAt: null } })) >= 20) throw new Error("Too many active keys - revoke one first");
    const k = generateApiKey();
    await prisma.apiKey.create({ data: { accountId: sess.account.id, name, prefix: k.prefix, keyHash: k.keyHash, scope, expiresAt } });
    await audit(sess, "apikey.create", { target: name, detail: { scope, expiresAt } });
    return "KEY:" + seal(k.key); // page shows the key once; never stored in clear
  });
}

export async function revokeApiKey(id: string) {
  const sess = await requireRole("admin", "reseller");
  return run(PATH, async () => {
    const k = await prisma.apiKey.findFirst({ where: { id, accountId: sess.account.id } });
    if (!k) throw new Error("Not found");
    await prisma.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
    await audit(sess, "apikey.revoke", { target: k.name });
    return "Key revoked";
  });
}

export async function addWebhook(fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  return run(PATH, async () => {
    if (sess.impersonating) throw new Error("Not available while impersonating");
    const url = checkWebhookUrl(s(fd, "url"));
    if ((await prisma.webhook.count({ where: { accountId: sess.account.id } })) >= 10) throw new Error("Webhook limit reached (10)");
    const secret = newWebhookSecret();
    await prisma.webhook.create({ data: { accountId: sess.account.id, url, secret: seal(secret) } });
    await audit(sess, "webhook.create", { target: new URL(url).host });
    return "SECRET:" + seal(secret);
  });
}

export async function toggleWebhook(id: string) {
  const sess = await requireRole("admin", "reseller");
  return run(PATH, async () => {
    const h = await prisma.webhook.findFirst({ where: { id, accountId: sess.account.id } });
    if (!h) throw new Error("Not found");
    await prisma.webhook.update({ where: { id: h.id }, data: { active: !h.active, failures: 0 } });
    return h.active ? "Webhook paused" : "Webhook enabled";
  });
}

export async function deleteWebhook(id: string) {
  const sess = await requireRole("admin", "reseller");
  return run(PATH, async () => {
    const h = await prisma.webhook.findFirst({ where: { id, accountId: sess.account.id } });
    if (!h) throw new Error("Not found");
    await prisma.webhook.delete({ where: { id: h.id } });
    await audit(sess, "webhook.delete", { target: new URL(h.url).host });
    return "Webhook deleted";
  });
}
