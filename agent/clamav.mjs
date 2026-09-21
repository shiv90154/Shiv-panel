// ClamAV on-demand scan of one site's files. Runs `clamscan` (the signature DB is loaded per run: ~20 s and ~1 GB RAM; use CLAMSCAN_CMD to point at a wrapper).
// Symlinks are never followed (a tenant's own container can plant links to host paths), findings are re-checked to lie inside the site jail, nothing is deleted or moved:
// the owner decides what to do with a finding (file manager). Report only.
//   env: CLAMSCAN_CMD (default clamscan), CLAMSCAN_TIMEOUT_SEC (default 1800)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { jailRoot } from "./files.mjs";
import { validateSiteId } from "./sites.mjs";

export const MAX_FINDINGS = 200;

/** Pure (unit-tested). clamscan prints "<path>: <Signature> FOUND". Lines whose path is not under `root` are dropped. */
export function parseClamOutput(stdout, root) {
  const findings = [];
  let total = 0;
  for (const line of String(stdout).split("\n")) {
    const m = /^(.+): (\S+) FOUND$/.exec(line.trimEnd());
    if (!m || !m[1].startsWith(root + path.sep)) continue;
    total++;
    if (findings.length < MAX_FINDINGS) findings.push({ path: "/" + path.relative(root, m[1]).split(path.sep).join("/"), signature: m[2].slice(0, 120) });
  }
  return { findings, total };
}

export const buildScanArgs = (root) => [
  "--recursive", "--infected", "--no-summary", "--stdout",
  "--follow-dir-symlinks=0", "--follow-file-symlinks=0", // 0 = never follow
  "--max-filesize=25M", "--max-scansize=200M", "--cross-fs=no", root,
];

/** Pure. `clamscan --version` -> "ClamAV 1.0.5/27000/Mon Sep 21 08:30:12 2026" */
export function parseVersion(text) {
  const m = /^ClamAV\s+(\S+?)(?:\/(\d+)\/(.+))?\s*$/m.exec(String(text));
  return m ? { version: m[1], dbVersion: m[2] ? Number(m[2]) : null, dbDate: m[3]?.trim() ?? null } : null;
}

const cmd = () => process.env.CLAMSCAN_CMD || "clamscan";
const NOT_INSTALLED = "ClamAV is not installed on the host (clamscan not found)";

function exec(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd(), args, { stdio: ["ignore", "pipe", "pipe"] });
    try { if (child.pid) os.setPriority(child.pid, 15); } catch { /* best effort: scans must not starve the sites */ }
    let out = "", err = "", timedOut = false;
    const cap = (s, d) => (s.length < 4 * 1024 * 1024 ? s + d : s);
    child.stdout.on("data", (d) => { out = cap(out, d); });
    child.stderr.on("data", (d) => { err = cap(err, d); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(e.code === "ENOENT" ? NOT_INSTALLED : `clamscan: ${e.message}`)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err: err.trim(), timedOut }); });
  });
}

const noParams = (p) => { if (p && Object.keys(p).length) throw new Error("This method takes no params"); return {}; };

export const CLAMAV_METHODS = {
  "clamav.scan": {
    scope: "account", validate: (p) => ({ siteId: validateSiteId(p) }),
    run: async (p, { accountId }) => {
      const root = jailRoot(accountId, p.siteId);
      if (!fs.existsSync(root)) throw new Error("The site has no files yet");
      const real = fs.realpathSync(root);
      if (real !== root) throw new Error("Site directory is a link; refusing to scan");
      const started = Date.now();
      const r = await exec(buildScanArgs(root), Number(process.env.CLAMSCAN_TIMEOUT_SEC || 1800) * 1000);
      if (r.timedOut) throw new Error("The scan timed out");
      const { findings, total } = parseClamOutput(r.out, root);
      // exit 0 = clean, 1 = infected, 2 = errors (partial results are still reported)
      if (r.code !== 0 && r.code !== 1 && !total) throw new Error(`clamscan failed (exit ${r.code}): ${r.err.slice(0, 300)}`);
      return { infected: total > 0, total, findings, durationMs: Date.now() - started, warnings: r.code === 2 ? r.err.slice(0, 300) : "" };
    },
  },
  "clamav.status": {
    scope: "system", validate: noParams,
    run: async () => {
      try {
        const r = await exec(["--version"], 20_000);
        return { installed: true, ...(parseVersion(r.out) ?? { version: r.out.trim().slice(0, 80), dbVersion: null, dbDate: null }) };
      } catch (e) {
        if (e.message === NOT_INSTALLED) return { installed: false };
        throw e;
      }
    },
  },
};
