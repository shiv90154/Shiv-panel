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

// Retry backoff in seconds after attempt 1, 2, 3, 4 fail; attempt 5 is the last try. Kept short: billing systems should
// reconcile via the API for anything older than a few hours, not wait on a webhook forever (see DECISIONS #22).
const BACKOFF_SEC = [60, 300, 1800, 7200];
const MAX_ATTEMPTS = BACKOFF_SEC.length + 1;
const STALE_SENDING_MS = 2 * 60_000; // a "sending" row this old means the process died mid-delivery
const KEEP_DELIVERIES = 20;

async function attempt(hook: { url: string; secret: string }, event: string, body: string): Promise<{ ok: boolean; httpStatus: number | null; error: string | null }> {
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
    return { ok: res.ok, httpStatus: res.status, error: res.ok ? null : `http ${res.status}` };
  } catch (e) {
    return { ok: false, httpStatus: null, error: (e instanceof Error ? e.message : "failed").slice(0, 200) };
  }
}

/** Claims one pending/due delivery row and runs it, scheduling a retry row on failure. Safe to call concurrently: only the caller that flips pending->sending proceeds. */
async function runDelivery(id: string) {
  const claimed = await prisma.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { status: "sending" } });
  if (!claimed.count) return;
  const del = await prisma.webhookDelivery.findUnique({ where: { id }, include: { webhook: true } });
  if (!del) return;
  const r = await attempt(del.webhook, del.event, del.body);
  await prisma.webhookDelivery.update({ where: { id }, data: { status: r.ok ? "ok" : "error", httpStatus: r.httpStatus, error: r.error } });
  await prisma.webhook.update({ where: { id: del.webhookId }, data: { lastAt: new Date(), lastStatus: r.ok ? `ok ${r.httpStatus}` : (r.error ?? "error"), failures: r.ok ? 0 : { increment: 1 } } }).catch(() => {});
  if (!r.ok && del.attempt < MAX_ATTEMPTS) {
    const delaySec = BACKOFF_SEC[del.attempt - 1];
    await prisma.webhookDelivery.create({ data: { webhookId: del.webhookId, event: del.event, body: del.body, attempt: del.attempt + 1, status: "pending", nextAttemptAt: new Date(Date.now() + delaySec * 1000) } });
  }
  await pruneDeliveries(del.webhookId);
}

async function pruneDeliveries(webhookId: string) {
  const old = await prisma.webhookDelivery.findMany({ where: { webhookId }, orderBy: { createdAt: "desc" }, skip: KEEP_DELIVERIES, select: { id: true } });
  if (old.length) await prisma.webhookDelivery.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
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
    await Promise.all(hooks.map(async (h) => {
      const del = await prisma.webhookDelivery.create({ data: { webhookId: h.id, event, body, attempt: 1, status: "pending", nextAttemptAt: new Date() } });
      await runDelivery(del.id);
    }));
  })().catch((e) => console.error("[webhook]", e));
}

/** Called once a minute by the job ticker: requeues stale "sending" rows (crashed mid-delivery) then runs whatever is due. */
export async function processDueWebhookDeliveries() {
  await prisma.webhookDelivery.updateMany({ where: { status: "sending", createdAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } }, data: { status: "pending", nextAttemptAt: new Date() } });
  const due = await prisma.webhookDelivery.findMany({ where: { status: "pending", nextAttemptAt: { lte: new Date() } }, select: { id: true }, take: 200 });
  for (const d of due) await runDelivery(d.id);
}
