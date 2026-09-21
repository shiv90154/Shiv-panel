// Run: node --test tests/*.test.ts   (Node >= 22.18 strips types natively; pure logic, no DB needed)
import test from "node:test";
import assert from "node:assert/strict";
import { canImpersonate, creatableRoles, descendantIds, homeFor, scopeWhere, visibleAccountIds, withinLimit, type Node } from "../src/lib/tenancy-core.ts";
import { base32Decode, base32Encode, hotp, otpauthUri, stepAt, verifyTotp } from "../src/lib/totp.ts";

// admin -> resellerA -> (alice, bob) ; admin -> resellerB -> carol ; admin -> dave (direct user)
const tree: Node[] = [
  { id: "admin", parentId: null }, { id: "resA", parentId: "admin" }, { id: "resB", parentId: "admin" },
  { id: "alice", parentId: "resA" }, { id: "bob", parentId: "resA" }, { id: "carol", parentId: "resB" }, { id: "dave", parentId: "admin" },
];

test("descendants", () => {
  assert.deepEqual(descendantIds(tree, "resA").sort(), ["alice", "bob"]);
  assert.deepEqual(descendantIds(tree, "alice"), []);
  assert.equal(descendantIds(tree, "admin").length, 6);
  assert.deepEqual(descendantIds([{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }], "x"), ["y"]); // cycle-safe
});

test("scope: two users cannot see each other; resellers see only their subtree; admin sees all", () => {
  assert.deepEqual(visibleAccountIds("user", "alice", tree), ["alice"]);
  assert.deepEqual(visibleAccountIds("user", "bob", tree), ["bob"]);
  assert.deepEqual(visibleAccountIds("reseller", "resA", tree)?.sort(), ["alice", "bob", "resA"]);
  assert.ok(!visibleAccountIds("reseller", "resA", tree)!.includes("carol"));
  assert.equal(visibleAccountIds("admin", "admin", tree), null);
  assert.deepEqual(scopeWhere(["alice"]), { accountId: { in: ["alice"] } });
  assert.deepEqual(scopeWhere(null), {});
});

test("role rules", () => {
  assert.deepEqual(creatableRoles("admin"), ["reseller", "user"]);
  assert.deepEqual(creatableRoles("reseller"), ["user"]);
  assert.deepEqual(creatableRoles("user"), []);
  assert.ok(canImpersonate("admin", "reseller") && canImpersonate("admin", "user") && canImpersonate("reseller", "user"));
  assert.ok(!canImpersonate("admin", "admin") && !canImpersonate("reseller", "reseller") && !canImpersonate("reseller", "admin") && !canImpersonate("user", "user"));
  assert.equal(homeFor("user"), "/cpanel");
  assert.equal(homeFor("reseller"), "/admin");
});

test("package limits (0 = unlimited)", () => {
  assert.ok(withinLimit(0, 999) && withinLimit(undefined, 5) && withinLimit(null, 5));
  assert.ok(withinLimit(3, 2));
  assert.ok(!withinLimit(3, 3) && !withinLimit(1, 5));
});

test("TOTP matches RFC 6238 vectors (SHA-1, secret 12345678901234567890)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(base32Decode(secret).toString(), "12345678901234567890");
  for (const [t, code] of [[59, "287082"], [1111111109, "081804"], [1234567890, "005924"], [2000000000, "279037"]] as const) {
    assert.equal(hotp(secret, Math.floor(t / 30)), code);
    assert.equal(verifyTotp(secret, code, null, t * 1000), stepAt(t * 1000));
  }
});

test("TOTP: drift window, wrong code, replay protection", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  const now = 1111111109 * 1000, step = stepAt(now);
  assert.equal(verifyTotp(secret, hotp(secret, step - 1), null, now), step - 1); // 30 s late
  assert.equal(verifyTotp(secret, hotp(secret, step + 1), null, now), step + 1); // 30 s early
  assert.equal(verifyTotp(secret, hotp(secret, step + 5), null, now), null); // outside window
  assert.equal(verifyTotp(secret, "000000", null, now), null);
  assert.equal(verifyTotp(secret, "abc", null, now), null);
  assert.equal(verifyTotp(secret, hotp(secret, step), step, now), null); // same step already used
  assert.equal(verifyTotp(secret, hotp(secret, step - 1), step, now), null); // older step than the last accepted
  assert.match(otpauthUri("Host", "a@b.c", secret), /^otpauth:\/\/totp\/Host:a%40b\.c\?secret=/);
});

import { cronMatches, minIntervalMinutes, parseCron } from "../src/lib/cron.ts";
import { isBackupDue, latestSlot } from "../src/lib/backup-schedule.ts";

test("cron parser + matcher (UTC)", () => {
  const at = (s: string) => new Date(s + "Z");
  assert.ok(cronMatches(parseCron("*/15 * * * *"), at("2026-01-05T10:45:00")));
  assert.ok(!cronMatches(parseCron("*/15 * * * *"), at("2026-01-05T10:46:00")));
  assert.ok(cronMatches(parseCron("30 2 * * 1-5"), at("2026-01-05T02:30:00"))); // Monday
  assert.ok(!cronMatches(parseCron("30 2 * * 1-5"), at("2026-01-04T02:30:00"))); // Sunday
  assert.ok(cronMatches(parseCron("0 0 * * 7"), at("2026-01-04T00:00:00"))); // 7 = Sunday
  assert.ok(cronMatches(parseCron("0 0 13 * 5"), at("2026-02-13T00:00:00"))); // dom OR dow: Fri 13th
  assert.ok(cronMatches(parseCron("0 0 13 * 5"), at("2026-02-20T00:00:00"))); // a Friday, not the 13th
  assert.ok(cronMatches(parseCron("@daily"), at("2026-03-01T00:00:00")));
  assert.ok(cronMatches(parseCron("10-30/10 * * * *"), at("2026-03-01T05:20:00")));
  for (const bad of ["", "* * * *", "60 * * * *", "*/0 * * * *", "5-1 * * * *", "a * * * *", "* * 0 * *", "* * * 13 *", "1,,2 * * * *"]) assert.throws(() => parseCron(bad), Error, bad);
  assert.equal(minIntervalMinutes(parseCron("*/5 * * * *")), 5);
  assert.equal(minIntervalMinutes(parseCron("* * * * *")), 1);
  assert.equal(minIntervalMinutes(parseCron("0 * * * *")), 60);
});

test("backup schedule slots", () => {
  const now = new Date("2026-09-21T10:00:00Z"); // Monday
  assert.equal(latestSlot("daily", 3, now).toISOString(), "2026-09-21T03:00:00.000Z");
  assert.equal(latestSlot("daily", 12, now).toISOString(), "2026-09-20T12:00:00.000Z");
  assert.equal(latestSlot("weekly", 3, now).toISOString(), "2026-09-20T03:00:00.000Z");
  assert.ok(isBackupDue({ frequency: "daily", hour: 3, lastRunAt: null }, now));
  assert.ok(isBackupDue({ frequency: "daily", hour: 3, lastRunAt: new Date("2026-09-20T03:05:00Z") }, now));
  assert.ok(!isBackupDue({ frequency: "daily", hour: 3, lastRunAt: new Date("2026-09-21T03:05:00Z") }, now));
  assert.ok(!isBackupDue({ frequency: "weekly", hour: 3, lastRunAt: new Date("2026-09-20T04:00:00Z") }, now));
});
