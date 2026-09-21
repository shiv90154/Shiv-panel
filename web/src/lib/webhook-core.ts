// Pure webhook helpers (no DB/Next) so they can be unit-tested.
import crypto from "node:crypto";
import net from "node:net";

export const WEBHOOK_EVENTS = ["account.created", "account.suspended", "account.unsuspended", "account.terminated", "account.package_changed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** `sha256=<hex>` HMAC over `<timestamp>.<body>`; receivers recompute and compare in constant time. */
export const signPayload = (secret: string, timestamp: number, body: string) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

/** True for loopback, private, link-local, CGNAT, multicast and unspecified addresses (v4 + v6). */
export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return l === "::" || l === "::1" || l.startsWith("fc") || l.startsWith("fd") || /^fe[89ab]/.test(l) || l.startsWith("ff");
  }
  return true; // not an IP: caller must resolve first
}

/** Syntactic check at save time: https only, no credentials, no literal private IPs / localhost. DNS is re-checked at delivery. */
export function checkWebhookUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "https:") throw new Error("Webhook URL must use https");
  if (u.username || u.password) throw new Error("Credentials in the URL are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("That host is not allowed");
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("Private addresses are not allowed");
  return u.toString();
}
