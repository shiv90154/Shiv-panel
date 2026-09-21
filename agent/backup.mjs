// restic backups, one repository per account under BACKUP_ROOT/<accountId> (encrypted; a server-wide RESTIC_PASSWORD in the agent's env).
// Snapshot kinds (one snapshot each, told apart by tag):  site:<siteId> (files) | db:<engine>:<name> (SQL dump on stdin) | mail:<domain> (Maildir tree).
// Everything is built from VALIDATED params, executed with argv arrays (never a shell); the restic password goes via env, never argv.
// Files are stored under their real absolute path, so `restic restore --target /` puts them back where they came from, with original owners (agent runs as root).
//   BACKUP_ROOT (default /srv/backups)  RESTIC_PASSWORD (required)  RESTIC_CMD  VMAIL_DIR (default /var/vmail; the host path of the mail volume)
//   MARIADB_DUMP_CMD (mariadb-dump)  MARIADB_CMD (mariadb)  PG_DUMP_CMD (pg_dump)  PSQL_CMD (psql)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { jailRoot } from "./files.mjs";
import { ENGINES, NAME_RE } from "./databases.mjs";
import { validateSiteId } from "./sites.mjs";

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SNAP_RE = /^[0-9a-f]{8,64}$/;
const ACC_RE = /^[a-z0-9]{8,64}$/;

export const cfg = () => ({
  root: process.env.BACKUP_ROOT || "/srv/backups",
  vmail: process.env.VMAIL_DIR || "/var/vmail",
  restic: process.env.RESTIC_CMD || "restic",
});

// ---------- pure helpers (unit-tested) ----------
const keepN = (v, name) => { const n = v ?? 0; if (!Number.isInteger(n) || n < 0 || n > 366) throw new Error(`${name} out of range`); return n; };

export function validateRun(p) {
  const list = (v, max, name) => { if (v === undefined) return []; if (!Array.isArray(v) || v.length > max) throw new Error(`${name}: at most ${max}`); return v; };
  const sites = list(p.sites, 200, "sites").map((id) => validateSiteId({ siteId: id }));
  const databases = list(p.databases, 200, "databases").map((d) => {
    if (!ENGINES.includes(d?.engine) || typeof d.name !== "string" || !NAME_RE.test(d.name)) throw new Error("invalid database");
    return { engine: d.engine, name: d.name };
  });
  const mailDomains = list(p.mailDomains, 500, "mailDomains").map((d) => { if (typeof d !== "string" || !HOST_RE.test(d)) throw new Error("invalid mail domain"); return d; });
  const keep = { daily: keepN(p.keep?.daily, "keep.daily"), weekly: keepN(p.keep?.weekly, "keep.weekly"), monthly: keepN(p.keep?.monthly, "keep.monthly") };
  if (!keep.daily && !keep.weekly && !keep.monthly) throw new Error("retention must keep at least one snapshot");
  if (!sites.length && !databases.length && !mailDomains.length) throw new Error("nothing to back up");
  return { sites, databases, mailDomains, keep };
}

export const snapshotTag = (kind, name) => (kind === "site" ? `site:${name}` : kind === "db" ? `db:${name}` : `mail:${name}`);
export const retentionArgs = (k) => ["forget", "--group-by", "host,tags", "--prune", ...(k.daily ? ["--keep-daily", String(k.daily)] : []), ...(k.weekly ? ["--keep-weekly", String(k.weekly)] : []), ...(k.monthly ? ["--keep-monthly", String(k.monthly)] : [])];
export const dumpName = (engine, name) => `db/${engine}/${name}.sql`;

/** Restore target validation: which snapshot, and what it must be for. Returns { snapshotId, kind, name (for db: "<engine>:<name>") }. */
export function validateRestore(p) {
  if (typeof p.snapshotId !== "string" || !SNAP_RE.test(p.snapshotId)) throw new Error("invalid snapshot id");
  if (p.kind === "site") return { snapshotId: p.snapshotId, kind: "site", siteId: validateSiteId({ siteId: p.name }), name: p.name };
  if (p.kind === "db") {
    const [engine, name, ...rest] = String(p.name).split(":");
    if (rest.length || !ENGINES.includes(engine) || !NAME_RE.test(name ?? "")) throw new Error("invalid database");
    return { snapshotId: p.snapshotId, kind: "db", engine, dbName: name, name: p.name };
  }
  if (p.kind === "mail") { if (typeof p.name !== "string" || !HOST_RE.test(p.name)) throw new Error("invalid mail domain"); return { snapshotId: p.snapshotId, kind: "mail", name: p.name }; }
  throw new Error("unknown snapshot kind");
}

