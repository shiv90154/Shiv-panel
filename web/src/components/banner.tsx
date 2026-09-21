import { stopImpersonating } from "@/app/actions/auth";
import type { Session } from "@/lib/session";

/** Shown on every page while an admin/reseller is logged in as another account. */
export function ImpersonationBanner({ s }: { s: Session }) {
  if (!s.actor) return null;
  return (
    <div className="imp">
      <span>Logged in as <b>{s.account.username}</b> (you are {s.actor.username}). Actions are recorded in the audit log.</span>
      <form action={stopImpersonating}><button className="sm">Return to my account</button></form>
    </div>
  );
}
