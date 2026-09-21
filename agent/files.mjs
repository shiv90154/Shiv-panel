// File manager for the host agent. Every operation is jailed to /srv/accounts/<account>/<site>.
// Symlinks are the escape route (a tenant's own container can create them), so every path is checked twice:
// lexically, then by realpath of the deepest existing ancestor. Symlinks are never followed for delete/chmod/rename.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { cfg, RUNTIMES, siteDir, validateSiteId } from "./sites.mjs";

export const MAX_EDIT = 1024 * 1024; // text editor limit
export const MAX_UPLOAD = 25 * 1024 * 1024;
const NAME_RE = /^[^\/\0]{1,255}$/;

export function jailRoot(accountId, siteId) {
  const c = cfg();
  const root = path.resolve(siteDir(c.sitesRoot, accountId, siteId));
  if (!root.startsWith(path.resolve(c.sitesRoot) + path.sep)) throw new Error("path escapes jail");
  return root;
}

const within = (base, target) => target === base || target.startsWith(base + path.sep);

/** Resolve a user path ("/a/b") to an absolute path inside root. `follow`: also require the final component's realpath to stay inside. */
export function jail(root, rel, { follow = false } = {}) {
  if (typeof rel !== "string" || rel.length > 4096 || rel.includes("\0")) throw new Error("invalid path");
  const abs = path.resolve(root, "." + path.sep + rel.replace(/^\/+/, ""));
  if (!within(root, abs)) throw new Error("path escapes jail");
  if (abs === root) return abs;
  const realRoot = fs.realpathSync(root);
  // deepest existing ancestor (the target itself when following, otherwise its parent)
  let probe = follow ? abs : path.dirname(abs);
  while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  if (!within(realRoot, fs.realpathSync(probe))) throw new Error("path escapes jail");
  return abs;
}

const ownerOf = (runtime) => RUNTIMES[runtime]?.uid ?? 0;
const isRoot = process.getuid?.() === 0; // the agent runs as root in production; unprivileged (dev/test) runs skip chown
const lchown = (p, uid) => { if (isRoot) fs.lchownSync(p, uid, uid); };
const chownTree = (p, uid) => { // lchown: never follow links
  const st = fs.lstatSync(p);
  lchown(p, uid);
  if (st.isDirectory()) for (const e of fs.readdirSync(p)) chownTree(path.join(p, e), uid);
};

const run = (cmd, args, cwd) => new Promise((resolve, reject) =>
  execFile(cmd, args, { cwd, timeout: 300_000, maxBuffer: 1024 * 1024 }, (err, so, se) =>
    err ? reject(new Error(`${cmd} failed: ${String(se || err.message).trim().slice(0, 300)}`)) : resolve(String(so))));

/** Remove every symlink under dir (used after unzip: archives can carry links pointing outside the jail). */
function stripLinks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) fs.rmSync(p, { force: true });
    else if (e.isDirectory()) stripLinks(p);
  }
}

// ---------- validation ----------
const pathParam = (p, k = "path") => { if (typeof p[k] !== "string") throw new Error(`${k} required`); return p[k]; };
const base = (p) => ({ siteId: validateSiteId(p), runtime: typeof p.runtime === "string" && Object.hasOwn(RUNTIMES, p.runtime) ? p.runtime : (() => { throw new Error("unknown runtime"); })() });
const leaf = (n) => { if (typeof n !== "string" || !NAME_RE.test(n) || n === "." || n === "..") throw new Error("invalid file name"); return n; };
export const validateMode = (m) => { if (typeof m !== "string" || !/^[0-7]{3}$/.test(m)) throw new Error("mode must be 3 octal digits"); return parseInt(m, 8); };

const ctxRoot = (p, { accountId }) => { const r = jailRoot(accountId, p.siteId); fs.mkdirSync(r, { recursive: true }); return r; };

