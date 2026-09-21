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
    prisma.webhook.findMany({ where: { accountId: s.account.id }, orderBy: { createdAt: "desc" } }),
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
          <div style={{ alignSelf: "flex-end" }}><button className="primary">Create key</button></div>
        </form>
        <DataTable rows={keys} rowKey={(k) => k.id} empty="No API keys."
          columns={[
            { header: "Name", render: (k) => k.name },
            { header: "Key", render: (k) => <code>{k.prefix}…</code> },
            { header: "Last used", render: (k) => k.lastUsedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "never" },
            { header: "Status", render: (k) => (k.revokedAt ? <Badge kind="off">revoked</Badge> : <Badge kind="ok">active</Badge>) },
            { header: "", render: (k) => !k.revokedAt && <form action={revokeApiKey.bind(null, k.id)}><ConfirmButton message={`Revoke key ${k.name}?`}>Revoke</ConfirmButton></form> },
          ]} />
      </SectionCard>
      <SectionCard title="Webhooks">
        <p className="muted">POST JSON, signed: <code>X-Webhook-Signature: sha256=HMAC(secret, timestamp + &quot;.&quot; + body)</code> with <code>X-Webhook-Timestamp</code>. Events: {WEBHOOK_EVENTS.join(", ")} (for accounts below you). HTTPS only; private addresses are refused.</p>
        <form action={addWebhook} className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: "1 1 320px" }}><label>URL</label><input name="url" required placeholder="https://billing.example.com/hook" /></div>
          <div style={{ alignSelf: "flex-end" }}><button className="primary">Add webhook</button></div>
        </form>
        <DataTable rows={hooks} rowKey={(h) => h.id} empty="No webhooks."
          columns={[
            { header: "URL", render: (h) => <span style={{ wordBreak: "break-all" }}>{h.url}</span> },
            { header: "Last delivery", render: (h) => (h.lastAt ? `${h.lastAt.toISOString().slice(0, 16).replace("T", " ")} · ${h.lastStatus}` : "never") },
            { header: "Status", render: (h) => (h.active ? <Badge kind={h.failures > 3 ? "warn" : "ok"}>active{h.failures ? ` (${h.failures} failed)` : ""}</Badge> : <Badge kind="off">paused</Badge>) },
            { header: "", render: (h) => <><form action={toggleWebhook.bind(null, h.id)} style={{ display: "inline" }}><button className="sm">{h.active ? "Pause" : "Enable"}</button></form> <form action={deleteWebhook.bind(null, h.id)} style={{ display: "inline" }}><ConfirmButton message="Delete this webhook?">Delete</ConfirmButton></form></> },
          ]} />
      </SectionCard>
    </>
  );
}
