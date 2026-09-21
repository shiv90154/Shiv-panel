import { prisma } from "@/lib/db";
import { Badge, DataTable, Flash, SectionCard } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { scopeFor, scopeIds } from "@/lib/tenancy";
import { ENGINE_OPTIONS, dbHost, readDbPassword } from "@/server/databases";
import { agentConfigured } from "@/server/agent";
import { addDatabase, removeDatabase, resetDbPassword } from "../../databases-actions";

export const dynamic = "force-dynamic";

export default async function Databases({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const ids = await scopeIds(s);
  const [dbs, owners] = await Promise.all([
    prisma.database.findMany({ where: await scopeFor(s), orderBy: { name: "asc" }, include: { account: { select: { username: true } } } }),
    s.role === "user" ? [] : prisma.account.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { username: "asc" }, select: { id: true, username: true } }),
  ]);
  const multi = s.role !== "user";
  return (
    <>
      <h1>Databases</h1>
      <p className="sub">Each database has one user with the same name and full rights on that database only. The name is prefixed with your username.</p>
      <Flash {...sp} />
      {!agentConfigured() && <p className="flash bad">The host agent is not configured (AGENT_URL / AGENT_SECRET), so databases cannot be created.</p>}
      <SectionCard title="New database">
        <form action={addDatabase} className="row">
          <div><label>Engine</label><select name="engine" defaultValue="mariadb">{ENGINE_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></div>
          <div><label>Name (after the prefix)</label><input name="name" placeholder="wp" required /></div>
          {multi && <div><label>Owner account</label><select name="ownerId" defaultValue={s.account.id}>{owners.map((o) => <option key={o.id} value={o.id}>{o.username}</option>)}</select></div>}
          <div className="auto"><button className="primary">Create database</button></div>
        </form>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={dbs} rowKey={(d) => d.id} empty="No databases yet."
          columns={[
            { header: "Database / user", className: "mono", render: (d) => <b>{d.name}</b> },
            ...(multi ? [{ header: "Owner", render: (d: (typeof dbs)[number]) => d.account.username }] : []),
            { header: "Engine", render: (d) => <Badge kind="off">{ENGINE_OPTIONS.find((e) => e.id === d.engine)?.label ?? d.engine}</Badge> },
            { header: "Connection", className: "mono", render: (d) => `${dbHost(d.engine as "mariadb" | "postgres")}:${ENGINE_OPTIONS.find((e) => e.id === d.engine)?.port}` },
            { header: "Password", render: (d) => <details><summary>Show</summary><code className="mono">{readDbPassword(d)}</code></details> },
            { header: "", render: (d) => (
              <div className="row">
                <form action={resetDbPassword.bind(null, d.id)}><button className="sm">New password</button></form>
                <form action={removeDatabase.bind(null, d.id)} className="row">
                  <input name="confirm" placeholder={`type ${d.name}`} autoComplete="off" required style={{ width: 150 }} />
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
