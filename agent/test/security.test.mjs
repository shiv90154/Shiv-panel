import test from "node:test";
import assert from "node:assert/strict";
import { parseCidr, validateFirewall, buildRuleset } from "../firewall.mjs";
import { banScript, unbanScript, ensureScript, parseHost } from "../banlist.mjs";
import { parseJailList, parseJailStatus } from "../fail2ban.mjs";
import { parseClamOutput, buildScanArgs, parseVersion } from "../clamav.mjs";
import { parseCpu, parseMem, parseLoad, parseNet } from "../metrics.mjs";
import { refusal, runUpdate, runnerEnv, uCfg, parseCommits } from "../update.mjs";
import { validateApply, buildCaddySnippet } from "../sites.mjs";

// ---------------- firewall ----------------
test("cidr parsing", () => {
  assert.equal(parseCidr("1.2.3.4").text, "1.2.3.4/32");
  assert.equal(parseCidr("10.0.0.0/8").text, "10.0.0.0/8");
  assert.equal(parseCidr("2001:DB8::/32").text, "2001:db8::/32");
  for (const bad of ["", "1.2.3", "1.2.3.4/33", "1.2.3.4/x", "1.2.3.4/8/8", "fe80::1%eth0", "a.b.c.d", "1.2.3.4; drop", "1.2.3.4\n", "::1/129", 5, null])
    assert.throws(() => parseCidr(bad), undefined, String(bad));
  assert.throws(() => parseCidr("0.0.0.0/0", { minPrefix: true }), /wider/);
  assert.throws(() => parseCidr("::/0", { minPrefix: true }), /wider/);
  assert.equal(parseCidr("0.0.0.0/0").prefix, 0); // allowed as the SOURCE of an open-port rule, never as a block
});
test("firewall validation", () => {
  const ok = validateFirewall({ openPorts: [{ proto: "tcp", from: 3306, source: "203.0.113.0/24" }, { proto: "udp", from: 100, to: 200 }], blocked: ["198.51.100.7"] });
  assert.equal(ok.openPorts.length, 2); assert.equal(ok.openPorts[0].to, 3306);
  for (const bad of [{ openPorts: [{ proto: "icmp", from: 1 }] }, { openPorts: [{ proto: "tcp", from: 0 }] }, { openPorts: [{ proto: "tcp", from: 5, to: 4 }] },
    { openPorts: [{ proto: "tcp", from: 70000 }] }, { openPorts: [{ proto: "tcp", from: 22, source: "x" }] }, { blocked: ["10.0.0.0/7"] }, { blocked: ["1.1.1.1 accept"] }, { blocked: [null] }])
    assert.throws(() => validateFirewall(bad), undefined, JSON.stringify(bad));
  assert.throws(() => validateFirewall({ openPorts: Array.from({ length: 201 }, () => ({ proto: "tcp", from: 1 })) }), /at most/);
});
test("ruleset: atomic replace, base ports, blocks before DNAT, custom rules", () => {
  const r = buildRuleset(validateFirewall({
    openPorts: [{ proto: "tcp", from: 3306, source: "203.0.113.0/24" }, { proto: "tcp", from: 8000, to: 8100 }, { proto: "udp", from: 5353, source: "2001:db8::/32" }],
    blocked: ["198.51.100.7", "192.0.2.0/24", "2001:db8:dead::/48"],
  }), 2222);
  const lines = r.split("\n");
  assert.equal(lines[0], "table inet mailhost"); assert.equal(lines[1], "delete table inet mailhost"); // create-then-delete-then-define = one atomic replace
  assert.match(r, /hook prerouting priority -300; policy accept;/);
  assert.match(r, /hook input priority 0; policy drop;/);
  assert.match(r, /tcp dport \{ 25, 53, 80, 143, 443, 465, 587, 993, 2222 \} accept/); // SSH port is always in the base set
  assert.match(r, /elements = \{ 198\.51\.100\.7\/32, 192\.0\.2\.0\/24 \}/);
  assert.match(r, /elements = \{ 2001:db8:dead::\/48 \}/);
  assert.match(r, /ip saddr 203\.0\.113\.0\/24 tcp dport 3306 accept/);
  assert.match(r, /tcp dport 8000-8100 accept/);
  assert.match(r, /ip6 saddr 2001:db8::\/32 udp dport 5353 accept/);
  // local interfaces are accepted before the drop rules in prerouting (a block must never cut off docker <-> agent traffic)
  const pre = r.slice(r.indexOf("chain prerouting"), r.indexOf("chain input"));
  assert.ok(pre.indexOf('iifname "br-*" accept') < pre.indexOf("@blocked4 drop"));
  assert.match(r, /meta l4proto ipv6-icmp accept/);
});
test("ruleset with no rules has no empty elements clause (nft rejects it)", () => {
  const r = buildRuleset(validateFirewall({}), 22);
  assert.ok(!r.includes("elements")); assert.ok(r.includes("set blocked4"));
});

