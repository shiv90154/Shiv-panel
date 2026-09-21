import "server-only";
import { prisma } from "./db";
import { clientIp, type Session } from "./session";

/** Append to the audit log. Never throws: a logging failure must not break the action being logged. */
export async function audit(
  s: Pick<Session, "account" | "actor"> | null,
  action: string,
  o: { target?: string; detail?: Record<string, unknown>; accountId?: string | null; actorName?: string } = {},
) {
  try {
    const real = s ? (s.actor ?? s.account) : null;
    await prisma.auditLog.create({
      data: {
        actorId: real?.id ?? null,
        actorName: o.actorName ?? (real ? real.username + (s?.actor ? ` (as ${s.account.username})` : "") : "anonymous"),
        accountId: o.accountId !== undefined ? o.accountId : (s?.account.id ?? null),
        action,
        target: o.target ?? null,
        ip: await clientIp().catch(() => null),
        detail: o.detail ? (o.detail as object) : undefined,
      },
    });
  } catch (e) {
    console.error("[audit] failed:", e);
  }
}
