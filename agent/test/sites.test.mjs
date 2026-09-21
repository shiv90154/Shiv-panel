import test from "node:test";
import assert from "node:assert/strict";
import { validateApply, buildRunArgs, buildCaddySnippet } from "../sites.mjs";

const base = { siteId: "abcdefgh1234", runtime: "node-22", domains: ["a.example.com"], startCommand: "npm start", env: { FOO: "bar" } };

test("validates and builds docker args without a shell", () => {
  const a = validateApply({ ...base, memoryMb: 256, cpuPercent: 50 });
  const args = buildRunArgs(a, { accountId: "acct12345678", network: "n" }, "/srv/accounts/acct12345678/abcdefgh1234");
  assert.deepEqual(args.slice(-3), ["sh", "-c", "npm start"]);
  assert.ok(args.includes("--memory") && args.includes("256m") && args.includes("0.50"));
  assert.ok(args.includes("FOO=bar") && args.includes("--user"));
});
test("rejects bad input", () => {
  for (const bad of [{ runtime: "evil" }, { runtime: "__proto__" }, { domains: ["a b.com"] }, { domains: ["x.com\nevil"] }, { env: { "A=B": "x" } }, { env: { PORT: "1" } },
    { startCommand: "a\nb" }, { redirects: [{ from: "/a", to: "x}", code: 301 }] }, { redirects: [{ from: "/a b", to: "/x", code: 301 }] }, { siteId: "../x" }])
    assert.throws(() => validateApply({ ...base, ...bad }), undefined, JSON.stringify(bad));
});
test("caddy snippet", () => {
  const s = buildCaddySnippet(validateApply({ ...base, redirects: [{ from: "/old", to: "https://x.com/new", code: 301 }] }));
  assert.match(s, /^a\.example\.com \{/m); assert.match(s, /redir \/old https:\/\/x\.com\/new 301/); assert.match(s, /reverse_proxy site-abcdefgh1234:3000/);
  assert.match(buildCaddySnippet(validateApply({ ...base, forceHttps: false })), /http:\/\/a\.example\.com, https:\/\/a\.example\.com/);
});
