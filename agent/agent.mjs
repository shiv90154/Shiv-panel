#!/usr/bin/env node
// Host agent: the ONLY component that performs privileged work (sites, DBs, files, backups, firewall ...).
// The web container never gets docker.sock or root; it calls this agent over a typed, whitelisted RPC.
//
//   POST /rpc   Authorization: Bearer <AGENT_SECRET>
//   body        { "method": "system.info", "accountId": "<cuid>|null", "params": {} }
//   response    { "ok": true, "result": ... }   |   { "ok": false, "error": "..." }
//
// Listen on a unix socket (AGENT_SOCKET, mode 0660) or TCP (AGENT_LISTEN=host:port, e.g. the docker bridge IP).
// A method exists only if it is in METHODS below. Each declares whether it needs an accountId and validates its params.
// Zero dependencies on purpose (small attack surface, runs under plain `node`).
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { SITE_METHODS } from "./sites.mjs";
import { FILE_METHODS } from "./files.mjs";
import { DB_METHODS } from "./databases.mjs";
import { DNS_METHODS } from "./dns.mjs";
import { CRON_METHODS } from "./cron.mjs";
import { BACKUP_METHODS } from "./backup.mjs";
import { FIREWALL_METHODS, restoreFirewall } from "./firewall.mjs";
import { FAIL2BAN_METHODS } from "./fail2ban.mjs";
import { CLAMAV_METHODS } from "./clamav.mjs";
import { METRIC_METHODS } from "./metrics.mjs";
import { UPDATE_METHODS } from "./update.mjs";

export const VERSION = "0.6.0";
const MAX_BODY = 36 * 1024 * 1024; // file.write carries up to 25 MB as base64 (bearer auth is checked before the body is read)
const ID_RE = /^[a-z0-9]{8,64}$/; // cuid-shaped account ids

const noParams = (p) => { if (p && Object.keys(p).length) throw new Error("This method takes no params"); return {}; };

/** name -> { scope: "system" | "account", validate(params) -> params, run(params, ctx) -> result } */
export const METHODS = {
  "agent.ping": {
    scope: "system", validate: noParams,
    run: async () => ({ pong: true, version: VERSION, time: new Date().toISOString() }),
  },
  "system.info": {
    scope: "system", validate: noParams,
    run: async () => {
      const st = fs.statfsSync("/");
      return {
        hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, uptimeSec: Math.round(os.uptime()),
        load: os.loadavg(), memTotal: os.totalmem(), memFree: os.freemem(),
        diskTotal: st.blocks * st.bsize, diskFree: st.bavail * st.bsize,
      };
    },
  },
  ...SITE_METHODS,
  ...FILE_METHODS,
  ...DB_METHODS,
  ...DNS_METHODS,
  ...CRON_METHODS,
  ...BACKUP_METHODS,
  ...FIREWALL_METHODS,
  ...FAIL2BAN_METHODS,
  ...CLAMAV_METHODS,
  ...METRIC_METHODS,
  ...UPDATE_METHODS,
};

const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function createServer(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("AGENT_SECRET must be at least 32 characters");
  return http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method !== "POST" || req.url !== "/rpc") return send(404, { ok: false, error: "not found" });
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !safeEq(auth.slice(7), secret)) return send(401, { ok: false, error: "unauthorized" });
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { send(413, { ok: false, error: "body too large" }); req.destroy(); } else chunks.push(c); });
    req.on("end", async () => {
      if (res.writableEnded) return;
      try {
        const { method, accountId = null, params = {} } = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        const m = typeof method === "string" && Object.hasOwn(METHODS, method) ? METHODS[method] : null;
        if (!m) return send(400, { ok: false, error: "unknown method" });
        if (m.scope === "account" && !(typeof accountId === "string" && ID_RE.test(accountId))) return send(400, { ok: false, error: "accountId required" });
        const result = await m.run(m.validate(params), { accountId });
        console.log(`[agent] ${method} account=${accountId ?? "-"} ok`);
        send(200, { ok: true, result });
      } catch (e) {
        console.error("[agent] error:", e);
        send(400, { ok: false, error: e instanceof Error ? e.message : "bad request" });
      }
    });
  });
}

// Only start listening when run directly (so tests can import createServer).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(process.env.AGENT_SECRET);
  // nftables is not persistent: re-load the last ruleset the panel applied (no file = the firewall was never enabled)
  restoreFirewall().then((r) => r && console.log("[agent] firewall restored"), (e) => console.error("[agent] firewall restore failed:", e.message));
  const sock = process.env.AGENT_SOCKET;
  if (sock) {
    fs.rmSync(sock, { force: true });
    server.listen(sock, () => { fs.chmodSync(sock, 0o660); console.log(`[agent] v${VERSION} listening on unix:${sock}`); });
  } else {
    const [host, port] = (process.env.AGENT_LISTEN ?? "127.0.0.1:7701").split(":");
    server.listen(Number(port), host, () => console.log(`[agent] v${VERSION} listening on ${host}:${port}`));
  }
}
