// Self-update: fast-forward the git checkout the panel is deployed from, rebuild the compose stack, restart the agent.
// The web app can only ask for "update to exactly <sha>" after showing the admin what that sha contains; the agent re-fetches and refuses if the
// remote moved, if the checkout has local changes, or if history diverged. The long part runs in a separate process (systemd-run, so restarting the
// agent unit does not kill it) which writes a state file and a log the panel reads back.
//   env: UPDATE_DIR (default /opt/mailhost, the checkout: docker-compose.yml, .env and agent/ live there), UPDATE_REMOTE (origin), UPDATE_BRANCH (main),
//        UPDATE_STATE (/var/lib/mailhost/update.json), UPDATE_LOG (/var/log/mailhost-update.log), UPDATE_DUMP_DIR (/var/backups/mailhost),
//        UPDATE_SKIP_DB_DUMP=1 (skip the pre-update database dump), UPDATE_AGENT_UNIT (mailhost-agent)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const SHA_RE = /^[0-9a-f]{40}$/;
const REF_RE = /^(?!-)[A-Za-z0-9._\/-]{1,100}$/;
const STALE_MS = 2 * 3600_000;

export function uCfg(env = process.env) {
  const c = {
    dir: env.UPDATE_DIR || "/opt/mailhost", remote: env.UPDATE_REMOTE || "origin", branch: env.UPDATE_BRANCH || "main",
    stateFile: env.UPDATE_STATE || "/var/lib/mailhost/update.json", logFile: env.UPDATE_LOG || "/var/log/mailhost-update.log",
    dumpDir: env.UPDATE_DUMP_DIR || "/var/backups/mailhost", skipDump: env.UPDATE_SKIP_DB_DUMP === "1", unit: env.UPDATE_AGENT_UNIT || "mailhost-agent",
  };
  if (!path.isAbsolute(c.dir)) throw new Error("UPDATE_DIR must be absolute");
  if (!REF_RE.test(c.remote) || !REF_RE.test(c.branch)) throw new Error("UPDATE_REMOTE / UPDATE_BRANCH are invalid");
  if (!/^[A-Za-z0-9@._-]{1,80}$/.test(c.unit)) throw new Error("UPDATE_AGENT_UNIT is invalid");
  return c;
}

const sh = (cmd, args, { cwd, timeout = 120_000, env } = {}) => new Promise((resolve, reject) =>
  execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } }, (err, so, se) =>
    err ? reject(new Error(`${cmd} ${args[0]} failed: ${String(se || err.message).trim().slice(0, 400)}`)) : resolve(String(so).trim())));

const git = (c, args, o) => sh("git", ["-c", `safe.directory=${c.dir}`, "-C", c.dir, ...args], o);

/** Pure. `git log --format=%H%x09%s` lines -> [{sha, subject}] */
export function parseCommits(text) {
  return text.split("\n").filter(Boolean).map((l) => { const [sha, ...s] = l.split("\t"); return { sha: sha.slice(0, 40), subject: s.join("\t").slice(0, 200) }; }).filter((c) => SHA_RE.test(c.sha));
}

// ---------- state ----------
export function readState(c) {
  try {
    const s = JSON.parse(fs.readFileSync(c.stateFile, "utf8"));
    if (s.state === "running" && Date.now() - Date.parse(s.startedAt) > STALE_MS) return { ...s, state: "failed", error: "The update runner stopped responding (check the log)" };
    return s;
  } catch { return { state: "idle" }; }
}
function writeState(c, s) {
  fs.mkdirSync(path.dirname(c.stateFile), { recursive: true });
  fs.writeFileSync(c.stateFile + ".tmp", JSON.stringify(s)); fs.renameSync(c.stateFile + ".tmp", c.stateFile);
}
const tailLog = (c, n = 12_000) => { try { const b = fs.readFileSync(c.logFile); return b.subarray(Math.max(0, b.length - n)).toString("utf8"); } catch { return ""; } };

