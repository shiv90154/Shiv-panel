"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/session";
import { packageScope } from "@/lib/tenancy";
import { packageOverruns } from "@/lib/tenancy-core";

/** A reseller may not hand out more than its own package allows (0 in a capped field = unlimited = too much). */
async function assertFitsReseller(sess: Awaited<ReturnType<typeof requireRole>>, data: Parameters<typeof packageOverruns>[0]) {
  if (sess.role !== "reseller") return;
  const own = sess.account.packageId ? await prisma.package.findUnique({ where: { id: sess.account.packageId } }) : null;
  const over = packageOverruns(data, own);
  if (over.length) throw new Error(`Exceeds your own package (${own!.name}): ${over.join(", ")}`);
}

const n = z.coerce.number().int().min(0).max(1_000_000_000);
const packageSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  diskMb: n, bandwidthMb: n, maxDomains: n, maxSites: n, maxMailboxes: n, maxDatabases: n, maxFtpUsers: n, maxCronJobs: n, cpuPercent: z.coerce.number().int().min(0).max(10000), ramMb: n,
});
const parse = (fd: FormData) => packageSchema.parse(Object.fromEntries(Object.keys(packageSchema.shape).map((k) => [k, s(fd, k) || (k === "name" ? "" : "0")])));

export async function createPackage(fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  return run("/admin/packages", async () => {
    const data = parse(fd);
    await assertFitsReseller(sess, data);
    if (await prisma.package.findUnique({ where: { ownerId_name: { ownerId: sess.account.id, name: data.name } } })) throw new Error("You already have a package with that name");
    await prisma.package.create({ data: { ...data, ownerId: sess.account.id } });
    await audit(sess, "package.create", { target: data.name });
    return `Package ${data.name} created`;
  });
}

export async function updatePackage(id: string, fd: FormData) {
  const sess = await requireRole("admin", "reseller");
  return run("/admin/packages", async () => {
    const pkg = await prisma.package.findFirst({ where: { id, ...packageScope(sess) } });
    if (!pkg) throw new Error("Not found");
    const data = parse(fd);
    await assertFitsReseller(sess, data);
    if (data.name !== pkg.name && (await prisma.package.findUnique({ where: { ownerId_name: { ownerId: pkg.ownerId, name: data.name } } }))) throw new Error("A package with that name already exists");
    await prisma.package.update({ where: { id: pkg.id }, data });
    await audit(sess, "package.update", { target: data.name });
    return `Package ${data.name} saved`;
  });
}

export async function deletePackage(id: string) {
  const sess = await requireRole("admin", "reseller");
  return run("/admin/packages", async () => {
    const pkg = await prisma.package.findFirst({ where: { id, ...packageScope(sess) } });
    if (!pkg) throw new Error("Not found");
    const used = await prisma.account.count({ where: { packageId: pkg.id } });
    if (used) throw new Error(`${used} account(s) still use this package`);
    await prisma.package.delete({ where: { id: pkg.id } });
    await audit(sess, "package.delete", { target: pkg.name });
    return "Package deleted";
  });
}
