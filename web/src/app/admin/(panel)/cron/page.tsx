import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { scopeFor } from "@/lib/tenancy";
import { MIN_INTERVAL_MIN } from "@/server/cron";
import { agentConfigured } from "@/server/agent";
import { addCronJob, removeCronJob, runCronNow, toggleCronJob } from "../../cron-actions";

export const dynamic = "force-dynamic";

export default async function Cron({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const scope = await scopeFor(s);
  const [jobs, sites] = await Promise.all([
    prisma.cronJob.findMany({ where: scope, orderBy: [{ accountId: "asc" }, { createdAt: "asc" }], include: { site: { select: { name: true } }, account: { select: { username: true } }, runs: { orderBy: { startedAt: "desc" }, take: 5 } } }),
    prisma.site.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, name: true, account: { select: { username: true } } } }),
  ]);
  const multi = s.role !== "user";
  return (
    <>
      <h1>Cron jobs</h1>
      <p className="sub">Commands run inside a site&apos;s container, in its web root, as the site user. Schedule is standard 5-field cron in <b>UTC</b> (minute hour day-of-month month day-of-week; also @hourly @daily @weekly @monthly). Minimum interval {MIN_INTERVAL_MIN} minutes, 5-minute time limit per run.</p>
      <Flash {...sp} />
      {!agentConfigured() && <p className="flash bad">The host agent is not configured (AGENT_URL / AGENT_SECRET), so jobs cannot run.</p>}
      <SectionCard title="New cron job">
        {sites.length === 0 ? <p className="muted">Create a website first; cron jobs run inside a site.</p> : (
          <form action={addCronJob} className="row">
            <div><label>Site</label><select name="siteId">{sites.map((x) => <option key={x.id} value={x.id}>{x.name}{multi ? ` (${x.account.username})` : ""}</option>)}</select></div>
            <div><label>Schedule (UTC)</label><input name="schedule" placeholder="*/15 * * * *" className="mono" required /></div>
            <div style={{ flex: 2 }}><label>Command</label><input name="command" placeholder="php artisan schedule:run" className="mono" required /></div>
            <div className="auto"><button className="primary">Add job</button></div>
          </form>
        )}
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={jobs} rowKey={(j) => j.id} empty="No cron jobs yet."
          columns={[
            { header: "Schedule", className: "mono", render: (j) => j.schedule },
            { header: "Command", className: "mono", render: (j) => j.command },
            { header: "Site", render: (j) => <>{j.site.name}{multi && <span className="muted"> ({j.account.username})</span>}</> },
            { header: "Last run", render: (j) => (j.lastRunAt ? <><Badge kind={j.lastExitCode === 0 ? "ok" : "bad"}>{j.lastExitCode === 0 ? "ok" : `exit ${j.lastExitCode ?? "n/a"}`}</Badge> <span className="muted">{j.lastRunAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span></> : <span className="muted">never</span>) },
            { header: "", render: (j) => (
              <div className="row">
                <form action={toggleCronJob.bind(null, j.id)}><button className="sm">{j.enabled ? "Disable" : "Enable"}</button></form>
                <form action={runCronNow.bind(null, j.id)}><button className="sm">Run now</button></form>
                <form action={removeCronJob.bind(null, j.id)}><button className="sm danger">Delete</button></form>
              </div>
            ) },
          ]}
        />
      </SectionCard>
      {jobs.filter((j) => j.runs.length).map((j) => (
        <SectionCard key={j.id} title={<>History: <span className="mono">{j.schedule}</span> {j.command}</>}>
          {j.runs.map((r) => (
            <details key={r.id}>
              <summary><Badge kind={r.exitCode === 0 ? "ok" : "bad"}>{r.exitCode === 0 ? "ok" : `exit ${r.exitCode ?? "n/a"}`}</Badge> {r.startedAt.toISOString().slice(0, 19).replace("T", " ")} UTC <span className="muted">({(r.durationMs / 1000).toFixed(1)}s)</span></summary>
              <pre className="mono" style={{ whiteSpace: "pre-wrap", overflowX: "auto", maxHeight: 300 }}>{r.output || "(no output)"}</pre>
            </details>
          ))}
        </SectionCard>
      ))}
    </>
  );
}
