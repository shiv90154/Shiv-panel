import { requireRole } from "@/lib/session";
import { NavLink } from "@/components/client";
import { ImpersonationBanner } from "@/components/banner";
import { logout } from "../../actions/auth";

export const dynamic = "force-dynamic";

// WHM-style shell for admins and resellers. Resellers see a reduced menu (no server-wide pages).
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("admin", "reseller");
  const admin = s.role === "admin";
  return (
    <>
      <ImpersonationBanner s={s} />
      <div className="shell">
        <nav className="side">
          <div className="brand">Hosting panel</div>
          <NavLink href="/admin" exact>Dashboard</NavLink>
          <h6>Accounts</h6>
          <NavLink href="/admin/accounts">Accounts</NavLink>
          <NavLink href="/admin/packages">Packages</NavLink>
          <h6>Websites</h6>
          <NavLink href="/admin/sites">Sites</NavLink>
          <NavLink href="/admin/files">File manager</NavLink>
          <NavLink href="/admin/databases">Databases</NavLink>
          <NavLink href="/admin/cron">Cron jobs</NavLink>
          <NavLink href="/admin/backups">Backups</NavLink>
          <h6>Email</h6>
          <NavLink href="/admin/domains">Domains</NavLink>
          <NavLink href="/admin/mailboxes">Mailboxes</NavLink>
          <NavLink href="/admin/aliases">Aliases</NavLink>
          <NavLink href="/admin/dns">DNS zones</NavLink>
          {admin && <NavLink href="/admin/logs">Email logs</NavLink>}
          {admin && <><h6>Server</h6><NavLink href="/admin/server">Server status</NavLink></>}
          <h6>Security</h6>
          <NavLink href="/admin/api">API &amp; webhooks</NavLink>
          <NavLink href="/admin/audit">Audit log</NavLink>
          <NavLink href="/admin/account">My account</NavLink>
          <a href="/webmail">Webmail ↗</a>
          <div className="spacer" />
          <div className="who">{s.account.username} · {s.role}</div>
          <form action={logout}><button className="sm" style={{ width: "100%" }}>Sign out</button></form>
        </nav>
        <main className="main">{children}</main>
      </div>
    </>
  );
}