// ---------- check ----------
export async function checkUpdate(c) {
  await git(c, ["fetch", "--quiet", "--prune", c.remote, c.branch], { timeout: 90_000 });
  const ref = `refs/remotes/${c.remote}/${c.branch}`;
  const [current, latest, currentBranch, dirty] = await Promise.all([
    git(c, ["rev-parse", "HEAD"]), git(c, ["rev-parse", ref]), git(c, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(c, ["status", "--porcelain", "--untracked-files=no"]),
  ]);
  const [behind, ahead, log] = await Promise.all([
    git(c, ["rev-list", "--count", `HEAD..${ref}`]), git(c, ["rev-list", "--count", `${ref}..HEAD`]),
    git(c, ["log", "--format=%H%x09%s", "-n", "30", `HEAD..${ref}`]),
  ]);
  return { branch: c.branch, currentBranch, current, latest, behind: Number(behind), ahead: Number(ahead), dirty: dirty.length > 0, commits: parseCommits(log) };
}

/** Pure: why an update must not start, or null. */
export function refusal(chk, expect, state) {
  if (state.state === "running") return "An update is already running";
  if (chk.dirty) return "The checkout has local changes; refusing to update";
  if (chk.currentBranch !== chk.branch) return `The checkout is on ${chk.currentBranch}, not ${chk.branch}`;
  if (chk.ahead > 0) return "The checkout has commits that are not on the remote; refusing to update";
  if (chk.behind === 0) return "Already up to date";
  if (chk.latest !== expect) return "The remote changed since you looked; check again";
  return null;
}

// ---------- the runner (separate process) ----------
/** io = { git(args), sh(cmd,args,opts), dump(file), log(msg), state(patch), pruneDumps() }; separated so the sequence is unit-testable. */
export async function runUpdate(c, sha, io) {
  if (!SHA_RE.test(sha)) throw new Error("bad sha");
  const from = await io.git(["rev-parse", "HEAD"]);
  let step = "start";
  const at = (s) => { step = s; io.log(`== ${s}`); io.state({ step: s }); };
  try {
    if (!c.skipDump) { at("database dump"); await io.dump(); await io.pruneDumps(); }
    at("merge"); await io.git(["merge", "--ff-only", sha]);
    at("build");
    try { await io.sh("docker", ["compose", "build"], { cwd: c.dir, timeout: 30 * 60_000 }); }
    catch (e) { io.log(`build failed, restoring ${from.slice(0, 7)}`); await io.git(["reset", "--hard", from]); throw new Error(`${e.message} (code restored to ${from.slice(0, 7)}, nothing was restarted)`); }
    at("restart services"); await io.sh("docker", ["compose", "up", "-d"], { cwd: c.dir, timeout: 10 * 60_000 });
    io.state({ state: "ok", step: "done", finishedAt: new Date().toISOString(), error: null }); io.log("== done; restarting the agent");
    await io.sh("systemctl", ["restart", c.unit]).catch((e) => io.log(`agent restart skipped: ${e.message}`));
    return true;
  } catch (e) {
    io.state({ state: "failed", step, finishedAt: new Date().toISOString(), error: e.message.slice(0, 500) }); io.log(`FAILED at ${step}: ${e.message}`);
    return false;
  }
}

export function realIo(c) {
  const stamp = () => new Date().toISOString();
  return {
    git: (a) => git(c, a),
    sh: (cmd, args, o) => sh(cmd, args, o),
    log: (m) => { fs.appendFileSync(c.logFile, `${stamp()} ${m}\n`); },
    state: (patch) => writeState(c, { ...readState(c), ...patch }),
    dump: async () => {
      fs.mkdirSync(c.dumpDir, { recursive: true, mode: 0o700 });
      const file = path.join(c.dumpDir, `panel-${stamp().replace(/[:.]/g, "-")}.sql.gz`);
      const child = spawn("docker", ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "mailadmin", "-d", "mail"], { cwd: c.dir, stdio: ["ignore", "pipe", "pipe"] });
      let err = ""; child.stderr.on("data", (d) => { err += d; });
      const done = new Promise((res, rej) => { child.on("error", rej); child.on("close", (code) => (code === 0 ? res() : rej(new Error(`pg_dump failed: ${err.trim().slice(0, 300)}`)))); });
      await Promise.all([pipeline(child.stdout, zlib.createGzip(), fs.createWriteStream(file, { mode: 0o600 })), done]);
      if (fs.statSync(file).size < 200) throw new Error("database dump is suspiciously small; aborting the update");
      fs.appendFileSync(c.logFile, `${stamp()} dump written to ${file}\n`);
    },
    pruneDumps: async () => {
      const files = fs.readdirSync(c.dumpDir).filter((f) => /^panel-.*\.sql\.gz$/.test(f)).sort();
      for (const f of files.slice(0, -5)) fs.rmSync(path.join(c.dumpDir, f), { force: true });
    },
  };
}

// ---------- launching ----------
const RUNNER = fileURLToPath(new URL("./update-run.mjs", import.meta.url));

/** Pure: env for the runner (only validated config, never request data). */
export const runnerEnv = (c) => ({
  UPDATE_DIR: c.dir, UPDATE_REMOTE: c.remote, UPDATE_BRANCH: c.branch, UPDATE_STATE: c.stateFile, UPDATE_LOG: c.logFile,
  UPDATE_DUMP_DIR: c.dumpDir, UPDATE_AGENT_UNIT: c.unit, ...(c.skipDump ? { UPDATE_SKIP_DB_DUMP: "1" } : {}),
});

async function launch(c, sha) {
  const env = runnerEnv(c);
  // systemd-run puts the runner in its own unit: restarting mailhost-agent (the last step) must not kill it.
  const args = ["--collect", "--quiet", `--unit=mailhost-update-${Date.now()}`, ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`), process.execPath, RUNNER, sha];
  try { await sh("systemd-run", args, { timeout: 20_000 }); return "systemd-run"; }
  catch (e) {
    if (!/ENOENT|not found/i.test(e.message)) throw e;
    const out = fs.openSync(c.logFile, "a");
    spawn(process.execPath, [RUNNER, sha], { detached: true, stdio: ["ignore", out, out], env: { ...process.env, ...env } }).unref();
    return "detached";
  }
}

const noParams = (p) => { if (p && Object.keys(p).length) throw new Error("This method takes no params"); return {}; };

export const UPDATE_METHODS = {
  "update.check": { scope: "system", validate: noParams, run: async () => { const c = uCfg(); return { ...(await checkUpdate(c)), busy: readState(c).state === "running" }; } },
  "update.status": { scope: "system", validate: noParams, run: async () => { const c = uCfg(); return { ...readState(c), log: tailLog(c) }; } },
  "update.apply": {
    scope: "system",
    validate: (p) => { if (typeof p?.expect !== "string" || !SHA_RE.test(p.expect)) throw new Error("expect must be a full commit sha"); return { expect: p.expect }; },
    run: async ({ expect }) => {
      const c = uCfg();
      const why = refusal(await checkUpdate(c), expect, readState(c));
      if (why) throw new Error(why);
      const from = await git(c, ["rev-parse", "HEAD"]);
      fs.mkdirSync(path.dirname(c.logFile), { recursive: true });
      writeState(c, { state: "running", step: "starting", from, to: expect, startedAt: new Date().toISOString(), error: null });
      try { return { started: true, via: await launch(c, expect) }; }
      catch (e) { writeState(c, { state: "failed", step: "starting", from, to: expect, error: e.message.slice(0, 300) }); throw e; }
    },
  },
};
