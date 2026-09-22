import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIREWALL_METHODS } from "../firewall.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const failregex = (file) => /^failregex\s*=\s*(.*)$/m.exec(fs.readFileSync(path.join(here, "../../deploy/fail2ban/filter.d", file), "utf8"))[1];
// fail2ban replaces <HOST> with an address group; the same substitution is done here so the shipped regex is exercised against real Postfix lines
const compile = (rx) => new RegExp(rx.replace("<HOST>", "(?<host>\\d{1,3}(?:\\.\\d{1,3}){3}|[0-9a-f:]+)"));

test("fail2ban postfix filter matches SASL failures (ISO and syslog timestamps) and nothing else", () => {
  const rx = compile(failregex("mailhost-postfix-sasl.conf"));
  const hit = (l) => rx.exec(l)?.groups.host;
  assert.equal(hit("2026-09-21T07:24:00.123456+00:00 mail postfix/submission/smtpd[1234]: warning: unknown[203.0.113.5]: SASL LOGIN authentication failed: UGFzc3dvcmQ6"), "203.0.113.5");
  assert.equal(hit("Sep 21 07:24:00 mail postfix/smtps/smtpd[99]: warning: host.example.com[198.51.100.2]: SASL PLAIN authentication failed: "), "198.51.100.2");
  assert.equal(hit("Sep 21 07:24:00 mail postfix/smtpd[5]: warning: unknown[2001:db8::7]: SASL LOGIN authentication failed: x"), "2001:db8::7");
  for (const no of ["Sep 21 07:24:00 mail postfix/smtpd[5]: NOQUEUE: reject: RCPT from unknown[203.0.113.5]: 554 5.7.1 denied",
    "Sep 21 07:24:00 mail postfix/smtpd[5]: connect from unknown[203.0.113.5]", "Sep 21 07:24:00 mail postfix/qmgr[5]: warning: x[1.2.3.4]: SASL LOGIN authentication failed"])
    assert.equal(hit(no), undefined, no);
});

test("firewall.apply: syntax check first, then atomic load, then persisted; a failed check changes nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-"));
  const log = path.join(dir, "calls.log"), stub = path.join(dir, "nft");
  fs.writeFileSync(stub, `#!/bin/sh\necho "ARGS $*" >> "${log}"\ncat >> "${log}"\n[ -n "$STUB_FAIL_CHECK" ] && [ "$1" = "-c" ] && { echo "Error: syntax" >&2; exit 1; }\nexit 0\n`, { mode: 0o755 });
  const saved = { ...process.env };
  Object.assign(process.env, { NFT_CMD: stub, FIREWALL_STATE: path.join(dir, "state", "firewall.nft"), FIREWALL_SSH_PORT: "2222" });
  try {
    const m = FIREWALL_METHODS["firewall.apply"];
    const res = await m.run(m.validate({ openPorts: [{ proto: "tcp", from: 3306, source: "203.0.113.0/24" }], blocked: ["198.51.100.7"] }));
    assert.deepEqual(res, { openPorts: 1, blocked: 1 });
    const calls = fs.readFileSync(log, "utf8");
    assert.ok(calls.indexOf("ARGS -c -f -") >= 0 && calls.indexOf("ARGS -c -f -") < calls.indexOf("ARGS -f -"));
    const saved1 = fs.readFileSync(process.env.FIREWALL_STATE, "utf8");
    assert.match(saved1, /2222/); assert.match(saved1, /198\.51\.100\.7\/32/);
    assert.equal((fs.statSync(process.env.FIREWALL_STATE).mode & 0o777), 0o600);

    fs.rmSync(process.env.FIREWALL_STATE); fs.writeFileSync(log, "");
    process.env.STUB_FAIL_CHECK = "1";
    await assert.rejects(m.run(m.validate({ blocked: ["192.0.2.1"] })), /nft failed: Error: syntax/);
    assert.ok(!fs.readFileSync(log, "utf8").includes("ARGS -f -"), "a ruleset that fails the check must never be loaded");
    assert.ok(!fs.existsSync(process.env.FIREWALL_STATE), "and must never be saved for reboot");
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("firewall.status without nft reports not installed instead of failing", async () => {
  const saved = process.env.NFT_CMD; process.env.NFT_CMD = "/nonexistent/nft";
  try { assert.deepEqual({ ...(await FIREWALL_METHODS["firewall.status"].run({})), sshPort: 0 }, { installed: false, active: false, ruleset: "", sshPort: 0 }); }
  finally { saved === undefined ? delete process.env.NFT_CMD : (process.env.NFT_CMD = saved); }
});
