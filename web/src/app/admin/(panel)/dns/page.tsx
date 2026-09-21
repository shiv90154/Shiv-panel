import Link from "next/link";
import { prisma } from "@/lib/db";
import { DataTable, Flash, SectionCard } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { scopeFor, scopeIds } from "@/lib/tenancy";
import { agentConfigured } from "@/server/agent";
import { addZone, removeZone } from "../../dns-actions";

export const dynamic = "force-dynamic";

export default async function DnsZones({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const ids = await scopeIds(s);
  const [zones, owners] = await Promise.all([
    prisma.dnsZone.findMany({ where: await scopeFor(s), orderBy: { name: "asc" }, include: { account: { select: { username: true } } } }),
    s.role === "user" ? [] : prisma.account.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { username: "asc" }, select: { id: true, username: true } }),
  ]);
  const multi = s.role !== "user";
  return (
    <>
      <h1>DNS zones</h1>
      <p className="sub">Authoritative DNS hosted on this server (PowerDNS). After creating a zone, set your domain&apos;s nameservers at the registrar to this server&apos;s nameservers.</p>
      <Flash {...sp} />
      {!agentConfigured() && <p className="flash bad">The host agent is not configured (AGENT_URL / AGENT_SECRET), so zones cannot be created.</p>}
      <SectionCard title="New zone">
        <form action={addZone} className="row">
          <div><label>Domain</label><input name="name" placeholder="example.com" required /></div>
          {multi && <div><label>Owner account</label><select name="ownerId" defaultValue={s.account.id}>{owners.map((o) => <option key={o.id} value={o.id}>{o.username}</option>)}</select></div>}
          <div><label><input type="checkbox" name="template" defaultChecked /> Add starter records (web, www, mail)</label></div>
          <div className="auto"><button className="primary">Create zone</button></div>
        </form>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={zones} rowKey={(z) => z.id} empty="No zones yet."
          columns={[
            { header: "Zone", render: (z) => <Link href={`${s.base}/dns/${z.id}`}><b>{z.name}</b></Link> },
            ...(multi ? [{ header: "Owner", render: (z: (typeof zones)[number]) => z.account.username }] : []),
            { header: "Created", render: (z) => z.createdAt.toLocaleDateString() },
            { header: "", render: (z) => (
              <form action={removeZone.bind(null, z.id)} className="row">
                <input name="confirm" placeholder={`type ${z.name}`} autoComplete="off" required style={{ width: 170 }} />
                <button className="sm danger">Delete</button>
              </form>
            ) },
          ]}
        />
      </SectionCard>
    </>
  );
}
