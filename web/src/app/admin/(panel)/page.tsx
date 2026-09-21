import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, bytes } from "@/components/ui";
import { getServerStatus } from "@/server/status";

export default async function Dashboard() {
  const since = new Date(Date.now() - 864e5);
  const [domains, mailboxes, aliases, storage, sent, received, rejected, recent, st] = await Promise.all([
    prisma.domain.count(), prisma.mailbox.count(), prisma.alias.count(),
    prisma.mailbox.aggregate({ _sum: { usedBytes: true } }),
    prisma.mailLog.count({ where: { time: { gte: since }, direction: "outbound", status: "sent" } }),
    prisma.mailLog.count({ where: { time: { gte: since }, direction: "inbound", status: "sent" } }),
    prisma.mailLog.count({ where: { time: { gte: since }, status: { in: ["rejected", "bounced", "auth_failed"] } } }),
    prisma.mailLog.findMany({ orderBy: { time: "desc" }, take: 8 }),
    getServerStatus(),
  ]);
  const down = st.services.filter((s) => !s.up);
  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">{down.length ? <Badge kind="bad">{down.length} service(s) down</Badge> : <Badge kind="ok">All services running</Badge>}</p>
      <div className="grid">
        <div className="stat"><b>{domains}</b><span>Domains</span></div>
        <div className="stat"><b>{mailboxes}</b><span>Mailboxes</span></div>
        <div className="stat"><b>{aliases}</b><span>Aliases</span></div>
        <div className="stat"><b>{bytes(storage._sum.usedBytes ?? 0)}</b><span>Mail storage used</span></div>
        <div className="stat"><b>{received}</b><span>Delivered (24h)</span></div>
        <div className="stat"><b>{sent}</b><span>Sent (24h)</span></div>
        <div className="stat"><b>{rejected}</b><span>Rejected / bounced / auth fails (24h)</span></div>
        <div className="stat"><b>{st.queue?.total ?? "?"}</b><span>Queued messages</span></div>
      </div>
      <div className="card">
        <h2>Recent activity <Link href="/admin/logs" style={{ fontWeight: 400, fontSize: 13 }}>all logs →</Link></h2>
        <table><tbody>
          {recent.map((l) => (
            <tr key={l.id}><td className="muted">{l.time.toLocaleString()}</td><td>{l.direction}</td><td>{l.sender || "-"} → {l.recipient || "-"}</td><td><Badge kind={l.status === "sent" ? "ok" : l.status === "deferred" ? "warn" : "bad"}>{l.status}</Badge></td></tr>
          ))}
          {!recent.length && <tr><td className="muted">No mail activity yet.</td></tr>}
        </tbody></table>
      </div>
    </>
  );
}
