import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, DataTable, SectionCard, bytes } from "@/components/ui";
import { requireRole } from "@/lib/session";
import { scopeFor, scopeIds } from "@/lib/tenancy";
import { getServerStatus } from "@/server/status";

export default async function Dashboard() {
  const s = await requireRole("admin", "reseller");
  const scope = await scopeFor(s);
  const ids = await scopeIds(s);
  const [accounts, domains, mailboxes, aliases, storage] = await Promise.all([
    prisma.account.count({ where: { role: { not: "admin" }, ...(ids && { id: { in: ids.filter((i) => i !== s.account.id) } }) } }),
    prisma.domain.count({ where: scope }), prisma.mailbox.count({ where: scope }), prisma.alias.count({ where: scope }),
    prisma.mailbox.aggregate({ where: scope, _sum: { usedBytes: true } }),
  ]);
  const stats = [
    [accounts, s.role === "admin" ? "Accounts" : "Customer accounts"], [domains, "Domains"], [mailboxes, "Mailboxes"], [aliases, "Aliases"], [bytes(storage._sum.usedBytes ?? 0), "Mail storage used"],
  ] as const;

  // Server-wide mail activity is admin-only (the mail log is not tenant-scoped).
  let serverPart: React.ReactNode = null;
  if (s.role === "admin") {
    const since = new Date(Date.now() - 864e5);
    const [sent, received, rejected, recent, st] = await Promise.all([
      prisma.mailLog.count({ where: { time: { gte: since }, direction: "outbound", status: "sent" } }),
      prisma.mailLog.count({ where: { time: { gte: since }, direction: "inbound", status: "sent" } }),
      prisma.mailLog.count({ where: { time: { gte: since }, status: { in: ["rejected", "bounced", "auth_failed"] } } }),
      prisma.mailLog.findMany({ orderBy: { time: "desc" }, take: 8 }),
      getServerStatus(),
    ]);
    const down = st.services.filter((x) => !x.up);
    serverPart = (
      <>
        <p className="sub">{down.length ? <Badge kind="bad">{down.length} service(s) down</Badge> : <Badge kind="ok">All services running</Badge>}</p>
        <div className="grid">
          <div className="stat"><b>{received}</b><span>Delivered (24h)</span></div>
          <div className="stat"><b>{sent}</b><span>Sent (24h)</span></div>
          <div className="stat"><b>{rejected}</b><span>Rejected / bounced / auth fails (24h)</span></div>
          <div className="stat"><b>{st.queue?.total ?? "?"}</b><span>Queued messages</span></div>
        </div>
        <SectionCard title={<>Recent activity <Link href="/admin/logs" style={{ fontWeight: 400, fontSize: 13 }}>all logs →</Link></>}>
          <DataTable
            rows={recent} rowKey={(l) => l.id} empty="No mail activity yet."
            columns={[
              { header: "Time", className: "muted", render: (l) => l.time.toLocaleString() },
              { header: "Type", render: (l) => l.direction },
              { header: "From → To", render: (l) => `${l.sender || "-"} → ${l.recipient || "-"}` },
              { header: "Status", render: (l) => <Badge kind={l.status === "sent" ? "ok" : l.status === "deferred" ? "warn" : "bad"}>{l.status}</Badge> },
            ]}
          />
        </SectionCard>
      </>
    );
  }
  return (
    <>
      <h1>Dashboard</h1>
      {s.role === "reseller" && <p className="sub">Your customers and their resources.</p>}
      <div className="grid">{stats.map(([v, l]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}</div>
      {serverPart}
    </>
  );
}
