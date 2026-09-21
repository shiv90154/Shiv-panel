import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge, DataTable, Flash, SectionCard } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { getOwnedZone } from "@/lib/tenancy";
import { RECORD_TYPES, getZoneRecords } from "@/server/dns";
import { addZoneRecord, removeZoneRecord, toggleDnssec } from "../../../dns-actions";

export const dynamic = "force-dynamic";

const HINT: Record<string, string> = {
  A: "IPv4 address", AAAA: "IPv6 address", CNAME: "target hostname", MX: "mail server hostname (set priority)", TXT: "text", NS: "nameserver hostname (not at the apex)",
  SRV: "weight port target (set priority)", CAA: "flags tag value, e.g. 0 issue letsencrypt.org",
};

export default async function ZonePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ id }, sp, s] = await Promise.all([params, searchParams, requireSession()]);
  const zn = await getOwnedZone(s, id).catch(() => notFound());
  const data = await getZoneRecords(zn).catch((e) => ({ error: e instanceof Error ? e.message : "PowerDNS unavailable" }));
  if ("error" in data) return <><h1>{zn.name}</h1><p className="sub"><Link href={`${s.base}/dns`}>← DNS zones</Link></p><p className="flash bad">{data.error}</p></>;
  const rows = data.records.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  const rel = (n: string) => { const x = n.replace(/\.$/, ""); return x === zn.name ? "@" : x.slice(0, -zn.name.length - 1); };
  const locked = (r: { name: string; type: string }) => r.type === "SOA" || (r.type === "NS" && rel(r.name) === "@");
  return (
    <>
      <h1>{zn.name} {data.dnssec.enabled ? <Badge kind="ok">DNSSEC</Badge> : <Badge kind="off">no DNSSEC</Badge>}</h1>
      <p className="sub"><Link href={`${s.base}/dns`}>← DNS zones</Link></p>
      <Flash {...sp} />
      <SectionCard title="Add record">
        <form action={addZoneRecord.bind(null, zn.id)} className="row">
          <div><label>Name</label><input name="name" placeholder="@ or www" defaultValue="@" required /></div>
          <div><label>Type</label><select name="type" defaultValue="A">{RECORD_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label>Value</label><input name="value" required style={{ minWidth: 260 }} placeholder="see hints below" /></div>
          <div><label>Priority (MX/SRV)</label><input name="priority" type="number" min={0} max={65535} style={{ width: 90 }} /></div>
          <div><label>TTL</label><input name="ttl" type="number" min={60} max={86400} defaultValue={3600} style={{ width: 90 }} /></div>
          <div className="auto"><button className="primary">Add</button></div>
        </form>
        <p className="muted">{RECORD_TYPES.map((t) => `${t}: ${HINT[t]}`).join(" · ")}. Adding to an existing name and type adds another value to that set.</p>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={rows} rowKey={(r) => `${r.name}|${r.type}|${r.content}`} empty="No records."
          columns={[
            { header: "Name", className: "mono", render: (r) => rel(r.name) },
            { header: "Type", render: (r) => r.type },
            { header: "Value", className: "mono", render: (r) => r.content },
            { header: "TTL", render: (r) => r.ttl },
            { header: "", render: (r) => locked(r) ? <span className="muted">managed</span> : (
              <form action={removeZoneRecord.bind(null, zn.id)}>
                <input type="hidden" name="name" value={r.name} /><input type="hidden" name="type" value={r.type} /><input type="hidden" name="content" value={r.content} />
                <button className="sm danger">Delete</button>
              </form>
            ) },
          ]}
        />
      </SectionCard>
      <SectionCard title="DNSSEC">
        {data.dnssec.enabled ? (
          <>
            <p className="muted">Publish this DS record at your registrar to complete the chain of trust.</p>
            {data.dnssec.ds.map((d) => <pre key={d} className="mono">{`${zn.name}. IN DS ${d}`}</pre>)}
            <form action={toggleDnssec.bind(null, zn.id, false)}><button className="sm danger">Disable DNSSEC</button></form>
          </>
        ) : (
          <form action={toggleDnssec.bind(null, zn.id, true)}><button>Enable DNSSEC (ECDSA P-256)</button></form>
        )}
      </SectionCard>
    </>
  );
}
