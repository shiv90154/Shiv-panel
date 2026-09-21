import { Resolver } from "node:dns/promises";
import { config } from "./config";
import { dkimTxtValue } from "./dkim";

export type DnsRecord = {
  key: string;
  type: "MX" | "TXT" | "CNAME";
  name: string; // fully qualified
  value: string;
  priority?: number;
  purpose: string;
  required: boolean;
};

type DomainDnsInput = {
  name: string;
  dkimSelector: string;
  dkimPublicKey: string;
  dmarcPolicy: string;
  dmarcReportEmail: string | null;
  spfQualifier: string;
};

export function expectedRecords(d: DomainDnsInput): DnsRecord[] {
  const spfParts = ["v=spf1"];
  if (config.ipv4) spfParts.push(`ip4:${config.ipv4}`);
  if (config.ipv6) spfParts.push(`ip6:${config.ipv6}`);
  if (!config.ipv4 && !config.ipv6) spfParts.push(`a:${config.mailHostname}`);
  spfParts.push(d.spfQualifier);
  const dmarc = [`v=DMARC1`, `p=${d.dmarcPolicy}`, d.dmarcReportEmail ? `rua=mailto:${d.dmarcReportEmail}` : "", "adkim=r", "aspf=r"].filter(Boolean).join("; ");
  return [
    { key: "mx", type: "MX", name: d.name, value: config.mailHostname, priority: 10, purpose: "Receive mail", required: true },
    { key: "spf", type: "TXT", name: d.name, value: spfParts.join(" "), purpose: "SPF: authorises this server to send", required: true },
    { key: "dkim", type: "TXT", name: `${d.dkimSelector}._domainkey.${d.name}`, value: dkimTxtValue(d.dkimPublicKey), purpose: "DKIM signature key", required: true },
    { key: "dmarc", type: "TXT", name: `_dmarc.${d.name}`, value: dmarc, purpose: "DMARC policy", required: true },
    { key: "autoconfig", type: "CNAME", name: `autoconfig.${d.name}`, value: config.mailHostname, purpose: "Thunderbird / mail client autoconfiguration", required: false },
    { key: "autodiscover", type: "CNAME", name: `autodiscover.${d.name}`, value: config.mailHostname, purpose: "Outlook autodiscover", required: false },
  ];
}

export type DnsCheck = { key: string; ok: boolean; found: string[]; detail: string };

const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

const norm = (s: string) => s.replace(/\.$/, "").toLowerCase();
const txt = async (name: string) => (await resolver.resolveTxt(name).catch(() => [])).map((c) => c.join(""));

export async function checkDomainDns(d: DomainDnsInput): Promise<DnsCheck[]> {
  const out: DnsCheck[] = [];

  const mx = (await resolver.resolveMx(d.name).catch(() => [])).sort((a, b) => a.priority - b.priority);
  out.push({
    key: "mx",
    ok: mx.some((m) => norm(m.exchange) === config.mailHostname),
    found: mx.map((m) => `${m.priority} ${norm(m.exchange)}`),
    detail: mx.length ? `Expected MX ${config.mailHostname}` : "No MX record found",
  });

  const spf = (await txt(d.name)).filter((t) => t.toLowerCase().startsWith("v=spf1"));
  const spfOk = spf.length === 1 && (config.ipv4 ? spf[0].includes(`ip4:${config.ipv4}`) || /\bmx\b/.test(spf[0]) : true);
  out.push({ key: "spf", ok: spfOk, found: spf, detail: spf.length > 1 ? "Multiple SPF records - only one is allowed" : spf.length ? "SPF must authorise this server's IP" : "No SPF record found" });

  const dkim = await txt(`${d.dkimSelector}._domainkey.${d.name}`);
  const pub = d.dkimPublicKey.replace(/\s/g, "");
  const dkimOk = dkim.some((t) => t.replace(/[\s"]/g, "").includes(`p=${pub}`));
  out.push({ key: "dkim", ok: dkimOk, found: dkim.map((t) => t.slice(0, 60) + "..."), detail: dkim.length ? (dkimOk ? "Public key matches" : "Record found but key does not match") : "No DKIM record found" });

  const dmarc = (await txt(`_dmarc.${d.name}`)).filter((t) => t.toUpperCase().startsWith("V=DMARC1"));
  out.push({ key: "dmarc", ok: dmarc.length === 1, found: dmarc, detail: dmarc.length ? "DMARC present" : "No DMARC record found" });

  for (const sub of ["autoconfig", "autodiscover"]) {
    const c = (await resolver.resolveCname(`${sub}.${d.name}`).catch(() => [])).map(norm);
    out.push({ key: sub, ok: c.includes(config.mailHostname), found: c, detail: c.length ? "" : "Optional - not set" });
  }
  return out;
}

export const isCoreDnsReady = (checks: DnsCheck[]) => ["mx", "spf", "dkim"].every((k) => checks.find((c) => c.key === k)?.ok);

/** Server-level checks: A record of the mail host and reverse DNS (PTR) - critical for deliverability. */
export async function checkServerDns() {
  const a = await resolver.resolve4(config.mailHostname).catch(() => [] as string[]);
  const ptr = config.ipv4 ? (await resolver.reverse(config.ipv4).catch(() => [] as string[])).map(norm) : [];
  return {
    hostname: config.mailHostname,
    a,
    aOk: !!config.ipv4 && a.includes(config.ipv4),
    ptr,
    ptrOk: ptr.includes(config.mailHostname),
    ipv4: config.ipv4,
  };
}
