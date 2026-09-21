import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authenticateKey } from "@/lib/apikey";
import { hashAdminPassword } from "@/lib/password";
import { tooManyAttempts, recordAttempt } from "@/lib/ratelimit";
import type { Session } from "@/lib/session";
import { creatableRoles, scopeIds, packageScope } from "@/lib/tenancy";
import type { Role } from "@/lib/tenancy-core";
import { passwordSchema } from "@/server/domains";
import { setAccountStatus, terminateAccountCore } from "@/server/accounts";
import { emitAccountEvent } from "@/server/webhooks";

export const dynamic = "force-dynamic";

const RESERVED = new Set(["root", "postmaster", "mail", "www", "ftp", "webmaster", "hostmaster", "abuse", "support", "nobody", "system"]);
const username = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9]{2,15}$/, "username: 3-16 letters/digits, starting with a letter").refine((u) => !RESERVED.has(u), "username is reserved");
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, error: string) => json({ error }, status);

const view = (a: { username: string; email: string; role: string; status: string; suspendReason: string | null; createdAt: Date; package?: { name: string } | null }) =>
  ({ username: a.username, email: a.email, role: a.role, status: a.status, suspendReason: a.suspendReason, package: a.package?.name ?? null, createdAt: a.createdAt });

async function findPackage(sess: Session, ref: unknown) {
  if (ref == null || ref === "") return null;
  const p = await prisma.package.findFirst({ where: { ...packageScope(sess), OR: [{ id: String(ref) }, { name: String(ref) }] } });
  if (!p) throw new Error("package not found");
  return p;
}

/** Account addressed by username, limited to the key owner's subtree (never itself, never an admin). */
async function findManaged(sess: Session, name: string) {
  const ids = await scopeIds(sess);
  const a = await prisma.account.findFirst({ where: { username: name.toLowerCase(), role: { not: "admin" }, id: { not: sess.account.id }, ...(ids && { AND: [{ id: { in: ids } }] }) }, include: { package: true } });
  if (!a) throw new Error("account not found");
  return a;
}

async function handle(req: NextRequest, path: string[]) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (tooManyAttempts("api-auth:" + ip, 30, 60_000)) return fail(429, "too many failed requests");
  const sess = await authenticateKey(req.headers.get("authorization"));
  if (!sess) { recordAttempt("api-auth:" + ip); return fail(401, "invalid or missing API key"); }
  const m = req.method;
  const body = m === "POST" ? await req.json().catch(() => ({})) as Record<string, unknown> : {};
  const [res, name, action] = path;

  try {
    if (res === "packages" && !name && m === "GET") {
      const pk = await prisma.package.findMany({ where: packageScope(sess), orderBy: { name: "asc" } });
      return json({ packages: pk.map(({ ownerId: _o, createdAt: _c, ...p }) => p) });
    }
    if (res !== "accounts") return fail(404, "not found");

    if (!name && m === "GET") {
      const ids = await scopeIds(sess);
      const list = await prisma.account.findMany({ where: { role: { not: "admin" }, id: { not: sess.account.id }, ...(ids && { AND: [{ id: { in: ids } }] }) }, include: { package: true }, orderBy: { username: "asc" }, take: 1000 });
      return json({ accounts: list.map(view) });
    }
    if (!name && m === "POST") {
      const d = z.object({ username, email: z.string().trim().toLowerCase().email(), password: passwordSchema, role: z.enum(["reseller", "user"]).default("user") }).parse(body);
      if (!creatableRoles(sess.role).includes(d.role as Role)) return fail(403, "cannot create that account type");
      const pkg = await findPackage(sess, body.package);
      if (!pkg && sess.role !== "admin") return fail(422, "package is required");
      if (await prisma.account.findFirst({ where: { OR: [{ username: d.username }, { email: d.email }] } })) return fail(409, "username or email already in use");
      const acc = await prisma.account.create({ data: { username: d.username, email: d.email, role: d.role, parentId: sess.account.id, packageId: pkg?.id ?? null, passwordHash: await hashAdminPassword(d.password) }, include: { package: true } });
      await audit(sess, "account.create", { target: acc.username, accountId: acc.id, detail: { role: acc.role, package: pkg?.name ?? null, via: "api" } });
      emitAccountEvent("account.created", acc);
      return json({ account: view(acc) }, 201);
    }
    if (name && !action && m === "GET") return json({ account: view(await findManaged(sess, name)) });
    if (name && !action && m === "DELETE") {
      const acc = await findManaged(sess, name);
      await terminateAccountCore(sess, acc);
      return json({ ok: true });
    }
    if (name && m === "POST") {
      const acc = await findManaged(sess, name);
      if (action === "suspend") { await setAccountStatus(sess, acc, true, typeof body.reason === "string" ? body.reason.slice(0, 200) : null); return json({ ok: true }); }
      if (action === "unsuspend") { await setAccountStatus(sess, acc, false); return json({ ok: true }); }
      if (action === "password") {
        await prisma.account.update({ where: { id: acc.id }, data: { passwordHash: await hashAdminPassword(passwordSchema.parse(body.password)) } });
        await audit(sess, "account.password_reset", { target: acc.username, accountId: acc.id, detail: { via: "api" } });
        return json({ ok: true });
      }
      if (action === "package") {
        const pkg = await findPackage(sess, body.package);
        if (!pkg && sess.role !== "admin") return fail(422, "package is required");
        await prisma.account.update({ where: { id: acc.id }, data: { packageId: pkg?.id ?? null } });
        await audit(sess, "account.update", { target: acc.username, accountId: acc.id, detail: { package: pkg?.name ?? null, via: "api" } });
        emitAccountEvent("account.package_changed", acc, { package: pkg?.name ?? null });
        return json({ ok: true });
      }
    }
    return fail(404, "not found");
  } catch (e) {
    if (e instanceof z.ZodError) return fail(422, e.issues[0]?.message ?? "invalid input");
    const msg = e instanceof Error ? e.message : "error";
    if (/not found$/.test(msg)) return fail(404, msg);
    console.error("[api]", e);
    return fail(400, msg);
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export const GET = async (r: NextRequest, c: Ctx) => handle(r, (await c.params).path);
export const POST = GET;
export const DELETE = GET;
