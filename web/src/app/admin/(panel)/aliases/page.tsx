import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireSession } from "@/lib/session";
import { scopeFor } from "@/lib/tenancy";
import { addAlias, removeAlias, toggleAlias } from "../../actions";

export default async function Aliases({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; domain?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const scope = await scopeFor(s);
  const back = `${s.base}/aliases${sp.domain ? `?domain=${sp.domain}` : ""}`;
  const [domains, aliases] = await Promise.all([
    prisma.domain.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.alias.findMany({ where: { ...scope, ...(sp.domain && { domainId: sp.domain }) }, orderBy: { source: "asc" }, take: 500 }),
  ]);
  return (
    <>
      <h1>{s.role === "user" ? "Forwarders" : "Aliases"}</h1>
      <p className="sub">Forward an address like <span className="mono">support@domain.com</span> to one or more mailboxes (or external addresses). Use <span className="mono">*</span> for a catch-all. Owners of the destination mailbox may send as the alias.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <SectionCard>
        <form action={addAlias.bind(null, back)} className="row">
          <div><label>Alias</label><input name="source" placeholder="support (or * for catch-all)" required /></div>
          <div><label>Domain</label><select name="domainId" defaultValue={sp.domain}>{domains.map((d) => <option key={d.id} value={d.id}>@{d.name}</option>)}</select></div>
          <div style={{ flex: "2 1 260px" }}><label>Deliver to (comma separated)</label><input name="destinations" placeholder="john@example.com, sara@example.com" required /></div>
          <div className="auto"><button className="primary" disabled={!domains.length}>Add alias</button></div>
        </form>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={aliases} rowKey={(a) => a.id} empty="No aliases."
          columns={[
            { header: "Alias", render: (a) => <b>{a.source}</b> },
            { header: "Delivers to", className: "mono", render: (a) => a.destinations.join(", ") },
            { header: "Status", render: (a) => (a.active ? <Badge kind="ok">active</Badge> : <Badge kind="off">disabled</Badge>) },
            {
              header: "", className: "actions",
              render: (a) => (
                <>
                  <form action={toggleAlias.bind(null, a.id, back)}><button className="sm">{a.active ? "Disable" : "Enable"}</button></form>
                  <form action={removeAlias.bind(null, a.id, back)}><ConfirmButton message={`Delete alias ${a.source}?`}>Delete</ConfirmButton></form>
                </>
              ),
            },
          ]}
        />
      </SectionCard>
    </>
  );
}
