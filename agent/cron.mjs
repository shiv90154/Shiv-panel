// Cron jobs run INSIDE the site's container (`docker exec`), as the site's own uid, in the site's web root.
// The schedule lives in the web app (it ticks once a minute and calls cron.run); the agent only executes one command and reports back.
// The command is passed as a single argv element to `sh -c` inside the container (never through a host shell).
import { spawn, execFile } from "node:child_process";
import { RUNTIMES, containerName, validateSiteId } from "./sites.mjs";

export const MAX_OUTPUT = 64 * 1024;

export function validateCron(p) {
  const siteId = validateSiteId(p);
  if (typeof p.runtime !== "string" || !Object.hasOwn(RUNTIMES, p.runtime)) throw new Error("unknown runtime");
  if (typeof p.command !== "string" || !p.command.trim() || p.command.length > 1000 || p.command.includes("\0")) throw new Error("command required (max 1000 chars)");
  const timeoutSec = p.timeoutSec ?? 300;
  if (!Number.isInteger(timeoutSec) || timeoutSec < 5 || timeoutSec > 3600) throw new Error("timeoutSec must be 5-3600");
  return { siteId, runtime: p.runtime, command: p.command, timeoutSec };
}

/** Pure (unit-tested). `timeout -s KILL` inside the container kills the whole command, not just the host-side docker client. */
export function buildExecArgs(a) {
  const rt = RUNTIMES[a.runtime];
  return ["exec", "--user", `${rt.uid}:${rt.uid}`, "-w", rt.mount, containerName(a.siteId), "timeout", "-s", "KILL", String(a.timeoutSec), "sh", "-c", a.command];
}

const inspect = (siteId) => new Promise((resolve) =>
  execFile("docker", ["inspect", "-f", '{{index .Config.Labels "mailhost.account"}} {{.State.Running}}', containerName(siteId)], { timeout: 15_000 },
    (err, out) => resolve(err ? null : String(out).trim())));

export const CRON_METHODS = {
  "cron.run": {
    scope: "account", validate: validateCron,
    run: async (a, { accountId }) => {
      // second lock: the container must be labelled with THIS account and be running
      const st = await inspect(a.siteId);
      if (st === null) throw new Error("The site's container does not exist (deploy the site first)");
      if (st !== `${accountId} true`) throw new Error(st.endsWith(" false") && st.startsWith(accountId) ? "The site is stopped" : "Site does not belong to this account");
      const started = Date.now();
      return new Promise((resolve) => {
        const child = spawn("docker", buildExecArgs(a), { stdio: ["ignore", "pipe", "pipe"] });
        let out = "", truncated = false;
        const take = (d) => { if (out.length < MAX_OUTPUT) out += d; else truncated = true; };
        child.stdout.on("data", take); child.stderr.on("data", take);
        const killer = setTimeout(() => child.kill("SIGKILL"), (a.timeoutSec + 15) * 1000);
        const done = (exitCode, extra = "") => {
          clearTimeout(killer);
          resolve({ exitCode, output: (out.slice(0, MAX_OUTPUT) + extra).trim(), truncated, durationMs: Date.now() - started });
        };
        child.on("error", (e) => done(null, `\n[agent] ${e.message}`));
        child.on("close", (code, sig) => done(code, code === 137 ? `\n[timed out after ${a.timeoutSec}s and killed]` : sig ? `\n[killed: ${sig}]` : ""));
      });
    },
  },
};
