import Link from "next/link";
import { prisma } from "@/lib/db";
import { DataTable, SectionCard } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { scopeIds } from "@/lib/tenancy";

const PAGE = 100;

// Shared by /admin/audit (admin: everything, reseller: own + customers) and /cpanel/activity (user: own account).
export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const ids = await scopeIds(s);
  const page = Math.max(1, Number(sp.page) || 1);
  const where = {
    ...(ids && { accountId: { in: ids } }),
    ...(sp.q && { OR: [{ action: { contains: sp.q } }, { target: { contains: sp.q } }, { actorName: { contains: sp.q } }, { ip: { contains: sp.q } }] }),
  };
  const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { time: "desc" }, take: PAGE, skip: (page - 1) * PAGE }), prisma.auditLog.count({ where })]);
  const qs = (p: number) => new URLSearchParams({ ...(sp.q && { q: sp.q }), page: String(p) }).toString();
  return (
    <>
      <h1>{s.role === "user" ? "Account activity" : "Audit log"}</h1>
      <p className="sub">{s.role === "user" ? "Sign-ins and changes made to your account." : "Who did what: sign-ins, account and resource changes, impersonation."}</p>
      <SectionCard>
        <form className="row" style={{ marginBottom: 12 }}>
          <div><input name="q" placeholder="Search action, target, user, IP" defaultValue={sp.q} /></div>
          <div className="auto"><button>Filter</button></div>
        </form>
        <DataTable
          rows={rows} rowKey={(r) => r.id} empty="No entries."
          columns={[
            { header: "Time", className: "muted", nowrap: true, render: (r) => r.time.toLocaleString() },
            { header: "Action", className: "mono", render: (r) => r.action },
            { header: "Target", render: (r) => r.target ?? "" },
            { header: "By", render: (r) => r.actorName },
            { header: "IP", className: "mono", render: (r) => r.ip ?? "" },
          ]}
        />
        <div className="actions" style={{ marginTop: 12 }}>
          {page > 1 && <Link className="btn" href={`?${qs(page - 1)}`}>← Newer</Link>}
          {page * PAGE < total && <Link className="btn" href={`?${qs(page + 1)}`}>Older →</Link>}
          <span className="muted">{total} entries</span>
        </div>
      </SectionCard>
    </>
  );
}
