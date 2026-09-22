import { Badge, Flash, Sparkline, bytes } from "@/components/ui";
import { getServerStatus } from "@/server/status";
import { checkServerDns } from "@/lib/dns";
import { config } from "@/lib/config";
import { requireRole } from "@/lib/session";
import { getAgentStatus } from "@/server/agent";
import { getMetricSeries } from "@/server/security";
import { parseRange, RANGES, type RangeKey } from "@/lib/security-core";
import { resyncDkim } from "../../actions";

export default async function ServerStatus({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; range?: string }> }) {
  await requireRole("admin");
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const [st, dns, agent, series] = await Promise.all([getServerStatus(), checkServerDns(), getAgentStatus(), getMetricSeries(range)]);
  const usedPct = st.disk ? Math.round(((st.disk.total - st.disk.free) / st.disk.total) * 100) : 0;
  return (
    <>
      <h1>Server status</h1>
      <p className="sub">{config.mailHostname}</p>
      <Flash {...sp} />
      <div className="card">
        <h2>Services</h2>
        <div className="actions">{st.services.map((s) => <Badge key={s.name} kind={s.up ? "ok" : "bad"}>{s.name}: {s.up ? "up" : "DOWN"}</Badge>)}</div>
      </div>
      <div className="grid">
        <div className="stat"><b>{st.queue ? st.queue.total : "?"}</b><span>Queue ({st.queue?.deferred ?? "?"} deferred)</span></div>
        <div className="stat"><b>{st.disk ? `${usedPct}%` : "?"}</b><span>Mail disk used{st.disk && ` (${bytes(st.disk.free)} free)`}</span></div>
        <div className="stat"><b>{st.load1.toFixed(2)}</b><span>Load (1m)</span></div>
        <div className="stat"><b>{bytes(st.memTotal - st.memFree)}</b><span>Memory used of {bytes(st.memTotal)}</span></div>
        <div className="stat"><b>{st.rspamd?.scanned ?? "?"}</b><span>Rspamd scanned ({st.rspamd?.spam_count ?? 0} spam)</span></div>
      </div>
      <div className="card">
        <h2>Server DNS (deliverability)</h2>
        <table><tbody>
          <tr><td>A record for {dns.hostname}</td><td className="mono">{dns.a.join(", ") || "none"}</td><td><Badge kind={dns.aOk ? "ok" : "bad"}>{dns.aOk ? "OK" : dns.ipv4 ? "must be " + dns.ipv4 : "set SERVER_IPV4"}</Badge></td></tr>
          <tr><td>Reverse DNS (PTR) for {dns.ipv4 || "server IP"}</td><td className="mono">{dns.ptr.join(", ") || "none"}</td><td><Badge kind={dns.ptrOk ? "ok" : "bad"}>{dns.ptrOk ? "OK" : `must be ${dns.hostname}`}</Badge></td></tr>
        </tbody></table>
        <p className="muted">Set the PTR record in your VPS provider&apos;s control panel. Gmail and Outlook reject or spam-folder mail without matching PTR. Port 25 outbound must also be open.</p>
      </div>
      <div className="card">
        <h2>Host agent</h2>
        {!agent.configured && <p className="muted">Not configured. The agent runs privileged tasks (sites, databases, files, backups) outside the web container; set <span className="mono">AGENT_URL</span> and <span className="mono">AGENT_SECRET</span> once it is installed (see <span className="mono">agent/</span>).</p>}
        {agent.configured && !agent.up && <p><Badge kind="bad">unreachable</Badge> <span className="muted">{agent.error}</span></p>}
        {agent.configured && agent.up && (
          <p><Badge kind="ok">connected</Badge> <span className="muted">v{agent.version} · {agent.info.hostname} · {agent.info.platform} · up {Math.round(agent.info.uptimeSec / 3600)} h · disk {bytes(agent.info.diskFree)} free</span></p>
        )}
      </div>
      <div className="card">
        <h2>Resource usage</h2>
        <p className="actions">
          {(Object.keys(RANGES) as RangeKey[]).map((r) => (
            <a key={r} href={`?range=${r}`} className="btn" style={r === range ? { borderColor: "var(--brand)", color: "var(--brand)" } : undefined}>{r}</a>
          ))}
        </p>
        {agent.configured ? (
          <div className="graphs">
            <Sparkline label="CPU" points={series.cpu} unit="%" />
            <Sparkline label="Memory" points={series.mem} unit="%" />
            <Sparkline label="Disk" points={series.disk} unit="%" />
            <Sparkline label="Load (1m)" points={series.load} decimals={2} />
            <Sparkline label="Network in" points={series.netRx} unit=" B/s" />
            <Sparkline label="Network out" points={series.netTx} unit=" B/s" />
          </div>
        ) : <p className="muted">Needs the host agent (samples are collected once a minute).</p>}
      </div>
      <div className="card">
        <h2>Maintenance</h2>
        <form action={resyncDkim}><button>Re-write DKIM key files</button></form>
      </div>
    </>
  );
}
