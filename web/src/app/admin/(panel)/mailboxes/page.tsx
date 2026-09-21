import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard, UsageBar } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireSession } from "@/lib/session";
import { scopeFor } from "@/lib/tenancy";
import { addMailbox, editMailbox, removeMailbox } from "../../actions";

export default async function Mailboxes({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; domain?: string; q?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const scope = await scopeFor(s);
  const back = `${s.base}/mailboxes${sp.domain ? `?domain=${sp.domain}` : ""}`;
  const [domains, boxes] = await Promise.all([
    prisma.domain.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, name: true, defaultQuotaMb: true } }),
    prisma.mailbox.findMany({
      where: { ...scope, ...(sp.domain && { domainId: sp.domain }), ...(sp.q && { email: { contains: sp.q.toLowerCase() } }) },
      orderBy: { email: "asc" }, take: 500,
    }),
  ]);
  return (
    <>
      <h1>Email accounts</h1>
      <p className="sub">Each mailbox works with IMAP/SMTP clients and webmail.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <SectionCard title="Create mailbox">
        <form action={addMailbox.bind(null, back)} className="row">
          <div><label>Address</label><input name="localPart" placeholder="john" required /></div>
          <div><label>Domain</label><select name="domainId" defaultValue={sp.domain}>{domains.map((d) => <option key={d.id} value={d.id}>@{d.name}</option>)}</select></div>
          <div><label>Password (min 10)</label><input name="password" type="password" required minLength={10} autoComplete="new-password" /></div>
          <div><label>Display name</label><input name="displayName" /></div>
          <div><label>Quota MB (blank = domain default)</label><input name="quota" type="number" min={0} /></div>
          <div className="auto"><button className="primary" disabled={!domains.length}>Create</button></div>
        </form>
      </SectionCard>
      <SectionCard>
        <form className="row" style={{ marginBottom: 12 }}>
          <div><select name="domain" defaultValue={sp.domain ?? ""}><option value="">All domains</option>{domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><input name="q" placeholder="Search address" defaultValue={sp.q} /></div>
          <div className="auto"><button>Filter</button></div>
        </form>
        <DataTable
          rows={boxes} rowKey={(m) => m.id} empty="No mailboxes."
          columns={[
            {
              header: "Mailbox",
              render: (m) => (
                <>
                  <b>{m.email}</b><div className="muted">{m.displayName}</div>
                  <details><summary>Edit</summary>
                    <form action={editMailbox.bind(null, m.id, back)} className="row" style={{ marginTop: 8 }}>
                      <div><label>Display name</label><input name="displayName" defaultValue={m.displayName ?? ""} /></div>
                      <div><label>Quota MB (0 = unlimited)</label><input name="quota" type="number" min={0} defaultValue={m.quotaMb} /></div>
                      <div><label>New password (optional)</label><input name="password" type="password" minLength={10} autoComplete="new-password" /></div>
                      <div className="auto"><label style={{ fontWeight: 400 }}><input type="checkbox" name="active" defaultChecked={m.active} style={{ width: "auto" }} /> Enabled</label></div>
                      <div className="auto"><button className="primary sm">Save</button></div>
                    </form>
                  </details>
                </>
              ),
            },
            { header: "Status", render: (m) => (m.active ? <Badge kind="ok">active</Badge> : <Badge kind="off">disabled</Badge>) },
            { header: "Storage", className: "w150", render: (m) => <div style={{ minWidth: 150 }}><UsageBar used={m.usedBytes} quotaMb={m.quotaMb} /></div> },
            { header: "Msgs", render: (m) => m.messageCount },
            { header: "Last login", render: (m) => <span className="muted">{m.lastLoginAt?.toLocaleDateString() ?? "never"}</span> },
            { header: "", render: (m) => <form action={removeMailbox.bind(null, m.id, back)}><ConfirmButton message={`Delete ${m.email} and all of its stored mail?`}>Delete</ConfirmButton></form> },
          ]}
        />
      </SectionCard>
    </>
  );
}
