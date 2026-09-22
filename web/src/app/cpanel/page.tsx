import { prisma } from "@/lib/db";
import { Meter, SectionCard, bytes } from "@/components/ui";
import { Tile, type TileColor } from "@/components/tile";
import { TileSearch } from "@/components/client";
import { requireRole } from "@/lib/session";

// cPanel-style home: search box + task tiles (only tools that exist) + usage sidebar. New features add tiles here.
const GROUPS = [
  { title: "Websites", tiles: [
    { href: "/cpanel/sites", icon: "globe", color: "blue", label: "Websites", hint: "Static, PHP, Node, Python sites", keywords: "site php node python static html domain subdomain redirect env ssl https" },
  ] },
  { title: "Files & databases", tiles: [
    { href: "/cpanel/files", icon: "folder", color: "amber", label: "File manager", hint: "Browse, upload, edit, zip", keywords: "files upload edit zip unzip chmod permissions folder" },
    { href: "/cpanel/databases", icon: "database", color: "violet", label: "Databases", hint: "MariaDB and PostgreSQL", keywords: "mysql mariadb postgres postgresql sql database user password" },
  ] },
  { title: "Maintenance", tiles: [
    { href: "/cpanel/backups", icon: "package", color: "teal", label: "Backups", hint: "Snapshots, schedule, restore", keywords: "backup restore snapshot restic retention schedule" },
    { href: "/cpanel/cron", icon: "activity", color: "slate", label: "Cron jobs", hint: "Scheduled commands", keywords: "cron schedule task job command periodic" },
  ] },
  { title: "Email", tiles: [
    { href: "/cpanel/mailboxes", icon: "inbox", color: "green", label: "Email accounts", hint: "Create and manage mailboxes", keywords: "mailbox quota password imap smtp" },
    { href: "/cpanel/aliases", icon: "forward", color: "green", label: "Forwarders", hint: "Aliases and catch-all", keywords: "alias forward catch-all redirect" },
    { href: "/webmail", icon: "mail", color: "green", label: "Webmail", hint: "Read and send mail", keywords: "inbox read compose" },
  ] },
  { title: "Domains", tiles: [
    { href: "/cpanel/domains", icon: "globe", color: "violet", label: "Domains", hint: "DNS records, DKIM, DMARC", keywords: "dns dkim spf dmarc mx verify" },
    { href: "/cpanel/dns", icon: "globe", color: "violet", label: "DNS zones", hint: "A, MX, TXT, CAA records, DNSSEC", keywords: "dns zone record nameserver a aaaa cname mx txt srv caa dnssec ttl" },
  ] },
  { title: "Security", tiles: [
    { href: "/cpanel/account", icon: "shield", color: "red", label: "Password & 2FA", hint: "Sign-in security", keywords: "password two-factor totp authenticator" },
    { href: "/cpanel/activity", icon: "activity", color: "red", label: "Activity log", hint: "Sign-ins and changes", keywords: "audit history log" },
  ] },
] satisfies { title: string; tiles: { href: string; icon: string; color: TileColor; label: string; hint: string; keywords: string }[] }[];

export default async function CpanelHome() {
  const s = await requireRole("user");
  const a = s.account;
  const [domains, sites, databases, cron, mailboxes, storage, pkg] = await Promise.all([
    prisma.domain.count({ where: { accountId: a.id } }), prisma.site.count({ where: { accountId: a.id } }), prisma.database.count({ where: { accountId: a.id } }), prisma.cronJob.count({ where: { accountId: a.id } }), prisma.mailbox.count({ where: { accountId: a.id } }),
    prisma.mailbox.aggregate({ where: { accountId: a.id }, _sum: { usedBytes: true } }),
    a.packageId ? prisma.package.findUnique({ where: { id: a.packageId } }) : null,
  ]);
  return (
    <div className="cp-home">
      <TileSearch>
        {GROUPS.map((g) => (
          <div className="tile-group" data-group key={g.title}>
            <h3>{g.title}</h3>
            <div className="tiles">{g.tiles.map((t) => <Tile key={t.href} {...t} />)}</div>
          </div>
        ))}
      </TileSearch>
      <aside>
        <SectionCard title="Statistics">
          <Meter label="Domains" used={domains} limit={pkg?.maxDomains ?? 0} />
          <Meter label="Websites" used={sites} limit={pkg?.maxSites ?? 0} />
          <Meter label="Databases" used={databases} limit={pkg?.maxDatabases ?? 0} />
          <Meter label="Cron jobs" used={cron} limit={pkg?.maxCronJobs ?? 0} />
          <Meter label="Email accounts" used={mailboxes} limit={pkg?.maxMailboxes ?? 0} />
          <Meter label="Mail storage" used={Number(storage._sum.usedBytes ?? 0)} limit={(pkg?.diskMb ?? 0) * 1048576} fmt={bytes} />
        </SectionCard>
        <SectionCard title="Account">
          <table><tbody>
            <tr><td className="muted">Username</td><td>{a.username}</td></tr>
            <tr><td className="muted">Package</td><td>{pkg?.name ?? "Unlimited"}</td></tr>
            <tr><td className="muted">Two-factor</td><td>{a.totpEnabled ? "On" : "Off"}</td></tr>
          </tbody></table>
        </SectionCard>
      </aside>
    </div>
  );
}
