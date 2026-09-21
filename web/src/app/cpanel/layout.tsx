import { requireRole } from "@/lib/session";
import { NavLink } from "@/components/client";
import { ImpersonationBanner } from "@/components/banner";
import { logout } from "../actions/auth";

export const dynamic = "force-dynamic";

// cPanel-style shell for hosting users: top bar + task tiles on the home page.
export default async function CpanelLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("user");
  return (
    <>
      <ImpersonationBanner s={s} />
      <header className="cp-top">
        <span className="brand">Hosting panel</span>
        <nav>
          <NavLink href="/cpanel" exact>Home</NavLink>
          <NavLink href="/cpanel/sites">Websites</NavLink>
          <NavLink href="/cpanel/files">Files</NavLink>
          <NavLink href="/cpanel/databases">Databases</NavLink>
          <NavLink href="/cpanel/cron">Cron jobs</NavLink>
          <NavLink href="/cpanel/backups">Backups</NavLink>
          <NavLink href="/cpanel/dns">DNS zones</NavLink>
          <NavLink href="/cpanel/domains">Domains</NavLink>
          <NavLink href="/cpanel/mailboxes">Email accounts</NavLink>
          <NavLink href="/cpanel/aliases">Forwarders</NavLink>
          <NavLink href="/cpanel/activity">Activity</NavLink>
          <NavLink href="/cpanel/account">Security</NavLink>
        </nav>
        <span className="grow" />
        <span className="muted">{s.account.username}</span>
        <form action={logout}><button className="sm">Sign out</button></form>
      </header>
      <div className="cp-page">{children}</div>
    </>
  );
}
