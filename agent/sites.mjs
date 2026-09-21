// Site lifecycle for the host agent: one Docker container per site + one Caddy snippet per site.
// Everything that reaches docker/Caddy is built here from VALIDATED params (execFile with arg arrays, never a shell).
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";

const ID_RE = /^[a-z0-9]{8,64}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RESERVED_ENV = new Set(["PATH", "HOME", "HOSTNAME", "PORT"]);
const REDIR_FROM_RE = /^\/[A-Za-z0-9._~\-\/%]*$/;
const REDIR_TO_RE = /^(https?:\/\/[^\s{}"\\`$]+|\/[^\s{}"\\`$]*)$/;

/** Runtime whitelist: image, in-container port, mount point, uid the files are owned by / process runs as. */
export const RUNTIMES = {
  static: { image: "nginx:1.27-alpine", port: 80, mount: "/usr/share/nginx/html", uid: 101, root: true },
  "php-8.1": { image: "php:8.1-apache", port: 80, mount: "/var/www/html", uid: 33, root: true },
  "php-8.2": { image: "php:8.2-apache", port: 80, mount: "/var/www/html", uid: 33, root: true },
  "php-8.3": { image: "php:8.3-apache", port: 80, mount: "/var/www/html", uid: 33, root: true },
  "php-8.4": { image: "php:8.4-apache", port: 80, mount: "/var/www/html", uid: 33, root: true },
  "node-18": { image: "node:18-alpine", port: 3000, mount: "/app", uid: 1000, cmd: true },
  "node-20": { image: "node:20-alpine", port: 3000, mount: "/app", uid: 1000, cmd: true },
  "node-22": { image: "node:22-alpine", port: 3000, mount: "/app", uid: 1000, cmd: true },
  python: { image: "python:3.12-slim", port: 8000, mount: "/app", uid: 1000, cmd: true },
};

export const cfg = () => ({
  sitesRoot: process.env.SITES_ROOT || "/srv/accounts",
  caddySitesDir: process.env.CADDY_SITES_DIR || "/srv/caddy-sites",
  caddyfile: process.env.CADDYFILE_PATH || "/opt/mailhost/Caddyfile",
  caddyAdmin: process.env.CADDY_ADMIN || "http://127.0.0.1:2019",
  network: process.env.DOCKER_NETWORK || "mailhost_default",
});

const run = (cmd, args, { allowFail = false, timeout = 120_000 } = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !allowFail) return reject(new Error(`${cmd} ${args[0]} failed: ${(stderr || err.message).toString().trim().slice(0, 500)}`));
      resolve({ stdout: String(stdout), stderr: String(stderr), ok: !err });
    });
  });

// ---------- param validation ----------
export function validateSiteId(p) {
  if (!p || typeof p.siteId !== "string" || !ID_RE.test(p.siteId)) throw new Error("siteId invalid");
  return p.siteId;
}

export function validateApply(p) {
  const siteId = validateSiteId(p);
  if (typeof p.runtime !== "string" || !Object.hasOwn(RUNTIMES, p.runtime)) throw new Error("unknown runtime");
  const rt = RUNTIMES[p.runtime];
  if (!Array.isArray(p.domains) || p.domains.length < 1 || p.domains.length > 50) throw new Error("1-50 domains required");
  const domains = p.domains.map((d) => { if (typeof d !== "string" || !HOST_RE.test(d)) throw new Error(`invalid domain: ${String(d).slice(0, 80)}`); return d; });
  if (new Set(domains).size !== domains.length) throw new Error("duplicate domains");
  const env = {};
  for (const [k, v] of Object.entries(p.env ?? {})) {
    if (!ENV_KEY_RE.test(k) || RESERVED_ENV.has(k)) throw new Error(`invalid env name: ${k.slice(0, 40)}`);
    if (typeof v !== "string" || v.length > 4096 || v.includes("\0")) throw new Error(`invalid env value for ${k}`);
    env[k] = v;
  }
  if (Object.keys(env).length > 100) throw new Error("too many env vars");
  let startCommand = "";
  if (rt.cmd) {
    startCommand = typeof p.startCommand === "string" ? p.startCommand : "";
    if (!startCommand || startCommand.length > 500 || /[\0\r\n]/.test(startCommand)) throw new Error("startCommand required (single line, max 500 chars)");
  }
  const redirects = (p.redirects ?? []).map((r) => {
    if (!r || !REDIR_FROM_RE.test(r.from ?? "") || !REDIR_TO_RE.test(r.to ?? "") || ![301, 302].includes(r.code)) throw new Error("invalid redirect");
    return { from: r.from, to: r.to, code: r.code };
  });
  if (redirects.length > 100) throw new Error("too many redirects");
  const int = (v, min, max, name) => { const n = v ?? 0; if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} out of range`); return n; };
  return {
    siteId, runtime: p.runtime, domains, env, startCommand, redirects, forceHttps: p.forceHttps !== false, waf: validateWaf(p.waf),
    memoryMb: int(p.memoryMb, 0, 262144, "memoryMb"), cpuPercent: int(p.cpuPercent, 0, 6400, "cpuPercent"),
  };
}