/** A snapshot may only be restored/deleted if it is in THIS account's repo (by construction), carries the requested tag and, for files, the expected path. */
export function snapshotMatches(snap, { host, tag, expectPath }) {
  return !!snap && snap.hostname === host && Array.isArray(snap.tags) && snap.tags.includes(tag) && (!expectPath || (snap.paths?.length === 1 && snap.paths[0] === expectPath));
}

export function mailDir(vmailRoot, domain) {
  const root = path.resolve(vmailRoot), t = path.resolve(root, domain);
  if (!t.startsWith(root + path.sep)) throw new Error("path escapes vmail root");
  return t;
}
const repoDir = (accountId) => {
  const c = cfg(), root = path.resolve(c.root), r = path.resolve(root, accountId);
  if (!ACC_RE.test(accountId) || !r.startsWith(root + path.sep)) throw new Error("bad account");
  return r;
};

// ---------- process helpers ----------
const collect = (child, cap = 64 * 1024) => new Promise((resolve, reject) => {
  let out = "", err = "";
  child.stdout?.on("data", (d) => { if (out.length < 32 * 1024 * 1024) out += d; });
  child.stderr?.on("data", (d) => { if (err.length < cap) err += d; });
  child.on("error", (e) => reject(new Error(`${child.spawnargs?.[0] ?? "process"}: ${e.message}`)));
  child.on("close", (code) => resolve({ code, out, err }));
});

const resticEnv = (accountId) => {
  if (!process.env.RESTIC_PASSWORD) throw new Error("RESTIC_PASSWORD is not set in the agent environment");
  return { ...process.env, RESTIC_REPOSITORY: repoDir(accountId), RESTIC_PASSWORD: process.env.RESTIC_PASSWORD };
};

