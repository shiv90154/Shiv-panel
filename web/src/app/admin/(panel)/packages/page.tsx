import { prisma } from "@/lib/db";
import { DataTable, Flash, SectionCard } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireRole } from "@/lib/session";
import { packageScope } from "@/lib/tenancy";
import { createPackage, deletePackage, updatePackage } from "./actions";

const FIELDS = [
  ["diskMb", "Disk (MB)"], ["bandwidthMb", "Bandwidth (MB/mo)"], ["maxDomains", "Domains"], ["maxSites", "Websites"], ["maxMailboxes", "Mailboxes"],
  ["maxDatabases", "Databases"], ["maxFtpUsers", "FTP/SFTP users"], ["maxCronJobs", "Cron jobs"], ["cpuPercent", "CPU (% of a core)"], ["ramMb", "RAM (MB)"],
] as const;

function Fields({ values }: { values?: Partial<Record<(typeof FIELDS)[number][0], number>> }) {
  return <div className="row">{FIELDS.map(([k, label]) => <div key={k} style={{ flex: "1 1 130px" }}><label>{label}</label><input name={k} type="number" min={0} defaultValue={values?.[k] ?? 0} /></div>)}</div>;
}

export default async function Packages({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireRole("admin", "reseller"), searchParams]);
  const packages = await prisma.package.findMany({ where: packageScope(s), orderBy: { name: "asc" }, include: { owner: { select: { username: true } }, _count: { select: { accounts: true } } } });
  const lim = (n: number) => (n ? n : "∞");
  return (
    <>
      <h1>Packages</h1>
      <p className="sub">Resource limits for accounts. <b>0 = unlimited.</b> Domain, mailbox, site, database and cron-job limits are enforced now; the others apply as their features are added (FTP, disk, CPU/RAM).</p>
      <Flash {...sp} />
      <SectionCard title="New package">
        <form action={createPackage}>
          <div className="row" style={{ marginBottom: 10 }}><div><label>Name</label><input name="name" required maxLength={60} /></div></div>
          <Fields />
          <div style={{ marginTop: 12 }}><button className="primary">Create package</button></div>
        </form>
      </SectionCard>
      <SectionCard>
        <DataTable
          rows={packages} rowKey={(p) => p.id} empty="No packages yet."
          columns={[
            {
              header: "Package",
              render: (p) => (
                <>
                  <b>{p.name}</b>{s.role === "admin" && <div className="muted">by {p.owner.username}</div>}
                  <details><summary>Edit</summary>
                    <form action={updatePackage.bind(null, p.id)} style={{ marginTop: 8 }}>
                      <div className="row" style={{ marginBottom: 10 }}><div><label>Name</label><input name="name" defaultValue={p.name} required maxLength={60} /></div></div>
                      <Fields values={p} />
                      <div style={{ marginTop: 10 }}><button className="primary sm">Save</button></div>
                    </form>
                  </details>
                </>
              ),
            },
            { header: "Disk", render: (p) => `${lim(p.diskMb)} MB` },
            { header: "Domains", render: (p) => lim(p.maxDomains) },
            { header: "Mailboxes", render: (p) => lim(p.maxMailboxes) },
            { header: "Sites", render: (p) => lim(p.maxSites) },
            { header: "DBs", render: (p) => lim(p.maxDatabases) },
            { header: "Accounts", render: (p) => p._count.accounts },
            { header: "", render: (p) => <form action={deletePackage.bind(null, p.id)}><ConfirmButton message={`Delete package ${p.name}?`}>Delete</ConfirmButton></form> },
          ]}
        />
      </SectionCard>
    </>
  );
}