export const WAF_MODES = ["off", "detect", "block"];
export function validateWaf(v) {
  if (v === undefined || v === null) return "off";
  if (typeof v !== "string" || !WAF_MODES.includes(v)) throw new Error("waf must be off, detect or block");
  return v;
}

// ---------- pure builders (unit-tested) ----------
export const containerName = (siteId) => `site-${siteId}`;
export const siteDir = (root, accountId, siteId) => path.join(root, accountId, siteId);

export function buildRunArgs(a, ctx, hostDir) {
  const rt = RUNTIMES[a.runtime];
  const args = [
    "run", "-d", "--name", containerName(a.siteId), "--network", ctx.network, "--restart", "unless-stopped",
    "--label", "mailhost.site=" + a.siteId, "--label", "mailhost.account=" + ctx.accountId,
    "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--pids-limit", "256",
    "-v", `${hostDir}:${rt.mount}`, "-e", `PORT=${rt.port}`,
  ];
  if (rt.root) args.push("--cap-add", "CHOWN", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "NET_BIND_SERVICE");
  else args.push("--user", `${rt.uid}:${rt.uid}`, "-w", rt.mount);
  if (a.memoryMb) args.push("--memory", `${Math.max(a.memoryMb, 16)}m`);
  if (a.cpuPercent) args.push("--cpus", (a.cpuPercent / 100).toFixed(2));
  for (const [k, v] of Object.entries(a.env)) args.push("-e", `${k}=${v}`);
  args.push(rt.image);
  if (rt.cmd) args.push("sh", "-c", a.startCommand);
  return args;
}

export function buildCaddySnippet(a) {
  const rt = RUNTIMES[a.runtime];
  const addrs = a.forceHttps ? a.domains : a.domains.flatMap((d) => [`http://${d}`, `https://${d}`]);
  const lines = [`# site ${a.siteId} (generated by the host agent - do not edit)`, `${addrs.join(", ")} {`, "\tencode gzip"];
  for (const r of a.redirects) lines.push(`\tredir ${r.from} ${r.to} ${r.code}`);
  const proxy = `reverse_proxy ${containerName(a.siteId)}:${rt.port}`;
  if (a.waf && a.waf !== "off") {
    // Coraza (OWASP CRS) needs a Caddy built with github.com/corazawaf/coraza-caddy (see caddy/Dockerfile). Inside `route` the directive order
    // does not matter, so no global `order coraza_waf first` is needed (that line would stop a stock Caddy from starting at all).
    lines.push("\troute {", "\t\tcoraza_waf {", "\t\t\tload_owasp_crs", "\t\t\tdirectives `", "\t\t\t\tInclude @coraza.conf-recommended", "\t\t\t\tInclude @crs-setup.conf.example",
      "\t\t\t\tInclude @owasp_crs/*.conf", `\t\t\t\tSecRuleEngine ${a.waf === "block" ? "On" : "DetectionOnly"}`, "\t\t\t`", "\t\t}", `\t\t${proxy}`, "\t}");
  } else lines.push(`\t${proxy}`);
  lines.push("}", "");
  return lines.join("\n");
}

