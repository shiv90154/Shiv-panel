import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, Flash, Meter, SectionCard, bytes } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireRole } from "@/lib/session";
import { canImpersonate, getManagedAccount, packageScope } from "@/lib/tenancy";
import type { Role } from "@/lib/tenancy-core";
import { impersonate, resetTwoFactor, setAccountPassword, suspendAccount, terminateAccount, unsuspendAccount, updateAccount } from "../actions";

export default async function AccountDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ id }, sp, s] = await Promise.all([params, searchParams, requireRole("admin", "reseller")]);
  const acc = await getManagedAccount(s, id).catch(() => null);
  if (!acc) notFound();
  const a = acc!;
  const [domains, mailboxes, storage, packages, audit] = await Promise.all([
    prisma.domain.count({ where: { accountId: a.id } }), prisma.mailbox.count({ where: { accountId: a.id } }),
    prisma.mailbox.aggregate({ where: { accountId: a.id }, _sum: { usedBytes: true } }),
    prisma.package.findMany({ where: packageScope(s), orderBy: { name: "asc" } }),
    prisma.auditLog.findMany({ where: { accountId: a.id }, orderBy: { time: "desc" }, take: 8 }),
  ]);
  const pkg = a.package;
  const suspended = a.status !== "active";
  return (
    <>
      <h1>{a.username} {suspended ? <Badge kind="bad">suspended</Badge> : <Badge kind="ok">active</Badge>} <Badge kind="off">{a.role}</Badge></h1>
      <p className="sub"><Link href="/admin/accounts">← Accounts</Link> · {a.email} · created {a.createdAt.toLocaleDateString()}{a.lastLoginAt && <> · last login {a.lastLoginAt.toLocaleString()}</>}</p>
      <Flash {...sp} />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        <SectionCard title="Usage">
          <Meter label="Domains" used={domains} limit={pkg?.maxDomains ?? 0} />
          <Meter label="Mailboxes" used={mailboxes} limit={pkg?.maxMailboxes ?? 0} />
          <Meter label="Mail storage" used={Number(storage._sum.usedBytes ?? 0)} limit={(pkg?.diskMb ?? 0) * 1048576} fmt={bytes} />
          <p className="muted">Package: {pkg ? pkg.name : "unlimited"}. Limits for sites, databases, FTP, cron, CPU and RAM apply once those features exist.</p>
        </SectionCard>
        <SectionCard title="Actions">
          <div className="actions">
            {canImpersonate(s.role, a.role as Role) && <form action={impersonate.bind(null, a.id)}><button className="primary">Log in as {a.username}</button></form>}
            {a.totpEnabled && <form action={resetTwoFactor.bind(null, a.id)}><ConfirmButton className="sm" message="Remove two-factor authentication for this account?">Remove 2FA</ConfirmButton></form>}
            {suspended && <form action={unsuspendAccount.bind(null, a.id)}><button>Unsuspend</button></form>}
          </div>
          {!suspended && (
            <form action={suspendAccount.bind(null, a.id)} className="row" style={{ marginTop: 12 }}>
              <div><label>Suspend (blocks panel login)</label><input name="reason" placeholder="Reason (optional)" /></div>
              <div className="auto"><button className="danger">Suspend</button></div>
            </form>
          )}
          {suspended && a.suspendReason && <p className="muted">Reason: {a.suspendReason}</p>}
        </SectionCard>
      </div>

      <SectionCard title="Details">
        <form action={updateAccount.bind(null, a.id)} className="row">
          <div><label>Email</label><input name="email" type="email" defaultValue={a.email} required /></div>
          <div><label>Package</label><select name="packageId" defaultValue={a.packageId ?? ""}>{s.role === "admin" && <option value="">Unlimited (no package)</option>}{packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="auto"><button className="primary">Save</button></div>
        </form>
        <form action={setAccountPassword.bind(null, a.id)} className="row" style={{ marginTop: 12 }}>
          <div><label>New password (min 10) - signs the account out everywhere</label><input name="password" type="password" minLength={10} required autoComplete="new-password" /></div>
          <div className="auto"><button>Set password</button></div>
        </form>
      </SectionCard>

      <SectionCard title="Recent activity" actions={<Link href="/admin/audit" style={{ fontSize: 13 }}>Audit log →</Link>}>
        <table><tbody>
          {audit.map((l) => <tr key={l.id}><td className="muted" style={{ whiteSpace: "nowrap" }}>{l.time.toLocaleString()}</td><td className="mono">{l.action}</td><td>{l.target}</td><td className="muted">{l.actorName}</td></tr>)}
          {!audit.length && <tr><td className="muted">No activity.</td></tr>}
        </tbody></table>
      </SectionCard>

      <SectionCard title="Terminate account">
        <p className="muted">Deletes the account, all of its domains, mailboxes, aliases and stored mail. This cannot be undone.</p>
        <form action={terminateAccount.bind(null, a.id)} className="row">
          <div><label>Type “{a.username}” to confirm</label><input name="confirm" autoComplete="off" required /></div>
          <div className="auto"><button className="danger">Terminate</button></div>
        </form>
      </SectionCard>
    </>
  );
}
