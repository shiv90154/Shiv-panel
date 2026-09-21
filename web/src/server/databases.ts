import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { seal, unseal } from "@/lib/crypto";
import { assertWithinPackage } from "@/lib/tenancy";
import { agentCall, type DbEngine } from "./agent";

export const ENGINE_OPTIONS = [{ id: "mariadb", label: "MariaDB", port: 3306 }, { id: "postgres", label: "PostgreSQL", port: 5432 }] as const;
export const engineSchema = z.enum(["mariadb", "postgres"]);
export const dbSuffixSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,23}$/, "Name: letters, digits, underscore (max 23)");

// Hostname tenants use to reach the DB server from their sites/apps (containers: the docker bridge gateway; external: the server).
export const dbHost = (engine: DbEngine) => (engine === "mariadb" ? process.env.MARIADB_HOST : process.env.POSTGRES_TENANT_HOST) || "host.docker.internal";

export const readDbPassword = (d: { passwordSealed: string }) => unseal(d.passwordSealed) ?? "";
const newPassword = () => crypto.randomBytes(18).toString("base64url"); // 24 chars of A-Za-z0-9_-, matches the agent's PASS_RE

/** "<up to 8 chars of the username>_<suffix>": the same string is the database name and its only user. */
export const dbName = (username: string, suffix: string) => `${username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "u"}_${suffix}`;

export async function createDatabase(a: { accountId: string; engine: string; suffix: string }) {
  const engine = engineSchema.parse(a.engine), suffix = dbSuffixSchema.parse(a.suffix);
  await assertWithinPackage(a.accountId, "databases");
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: a.accountId }, select: { username: true } });
  const name = dbName(acc.username, suffix), password = newPassword();
  if (await prisma.database.findUnique({ where: { engine_name: { engine, name } } })) throw new Error(`A ${engine} database named ${name} already exists`);
  const row = await prisma.database.create({ data: { accountId: a.accountId, engine, name, passwordSealed: seal(password) } });
  try { await agentCall("db.create", { engine, name, password }, a.accountId, 60_000); }
  catch (e) { await prisma.database.delete({ where: { id: row.id } }); throw e; }
  return row;
}

export async function resetDatabasePassword(id: string) {
  const d = await prisma.database.findUniqueOrThrow({ where: { id } });
  const password = newPassword();
  await agentCall("db.setPassword", { engine: d.engine as DbEngine, name: d.name, password }, d.accountId, 60_000);
  await prisma.database.update({ where: { id }, data: { passwordSealed: seal(password) } });
}

export async function deleteDatabase(id: string) {
  const d = await prisma.database.findUniqueOrThrow({ where: { id } });
  await agentCall("db.drop", { engine: d.engine as DbEngine, name: d.name }, d.accountId, 60_000);
  await prisma.database.delete({ where: { id } });
}
