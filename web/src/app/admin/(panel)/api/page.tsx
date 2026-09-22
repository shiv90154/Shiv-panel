import { prisma } from "@/lib/db";
import { unseal } from "@/lib/crypto";
import { DataTable, Flash, SectionCard, Badge } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireRole } from "@/lib/session";
import { WEBHOOK_EVENTS } from "@/lib/webhook-core";
import { addWebhook, createApiKey, deleteWebhook, revokeApiKey, toggleWebhook } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApiPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireRole("admin", "reseller"), searchParams]);
  const [keys, hooks] = await Promise.all([
    prisma.apiKey.findMany({ where: { accountId: s.account.id }, orderBy: { createdAt: "desc" } }),
    prisma.webhook.findMany({ where: { accountId: s.account.id }, orderBy: { createdAt: "desc" }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } } }),
  ]);
  const secret = sp.ok?.startsWith("KEY:") || sp.ok?.startsWith("SECRET:") ? unseal(sp.ok.slice(sp.ok.indexOf(":") + 1)) : null;
  const flash = secret ? undefined : sp.ok;
  return (
    <>
      <h1>API &amp; webhooks</h1>
      <p className="sub">Provision accounts from billing systems (WHMCS module in <code>integrations/whmcs</code>). Requests: <code>Authorization: Bearer &lt;key&gt;</code> to <code>/api/v1/…</code>. A key can only manage the accounts below its owner.</p>
      <Flash ok={flash} error={sp.error} />
      {secret && <div className="flash ok"><b>Copy this now, it will not be shown again:</b><br /><code style={{ wordBreak: "break-all" }}>{secret}</code></div>}
      <SectionCard title="API keys">
        <form action={createApiKey} className="row" style={{ marginBottom: 12 }}>
          <div><label>Name</label><input name="name" required maxLength={60} placeholder="whmcs" /></div>
          <div><label>Scope</label><select name="scope"><option value="full">Full access</option><option value="read">Read-only</option></select></div>
          <div><label>Expires</label><select name="expires" defaultValue=""><option value="">Never</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></div>
          <div style={{ alignSelf: "flex-end" }}><button className="primary">Create key</button></div>
        </form>
        <DataTable rows={keys} rowKey={(k) => k.id} empty="No API keys."
          columns={[
            { header: "Name", render: (k) => k.name },
            { header: "Key", render: (k) => <code>{k.prefix}…</code> },
            { header: "Scope", render: (k) => (k.scope === "read" ? <Badge kind="warn">read-only</Badge> : "full") },
            { header: "Expires", render: (k) => k.expiresAt?.toISOString().slice(0, 10) ?? "never" },
            { header: "Last used", render: (k) => k.lastUsedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "never" },
            { header: "Status", render: (k) => (k.revokedAt ? <Badge kind="off">revoked</Badge> : k.expiresAt && k.expiresAt.getTime() <= Date.now() ? <Badge kind="off">expired</Badge> : <Badge kind="ok">active</Badge>) },
            { header: "", render: (k) => !k.revokedAt && <form action={revokeApiKey.bind(null, k.id)}><ConfirmButton message={`Revoke key ${k.name}?`}>Revoke</ConfirmButton></form> },
          ]} />
      </SectionCard>
      <SectionCard title="Webhooks">
        <p className="muted">POST JSON, signed: <code>X-Webhook-Signature: sha256=HMAC(secret, timestamp + &quot;.&quot; + body)</code> with <code>X-Webhook-Timestamp</code>. Events: {WEBHOOK_EVENTS.join(", ")} (for accounts below you). HTTPS only; private addresses are refused. A failed delivery retries up to 4 more times over 2 hours, then stops - reconcile anything older via the API.</p>
        <form action={addWebhook} className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: "1 1 320px" }}><label>URL</label><input name="url" required placeholder="https://billing.example.com/hook" /></div>
          <div style={{ alignSelf: "flex-end" }}><button className="primary">Add webhook</button></div>
        </form>
        {hooks.map((h) => (
          <div key={h.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 12 }}>
            <div className="row" style={{ alignItems: "center" }}>
              <span style={{ wordBreak: "break-all" }} className="mono">{h.url}</span>
              <span className="auto">{h.active ? <Badge kind={h.failures > 3 ? "warn" : "ok"}>active{h.failures ? ` (${h.failures} failed)` : ""}</Badge> : <Badge kind="off">paused</Badge>}</span>
              <form action={toggleWebhook.bind(null, h.id)} className="auto"><button className="sm">{h.active ? "Pause" : "Enable"}</button></form>
              <form action={deleteWebhook.bind(null, h.id)} className="auto"><ConfirmButton message="Delete this webhook?">Delete</ConfirmButton></form>
            </div>
            <table style={{ marginTop: 8 }}><tbody>
              {h.deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="muted">{d.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{d.event}</td>
                  <td>attempt {d.attempt}</td>
                  <td>{d.status === "ok" ? <Badge kind="ok">delivered{d.httpStatus ? ` (${d.httpStatus})` : ""}</Badge> : d.status === "error" ? <Badge kind="bad">{d.error ?? "failed"}</Badge> : <Badge kind="warn">{d.status}</Badge>}</td>
                </tr>
              ))}
              {!h.deliveries.length && <tr><td colSpan={4} className="muted">No deliveries yet.</td></tr>}
            </tbody></table>
          </div>
        ))}
        {!hooks.length && <p className="muted">No webhooks.</p>}
      </SectionCard>
    </>
  );
}
