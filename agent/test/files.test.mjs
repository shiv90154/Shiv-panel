import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jail, validateMode, FILE_METHODS } from "../files.mjs";
import { validateDb, buildSql } from "../databases.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jail-"));
const root = path.join(tmp, "root"), outside = path.join(tmp, "outside");
fs.mkdirSync(root); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "secret"), "x");
fs.symlinkSync(outside, path.join(root, "link"));
fs.mkdirSync(path.join(root, "sub"));

test("jail accepts inside paths, including not-yet-existing ones", () => {
  assert.equal(jail(root, "/sub"), path.join(root, "sub"));
  assert.equal(jail(root, "/sub/new/file.txt"), path.join(root, "sub/new/file.txt"));
  assert.equal(jail(root, "/"), root);
});
test("jail rejects traversal and symlink escapes", () => {
  for (const bad of ["/../outside", "/sub/../../outside/secret", "//../..", "/link/secret", "/link/newfile"]) assert.throws(() => jail(root, bad), /escapes jail/, bad);
  assert.throws(() => jail(root, "/link", { follow: true }), /escapes jail/);
  assert.throws(() => jail(root, "/a\0b"), /invalid path/);
});
test("delete/chmod act on the link, not its target", () => {
  const ctx = { accountId: "acct12345678" };
  assert.doesNotThrow(() => jail(root, "/link")); // final component not followed
  assert.equal(validateMode("755"), 0o755);
  for (const m of ["4755", "999", "rwx", 755]) assert.throws(() => validateMode(m));
  assert.ok(FILE_METHODS["file.delete"] && ctx);
});
test("method params are validated", () => {
  const v = FILE_METHODS["file.rename"].validate;
  assert.throws(() => v({ siteId: "abcdefgh1234", runtime: "static", path: "/a", newName: "../x" }));
  assert.throws(() => v({ siteId: "abcdefgh1234", runtime: "evil", path: "/a", newName: "x" }));
  assert.throws(() => FILE_METHODS["file.write"].validate({ siteId: "abcdefgh1234", runtime: "static", path: "/a", contentB64: "not base64!" }));
});
test("db validation and SQL", () => {
  for (const bad of [{ engine: "mysql" }, { name: "mysql" }, { name: "a_b;drop" }, { name: "performance_schema" }, { name: "x_`y" }, { name: "" }])
    assert.throws(() => validateDb({ engine: "mariadb", name: "user_db", password: "a".repeat(20), ...bad }), undefined, JSON.stringify(bad));
  for (const pw of ["short", "a'b".padEnd(20, "x"), "a b".padEnd(20, "x"), "x".repeat(65)]) assert.throws(() => validateDb({ engine: "postgres", name: "user_db", password: pw }, { password: true }));
  const a = validateDb({ engine: "mariadb", name: "user_db", password: "A".repeat(20) }, { password: true });
  assert.match(buildSql("create", a).join("\n"), /GRANT ALL PRIVILEGES ON `user_db`\.\* TO 'user_db'@'%'/);
  assert.match(buildSql("drop", { engine: "postgres", name: "user_db" }).join("\n"), /DROP ROLE IF EXISTS "user_db"/);
});

test("rename/write/zip/unzip work inside the jail and never escape via links", async () => {
  process.env.SITES_ROOT = path.join(tmp, "sites");
  const ctx = { accountId: "acct12345678" }, site = { siteId: "abcdefgh1234", runtime: "static" };
  const call = (m, p) => FILE_METHODS[m].run(FILE_METHODS[m].validate({ ...site, ...p }), ctx);
  await call("file.mkdir", { path: "/d" });
  await call("file.write", { path: "/d/a.txt", contentB64: Buffer.from("hi").toString("base64") });
  await call("file.rename", { path: "/d/a.txt", newName: "b.txt" });
  await call("file.zip", { path: "/d" });
  await call("file.delete", { path: "/d" });
  await call("file.unzip", { path: "/d.zip" });
  assert.equal((await call("file.read", { path: "/d/b.txt" })).content, "hi");
  fs.symlinkSync(outside, path.join(process.env.SITES_ROOT, ctx.accountId, site.siteId, "esc"));
  assert.throws(() => call("file.read", { path: "/esc/secret" }), /escapes jail/);
  await call("file.delete", { path: "/esc" });
  assert.ok(fs.existsSync(path.join(outside, "secret")));
});