// ---------------- ban list ----------------
test("ban scripts", () => {
  const s = banScript("203.0.113.9", 3600);
  assert.match(s, /add table inet mailhost_ban/); assert.match(s, /add element inet mailhost_ban banned4 \{ 203\.0\.113\.9 timeout 3600s \}/);
  assert.match(banScript("2001:db8::1", -1), /banned6 \{ 2001:db8::1 \}/); // -1 = permanent
  assert.match(unbanScript("203.0.113.9"), /^delete element inet mailhost_ban banned4 \{ 203\.0\.113\.9 \}/);
  for (const bad of ["1.2.3.4/24", "1.2.3.4 } ; flush ruleset ; {", "fe80::1%lo", "example.com", "", undefined]) assert.throws(() => parseHost(bad), undefined, String(bad));
  for (const bad of [0, -2, 1.5, 1e10, "60"]) assert.throws(() => banScript("1.2.3.4", bad), undefined, String(bad));
  assert.match(ensureScript(), /flush chain inet mailhost_ban prerouting/); // idempotent: rules are re-added on a flushed chain
});

// ---------------- fail2ban ----------------
test("fail2ban output parsing", () => {
  assert.deepEqual(parseJailList("Status\n|- Number of jail:\t2\n`- Jail list:\tpostfix-sasl, sshd\n"), ["postfix-sasl", "sshd"]);
  assert.deepEqual(parseJailList("nothing"), []);
  const st = parseJailStatus(`Status for the jail: sshd
|- Filter
|  |- Currently failed:\t3
|  |- Total failed:\t41
|  \`- File list:\t/var/log/auth.log
\`- Actions
   |- Currently banned:\t2
   |- Total banned:\t9
   \`- Banned IP list:\t203.0.113.5 2001:db8::7 not-an-ip
`);
  assert.deepEqual(st, { currentlyFailed: 3, totalFailed: 41, currentlyBanned: 2, totalBanned: 9, banned: ["203.0.113.5", "2001:db8::7"] });
  assert.deepEqual(parseJailStatus("Banned IP list:\t").banned, []);
});

// ---------------- clamav ----------------
test("clamscan output is parsed and confined to the site jail", () => {
  const root = "/srv/accounts/acct1/site1";
  const out = [`${root}/wp-content/uploads/x.php: Php.Trojan.Agent-1 FOUND`, `${root}/a: b/c.js: Js.Malware.Foo FOUND`, "/etc/passwd: Evil FOUND",
    `${root}-evil/x: Evil FOUND`, `${root}/ok.txt: OK`, "garbage"].join("\n");
  const r = parseClamOutput(out, root);
  assert.equal(r.total, 2);
  assert.deepEqual(r.findings, [{ path: "/wp-content/uploads/x.php", signature: "Php.Trojan.Agent-1" }, { path: "/a: b/c.js", signature: "Js.Malware.Foo" }]);
  const many = Array.from({ length: 500 }, (_, i) => `${root}/f${i}: S FOUND`).join("\n");
  const m = parseClamOutput(many, root); assert.equal(m.total, 500); assert.equal(m.findings.length, 200);
});
test("scan args never follow symlinks and pass the root last", () => {
  const a = buildScanArgs("/srv/accounts/a/b");
  assert.ok(a.includes("--follow-dir-symlinks=0") && a.includes("--follow-file-symlinks=0"));
  assert.equal(a.at(-1), "/srv/accounts/a/b");
});
test("clamscan version", () => {
  assert.deepEqual(parseVersion("ClamAV 1.0.5/27000/Mon Sep 21 08:30:12 2026\n"), { version: "1.0.5", dbVersion: 27000, dbDate: "Mon Sep 21 08:30:12 2026" });
  assert.equal(parseVersion("ClamAV 0.103.8\n").dbVersion, null);
});