export const FILE_METHODS = {
  "file.list": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p) }),
    run: (p, ctx) => {
      const root = ctxRoot(p, ctx), dir = jail(root, p.path, { follow: true });
      const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 5000).map((e) => {
        const full = path.join(dir, e.name), st = fs.lstatSync(full);
        return { name: e.name, type: e.isSymbolicLink() ? "link" : e.isDirectory() ? "dir" : "file", size: st.size, mode: (st.mode & 0o777).toString(8).padStart(3, "0"), mtime: st.mtime.toISOString() };
      });
      return { entries };
    },
  },
  "file.read": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p) }),
    run: (p, ctx) => {
      const f = jail(ctxRoot(p, ctx), p.path, { follow: true }), st = fs.statSync(f);
      if (!st.isFile()) throw new Error("not a file");
      if (st.size > MAX_EDIT) throw new Error("file too large to edit (max 1 MB)");
      const buf = fs.readFileSync(f);
      if (buf.includes(0)) throw new Error("binary file cannot be edited");
      return { content: buf.toString("utf8") };
    },
  },
  "file.write": { // create/overwrite; content is base64 so uploads may be binary
    scope: "account",
    validate: (p) => {
      if (typeof p.contentB64 !== "string") throw new Error("contentB64 required");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(p.contentB64) || p.contentB64.length > Math.ceil(MAX_UPLOAD / 3) * 4) throw new Error("content invalid or over 25 MB");
      return { ...base(p), path: pathParam(p), contentB64: p.contentB64 };
    },
    run: (p, ctx) => {
      const root = ctxRoot(p, ctx), f = jail(root, p.path);
      if (f === root) throw new Error("invalid path");
      if (fs.existsSync(f) && fs.lstatSync(f).isSymbolicLink()) throw new Error("refusing to write through a symlink");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      // create-then-chown-then-rename keeps the file owned by the runtime user without ever following a link
      const tmp = `${f}.mh-upload-${process.pid}`;
      fs.writeFileSync(tmp, Buffer.from(p.contentB64, "base64"), { mode: 0o644, flag: "wx" });
      lchown(tmp, ownerOf(p.runtime));
      fs.renameSync(tmp, f);
      return {};
    },
  },
  "file.mkdir": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p) }),
    run: (p, ctx) => {
      const root = ctxRoot(p, ctx), d = jail(root, p.path);
      if (d === root) throw new Error("invalid path");
      fs.mkdirSync(d, { recursive: true, mode: 0o755 });
      chownTree(d, ownerOf(p.runtime));
      return {};
    },
  },
  "file.delete": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p) }),
    run: (p, ctx) => {
      const root = ctxRoot(p, ctx), f = jail(root, p.path);
      if (f === root) throw new Error("cannot delete the site root");
      fs.rmSync(f, { recursive: true, force: true }); // rm never follows links
      return {};
    },
  },
  "file.rename": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p), newName: leaf(p.newName) }),
    run: (p, ctx) => {
      const root = ctxRoot(p, ctx), f = jail(root, p.path);
      if (f === root) throw new Error("cannot rename the site root");
      const dest = jail(root, path.posix.join(path.posix.dirname(p.path), p.newName)); // user-relative, so the jail resolves it again
      if (fs.existsSync(dest)) throw new Error("a file with that name exists");
      fs.renameSync(f, dest);
      return {};
    },
  },
  "file.chmod": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p), mode: validateMode(p.mode) }),
    run: (p, ctx) => {
      const f = jail(ctxRoot(p, ctx), p.path);
      if (fs.lstatSync(f).isSymbolicLink()) throw new Error("cannot chmod a symlink");
      fs.chmodSync(f, p.mode);
      return {};
    },
  },
  "file.zip": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p) }),
    run: async (p, ctx) => {
      const root = ctxRoot(p, ctx), f = jail(root, p.path);
      if (f === root) throw new Error("select a file or folder inside the site");
      const out = `${f}.zip`;
      if (fs.existsSync(out)) throw new Error(`${path.basename(out)} already exists`);
      await run("zip", ["-q", "-r", "-y", out, "--", path.basename(f)], path.dirname(f)); // -y stores symlinks as links instead of following them
      lchown(out, ownerOf(p.runtime));
      return { name: path.basename(out) };
    },
  },
  "file.unzip": {
    scope: "account", validate: (p) => ({ ...base(p), path: pathParam(p) }),
    run: async (p, ctx) => {
      const root = ctxRoot(p, ctx), f = jail(root, p.path, { follow: true });
      if (!fs.statSync(f).isFile() || !f.toLowerCase().endsWith(".zip")) throw new Error("not a .zip file");
      const dir = path.dirname(f);
      await run("unzip", ["-q", "-n", f, "-d", dir]); // -n never overwrites; unzip strips ../ and absolute paths
      stripLinks(dir);
      chownTree(dir, ownerOf(p.runtime)); // recursion is bounded to the archive's parent = inside the site
      return {};
    },
  },
};
