import { Badge, DataTable, Flash, SectionCard } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { agentConfigured } from "@/server/agent";
import { getFail2banStatus, getFirewallStatus } from "@/server/security";
import { addBlockRuleAction, addOpenPortRuleAction, banIpAction, disableFirewallAction, removeFirewallRuleAction, unbanIpAction } from "../../security-actions";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try { return { data: await fn(), error: null }; } catch (e) { return { data: null, error: e instanceof Error ? e.message : "Agent error" }; }
}

export default async function Security({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireRole("admin");
  const sp = await searchParams;
  const configured = agentConfigured();
  const rules = await prisma.firewallRule.findMany({ orderBy: { createdAt: "asc" } });
  const ports = rules.filter((r) => r.kind === "port"), blocks = rules.filter((r) => r.kind === "block");
  const fw = configured ? await safe(getFirewallStatus) : null;
  const f2b = configured ? await safe(getFail2banStatus) : null;
  const jailNames = f2b?.data?.jails.map((j) => j.name) ?? [];

  return (
    <>
      <h1>Firewall &amp; fail2ban</h1>
      <p className="sub">Host-wide, not per account. SSH and the base platform ports ({fw?.data?.sshPort ?? "22"}, 25, 53, 80, 143, 443, 465, 587, 993) are always open; everything else is drop-by-default.</p>
      <Flash {...sp} />
      {!configured && <p className="flash bad">The host agent is not configured (AGENT_URL / AGENT_SECRET).</p>}

      <SectionCard title="Firewall status" actions={fw?.data?.active && <form action={disableFirewallAction}><ConfirmButton message="Disable the firewall? Stored rules are kept and can be re-applied later.">Disable firewall</ConfirmButton></form>}>
        {fw?.error && <p className="flash bad">{fw.error}</p>}
        {fw?.data && (
          <p>
            {fw.data.installed ? <Badge kind={fw.data.active ? "ok" : "warn"}>{fw.data.active ? "Active" : "Installed, not active"}</Badge> : <Badge kind="bad">nftables not installed</Badge>}
            {" "}Adding or removing a rule below re-applies the whole ruleset.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Open ports">
        <DataTable
          rows={ports} rowKey={(r) => r.id} empty="No extra open ports (only the base platform ports and SSH)."
          columns={[
            { header: "Proto", className: "mono", render: (r) => r.proto },
            { header: "Port", className: "mono", render: (r) => (r.portFrom === r.portTo ? String(r.portFrom) : `${r.portFrom}-${r.portTo}`) },
            { header: "Source", className: "mono", render: (r) => r.cidr ?? "anyone" },
            { header: "Comment", render: (r) => r.comment || <span className="muted">-</span> },
            { header: "", render: (r) => <form action={removeFirewallRuleAction.bind(null, r.id)}><ConfirmButton message="Remove this rule?">Remove</ConfirmButton></form> },
          ]}
        />
        <form action={addOpenPortRuleAction} className="row" style={{ marginTop: 12 }}>
          <div><label>Protocol</label><select name="proto"><option value="tcp">tcp</option><option value="udp">udp</option></select></div>
          <div><label>Port or range</label><input name="port" placeholder="8080 or 8000-8100" required /></div>
          <div><label>Source CIDR (optional)</label><input name="source" placeholder="203.0.113.0/24" /></div>
          <div style={{ flex: 2 }}><label>Comment</label><input name="comment" placeholder="Minecraft server" /></div>
          <div className="auto"><button className="primary">Open port</button></div>
        </form>
      </SectionCard>

      <SectionCard title="Blocked addresses">
        <DataTable
          rows={blocks} rowKey={(r) => r.id} empty="No addresses blocked."
          columns={[
            { header: "CIDR", className: "mono", render: (r) => r.cidr },
            { header: "Comment", render: (r) => r.comment || <span className="muted">-</span> },
            { header: "", render: (r) => <form action={removeFirewallRuleAction.bind(null, r.id)}><ConfirmButton message="Unblock this address?">Remove</ConfirmButton></form> },
          ]}
        />
        <form action={addBlockRuleAction} className="row" style={{ marginTop: 12 }}>
          <div><label>Address or CIDR</label><input name="cidr" placeholder="203.0.113.77 or 198.51.100.0/24" required /></div>
          <div style={{ flex: 2 }}><label>Comment</label><input name="comment" placeholder="Repeated scanning" /></div>
          <div className="auto"><button className="primary">Block</button></div>
        </form>
        <p className="muted">Networks wider than /8 (IPv4) or /16 (IPv6) are refused, as is a range that includes your own current address.</p>
      </SectionCard>

      <SectionCard title="Fail2ban">
        {f2b?.error && <p className="flash bad">{f2b.error}</p>}
        {f2b?.data && !f2b.data.installed && <p className="muted">fail2ban is not installed on the host.</p>}
        {f2b?.data?.installed && (
          <>
            <DataTable
              rows={f2b.data.jails} rowKey={(j) => j.name} empty="No jails configured."
              columns={[
                { header: "Jail", className: "mono", render: (j) => j.name },
                { header: "Currently banned", render: (j) => j.currentlyBanned },
                { header: "Total banned", render: (j) => j.totalBanned },
                { header: "Currently failing", render: (j) => j.currentlyFailed },
                { header: "Banned addresses", render: (j) => j.banned.length ? j.banned.map((ip) => (
                  <form key={ip} action={unbanIpAction} style={{ display: "inline-block", marginRight: 6 }}>
                    <input type="hidden" name="jail" value={j.name} /><input type="hidden" name="ip" value={ip} />
                    <button className="sm mono" title="Unban">{ip} ×</button>
                  </form>
                )) : <span className="muted">-</span> },
              ]}
            />
            <form action={banIpAction} className="row" style={{ marginTop: 12 }}>
              <div><label>Jail</label><select name="jail">{jailNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div><label>IP address</label><input name="ip" placeholder="203.0.113.77" required /></div>
              <div className="auto"><button className="primary">Ban now</button></div>
            </form>
          </>
        )}
      </SectionCard>
    </>
  );
}
