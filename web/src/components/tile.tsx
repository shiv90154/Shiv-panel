import Link from "next/link";
import { Icon } from "./ui";

export type TileColor = "blue" | "amber" | "violet" | "teal" | "green" | "red" | "slate";

export function Tile({ href, icon, label, hint, keywords, color }: { href: string; icon: string; label: string; hint?: string; keywords?: string; color?: TileColor }) {
  return (
    <Link href={href} className={`tile${color ? ` c-${color}` : ""}`} data-tile={`${label} ${hint ?? ""} ${keywords ?? ""}`.toLowerCase()}>
      <span className="tile-icon"><Icon name={icon} /></span>
      <span className="tile-label">{label}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </Link>
  );
}
