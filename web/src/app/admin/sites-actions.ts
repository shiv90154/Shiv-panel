"use server";

// Website actions, shared by the WHM shell (/admin) and the cPanel shell (/cpanel). Session -> getOwnedSite (tenant scope) -> mutate -> apply on host.
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { assertInScope, getOwnedSite } from "@/lib/tenancy";
import { WAF_MODES } from "@/lib/security-core";
import { agentCall } from "@/server/agent";
import { addSiteDomain, applySite, createSite, deleteSite, envKeySchema, redirectSchema, removeSiteDomain, setSiteEnv, type Redirect } from "@/server/sites";

export async function addSite(fd: FormData) {
  const sess = await requireSession();
  let id = "", failed = "";
  await run(`${sess.base}/sites`, async () => {
    const ownerId = s(fd, "ownerId") || sess.account.id;
    await assertInScope(sess, ownerId);
    const site = await createSite({ accountId: ownerId, name: s(fd, "name"), runtime: s(fd, "runtime"), domain: s(fd, "domain"), startCommand: s(fd, "startCommand") || undefined, withWww: fd.get("www") === "on" });
    id = site.id;
    await audit(sess, "site.create", { target: site.name, accountId: ownerId, detail: { runtime: site.runtime } });
    await applySite(site.id).catch((e) => { failed = e instanceof Error ? e.message : "deployment failed"; });
  }).catch((e) => {
    if (!id) throw e;
    redirect(`${sess.base}/sites/${id}?${failed ? "error=" + encodeURIComponent(`Site saved, but deployment failed: ${failed}`) : "ok=Site+created"}`);
  });
}

/** Common shape: load owned site, run `fn`, re-apply on the host, audit. */
async function mutate(id: string, action: string, fn: (site: Awaited<ReturnType<typeof getOwnedSite>>) => Promise<string>, opts: { apply?: boolean } = {}) {
  const sess = await requireSession();
  return run(`${sess.base}/sites/${id}`, async () => {
    const site = await getOwnedSite(sess, id);
    const msg = await fn(site);
    await audit(sess, action, { target: site.name, accountId: site.accountId });
    if (opts.apply !== false) await applySite(site.id);
    return msg;
  });
}

export async function redeploySite(id: string) {
  return mutate(id, "site.redeploy", async () => "Site redeployed");
}

export async function setSiteRunning(id: string, on: boolean) {
  return mutate(id, on ? "site.start" : "site.stop", async (site) => {
    await agentCall(on ? "site.start" : "site.stop", { siteId: site.id }, site.accountId, 30_000);
    await prisma.site.update({ where: { id: site.id }, data: { status: on ? "running" : "stopped", lastError: null } });
    return on ? "Site started" : "Site stopped";
  }, { apply: false });
}

export async function updateSite(id: string, fd: FormData) {
  return mutate(id, "site.update", async (site) => {
    const cmd = s(fd, "startCommand");
    const startCommand = site.startCommand === null ? null : z.string().min(1, "Start command required").max(500).regex(/^[^\r\n\0]+$/, "Single line only").parse(cmd);
    const waf = z.enum(WAF_MODES).parse(s(fd, "waf") || "off");
    await prisma.site.update({ where: { id: site.id }, data: { forceHttps: fd.get("forceHttps") === "on", startCommand, waf } });
    return "Settings saved and redeployed";
  });
}

export async function addDomainToSite(id: string, fd: FormData) {
  return mutate(id, "site.domain.add", async (site) => `Added ${await addSiteDomain(site.id, s(fd, "name"))}`);
}
export async function removeDomainFromSite(id: string, domainId: string) {
  return mutate(id, "site.domain.remove", async (site) => `Removed ${await removeSiteDomain(site, domainId)}`);
}

export async function saveSiteEnv(id: string, fd: FormData) {
  return mutate(id, "site.env", async (site) => {
    const env: Record<string, string> = {};
    for (const line of s(fd, "env").split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 1) throw new Error(`Bad line (expected NAME=value): ${line.slice(0, 60)}`);
      const k = envKeySchema.parse(line.slice(0, i));
      const v = line.slice(i + 1).trim();
      if (v.length > 4096) throw new Error(`${k}: value too long`);
      env[k] = v;
    }
    if (Object.keys(env).length > 100) throw new Error("At most 100 variables");
    await setSiteEnv(site.id, env);
    return "Environment saved and site redeployed";
  });
}

export async function saveSiteRedirects(id: string, fd: FormData) {
  return mutate(id, "site.redirects", async (site) => {
    const list: Redirect[] = [];
    for (const line of s(fd, "redirects").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [from, to, code = "301"] = line.trim().split(/\s+/);
      list.push(redirectSchema.parse({ from, to, code: Number(code) }));
    }
    if (list.length > 100) throw new Error("At most 100 redirects");
    await prisma.site.update({ where: { id: site.id }, data: { redirects: list } });
    return "Redirects saved";
  });
}

export async function removeSite(id: string, fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/sites`, async () => {
    const site = await getOwnedSite(sess, id);
    if (s(fd, "confirm") !== site.name) throw new Error("Type the site name to confirm");
    await deleteSite(site.id, fd.get("deleteFiles") === "on");
    await audit(sess, "site.delete", { target: site.name, accountId: site.accountId });
    return `Site ${site.name} deleted`;
  });
}
