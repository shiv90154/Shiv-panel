import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">✉ MailHost</div>
        <Link href="/admin">Dashboard</Link>
        <Link href="/admin/domains">Domains</Link>
        <Link href="/admin/mailboxes">Mailboxes</Link>
        <Link href="/admin/aliases">Aliases</Link>
        <Link href="/admin/logs">Email logs</Link>
        <Link href="/admin/server">Server status</Link>
        <Link href="/webmail">Webmail ↗</Link>
        <div className="spacer" />
        <Link href="/admin/account">{admin.email}</Link>
        <form action={logout}><button className="sm" style={{ width: "100%" }}>Sign out</button></form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
