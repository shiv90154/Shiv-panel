import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard } from "@/components/ui";
import { requireRole } from "@/lib/session";
import { creatableRoles, packageScope, scopeIds } from "@/lib/tenancy";
import { createAccount } from "./actions";

export default async function Accounts({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireRole("admin", "reseller"), searchParams]);
  const ids = await scopeIds(s);
  const [accounts, packages, resellers] = await Promise.all([
    prisma.account.findMany({
      where: { id: { not: s.account.id }, role: { not: "admin" }, ...(ids && { AND: [{ id: { in: ids } }] }) },
      orderBy: [{ role: "asc" }, { username: "asc" }],
      include: { package: { select: { name: true } }, parent: { select: { username: true } }, _count: { select: { domains: true, mailboxes: true } } },
    }),
    prisma.package.findMany({ where: packageScope(s), orderBy: { name: "asc" }, include: { owner: { select: { username: true } } } }),
    s.role === "admin" ? prisma.account.findMany({ where: { role: "reseller" }, orderBy: { username: "asc" }, select: { id: true, username: true } }) : [],
  ]);
  const roles = creatableRoles(s.role);
  return (
    <>
      <h1>Accounts</h1>
      <p className="sub">{s.role === "admin" ? "Resellers and hosting accounts on this server." : "Your hosting customers."}</p>
      <Flash {...sp} />
      <SectionCard title="Create account">
        {s.role !== "admin" && !packages.length && <p className="muted">Create a <Link href="/admin/packages">package</Link> first - every customer account needs one.</p>}
        <form action={createAccount}>
          <div className="row">
            <div><label>Username</label><input name="username" required pattern="[a-z][a-z0-9]{2,15}" title="3-16 lowercase letters/digits, starting with a letter" autoComplete="off" /></div>
            <div><label>Email</label><input name="email" type="email" required autoComplete="off" /></div>
            <div><label>Password (min 10)</label><input name="password" type="password" required minLength={10} autoComplete="new-password" /></div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            {roles.length > 1 && <div><label>Type</label><select name="role" defaultValue="user">{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>}
            <div><label>Package</label><select name="packageId" defaultValue="">{s.role === "admin" && <option value="">Unlimited (no package)</option>}{packages.map((p) => <option key={p.id} value={p.id}>{p.name}{s.role === "admin" && ` (${p.owner.username})`}</option>)}</select></div>
            {s.role === "admin" && <div><label>Owner (for users)</label><select name="parentId" defaultValue=""><option value="">Me (admin)</option>{resellers.map((r) => <option key={r.id} value={r.id}>{r.username}</option>)}</select></div>}
            <div className="auto"><button className="primary">Create</button></div>
          </div>
        </form>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={accounts} rowKey={(a) => a.id} empty="No accounts yet."
          columns={[
            { header: "Username", render: (a) => <Link href={`/admin/accounts/${a.id}`}><b>{a.username}</b></Link> },
            { header: "Email", render: (a) => a.email },
            { header: "Type", render: (a) => a.role },
            ...(s.role === "admin" ? [{ header: "Owner", render: (a: (typeof accounts)[number]) => a.parent?.username ?? "-" }] : []),
            { header: "Package", render: (a) => a.package?.name ?? <span className="muted">unlimited</span> },
            { header: "Domains", render: (a) => a._count.domains },
            { header: "Mailboxes", render: (a) => a._count.mailboxes },
            { header: "2FA", render: (a) => (a.totpEnabled ? <Badge kind="ok">on</Badge> : <span className="muted">off</span>) },
            { header: "Status", render: (a) => (a.status === "active" ? <Badge kind="ok">active</Badge> : <Badge kind="bad">suspended</Badge>) },
          ]}
        />
      </SectionCard>
    </>
  );
}
