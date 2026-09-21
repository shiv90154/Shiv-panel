import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mailDir, retentionArgs, snapshotMatches, validateRestore, validateRun } from "../backup.mjs";
import { BACKUP_METHODS } from "../backup.mjs";
import { buildExecArgs, validateCron } from "../cron.mjs";

const SITE = "cabcdefgh1234567";
const ACC = "cxyzxyzxyz123456";

test("backup.run validation", () => {
  const ok = validateRun({ sites: [SITE], databases: [{ engine: "mariadb", name: "acme_wp" }], mailDomains: ["a.com"], keep: { daily: 7 } });
  assert.deepEqual(ok.keep, { daily: 7, weekly: 0, monthly: 0 });
  assert.throws(() => validateRun({ sites: [SITE], keep: {} }), /retention/);
  assert.throws(() => validateRun({ keep: { daily: 1 } }), /nothing/);
  assert.throws(() => validateRun({ sites: ["../x"], keep: { daily: 1 } }));
  assert.throws(() => validateRun({ databases: [{ engine: "mariadb", name: "mysql" }], keep: { daily: 1 } }), /database/);
  assert.throws(() => validateRun({ databases: [{ engine: "oracle", name: "a_b" }], keep: { daily: 1 } }));
  assert.throws(() => validateRun({ mailDomains: ["a.com/../../etc"], keep: { daily: 1 } }));
  assert.throws(() => validateRun({ sites: [SITE], keep: { daily: 1000 } }));
});

test("retention args", () => {
  assert.deepEqual(retentionArgs({ daily: 7, weekly: 0, monthly: 3 }), ["forget", "--group-by", "host,tags", "--prune", "--keep-daily", "7", "--keep-monthly", "3"]);
});

test("restore validation and snapshot matching", () => {
  assert.equal(validateRestore({ snapshotId: "deadbeef", kind: "db", name: "postgres:acme_x" }).dbName, "acme_x");
  assert.throws(() => validateRestore({ snapshotId: "deadbeef", kind: "db", name: "postgres:acme_x:extra" }));
  assert.throws(() => validateRestore({ snapshotId: "--all", kind: "site", name: SITE }));
  assert.throws(() => validateRestore({ snapshotId: "deadbeef", kind: "mail", name: "../etc" }));
  const snap = { hostname: ACC, tags: [`site:${SITE}`], paths: ["/srv/accounts/x/y"] };
  assert.ok(snapshotMatches(snap, { host: ACC, tag: `site:${SITE}`, expectPath: "/srv/accounts/x/y" }));
  assert.ok(!snapshotMatches(snap, { host: "other", tag: `site:${SITE}` }));
  assert.ok(!snapshotMatches(snap, { host: ACC, tag: `site:${SITE}`, expectPath: "/etc" }));
  assert.ok(!snapshotMatches(snap, { host: ACC, tag: "site:zzz" }));
  assert.ok(!snapshotMatches(null, { host: ACC, tag: "x" }));
});

test("mail dir is jailed", () => {
  assert.equal(mailDir("/var/vmail", "a.com"), "/var/vmail/a.com");
  assert.throws(() => mailDir("/var/vmail", ".."));
});

test("cron validation + docker exec args", () => {
  const a = validateCron({ siteId: SITE, runtime: "php-8.3", command: "php artisan schedule:run" });
  assert.equal(a.timeoutSec, 300);
  assert.deepEqual(buildExecArgs(a), ["exec", "--user", "33:33", "-w", "/var/www/html", `site-${SITE}`, "timeout", "-s", "KILL", "300", "sh", "-c", "php artisan schedule:run"]);
  assert.throws(() => validateCron({ siteId: SITE, runtime: "nope", command: "x" }));
  assert.throws(() => validateCron({ siteId: SITE, runtime: "static", command: "  " }));
  assert.throws(() => validateCron({ siteId: SITE, runtime: "static", command: "x", timeoutSec: 1 }));
  assert.throws(() => validateCron({ siteId: "../x", runtime: "static", command: "x" }));
});

test("backup.run flow against a stub restic (files only): order of calls, retention, per-item results", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  const log = path.join(dir, "calls.log");
  const stub = path.join(dir, "restic");
  fs.writeFileSync(stub, `#!/usr/bin/env node\nconst fs=require("fs");fs.appendFileSync(${JSON.stringify(log)},process.argv.slice(2).join(" ")+"|"+process.env.RESTIC_REPOSITORY+"\\n");\nif(process.argv[2]==="init")fs.mkdirSync(process.env.RESTIC_REPOSITORY+"",{recursive:true}),fs.writeFileSync(process.env.RESTIC_REPOSITORY+"/config","x");\n`, { mode: 0o755 });
  const sites = path.join(dir, "sites");
  fs.mkdirSync(path.join(sites, ACC, SITE), { recursive: true });
  process.env.RESTIC_CMD = stub; process.env.RESTIC_PASSWORD = "pw"; process.env.BACKUP_ROOT = path.join(dir, "repos");
  process.env.SITES_ROOT = sites; process.env.VMAIL_DIR = path.join(dir, "vmail");
  const m = BACKUP_METHODS["backup.run"];
  const other = "cabcdefgh7654321";
  const r = await m.run(m.validate({ sites: [SITE, other], mailDomains: ["a.com"], keep: { daily: 7 } }), { accountId: ACC });
  assert.deepEqual(r.results.map((x) => [x.kind, x.name, x.ok]), [["site", SITE, true], ["site", other, false], ["mail", "a.com", true]]);
  const calls = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.match(calls[0], /^init\|/);
  assert.match(calls[1], new RegExp(`^backup --host ${ACC} --tag site:${SITE} --one-file-system ${sites}/${ACC}/${SITE}\\|`));
  assert.match(calls.at(-1), /^forget --group-by host,tags --prune --keep-daily 7\|/);
  assert.ok(calls.every((c) => c.endsWith(`|${path.join(dir, "repos", ACC)}`)), "every call is bound to the account's own repo");
  await BACKUP_METHODS["backup.purgeAccount"].run({}, { accountId: ACC });
  assert.ok(!fs.existsSync(path.join(dir, "repos", ACC)));
});
