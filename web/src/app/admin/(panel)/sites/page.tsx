import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { scopeFor, scopeIds } from "@/lib/tenancy";
import { RUNTIME_OPTIONS } from "@/server/sites";
import { agentConfigured } from "@/server/agent";
import { addSite } from "../../sites-actions";

export const statusBadge = (st: string) => <Badge kind={st === "running" ? "ok" : st === "error" ? "bad" : st === "stopped" ? "off" : "warn"}>{st}</Badge>;

export default async function Sites({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const ids = await scopeIds(s);
  const [sites, owners] = await Promise.all([
    prisma.site.findMany({ where: await scopeFor(s), orderBy: { name: "asc" }, include: { account: { select: { username: true } }, domains: { orderBy: { primary: "desc" } } } }),
    s.role === "user" ? [] : prisma.account.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { username: "asc" }, select: { id: true, username: true } }),
  ]);
  const multi = s.role !== "user";
  return (
    <>
      <h1>Websites</h1>
      <p className="sub">Each site runs in its own container with its own files, resource limits and HTTPS certificate. Point the domain&apos;s A/AAAA record at this server.</p>
      <Flash {...sp} />
      {!agentConfigured() && <p className="flash bad">The host agent is not configured (AGENT_URL / AGENT_SECRET), so sites cannot be deployed.</p>}
      <SectionCard title="New site">
        <form action={addSite} className="row">
          <div><label>Site name</label><input name="name" placeholder="blog" required /></div>
          <div><label>Primary domain</label><input name="domain" placeholder="example.com" required /></div>
          <div><label>Runtime</label><select name="runtime" defaultValue="static">{RUNTIME_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          <div><label>Start command (Node/Python)</label><input name="startCommand" placeholder="npm start" /></div>
          {multi && <div><label>Owner account</label><select name="ownerId" defaultValue={s.account.id}>{owners.map((o) => <option key={o.id} value={o.id}>{o.username}</option>)}</select></div>}
          <div className="auto"><label><input type="checkbox" name="www" defaultChecked style={{ width: "auto" }} /> also www.</label></div>
          <div className="auto"><button className="primary">Create site</button></div>
        </form>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={sites} rowKey={(x) => x.id} empty="No sites yet."
          columns={[
            { header: "Site", render: (x) => <Link href={`${s.base}/sites/${x.id}`}><b>{x.name}</b></Link> },
            ...(multi ? [{ header: "Owner", render: (x: (typeof sites)[number]) => x.account.username }] : []),
            { header: "Domains", className: "mono", render: (x) => x.domains.map((d) => d.name).join(", ") },
            { header: "Runtime", render: (x) => RUNTIME_OPTIONS.find((r) => r.id === x.runtime)?.label ?? x.runtime },
            { header: "Status", render: (x) => statusBadge(x.status) },
          ]}
        />
      </SectionCard>
    </>
  );
}
