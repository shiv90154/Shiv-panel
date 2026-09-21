import http from "node:http";

// Typed client for the host agent (agent/agent.mjs). Add a method here AND in the agent's METHODS whitelist together.
export type AgentMethods = {
  "agent.ping": { params: Record<string, never>; result: { pong: true; version: string; time: string } };
  "system.info": {
    params: Record<string, never>;
    result: { hostname: string; platform: string; uptimeSec: number; load: number[]; memTotal: number; memFree: number; diskTotal: number; diskFree: number };
  };
  "site.apply": { params: SiteApplyParams; result: { container: string; dir: string } };
  "site.start": { params: { siteId: string }; result: Record<string, never> };
  "site.stop": { params: { siteId: string }; result: Record<string, never> };
  "site.status": { params: { siteId: string }; result: { state: string } };
  "site.logs": { params: { siteId: string; lines?: number }; result: { logs: string } };
  "site.delete": { params: { siteId: string; deleteFiles?: boolean }; result: Record<string, never> };
  "file.list": { params: FileTarget; result: { entries: FileEntry[] } };
  "file.read": { params: FileTarget; result: { content: string } };
  "file.write": { params: FileTarget & { contentB64: string }; result: Record<string, never> };
  "file.mkdir": { params: FileTarget; result: Record<string, never> };
  "file.delete": { params: FileTarget; result: Record<string, never> };
  "file.rename": { params: FileTarget & { newName: string }; result: Record<string, never> };
  "file.chmod": { params: FileTarget & { mode: string }; result: Record<string, never> };
  "file.zip": { params: FileTarget; result: { name: string } };
  "file.unzip": { params: FileTarget; result: Record<string, never> };
  "db.create": { params: { engine: DbEngine; name: string; password: string }; result: Record<string, never> };
  "db.setPassword": { params: { engine: DbEngine; name: string; password: string }; result: Record<string, never> };
  "db.drop": { params: { engine: DbEngine; name: string }; result: Record<string, never> };
  "dns.zoneCreate": { params: { zone: string; records: DnsRecordInput[] }; result: Record<string, never> };
  "dns.zoneDelete": { params: { zone: string }; result: Record<string, never> };
  "dns.zoneGet": { params: { zone: string }; result: { records: { name: string; type: string; ttl: number; content: string }[]; dnssec: { enabled: boolean; ds: string[] } } };
  "dns.recordAdd": { params: DnsRecordInput & { zone: string }; result: Record<string, never> };
  "dns.recordDelete": { params: { zone: string; name: string; type: string; content: string }; result: Record<string, never> };
  "dns.dnssec": { params: { zone: string; enable: boolean }; result: Record<string, never> };
  "cron.run": { params: { siteId: string; runtime: string; command: string; timeoutSec?: number }; result: { exitCode: number | null; output: string; truncated: boolean; durationMs: number } };
  "backup.run": { params: BackupRunParams; result: { results: BackupItemResult[] } };
  "backup.list": { params: Record<string, never>; result: { snapshots: SnapshotInfo[] } };
  "backup.restore": { params: { snapshotId: string; kind: "site" | "db" | "mail"; name: string }; result: Record<string, never> };
  "backup.deleteSnapshot": { params: { snapshotId: string }; result: Record<string, never> };
  "backup.purgeAccount": { params: Record<string, never>; result: Record<string, never> };
};

export type BackupRunParams = { sites: string[]; databases: { engine: DbEngine; name: string }[]; mailDomains: string[]; keep: { daily: number; weekly: number; monthly: number } };
export type BackupItemResult = { kind: "site" | "db" | "mail" | "retention"; name: string; ok: boolean; error?: string };
/** tags look like "site:<siteId>", "db:<engine>:<name>", "mail:<domain>" */
export type SnapshotInfo = { id: string; fullId: string; time: string; tags: string[]; bytes: number | null };

/** name: "@", a label or an FQDN inside the zone. value/priority meaning depends on type (see agent/dns.mjs buildContent). */
export type DnsRecordInput = { name: string; type: string; value: string; priority?: number; ttl?: number };

export type DbEngine = "mariadb" | "postgres";
/** path is relative to the site root, e.g. "/public/index.html"; runtime decides the owning uid of created files. */
export type FileTarget = { siteId: string; runtime: string; path: string };
export type FileEntry = { name: string; type: "file" | "dir" | "link"; size: number; mode: string; mtime: string };

export type SiteApplyParams = {
  siteId: string; runtime: string; domains: string[]; env: Record<string, string>; startCommand?: string;
  redirects: { from: string; to: string; code: 301 | 302 }[]; forceHttps: boolean; memoryMb: number; cpuPercent: number;
};

export class AgentError extends Error {}

export const agentConfigured = () => !!process.env.AGENT_SECRET && !!(process.env.AGENT_URL || process.env.AGENT_SOCKET);

/** accountId: the tenant the call is made for (required by account-scoped methods). */
export function agentCall<M extends keyof AgentMethods>(method: M, params: AgentMethods[M]["params"], accountId: string | null = null, timeoutMs = 5000): Promise<AgentMethods[M]["result"]> {
  return new Promise((resolve, reject) => {
    if (!agentConfigured()) return reject(new AgentError("Agent not configured (set AGENT_SECRET and AGENT_URL or AGENT_SOCKET)"));
    const body = JSON.stringify({ method, accountId, params });
    const url = process.env.AGENT_URL ? new URL("/rpc", process.env.AGENT_URL) : null;
    const req = http.request(
      { method: "POST", ...(url ? { hostname: url.hostname, port: url.port, path: url.pathname } : { socketPath: process.env.AGENT_SOCKET, path: "/rpc" }), timeout: timeoutMs,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), authorization: `Bearer ${process.env.AGENT_SECRET}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString());
            j.ok ? resolve(j.result) : reject(new AgentError(j.error ?? `agent error ${res.statusCode}`));
          } catch { reject(new AgentError(`bad response from agent (${res.statusCode})`)); }
        });
      },
    );
    req.on("timeout", () => req.destroy(new AgentError("agent timed out")));
    req.on("error", (e) => reject(e instanceof AgentError ? e : new AgentError(`agent unreachable: ${e.message}`)));
    req.end(body);
  });
}

export type AgentStatus = { configured: false } | { configured: true; up: false; error: string } | { configured: true; up: true; version: string; info: AgentMethods["system.info"]["result"] };

export async function getAgentStatus(): Promise<AgentStatus> {
  if (!agentConfigured()) return { configured: false };
  try {
    const [ping, info] = await Promise.all([agentCall("agent.ping", {}), agentCall("system.info", {})]);
    return { configured: true, up: true, version: ping.version, info };
  } catch (e) {
    return { configured: true, up: false, error: e instanceof Error ? e.message : "unreachable" };
  }
}
