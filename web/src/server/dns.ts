import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { expectedRecords } from "@/lib/dns";
import { agentCall, type DnsRecordInput } from "./agent";

export const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA", "NS"] as const;
export const zoneNameSchema = z.string().trim().toLowerCase().regex(/^([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/, "Enter a domain like example.com");
export const recordSchema = z.object({
  name: z.string().trim().toLowerCase().max(253),
  type: z.enum(RECORD_TYPES),
  value: z.string().trim().min(1).max(4000),
  priority: z.coerce.number().int().min(0).max(65535).optional(),
  ttl: z.coerce.number().int().min(60).max(86400).default(3600),
});

const dotted = (n: string) => (n.endsWith(".") ? n : `${n}.`);

/** Starter records for a new zone: web + www -> this server, plus the mail set when the domain is also hosted for email. */
export async function templateRecords(zone: string): Promise<DnsRecordInput[]> {
  const out: DnsRecordInput[] = [];
  if (config.ipv4) out.push({ name: "@", type: "A", value: config.ipv4 }, { name: "www", type: "CNAME", value: zone });
  const d = await prisma.domain.findUnique({ where: { name: zone } });
  if (d) for (const r of expectedRecords(d)) out.push({ name: r.name, type: r.type, value: r.value, priority: r.priority });
  return out;
}

/** Zone names are one global namespace: refuse a name that is, contains, or sits under a zone owned by someone else. */
async function assertNameFree(accountId: string, name: string) {
  const clash = await prisma.dnsZone.findFirst({ where: { accountId: { not: accountId }, OR: [{ name }, { name: { endsWith: `.${name}` } }, { name: { in: parents(name) } }] }, select: { id: true } });
  if (clash || (await prisma.dnsZone.findUnique({ where: { name }, select: { id: true } }))) throw new Error(`The zone ${name} is not available`);
}
const parents = (n: string) => { const l = n.split("."); return l.slice(1, -1).map((_, i) => l.slice(i + 1).join(".")); }; // parent zones, excluding the bare TLD

export async function createZone(a: { accountId: string; name: string; template: boolean }) {
  const name = zoneNameSchema.parse(a.name);
  await assertNameFree(a.accountId, name);
  // A mail domain of the same name must belong to the same account, otherwise its DKIM key would leak into someone else's zone.
  const dom = await prisma.domain.findUnique({ where: { name }, select: { accountId: true } });
  if (dom && dom.accountId !== a.accountId) throw new Error(`The zone ${name} is not available`);
  const row = await prisma.dnsZone.create({ data: { accountId: a.accountId, name } });
  try { await agentCall("dns.zoneCreate", { zone: name, records: a.template ? await templateRecords(name) : [] }, a.accountId, 30_000); }
  catch (e) { await prisma.dnsZone.delete({ where: { id: row.id } }); throw e; }
  return row;
}

export async function deleteZone(id: string) {
  const zn = await prisma.dnsZone.findUniqueOrThrow({ where: { id } });
  await agentCall("dns.zoneDelete", { zone: zn.name }, zn.accountId, 30_000);
  await prisma.dnsZone.delete({ where: { id } });
}

export const getZoneRecords = (zn: { name: string; accountId: string }) => agentCall("dns.zoneGet", { zone: zn.name }, zn.accountId, 15_000);

export async function addRecord(zn: { name: string; accountId: string }, input: unknown) {
  const r = recordSchema.parse(input);
  await agentCall("dns.recordAdd", { zone: zn.name, ...r }, zn.accountId);
  return r;
}
export const deleteRecord = (zn: { name: string; accountId: string }, r: { name: string; type: string; content: string }) =>
  agentCall("dns.recordDelete", { zone: zn.name, name: dotted(r.name), type: r.type, content: r.content }, zn.accountId);
export const setDnssec = (zn: { name: string; accountId: string }, enable: boolean) => agentCall("dns.dnssec", { zone: zn.name, enable }, zn.accountId, 30_000);
