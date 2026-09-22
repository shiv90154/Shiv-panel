import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { seal, unseal } from "@/lib/crypto";
import { domainNameSchema } from "./domains";
import { agentCall, type SiteApplyParams } from "./agent";
import { assertWithinPackage } from "@/lib/tenancy";
import { config } from "@/lib/config";

// Keep in sync with RUNTIMES in agent/sites.mjs (the agent is the authority; it rejects anything not listed).
export const RUNTIME_OPTIONS = [
  { id: "static", label: "Static HTML", cmd: false },
  { id: "php-8.4", label: "PHP 8.4", cmd: false }, { id: "php-8.3", label: "PHP 8.3", cmd: false },
  { id: "php-8.2", label: "PHP 8.2", cmd: false }, { id: "php-8.1", label: "PHP 8.1", cmd: false },
  { id: "node-22", label: "Node.js 22", cmd: true, defaultCmd: "npm start" }, { id: "node-20", label: "Node.js 20", cmd: true, defaultCmd: "npm start" },
  { id: "node-18", label: "Node.js 18", cmd: true, defaultCmd: "npm start" },
  { id: "python", label: "Python 3.12", cmd: true, defaultCmd: "python app.py" },
] as const;

export const siteNameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Site name: letters, digits, dashes (max 40)");
export const runtimeSchema = z.enum(RUNTIME_OPTIONS.map((r) => r.id) as [string, ...string[]]);
export const envKeySchema = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "Env name: letters, digits, _").refine((k) => !["PATH", "HOME", "HOSTNAME", "PORT"].includes(k), "That name is reserved");
export const redirectSchema = z.object({
  from: z.string().trim().regex(/^\/[A-Za-z0-9._~\-\/%]*$/, "From-path must start with / (letters, digits, . _ ~ - / %)"),
  to: z.string().trim().regex(/^(https?:\/\/[^\s{}"\\`$]+|\/[^\s{}"\\`$]*)$/, "Target must be an http(s) URL or a /path"),
  code: z.union([z.literal(301), z.literal(302)]),
});
export type Redirect = z.infer<typeof redirectSchema>;

export const readEnv = (site: { envSealed: string | null }): Record<string, string> => {
  if (!site.envSealed) return {};
  try { return JSON.parse(unseal(site.envSealed) ?? "{}"); } catch { return {}; }
};
const readRedirects = (v: unknown): Redirect[] => (Array.isArray(v) ? (v as Redirect[]) : []);

type SiteFull = NonNullable<Awaited<ReturnType<typeof loadSite>>>;
const loadSite = (id: string) => prisma.site.findUnique({ where: { id }, include: { domains: true, account: { include: { package: true } } } });

/** Push the DB state of a site to the host (container + Caddy route) and record the outcome. */
export async function applySite(id: string) {
  const site = await loadSite(id);
  if (!site) throw new Error("Not found");
  const pkg = site.account.package;
  const params: SiteApplyParams = {
    siteId: site.id, runtime: site.runtime, domains: site.domains.map((d) => d.name), env: readEnv(site),
    startCommand: site.startCommand ?? undefined, redirects: readRedirects(site.redirects) as SiteApplyParams["redirects"],
    forceHttps: site.forceHttps, waf: site.waf as SiteApplyParams["waf"], memoryMb: pkg?.ramMb ?? 0, cpuPercent: pkg?.cpuPercent ?? 0,
  };
  try {
    await agentCall("site.apply", params, site.accountId, 15 * 60_000);
    await prisma.site.update({ where: { id }, data: { status: "running", lastError: null } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "apply failed";
    await prisma.site.update({ where: { id }, data: { status: "error", lastError: msg.slice(0, 500) } });
    throw e;
  }
}

/** Domain names must be unique across sites, and must not shadow the panel/mail hostname. */
async function assertDomainsFree(names: string[], exceptSiteId?: string) {
  for (const n of names) {
    if (n === config.mailHostname) throw new Error(`${n} is reserved for the panel`);
    const hit = await prisma.siteDomain.findUnique({ where: { name: n } });
    if (hit && hit.siteId !== exceptSiteId) throw new Error(`${n} is already used by another site`);
  }
}

export async function createSite(o: { accountId: string; name: string; runtime: string; domain: string; startCommand?: string; withWww: boolean }) {
  const name = siteNameSchema.parse(o.name);
  const runtime = runtimeSchema.parse(o.runtime);
  const domain = domainNameSchema.parse(o.domain);
  const opt = RUNTIME_OPTIONS.find((r) => r.id === runtime)!;
  const startCommand = opt.cmd ? z.string().trim().min(1, "Start command required").max(500).regex(/^[^\r\n\0]+$/, "Single line only").parse(o.startCommand ?? opt.defaultCmd) : null;
  const names = [domain, ...(o.withWww && domain.split(".").length === 2 ? [`www.${domain}`] : [])];
  await assertDomainsFree(names);
  if (await prisma.site.findUnique({ where: { accountId_name: { accountId: o.accountId, name } } })) throw new Error(`You already have a site called ${name}`);
  await assertWithinPackage(o.accountId, "sites");
  const site = await prisma.site.create({
    data: { accountId: o.accountId, name, runtime, startCommand, domains: { create: names.map((n, i) => ({ name: n, primary: i === 0 })) } },
  });
  return site;
}

export async function addSiteDomain(siteId: string, raw: string) {
  const name = domainNameSchema.parse(raw);
  await assertDomainsFree([name]);
  const count = await prisma.siteDomain.count({ where: { siteId } });
  if (count >= 50) throw new Error("A site can have at most 50 domains");
  await prisma.siteDomain.create({ data: { siteId, name } });
  return name;
}

export async function removeSiteDomain(site: SiteFull | { id: string }, domainId: string) {
  const d = await prisma.siteDomain.findFirst({ where: { id: domainId, siteId: site.id } });
  if (!d) throw new Error("Not found");
  if (d.primary) throw new Error("The primary domain cannot be removed");
  await prisma.siteDomain.delete({ where: { id: d.id } });
  return d.name;
}

export async function setSiteEnv(siteId: string, env: Record<string, string>) {
  await prisma.site.update({ where: { id: siteId }, data: { envSealed: Object.keys(env).length ? seal(JSON.stringify(env)) : null } });
}

export async function deleteSite(id: string, deleteFiles: boolean) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id } });
  await agentCall("site.delete", { siteId: id, deleteFiles }, site.accountId, 60_000);
  await prisma.site.delete({ where: { id } });
}
