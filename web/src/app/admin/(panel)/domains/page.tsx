import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, Flash, bytes } from "@/components/ui";
import { addDomain } from "../../actions";

export default async function Domains({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const domains = await prisma.domain.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { mailboxes: true, aliases: true } }, mailboxes: { select: { usedBytes: true } } } });
  return (
    <>
      <h1>Domains</h1>
      <p className="sub">Add as many domains as you like - no code or server changes needed.</p>
      <Flash {...sp} />
      <div className="card">
        <form action={addDomain} className="row">
          <div><label>New domain</label><input name="name" placeholder="example.com" required /></div>
          <div><label>Default mailbox quota (MB)</label><input name="quota" type="number" defaultValue={1024} min={0} /></div>
          <div className="auto"><button className="primary">Add domain</button></div>
        </form>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Domain</th><th>Status</th><th>DNS</th><th>Mailboxes</th><th>Aliases</th><th>Storage</th></tr></thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/admin/domains/${d.id}`}><b>{d.name}</b></Link></td>
                <td>{d.active ? <Badge kind="ok">active</Badge> : <Badge kind="off">disabled</Badge>}</td>
                <td>{d.dnsVerified ? <Badge kind="ok">verified</Badge> : <Badge kind="warn">needs setup</Badge>}</td>
                <td>{d._count.mailboxes}</td><td>{d._count.aliases}</td>
                <td>{bytes(d.mailboxes.reduce((a, m) => a + Number(m.usedBytes), 0))}</td>
              </tr>
            ))}
            {!domains.length && <tr><td colSpan={6} className="muted">No domains yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
