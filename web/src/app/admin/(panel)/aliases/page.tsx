import { prisma } from "@/lib/db";
import { Badge, Flash } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { addAlias, removeAlias, toggleAlias } from "../../actions";

export default async function Aliases({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; domain?: string }> }) {
  const sp = await searchParams;
  const back = `/admin/aliases${sp.domain ? `?domain=${sp.domain}` : ""}`;
  const [domains, aliases] = await Promise.all([
    prisma.domain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.alias.findMany({ where: sp.domain ? { domainId: sp.domain } : {}, orderBy: { source: "asc" }, take: 500 }),
  ]);
  return (
    <>
      <h1>Aliases</h1>
      <p className="sub">Forward an address like <span className="mono">support@domain.com</span> to one or more mailboxes (or external addresses). Use <span className="mono">*</span> for a catch-all. Owners of the destination mailbox may send as the alias.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="card">
        <form action={addAlias.bind(null, back)} className="row">
          <div><label>Alias</label><input name="source" placeholder="support (or * for catch-all)" required /></div>
          <div><label>Domain</label><select name="domainId" defaultValue={sp.domain}>{domains.map((d) => <option key={d.id} value={d.id}>@{d.name}</option>)}</select></div>
          <div style={{ flex: "2 1 260px" }}><label>Deliver to (comma separated)</label><input name="destinations" placeholder="john@example.com, sara@example.com" required /></div>
          <div className="auto"><button className="primary" disabled={!domains.length}>Add alias</button></div>
        </form>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Alias</th><th>Delivers to</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.id}>
                <td><b>{a.source}</b></td><td className="mono">{a.destinations.join(", ")}</td>
                <td>{a.active ? <Badge kind="ok">active</Badge> : <Badge kind="off">disabled</Badge>}</td>
                <td className="actions">
                  <form action={toggleAlias.bind(null, a.id, back)}><button className="sm">{a.active ? "Disable" : "Enable"}</button></form>
                  <form action={removeAlias.bind(null, a.id, back)}><ConfirmButton message={`Delete alias ${a.source}?`}>Delete</ConfirmButton></form>
                </td>
              </tr>
            ))}
            {!aliases.length && <tr><td colSpan={4} className="muted">No aliases.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
