import Link from "next/link";
import { Icon } from "./ui";

export function Tile({ href, icon, label, hint, keywords }: { href: string; icon: string; label: string; hint?: string; keywords?: string }) {
  return (
    <Link href={href} className="tile" data-tile={`${label} ${hint ?? ""} ${keywords ?? ""}`.toLowerCase()}>
      <span className="tile-icon"><Icon name={icon} /></span>
      <span className="tile-label">{label}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </Link>
  );
}
