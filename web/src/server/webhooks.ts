import "server-only";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { seal, unseal } from "@/lib/crypto";
import { isPrivateIp, signPayload, type WebhookEvent } from "@/lib/webhook-core";

/** Refuse hosts that resolve to private space (re-checked per delivery: DNS can change after the URL was saved). */
async function assertPublicHost(url: string) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const addrs = (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error("resolves to a private address");
}

export const newWebhookSecret = () => "whsec_" + crypto.randomBytes(24).toString("base64url");
export const sealSecret = seal;

async function deliver(hook: { id: string; url: string; secret: string }, body: string) {
  let status: string;
  try {
    await assertPublicHost(hook.url);
    const secret = unseal(hook.secret);
    if (!secret) throw new Error("secret unreadable");
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(hook.url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json", "user-agent": "ShivAppHub-Webhook/1", "x-webhook-timestamp": String(ts), "x-webhook-signature": signPayload(secret, ts, body) },
      body,
    });
    status = res.ok ? `ok ${res.status}` : `http ${res.status}`;
  } catch (e) {
    status = "error: " + (e instanceof Error ? e.message : "failed").slice(0, 100);
  }
  const ok = status.startsWith("ok");
  await prisma.webhook.update({ where: { id: hook.id }, data: { lastAt: new Date(), lastStatus: status, failures: ok ? 0 : { increment: 1 } } }).catch(() => {});
}

/** Fire-and-forget: notifies the webhooks of every ancestor (reseller, admin) of `accountId`, plus the account's own if it is one. Never throws. */
export function emitAccountEvent(event: WebhookEvent, account: { id: string; username: string; email: string; role: string; parentId: string | null; packageId?: string | null }, extra: Record<string, unknown> = {}) {
  void (async () => {
    const nodes = await prisma.account.findMany({ select: { id: true, parentId: true } });
    const parent = new Map(nodes.map((n) => [n.id, n.parentId]));
    const owners: string[] = [];
    for (let id = account.parentId, i = 0; id && i < 10; id = parent.get(id) ?? null, i++) owners.push(id);
    if (!owners.length) return;
    const hooks = await prisma.webhook.findMany({ where: { accountId: { in: owners }, active: true } });
    const body = JSON.stringify({ event, time: new Date().toISOString(), account: { id: account.id, username: account.username, email: account.email, role: account.role }, ...extra });
    await Promise.all(hooks.map((h) => deliver(h, body)));
  })().catch((e) => console.error("[webhook]", e));
}
