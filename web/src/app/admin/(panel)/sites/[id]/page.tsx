import { notFound } from "next/navigation";
import Link from "next/link";
import { Flash, SectionCard, Badge } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireSession } from "@/lib/session";
import { getOwnedSite } from "@/lib/tenancy";
import { RUNTIME_OPTIONS, readEnv } from "@/server/sites";
import { agentCall } from "@/server/agent";
import { addDomainToSite, redeploySite, removeDomainFromSite, removeSite, saveSiteEnv, saveSiteRedirects, setSiteRunning, updateSite } from "../../../sites-actions";
import { statusBadge } from "../page";

export const dynamic = "force-dynamic";

export default async function SiteDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ id }, sp, s] = await Promise.all([params, searchParams, requireSession()]);
  const found = (await getOwnedSite(s, id).catch(() => null));
  if (!found) notFound(); // out-of-scope ids look like missing ones (404, not 500)
  const site = found;
  const logs = await agentCall("site.logs", { siteId: site.id, lines: 200 }, site.accountId, 8000).then((r) => r.logs, (e: Error) => `(logs unavailable: ${e.message})`);
  const rt = RUNTIME_OPTIONS.find((r) => r.id === site.runtime);
  const redirects = (Array.isArray(site.redirects) ? site.redirects : []) as { from: string; to: string; code: number }[];
  const primary = site.domains.find((d) => d.primary);
  return (
    <>
      <p><Link href={`${s.base}/sites`}>← Websites</Link></p>
      <h1>{site.name} {statusBadge(site.status)}</h1>
      <p className="sub">{rt?.label ?? site.runtime}{primary && <> · <a href={`https://${primary.name}`} target="_blank" rel="noreferrer">{primary.name} ↗</a></>} · <Link href={`${s.base}/files?site=${site.id}`}>File manager</Link></p>
      <Flash {...sp} />
      {site.lastError && <p className="flash bad">{site.lastError}</p>}

      <SectionCard title="Control">
        <div className="row" style={{ alignItems: "center" }}>
          <form action={setSiteRunning.bind(null, site.id, true)}><button className="sm">Start</button></form>
          <form action={setSiteRunning.bind(null, site.id, false)}><button className="sm">Stop</button></form>
          <form action={redeploySite.bind(null, site.id)}><button className="sm">Redeploy</button></form>
        </div>
        <p className="muted">Upload your files to <span className="mono">/srv/accounts/{site.accountId}/{site.id}</span> on the server (file manager and SFTP arrive in Phase 2).</p>
      </SectionCard>

      <SectionCard title="Settings">
        <form action={updateSite.bind(null, site.id)} className="row">
          {rt?.cmd && <div style={{ flex: "2 1 260px" }}><label>Start command (listen on $PORT)</label><input name="startCommand" defaultValue={site.startCommand ?? ""} required /></div>}
          <div className="auto"><label><input type="checkbox" name="forceHttps" defaultChecked={site.forceHttps} style={{ width: "auto" }} /> Force HTTPS</label></div>
          <div className="auto"><button className="primary">Save &amp; redeploy</button></div>
        </form>
      </SectionCard>

      <SectionCard title="Domains &amp; subdomains">
        <table><tbody>
          {site.domains.map((d) => (
            <tr key={d.id}><td className="mono">{d.name}</td><td>{d.primary && <Badge kind="ok">primary</Badge>}</td>
              <td className="actions">{!d.primary && <form action={removeDomainFromSite.bind(null, site.id, d.id)}><ConfirmButton message={`Remove ${d.name}?`}>Remove</ConfirmButton></form>}</td></tr>
          ))}
        </tbody></table>
        <form action={addDomainToSite.bind(null, site.id)} className="row" style={{ marginTop: 12 }}>
          <div><label>Add domain, subdomain or addon domain</label><input name="name" placeholder="shop.example.com" required /></div>
          <div className="auto"><button>Add</button></div>
        </form>
      </SectionCard>

      <SectionCard title="Redirects">
        <form action={saveSiteRedirects.bind(null, site.id)}>
          <label>One per line: <span className="mono">/from /to-or-URL [301|302]</span></label>
          <textarea name="redirects" rows={4} className="mono" defaultValue={redirects.map((r) => `${r.from} ${r.to} ${r.code}`).join("\n")} placeholder="/old-page https://example.com/new 301" />
          <p><button>Save redirects</button></p>
        </form>
      </SectionCard>

      <SectionCard title="Environment variables">
        <form action={saveSiteEnv.bind(null, site.id)}>
          <label>One per line: <span className="mono">NAME=value</span> (stored encrypted; saving redeploys the site)</label>
          <textarea name="env" rows={5} className="mono" defaultValue={Object.entries(readEnv(site)).map(([k, v]) => `${k}=${v}`).join("\n")} autoComplete="off" />
          <p><button>Save environment</button></p>
        </form>
      </SectionCard>

      <SectionCard title="Logs (last 200 lines)">
        <pre className="mono" style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}>{logs || "(empty)"}</pre>
      </SectionCard>

      <SectionCard title="Delete site">
        <form action={removeSite.bind(null, site.id)} className="row">
          <div><label>Type “{site.name}” to confirm</label><input name="confirm" autoComplete="off" required /></div>
          <div className="auto"><label><input type="checkbox" name="deleteFiles" style={{ width: "auto" }} /> also delete files</label></div>
          <div className="auto"><button className="danger">Delete</button></div>
        </form>
      </SectionCard>
    </>
  );
}
