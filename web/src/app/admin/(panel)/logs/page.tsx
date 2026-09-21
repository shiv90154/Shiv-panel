import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";

const PAGE = 100;

export default async function Logs({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = {
    ...(sp.status && { status: sp.status }),
    ...(sp.q && { OR: [{ sender: { contains: sp.q } }, { recipient: { contains: sp.q } }, { message: { contains: sp.q } }, { relay: { contains: sp.q } }] }),
  };
  const [logs, total] = await Promise.all([prisma.mailLog.findMany({ where, orderBy: { time: "desc" }, take: PAGE, skip: (page - 1) * PAGE }), prisma.mailLog.count({ where })]);
  const qs = (p: number) => new URLSearchParams({ ...(sp.status && { status: sp.status }), ...(sp.q && { q: sp.q }), page: String(p) }).toString();
  return (
    <>
      <h1>Email logs</h1>
      <p className="sub">Delivery attempts, rejections and failed logins parsed from the Postfix log (kept 30 days).</p>
      <div className="card">
        <form className="row" style={{ marginBottom: 12 }}>
          <div><select name="status" defaultValue={sp.status ?? ""}><option value="">Any status</option>{["sent", "deferred", "bounced", "rejected", "auth_failed"].map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><input name="q" placeholder="Search sender, recipient, message, IP" defaultValue={sp.q} /></div>
          <div className="auto"><button>Filter</button></div>
        </form>
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>From → To</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{l.time.toLocaleString()}</td><td>{l.direction}</td>
                <td className="mono">{l.sender || "-"} → {l.recipient || "-"}</td>
                <td><Badge kind={l.status === "sent" ? "ok" : l.status === "deferred" ? "warn" : "bad"}>{l.status}</Badge></td>
                <td className="muted">{l.relay && <div className="mono">{l.relay}</div>}{l.message}</td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={5} className="muted">No log entries.</td></tr>}
          </tbody>
        </table>
        <div className="actions" style={{ marginTop: 12 }}>
          {page > 1 && <Link className="btn" href={`?${qs(page - 1)}`}>← Newer</Link>}
          {page * PAGE < total && <Link className="btn" href={`?${qs(page + 1)}`}>Older →</Link>}
          <span className="muted">{total} entries</span>
        </div>
      </div>
    </>
  );
}
