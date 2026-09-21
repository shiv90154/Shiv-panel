import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { generateDkimKeyPair, syncDkimFiles } from "@/lib/dkim";
import { checkDomainDns, isCoreDnsReady } from "@/lib/dns";
import { hashMailboxPassword } from "@/lib/password";

export const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Invalid domain name");

export const localPartSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/, "Invalid mailbox name (letters, digits, . _ + - only)");

export const passwordSchema = z.string().min(10, "Password must be at least 10 characters").max(200);

export async function createDomain(rawName: string, opts: { defaultQuotaMb?: number } = {}) {
  const name = domainNameSchema.parse(rawName);
  if (name === config.mailHostname) throw new Error("This is the server hostname; use a different domain");
  if (await prisma.domain.findUnique({ where: { name } })) throw new Error(`${name} already exists`);
  const { publicKey, privateKey } = generateDkimKeyPair();
  const domain = await prisma.domain.create({
    data: { name, dkimPublicKey: publicKey, dkimPrivateKey: privateKey, defaultQuotaMb: opts.defaultQuotaMb ?? 1024 },
  });
  await syncDkimFiles();
  return domain;
}

export async function deleteDomain(id: string) {
  const d = await prisma.domain.findUnique({ where: { id } });
  if (!d) return;
  await prisma.domain.delete({ where: { id } }); // cascades to mailboxes + aliases
  await syncDkimFiles();
  await removeMailData(d.name);
}

export async function rotateDkim(id: string) {
  const { publicKey, privateKey } = generateDkimKeyPair();
  await prisma.domain.update({ where: { id }, data: { dkimPublicKey: publicKey, dkimPrivateKey: privateKey, dnsVerified: false } });
  await syncDkimFiles();
}

export async function verifyDomainDns(id: string) {
  const d = await prisma.domain.findUniqueOrThrow({ where: { id } });
  const checks = await checkDomainDns(d);
  await prisma.domain.update({ where: { id }, data: { dnsStatus: checks, dnsCheckedAt: new Date(), dnsVerified: isCoreDnsReady(checks) } });
  return checks;
}

// ---------- mailboxes ----------
export async function createMailbox(domainId: string, input: { localPart: string; password: string; displayName?: string; quotaMb?: number }) {
  const domain = await prisma.domain.findUniqueOrThrow({ where: { id: domainId }, include: { _count: { select: { mailboxes: true } } } });
  const localPart = localPartSchema.parse(input.localPart);
  const password = passwordSchema.parse(input.password);
  if (domain.maxMailboxes > 0 && domain._count.mailboxes >= domain.maxMailboxes) throw new Error(`Mailbox limit (${domain.maxMailboxes}) reached for ${domain.name}`);
  const email = `${localPart}@${domain.name}`;
  if (await prisma.alias.findUnique({ where: { source: email } })) throw new Error(`${email} is already used as an alias`);
  return prisma.mailbox.create({
    data: {
      domainId, localPart, email,
      displayName: input.displayName?.trim() || null,
      passwordHash: await hashMailboxPassword(password),
      quotaMb: input.quotaMb ?? domain.defaultQuotaMb,
    },
  });
}

export async function deleteMailbox(id: string, { purge = true } = {}) {
  const m = await prisma.mailbox.findUnique({ where: { id }, include: { domain: true } });
  if (!m) return;
  await prisma.mailbox.delete({ where: { id } });
  if (purge) await removeMailData(m.domain.name, m.localPart);
}

// ---------- aliases ----------
export async function createAlias(domainId: string, sourceLocal: string, destinationsRaw: string) {
  const domain = await prisma.domain.findUniqueOrThrow({ where: { id: domainId } });
  const local = sourceLocal.trim().toLowerCase();
  const source = local === "*" || local === "" ? `@${domain.name}` : `${localPartSchema.parse(local)}@${domain.name}`;
  const destinations = [...new Set(destinationsRaw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!destinations.length) throw new Error("At least one destination is required");
  for (const dest of destinations) z.string().email().parse(dest);
  if (destinations.includes(source)) throw new Error("An alias cannot point to itself");
  if (await prisma.mailbox.findUnique({ where: { email: source } })) throw new Error(`${source} is already a mailbox`);
  return prisma.alias.create({ data: { domainId, source, destinations } });
}

// ---------- filesystem ----------
async function removeMailData(domainName: string, localPart?: string) {
  const root = path.resolve(config.vmailDir);
  const target = path.resolve(root, domainName, ...(localPart ? [localPart] : []));
  if (!target.startsWith(root + path.sep) || target === root) return; // safety
  await fs.rm(target, { recursive: true, force: true }).catch(() => {});
}