/** Run restic for an account. `stdin`: a readable stream to pipe in (dumps). Returns stdout; throws with restic's stderr. */
async function restic(accountId, args, { stdin = null, allowCodes = [0] } = {}) {
  const child = spawn(cfg().restic, args, { env: resticEnv(accountId), stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
  if (stdin) { stdin.pipe(child.stdin); stdin.on("error", () => child.stdin.destroy()); }
  const r = await collect(child);
  if (!allowCodes.includes(r.code)) throw new Error(`restic ${args[0]} failed: ${r.err.trim().slice(-300)}`);
  return r.out;
}

async function ensureRepo(accountId) {
  const dir = repoDir(accountId);
  if (fs.existsSync(path.join(dir, "config"))) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  await restic(accountId, ["init"]);
}

const dumpCmd = (engine, name) => engine === "mariadb"
  ? [process.env.MARIADB_DUMP_CMD || "mariadb-dump", ["--single-transaction", "--routines", "--events", "--databases", name]]
  : [process.env.PG_DUMP_CMD || "pg_dump", ["--no-owner", "--clean", "--if-exists", "-d", name]];
const loadCmd = (engine, name) => engine === "mariadb"
  ? [process.env.MARIADB_CMD || "mariadb", [name]]
  : [process.env.PSQL_CMD || "psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", name]];

async function backupDb(accountId, engine, name) {
  const [cmd, args] = dumpCmd(engine, name), tag = snapshotTag("db", `${engine}:${name}`);
  const dump = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let dumpErr = ""; dump.stderr.on("data", (d) => { if (dumpErr.length < 4096) dumpErr += d; });
  const dumpExit = new Promise((res, rej) => { dump.on("error", (e) => rej(new Error(`${cmd}: ${e.message}`))); dump.on("close", res); });
  const [snap, code] = await Promise.allSettled([
    restic(accountId, ["backup", "--host", accountId, "--tag", tag, "--stdin", "--stdin-filename", dumpName(engine, name)], { stdin: dump.stdout }),
    dumpExit,
  ]);
  const failure = code.status === "rejected" ? code.reason : code.value !== 0 ? new Error(`${cmd} failed: ${dumpErr.trim().slice(-300)}`) : null;
  if (failure) { await dropLatest(accountId, tag).catch(() => {}); throw failure; } // a truncated dump must never stand as a good backup
  if (snap.status === "rejected") throw snap.reason;
}

/** Forget the newest snapshot carrying `tag` (used to discard a backup whose source command failed midway). */
async function dropLatest(accountId, tag) {
  const list = JSON.parse((await restic(accountId, ["snapshots", "--json", "--host", accountId, "--tag", tag])) || "[]");
  const latest = list.sort((a, b) => String(b.time).localeCompare(String(a.time)))[0];
  if (latest) await restic(accountId, ["forget", latest.id]);
}

const fileBackup = (accountId, dir, tag) => restic(accountId, ["backup", "--host", accountId, "--tag", tag, "--one-file-system", dir]);

async function findSnapshot(accountId, snapshotId) {
  const out = await restic(accountId, ["snapshots", "--json", "--host", accountId, snapshotId]);
  const list = JSON.parse(out || "[]");
  return list.length === 1 ? list[0] : null;
}

export const BACKUP_METHODS = {
  "backup.run": {
    scope: "account", validate: validateRun,
    run: async (p, { accountId }) => {
      await ensureRepo(accountId);
      const c = cfg(), results = [];
      const step = async (kind, name, fn) => {
        try { await fn(); results.push({ kind, name, ok: true }); }
        catch (e) { results.push({ kind, name, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }); }
      };
      for (const id of p.sites) await step("site", id, async () => {
        const dir = jailRoot(accountId, id);
        if (!fs.existsSync(dir)) throw new Error("site directory does not exist yet");
        await fileBackup(accountId, dir, snapshotTag("site", id));
      });
      for (const d of p.databases) await step("db", `${d.engine}:${d.name}`, () => backupDb(accountId, d.engine, d.name));
      for (const dom of p.mailDomains) await step("mail", dom, async () => {
        const dir = mailDir(c.vmail, dom);
        if (!fs.existsSync(dir)) return; // domain without any delivered mail yet: nothing to save, not an error
        await fileBackup(accountId, dir, snapshotTag("mail", dom));
      });
      await restic(accountId, retentionArgs(p.keep)).catch((e) => results.push({ kind: "retention", name: "-", ok: false, error: e.message }));
      return { results };
    },
  },
  "backup.list": {
    scope: "account", validate: () => ({}),
    run: async (_p, { accountId }) => {
      if (!fs.existsSync(path.join(repoDir(accountId), "config"))) return { snapshots: [] };
      const list = JSON.parse((await restic(accountId, ["snapshots", "--json", "--host", accountId])) || "[]");
      return { snapshots: list.map((s) => ({ id: s.short_id ?? String(s.id).slice(0, 8), fullId: s.id, time: s.time, tags: s.tags ?? [], bytes: s.summary?.total_bytes_processed ?? null })) };
    },
  },
  "backup.restore": {
    scope: "account", validate: validateRestore,
    run: async (p, { accountId }) => {
      const snap = await findSnapshot(accountId, p.snapshotId);
      if (p.kind === "db") {
        if (!snapMatch(snap, accountId, snapshotTag("db", p.name))) throw new Error("snapshot does not match");
        const [cmd, args] = loadCmd(p.engine, p.dbName);
        const load = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
        const loaded = collect(load);
        const dump = spawn(cfg().restic, ["dump", p.snapshotId, dumpName(p.engine, p.dbName)], { env: resticEnv(accountId), stdio: ["ignore", "pipe", "pipe"] });
        dump.stdout.pipe(load.stdin); load.stdin.on("error", () => {});
        const [d, l] = await Promise.all([collect(dump), loaded]);
        if (d.code !== 0) throw new Error(`restic dump failed: ${d.err.trim().slice(-300)}`);
        if (l.code !== 0) throw new Error(`${cmd} failed: ${l.err.trim().slice(-300)}`);
        return {};
      }
      const expect = p.kind === "site" ? jailRoot(accountId, p.siteId) : mailDir(cfg().vmail, p.name);
      if (!snapMatch(snap, accountId, snapshotTag(p.kind, p.name), expect)) throw new Error("snapshot does not match");
      await restic(accountId, ["restore", p.snapshotId, "--target", "/"]); // overwrites files that exist in the snapshot; files created since are left alone
      return {};
    },
  },
  "backup.deleteSnapshot": {
    scope: "account", validate: (p) => { if (typeof p.snapshotId !== "string" || !SNAP_RE.test(p.snapshotId)) throw new Error("invalid snapshot id"); return { snapshotId: p.snapshotId }; },
    run: async (p, { accountId }) => {
      const snap = await findSnapshot(accountId, p.snapshotId);
      if (!snap) throw new Error("snapshot not found");
      await restic(accountId, ["forget", "--prune", p.snapshotId]);
      return {};
    },
  },
  "backup.purgeAccount": {
    scope: "account", validate: () => ({}),
    run: async (_p, { accountId }) => { fs.rmSync(repoDir(accountId), { recursive: true, force: true }); return {}; },
  },
};

const snapMatch = (snap, accountId, tag, expectPath) => snapshotMatches(snap, { host: accountId, tag, expectPath });
