import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { Badge, Flash } from "@/components/ui";
import { ConfirmButton, CopyButton } from "@/components/client";
import { expectedRecords, type DnsCheck } from "@/lib/dns";
import { cloudflareEnabled } from "@/lib/cloudflare";
import { newDkim, pushToCloudflare, removeDomain, updateDomain, verifyDns } from "../../../actions";

export default async function DomainPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const d = await prisma.domain.findUnique({ where: { id }, include: { _count: { select: { mailboxes: true, aliases: true } } } });
  if (!d) notFound();
  const records = expectedRecords(d);
  const checks = (d.dnsStatus as DnsCheck[] | null) ?? [];
  return (
    <>
      <h1>{d.name} {d.active ? <Badge kind="ok">active</Badge> : <Badge kind="off">disabled</Badge>}</h1>
      <p className="sub"><Link href="/admin/domains">← Domains</Link> · <Link href={`/admin/mailboxes?domain=${d.id}`}>{d._count.mailboxes} mailboxes</Link> · <Link href={`/admin/aliases?domain=${d.id}`}>{d._count.aliases} aliases</Link></p>
      <Flash {...sp} />

      <div className="card">
        <h2>DNS records {d.dnsVerified ? <Badge kind="ok">verified</Badge> : <Badge kind="warn">not verified</Badge>}</h2>
        <p className="muted">Publish these at your DNS provider. {d.dnsCheckedAt && <>Last checked {d.dnsCheckedAt.toLocaleString()}.</>}</p>
        <table>
          <thead><tr><th>Type</th><th>Name</th><th>Value</th><th>Status</th></tr></thead>
          <tbody>
            {records.map((r) => {
              const c = checks.find((x) => x.key === r.key);
              return (
                <tr key={r.key}>
                  <td>{r.type}{r.priority !== undefined && ` (${r.priority})`}</td>
                  <td className="mono">{r.name}</td>
                  <td className="mono">{r.value} <CopyButton text={r.value} /><div className="muted">{r.purpose}{!r.required && " (optional)"}</div></td>
                  <td>{c ? <Badge kind={c.ok ? "ok" : r.required ? "bad" : "warn"}>{c.ok ? "OK" : "missing"}</Badge> : <Badge kind="off">unchecked</Badge>}{c && !c.ok && c.detail && <div className="muted">{c.detail}</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="actions" style={{ marginTop: 12 }}>
          <form action={verifyDns.bind(null, d.id)}><button className="primary">Verify DNS now</button></form>
          {cloudflareEnabled() && <form action={pushToCloudflare.bind(null, d.id)}><button>Publish to Cloudflare</button></form>}
          <form action={newDkim.bind(null, d.id)}><ConfirmButton message="Generate a new DKIM key? You must publish the new DNS record or signatures will fail." className="sm">Rotate DKIM key</ConfirmButton></form>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>Also make sure <b>{config.mailHostname}</b> has an A record to {config.ipv4 || "your server IP"} and that your VPS provider sets reverse DNS (PTR) for that IP to <b>{config.mailHostname}</b> (see Server status).</p>
      </div>

      <div className="card">
        <h2>Settings</h2>
        <form action={updateDomain.bind(null, d.id)}>
          <div className="row">
            <div><label>DMARC policy</label><select name="dmarcPolicy" defaultValue={d.dmarcPolicy}><option>none</option><option>quarantine</option><option>reject</option></select></div>
            <div><label>SPF ending</label><select name="spfQualifier" defaultValue={d.spfQualifier}><option value="~all">~all (soft fail)</option><option value="-all">-all (hard fail)</option></select></div>
            <div><label>DMARC report email</label><input name="dmarcReportEmail" type="email" defaultValue={d.dmarcReportEmail ?? ""} /></div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div><label>Default quota (MB, 0 = unlimited)</label><input name="defaultQuotaMb" type="number" min={0} defaultValue={d.defaultQuotaMb} /></div>
            <div><label>Max mailboxes (0 = unlimited)</label><input name="maxMailboxes" type="number" min={0} defaultValue={d.maxMailboxes} /></div>
            <div className="auto"><label>&nbsp;</label><label style={{ fontWeight: 400 }}><input type="checkbox" name="active" defaultChecked={d.active} style={{ width: "auto" }} /> Domain active</label></div>
          </div>
          <div style={{ marginTop: 12 }}><button className="primary">Save settings</button></div>
        </form>
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        <form action={removeDomain.bind(null, d.id)}><ConfirmButton message={`Delete ${d.name} with ALL its mailboxes, aliases and stored mail? This cannot be undone.`}>Delete domain and all mail</ConfirmButton></form>
      </div>
    </>
  );
}
