import { config } from "./config";
import type { DnsRecord } from "./dns";

export const cloudflareEnabled = () => !!config.cloudflareToken;

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.cloudflareToken}`, "Content-Type": "application/json" },
  });
  const json = (await res.json()) as { success: boolean; result: T; errors?: { message: string }[] };
  if (!json.success) throw new Error(json.errors?.map((e) => e.message).join("; ") || `Cloudflare error ${res.status}`);
  return json.result;
}

async function findZone(domain: string): Promise<string> {
  const labels = domain.split(".");
  for (let i = 0; i <= labels.length - 2; i++) {
    const name = labels.slice(i).join(".");
    const zones = await cf<{ id: string }[]>(`/zones?name=${encodeURIComponent(name)}`);
    if (zones[0]) return zones[0].id;
  }
  throw new Error(`No Cloudflare zone found for ${domain} (does the token have access?)`);
}

/** Creates or updates each record in the domain's Cloudflare zone. Returns a per-record report. */
export async function applyRecordsToCloudflare(domain: string, records: DnsRecord[]) {
  const zone = await findZone(domain);
  const report: { key: string; action: string }[] = [];
  for (const r of records) {
    const existing = await cf<{ id: string; content: string }[]>(`/zones/${zone}/dns_records?type=${r.type}&name=${encodeURIComponent(r.name)}`);
    const match = r.type === "TXT" ? existing.find((e) => e.content.replace(/"/g, "").toLowerCase().startsWith(r.value.slice(0, 8).toLowerCase())) : existing[0];
    const body = JSON.stringify({ type: r.type, name: r.name, content: r.value, priority: r.priority, ttl: 1, proxied: false });
    if (match) {
      await cf(`/zones/${zone}/dns_records/${match.id}`, { method: "PUT", body });
      report.push({ key: r.key, action: "updated" });
    } else {
      await cf(`/zones/${zone}/dns_records`, { method: "POST", body });
      report.push({ key: r.key, action: "created" });
    }
  }
  return report;
}
