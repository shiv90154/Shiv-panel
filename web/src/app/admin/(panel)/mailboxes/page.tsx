import { prisma } from "@/lib/db";
import { Badge, Flash, UsageBar } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { addMailbox, editMailbox, removeMailbox } from "../../actions";

export default async function Mailboxes({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; domain?: string; q?: string }> }) {
  const sp = await searchParams;
  const back = `/admin/mailboxes${sp.domain ? `?domain=${sp.domain}` : ""}`;
  const [domains, boxes] = await Promise.all([
    prisma.domain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, defaultQuotaMb: true } }),
    prisma.mailbox.findMany({
      where: { ...(sp.domain && { domainId: sp.domain }), ...(sp.q && { email: { contains: sp.q.toLowerCase() } }) },
      orderBy: { email: "asc" }, take: 500,
    }),
  ]);
  return (
    <>
      <h1>Mailboxes</h1>
      <p className="sub">Each mailbox works with IMAP/SMTP clients and webmail.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="card">
        <h2>Create mailbox</h2>
        <form action={addMailbox.bind(null, back)} className="row">
          <div><label>Address</label><input name="localPart" placeholder="john" required /></div>
          <div><label>Domain</label><select name="domainId" defaultValue={sp.domain}>{domains.map((d) => <option key={d.id} value={d.id}>@{d.name}</option>)}</select></div>
          <div><label>Password (min 10)</label><input name="password" type="password" required minLength={10} autoComplete="new-password" /></div>
          <div><label>Display name</label><input name="displayName" /></div>
          <div><label>Quota MB (blank = domain default)</label><input name="quota" type="number" min={0} /></div>
          <div className="auto"><button className="primary" disabled={!domains.length}>Create</button></div>
        </form>
      </div>
      <div className="card">
        <form className="row" style={{ marginBottom: 12 }}>
          <div><select name="domain" defaultValue={sp.domain ?? ""}><option value="">All domains</option>{domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><input name="q" placeholder="Search address" defaultValue={sp.q} /></div>
          <div className="auto"><button>Filter</button></div>
        </form>
        <table>
          <thead><tr><th>Mailbox</th><th>Status</th><th>Storage</th><th>Msgs</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {boxes.map((m) => (
              <tr key={m.id}>
                <td><b>{m.email}</b><div className="muted">{m.displayName}</div>
                  <details><summary>Edit</summary>
                    <form action={editMailbox.bind(null, m.id, back)} className="row" style={{ marginTop: 8 }}>
                      <div><label>Display name</label><input name="displayName" defaultValue={m.displayName ?? ""} /></div>
                      <div><label>Quota MB (0 = unlimited)</label><input name="quota" type="number" min={0} defaultValue={m.quotaMb} /></div>
                      <div><label>New password (optional)</label><input name="password" type="password" minLength={10} autoComplete="new-password" /></div>
                      <div className="auto"><label style={{ fontWeight: 400 }}><input type="checkbox" name="active" defaultChecked={m.active} style={{ width: "auto" }} /> Enabled</label></div>
                      <div className="auto"><button className="primary sm">Save</button></div>
                    </form>
                  </details>
                </td>
                <td>{m.active ? <Badge kind="ok">active</Badge> : <Badge kind="off">disabled</Badge>}</td>
                <td style={{ minWidth: 150 }}><UsageBar used={m.usedBytes} quotaMb={m.quotaMb} /></td>
                <td>{m.messageCount}</td>
                <td className="muted">{m.lastLoginAt?.toLocaleDateString() ?? "never"}</td>
                <td>
                  <form action={removeMailbox.bind(null, m.id, back)}>
                    <ConfirmButton message={`Delete ${m.email} and all of its stored mail?`}>Delete</ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
            {!boxes.length && <tr><td colSpan={6} className="muted">No mailboxes.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
