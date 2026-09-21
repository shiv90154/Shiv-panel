import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard, bytes } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { assertInScope, scopeIds } from "@/lib/tenancy";
import { describeTag, getPolicy, listSnapshots } from "@/server/backups";
import { agentConfigured, type BackupItemResult, type SnapshotInfo } from "@/server/agent";
import { backupNow, deleteBackup, restoreBackup, saveBackupPolicy } from "../../backups-actions";

export const dynamic = "force-dynamic";
const when = (d: Date | string) => new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default async function Backups({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; account?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const ids = await scopeIds(s);
  const accounts = s.role === "user" ? [] : await prisma.account.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { username: "asc" }, select: { id: true, username: true } });
  const accountId = sp.account && s.role !== "user" ? sp.account : s.account.id;
  await assertInScope(s, accountId);
  const [policy, runs, sites] = await Promise.all([
    getPolicy(accountId),
    prisma.backupRun.findMany({ where: { accountId }, orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.site.findMany({ where: { accountId }, select: { id: true, name: true } }),
  ]);
  let snapshots: SnapshotInfo[] = [], listError = "";
  if (agentConfigured()) { try { snapshots = await listSnapshots(accountId); } catch (e) { listError = e instanceof Error ? e.message : "Could not list snapshots"; } }
  const names = { sites: new Map(sites.map((x) => [x.id, x.name])) };
  const numField = (name: string, label: string, v: number, max: number) => <div><label>{label}</label><input name={name} type="number" min={0} max={max} defaultValue={v} style={{ width: 90 }} /></div>;
  return (
    <>
      <h1>Backups</h1>
      <p className="sub">Encrypted, deduplicated restic snapshots of your site files, databases and mail, stored on this server. Restoring overwrites files that exist in the snapshot (files created since are kept) and replaces a database&apos;s tables with the dump. Times are UTC.</p>
      <Flash ok={sp.ok} error={sp.error} />
      {!agentConfigured() && <p className="flash bad">The host agent is not configured (AGENT_URL / AGENT_SECRET), so backups cannot run.</p>}
      {accounts.length > 1 && (
        <SectionCard>
          <form method="get" className="row">
            <div><label>Account</label><select name="account" defaultValue={accountId}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.username}</option>)}</select></div>
            <div className="auto"><button className="sm">Show</button></div>
          </form>
        </SectionCard>
      )}
      <SectionCard title="Schedule and retention">
        <form action={saveBackupPolicy} className="row">
          <input type="hidden" name="accountId" value={accountId} />
          <div><label><input type="checkbox" name="enabled" defaultChecked={policy.enabled} /> Automatic backups</label></div>
          <div><label>Frequency</label><select name="frequency" defaultValue={policy.frequency}><option value="daily">Daily</option><option value="weekly">Weekly (Sunday)</option></select></div>
          {numField("hour", "Hour (UTC)", policy.hour, 23)}
          {numField("keepDaily", "Keep daily", policy.keepDaily, 60)}
          {numField("keepWeekly", "Keep weekly", policy.keepWeekly, 52)}
          {numField("keepMonthly", "Keep monthly", policy.keepMonthly, 24)}
          <div><label><input type="checkbox" name="includeSites" defaultChecked={policy.includeSites} /> Site files</label></div>
          <div><label><input type="checkbox" name="includeDatabases" defaultChecked={policy.includeDatabases} /> Databases</label></div>
          <div><label><input type="checkbox" name="includeMail" defaultChecked={policy.includeMail} /> Mail</label></div>
          <div className="auto"><button className="primary">Save</button></div>
        </form>
        <form action={backupNow} className="row" style={{ marginTop: 12 }}>
          <input type="hidden" name="accountId" value={accountId} />
          <button>Back up now</button>
          <span className="muted">{policy.lastRunAt ? `Last started ${when(policy.lastRunAt)}` : "No backup has run yet"}</span>
        </form>
      </SectionCard>
      <SectionCard title="Recent runs">
        <DataTable
          rows={runs} rowKey={(r) => r.id} empty="No backup runs yet."
          columns={[
            { header: "Started", render: (r) => when(r.startedAt) },
            { header: "Trigger", render: (r) => r.trigger },
            { header: "Status", render: (r) => <Badge kind={r.status === "ok" ? "ok" : r.status === "running" ? "warn" : r.status === "partial" ? "warn" : "bad"}>{r.status}</Badge> },
            { header: "Details", render: (r) => {
              const failed = (r.results as unknown as BackupItemResult[]).filter((x) => !x.ok);
              return r.error ? <span className="muted">{r.error}</span> : failed.length ? <details><summary>{failed.length} failed</summary>{failed.map((f, i) => <div key={i} className="mono">{f.kind} {f.name}: {f.error}</div>)}</details> : "";
            } },
          ]}
        />
      </SectionCard>
      <SectionCard title="Snapshots">
        {listError && <p className="flash bad">{listError}</p>}
        <DataTable
          rows={snapshots} rowKey={(x) => x.fullId} empty="No snapshots yet."
          columns={[
            { header: "Time", render: (x) => when(x.time) },
            { header: "Contents", render: (x) => x.tags.map((t) => describeTag(t, names)?.label).filter(Boolean).join(", ") || "-" },
            { header: "Size", render: (x) => (x.bytes ? bytes(x.bytes) : "-") },
            { header: "", render: (x) => (
              <div className="row">
                <form action={restoreBackup} className="row">
                  <input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="snapshotId" value={x.fullId} />
                  <input name="confirm" placeholder="type restore" autoComplete="off" required style={{ width: 110 }} />
                  <button className="sm">Restore</button>
                </form>
                <form action={deleteBackup}>
                  <input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="snapshotId" value={x.fullId} />
                  <button className="sm danger">Delete</button>
                </form>
              </div>
            ) },
          ]}
        />
      </SectionCard>
    </>
  );
}
