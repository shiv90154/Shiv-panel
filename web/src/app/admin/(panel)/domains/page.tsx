import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard, bytes } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { scopeFor, scopeIds } from "@/lib/tenancy";
import { addDomain } from "../../actions";

export default async function Domains({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const ids = await scopeIds(s);
  const [domains, owners] = await Promise.all([
    prisma.domain.findMany({ where: await scopeFor(s), orderBy: { name: "asc" }, include: { account: { select: { username: true } }, _count: { select: { mailboxes: true, aliases: true } }, mailboxes: { select: { usedBytes: true } } } }),
    s.role === "user" ? [] : prisma.account.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { username: "asc" }, select: { id: true, username: true } }),
  ]);
  const multi = s.role !== "user";
  return (
    <>
      <h1>Domains</h1>
      <p className="sub">Add a domain, then publish the DNS records shown on its page.</p>
      <Flash {...sp} />
      <SectionCard>
        <form action={addDomain} className="row">
          <div><label>New domain</label><input name="name" placeholder="example.com" required /></div>
          {multi && <div><label>Owner account</label><select name="ownerId" defaultValue={s.account.id}>{owners.map((o) => <option key={o.id} value={o.id}>{o.username}</option>)}</select></div>}
          <div><label>Default mailbox quota (MB)</label><input name="quota" type="number" defaultValue={1024} min={0} /></div>
          <div className="auto"><button className="primary">Add domain</button></div>
        </form>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={domains} rowKey={(d) => d.id} empty="No domains yet."
          columns={[
            { header: "Domain", render: (d) => <Link href={`${s.base}/domains/${d.id}`}><b>{d.name}</b></Link> },
            ...(multi ? [{ header: "Owner", render: (d: (typeof domains)[number]) => d.account.username }] : []),
            { header: "Status", render: (d) => (d.active ? <Badge kind="ok">active</Badge> : <Badge kind="off">disabled</Badge>) },
            { header: "DNS", render: (d) => (d.dnsVerified ? <Badge kind="ok">verified</Badge> : <Badge kind="warn">needs setup</Badge>) },
            { header: "Mailboxes", render: (d) => d._count.mailboxes },
            { header: "Aliases", render: (d) => d._count.aliases },
            { header: "Storage", render: (d) => bytes(d.mailboxes.reduce((a, m) => a + Number(m.usedBytes), 0)) },
          ]}
        />
      </SectionCard>
    </>
  );
}
