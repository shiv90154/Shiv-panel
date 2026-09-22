import { requireRole } from "@/lib/session";
import { getBrand } from "@/lib/brand";
import { NavLink } from "@/components/client";
import { ImpersonationBanner } from "@/components/banner";
import { logout } from "../actions/auth";

export const dynamic = "force-dynamic";

// cPanel-style shell for hosting users: top bar + task tiles on the home page.
export default async function CpanelLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("user");
  const brand = await getBrand(s);
  return (
    <>
      <ImpersonationBanner s={s} />
      <header className="cp-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="brand">{brand?.logoUrl && <img src={brand.logoUrl} alt="" height={20} />}{brand?.name ?? "Hosting panel"}</span>
        <nav>
          <NavLink href="/cpanel" exact icon="grid" color="blue">Home</NavLink>
          <NavLink href="/cpanel/sites" icon="globe" color="blue">Websites</NavLink>
          <NavLink href="/cpanel/files" icon="folder" color="amber">Files</NavLink>
          <NavLink href="/cpanel/databases" icon="database" color="violet">Databases</NavLink>
          <NavLink href="/cpanel/cron" icon="activity" color="slate">Cron jobs</NavLink>
          <NavLink href="/cpanel/backups" icon="package" color="teal">Backups</NavLink>
          <NavLink href="/cpanel/dns" icon="globe" color="violet">DNS zones</NavLink>
          <NavLink href="/cpanel/domains" icon="globe" color="violet">Domains</NavLink>
          <NavLink href="/cpanel/mailboxes" icon="inbox" color="green">Email accounts</NavLink>
          <NavLink href="/cpanel/aliases" icon="forward" color="green">Forwarders</NavLink>
          <NavLink href="/cpanel/activity" icon="activity" color="red">Activity</NavLink>
          <NavLink href="/cpanel/account" icon="shield" color="red">Security</NavLink>
        </nav>
        <span className="grow" />
        <span className="muted">{s.account.username}</span>
        <form action={logout}><button className="sm">Sign out</button></form>
      </header>
      <div className="cp-page">{children}</div>
    </>
  );
}