// ---------- caddy ----------
function caddyLoad(c) {
  const body = fs.readFileSync(c.caddyfile);
  const url = new URL("/load", c.caddyAdmin);
  return new Promise((resolve, reject) => {
    const req = http.request({ method: "POST", hostname: url.hostname, port: url.port, path: url.pathname, timeout: 30_000,
      headers: { "content-type": "text/caddyfile", "content-length": body.length } }, (res) => {
      const chunks = []; res.on("data", (x) => chunks.push(x));
      res.on("end", () => (res.statusCode === 200 ? resolve() : reject(new Error(`caddy reload failed (${res.statusCode}): ${Buffer.concat(chunks).toString().slice(0, 400)}`))));
    });
    req.on("error", (e) => reject(new Error(`caddy unreachable: ${e.message}`)));
    req.on("timeout", () => req.destroy(new Error("caddy timed out")));
    req.end(body);
  });
}

const snippetPath = (c, siteId) => path.join(c.caddySitesDir, `${siteId}.caddy`);

/** Refuse any resolved path outside `base` (siteId/accountId are regex-validated already; this is the second lock). */
function inside(base, target) {
  const b = path.resolve(base) + path.sep, t = path.resolve(target);
  if (!t.startsWith(b)) throw new Error("path escapes jail");
  return t;
}

// ---------- methods ----------
export const SITE_METHODS = {
  "site.apply": {
    scope: "account", validate: validateApply,
    run: async (a, { accountId }) => {
      const c = cfg();
      const dir = inside(c.sitesRoot, siteDir(c.sitesRoot, accountId, a.siteId));
      const rt = RUNTIMES[a.runtime];
      fs.mkdirSync(dir, { recursive: true });
      fs.chownSync(path.dirname(dir), 0, 0);
      fs.chmodSync(path.dirname(dir), 0o755);
      fs.chownSync(dir, rt.uid, rt.uid);
      await run("docker", ["rm", "-f", containerName(a.siteId)], { allowFail: true });
      await run("docker", buildRunArgs(a, { accountId, network: c.network }, dir), { timeout: 600_000 });
      fs.mkdirSync(c.caddySitesDir, { recursive: true });
      const sp = snippetPath(c, a.siteId), prev = fs.existsSync(sp) ? fs.readFileSync(sp) : null;
      fs.writeFileSync(sp + ".tmp", buildCaddySnippet(a)); fs.renameSync(sp + ".tmp", sp);
      try { await caddyLoad(c); }
      catch (e) { // never leave a snippet that breaks every later reload
        if (prev) fs.writeFileSync(sp, prev); else fs.rmSync(sp, { force: true });
        await caddyLoad(c).catch(() => {});
        throw e;
      }
      return { container: containerName(a.siteId), dir };
    },
  },
  "site.start": { scope: "account", validate: (p) => ({ siteId: validateSiteId(p) }), run: async (p) => { await run("docker", ["start", containerName(p.siteId)]); return {}; } },
  "site.stop": { scope: "account", validate: (p) => ({ siteId: validateSiteId(p) }), run: async (p) => { await run("docker", ["stop", "-t", "10", containerName(p.siteId)]); return {}; } },
  "site.status": {
    scope: "account", validate: (p) => ({ siteId: validateSiteId(p) }),
    run: async (p) => {
      const r = await run("docker", ["inspect", "-f", "{{.State.Status}}", containerName(p.siteId)], { allowFail: true });
      return { state: r.ok ? r.stdout.trim() : "missing" };
    },
  },
  "site.logs": {
    scope: "account",
    validate: (p) => { const lines = p.lines ?? 200; if (!Number.isInteger(lines) || lines < 1 || lines > 2000) throw new Error("lines out of range"); return { siteId: validateSiteId(p), lines }; },
    run: async (p) => {
      const r = await run("docker", ["logs", "--tail", String(p.lines), containerName(p.siteId)], { allowFail: true });
      return { logs: (r.stdout + r.stderr).slice(-200_000) };
    },
  },
  "site.delete": {
    scope: "account",
    validate: (p) => ({ siteId: validateSiteId(p), deleteFiles: p.deleteFiles === true }),
    run: async (p, { accountId }) => {
      const c = cfg();
      await run("docker", ["rm", "-f", containerName(p.siteId)], { allowFail: true });
      fs.rmSync(snippetPath(c, p.siteId), { force: true });
      await caddyLoad(c).catch((e) => console.error("[agent] caddy reload after delete:", e.message));
      if (p.deleteFiles) fs.rmSync(inside(c.sitesRoot, siteDir(c.sitesRoot, accountId, p.siteId)), { recursive: true, force: true });
      return {};
    },
  },
};