// ---------------- metrics ----------------
test("proc parsers", () => {
  assert.deepEqual(parseCpu("cpu  100 5 50 800 20 1 2 3 0 0\ncpu0 1 1 1 1 1 1 1 1\n"), { idle: 820, total: 981 });
  assert.equal(parseCpu("nope"), null);
  assert.deepEqual(parseMem("MemTotal:       16000000 kB\nMemFree: 1 kB\nMemAvailable:   8000000 kB\n"), { total: 16000000 * 1024, available: 8000000 * 1024 });
  assert.equal(parseMem("MemTotal: 5 kB\n"), null);
  assert.deepEqual(parseLoad("0.52 0.40 0.31 1/234 5678\n"), [0.52, 0.4, 0.31]);
  const dev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
docker0: 5000 1 0 0 0 0 0 0 6000 1 0 0 0 0 0 0
veth12: 7 1 0 0 0 0 0 0 8 1 0 0 0 0 0 0
  ens3: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0
`;
  assert.deepEqual(parseNet(dev), { rx: 1010, tx: 2020 }); // lo, docker0 and veth are not counted
});

// ---------------- self-update ----------------
const chk = { branch: "main", currentBranch: "main", current: "a".repeat(40), latest: "b".repeat(40), behind: 2, ahead: 0, dirty: false };
test("update refusals", () => {
  const idle = { state: "idle" };
  assert.equal(refusal(chk, chk.latest, idle), null);
  assert.match(refusal(chk, chk.latest, { state: "running" }), /already running/);
  assert.match(refusal({ ...chk, dirty: true }, chk.latest, idle), /local changes/);
  assert.match(refusal({ ...chk, currentBranch: "dev" }, chk.latest, idle), /not main/);
  assert.match(refusal({ ...chk, ahead: 1 }, chk.latest, idle), /not on the remote/);
  assert.match(refusal({ ...chk, behind: 0 }, chk.latest, idle), /up to date/);
  assert.match(refusal(chk, "c".repeat(40), idle), /remote changed/);
});
test("update config validation and runner env", () => {
  assert.throws(() => uCfg({ UPDATE_DIR: "relative/path" }), /absolute/);
  assert.throws(() => uCfg({ UPDATE_BRANCH: "--upload-pack=evil" }), /invalid/);
  assert.throws(() => uCfg({ UPDATE_REMOTE: "a b" }), /invalid/);
  const c = uCfg({ UPDATE_SKIP_DB_DUMP: "1" });
  assert.equal(runnerEnv(c).UPDATE_SKIP_DB_DUMP, "1"); assert.equal(runnerEnv(uCfg({})).UPDATE_SKIP_DB_DUMP, undefined);
  assert.deepEqual(parseCommits(`${"a".repeat(40)}\tfix: x\ty\nbad\tline\n`), [{ sha: "a".repeat(40), subject: "fix: x\ty" }]);
});
function fakeIo({ failOn } = {}) {
  const calls = [], states = [];
  return {
    calls, states,
    git: async (a) => { calls.push(["git", ...a]); if (a[0] === "rev-parse") return "f".repeat(40); if (failOn === "merge" && a[0] === "merge") throw new Error("not fast-forward"); return ""; },
    sh: async (cmd, a) => { calls.push([cmd, ...a]); if (failOn === "build" && a[1] === "build") throw new Error("docker compose failed: boom"); if (failOn === "up" && a[1] === "up") throw new Error("up failed"); return ""; },
    log: () => {}, state: (p) => states.push(p), dump: async () => { calls.push(["dump"]); }, pruneDumps: async () => {},
  };
}
const sha = "b".repeat(40);
test("update sequence: dump, ff-only merge of the exact sha, build, up, agent restart last", async () => {
  const io = fakeIo();
  assert.equal(await runUpdate(uCfg({}), sha, io), true);
  assert.deepEqual(io.calls.map((c) => c.slice(0, 3).join(" ")), ["git rev-parse HEAD", "dump", `git merge --ff-only`, "docker compose build", "docker compose up", "systemctl restart mailhost-agent"]);
  assert.equal(io.calls[2][3], sha);
  assert.equal(io.states.at(-1).state, "ok");
});
test("update: a failed build restores the previous commit and never restarts anything", async () => {
  const io = fakeIo({ failOn: "build" });
  assert.equal(await runUpdate(uCfg({}), sha, io), false);
  assert.ok(io.calls.some((c) => c[0] === "git" && c[1] === "reset" && c[2] === "--hard" && c[3] === "f".repeat(40)));
  assert.ok(!io.calls.some((c) => c[1] === "up" || c[0] === "systemctl"));
  assert.match(io.states.at(-1).error, /restored/); assert.equal(io.states.at(-1).state, "failed");
});
test("update: failed dump or merge stops before touching the stack", async () => {
  const io = fakeIo(); io.dump = async () => { throw new Error("pg_dump failed"); };
  assert.equal(await runUpdate(uCfg({}), sha, io), false);
  assert.ok(!io.calls.some((c) => c[0] === "git" && c[1] === "merge"));
  const io2 = fakeIo({ failOn: "merge" });
  assert.equal(await runUpdate(uCfg({}), sha, io2), false);
  assert.ok(!io2.calls.some((c) => c[0] === "docker"));
  const io3 = fakeIo({ failOn: "up" }); // after `up` started there is no automatic rollback (migrations may have run)
  assert.equal(await runUpdate(uCfg({}), sha, io3), false);
  assert.ok(!io3.calls.some((c) => c[1] === "reset"));
  await assert.rejects(runUpdate(uCfg({}), "main; rm -rf /", fakeIo()), /bad sha/);
});
test("skipDump omits the database dump", async () => {
  const io = fakeIo();
  await runUpdate(uCfg({ UPDATE_SKIP_DB_DUMP: "1" }), sha, io);
  assert.ok(!io.calls.some((c) => c[0] === "dump"));
});

// ---------------- WAF ----------------
const site = { siteId: "abcdefgh1234", runtime: "php-8.3", domains: ["a.example.com"] };
test("waf option is validated", () => {
  assert.equal(validateApply(site).waf, "off");
  assert.equal(validateApply({ ...site, waf: "block" }).waf, "block");
  for (const bad of ["on", "BLOCK", 1, true, {}]) assert.throws(() => validateApply({ ...site, waf: bad }), /waf/, String(bad));
});
test("caddy snippet: WAF wraps the proxy in a route, never touches global options", () => {
  const off = buildCaddySnippet(validateApply(site));
  assert.ok(!off.includes("coraza"));
  const block = buildCaddySnippet(validateApply({ ...site, waf: "block", redirects: [{ from: "/old", to: "/new", code: 301 }] }));
  assert.match(block, /route \{\n\t\tcoraza_waf \{/); assert.match(block, /SecRuleEngine On/); assert.match(block, /reverse_proxy site-abcdefgh1234:80\n\t\}/);
  assert.ok(block.indexOf("redir /old") < block.indexOf("route {"));
  assert.ok(!/^order /m.test(block) && !block.includes("order coraza_waf"));
  assert.match(buildCaddySnippet(validateApply({ ...site, waf: "detect" })), /SecRuleEngine DetectionOnly/);
  // balanced braces: a malformed snippet would break every later Caddy reload
  for (const s of [off, block]) assert.equal((s.match(/\{/g) ?? []).length, (s.match(/\}/g) ?? []).length);
});
