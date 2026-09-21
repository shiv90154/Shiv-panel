"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ConfirmButton({ message, children, className = "danger sm" }: { message: string; children: React.ReactNode; className?: string }) {
  return (
    <button className={className} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}

export function CopyButton({ text }: { text: string }) {
  return (
    <button type="button" className="sm" onClick={(e) => { navigator.clipboard.writeText(text); const b = e.currentTarget; b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); }}>
      Copy
    </button>
  );
}

/** cPanel-style "find anything" box: filters tiles (elements with data-tile) and hides empty groups. */
export function TileSearch({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <input
        className="search" type="search" placeholder="Search tools (e.g. mailbox, forwarder, password)…" aria-label="Search tools"
        onChange={(e) => {
          const q = e.target.value.trim().toLowerCase();
          const root = e.currentTarget.parentElement!;
          root.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => { el.hidden = !!q && !el.dataset.tile!.includes(q); });
          root.querySelectorAll<HTMLElement>("[data-group]").forEach((g) => { g.hidden = !g.querySelector("[data-tile]:not([hidden])"); });
        }}
      />
      {children}
    </div>
  );
}

export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const p = usePathname();
  const cur = exact ? p === href : p === href || p.startsWith(href + "/");
  return <Link href={href} className={cur ? "cur" : undefined}>{children}</Link>;
}
