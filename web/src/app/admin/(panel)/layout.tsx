import { requireRole } from "@/lib/session";
import { getBrand } from "@/lib/brand";
import { NavLink } from "@/components/client";
import { Icon } from "@/components/ui";
import { ImpersonationBanner } from "@/components/banner";
import { logout } from "../../actions/auth";

export const dynamic = "force-dynamic";

// WHM-style shell for admins and resellers. Resellers see a reduced menu (no server-wide pages).
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("admin", "reseller");
  const admin = s.role === "admin";
  const brand = await getBrand(s);
  return (
    <>
      <ImpersonationBanner s={s} />
      <div className="shell">
        <nav className="side">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="brand">{brand?.logoUrl && <img src={brand.logoUrl} alt="" height={20} />}{brand?.name ?? "Hosting panel"}</div>
          <NavLink href="/admin" exact icon="grid" color="blue">Dashboard</NavLink>
          <h6>Accounts</h6>
          <NavLink href="/admin/accounts" icon="users" color="slate">Accounts</NavLink>
          <NavLink href="/admin/packages" icon="package" color="slate">Packages</NavLink>
          <h6>Websites</h6>
          <NavLink href="/admin/sites" icon="globe" color="blue">Sites</NavLink>
          <NavLink href="/admin/files" icon="folder" color="amber">File manager</NavLink>
          <NavLink href="/admin/databases" icon="database" color="violet">Databases</NavLink>
          <NavLink href="/admin/cron" icon="activity" color="slate">Cron jobs</NavLink>
          <NavLink href="/admin/backups" icon="package" color="teal">Backups</NavLink>
          <h6>Email</h6>
          <NavLink href="/admin/domains" icon="globe" color="violet">Domains</NavLink>
          <NavLink href="/admin/mailboxes" icon="inbox" color="green">Mailboxes</NavLink>
          <NavLink href="/admin/aliases" icon="forward" color="green">Aliases</NavLink>
          <NavLink href="/admin/dns" icon="globe" color="violet">DNS zones</NavLink>
          {admin && <NavLink href="/admin/logs" icon="clipboard" color="green">Email logs</NavLink>}
          {admin && <><h6>Server</h6>
            <NavLink href="/admin/server" icon="server" color="blue">Server status</NavLink>
            <NavLink href="/admin/security" icon="shield" color="red">Firewall &amp; fail2ban</NavLink>
            <NavLink href="/admin/updates" icon="activity" color="teal">Self-update</NavLink>
          </>}
          <h6>Security</h6>
          <NavLink href="/admin/api" icon="key" color="slate">API &amp; webhooks</NavLink>
          <NavLink href="/admin/audit" icon="clipboard" color="red">Audit log</NavLink>
          <NavLink href="/admin/account" icon="user" color="slate">My account</NavLink>
          <a href="/webmail"><span className="nav-icon"><Icon name="mail" size={16} /></span>Webmail ↗</a>
          <div className="spacer" />
          <div className="who">{s.account.username} · {s.role}</div>
          <form action={logout}><button className="sm" style={{ width: "100%" }}>Sign out</button></form>
        </nav>
        <main className="main">{children}</main>
      </div>
    </>
  );
}
