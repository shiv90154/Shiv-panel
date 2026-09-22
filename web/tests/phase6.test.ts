import test from "node:test";
import assert from "node:assert/strict";
import { cidrContains, downsample, nightlyDue, parseCidr, parsePortSpec, parseRange, toSample, type RawMetrics } from "../src/lib/security-core.ts";

test("cidr parsing and block guard", () => {
  assert.equal(parseCidr(" 1.2.3.4 ").text, "1.2.3.4/32");
  assert.equal(parseCidr("2001:DB8::/32").text, "2001:db8::/32");
  for (const bad of ["", "1.2.3", "1.2.3.4/33", "1.2.3.4/x", "1.2.3.4/8/8", "fe80::1%eth0", "example.com", "1.2.3.4 drop", "::1/129"]) assert.throws(() => parseCidr(bad), bad);
  assert.throws(() => parseCidr("10.0.0.0/7", { block: true }), /wider/);
  assert.throws(() => parseCidr("::/0", { block: true }), /wider/);
  assert.equal(parseCidr("10.0.0.0/8", { block: true }).text, "10.0.0.0/8");
  assert.equal(parseCidr("0.0.0.0/0").text, "0.0.0.0/0"); // fine as the source restriction of an open-port rule
});
test("port specs", () => {
  assert.deepEqual(parsePortSpec("80"), { from: 80, to: 80 });
  assert.deepEqual(parsePortSpec(" 8000 - 8100 "), { from: 8000, to: 8100 });
  for (const bad of ["", "0", "65536", "8100-8000", "a", "80,81", "1-2-3", "-5"]) assert.throws(() => parsePortSpec(bad), bad);
});
test("cidrContains protects the admin's own address", () => {
  assert.ok(cidrContains("203.0.113.0/24", "203.0.113.77"));
  assert.ok(cidrContains("203.0.113.77/32", "203.0.113.77"));
  assert.ok(cidrContains("203.0.113.0/24", "::ffff:203.0.113.77")); // IPv4 client seen through a dual-stack socket
  assert.ok(!cidrContains("203.0.113.0/24", "203.0.114.1"));
  assert.ok(cidrContains("2001:db8::/32", "2001:db8:1::5"));
  assert.ok(!cidrContains("2001:db8::/32", "203.0.113.77")); // different families never match
  assert.ok(!cidrContains("203.0.113.0/24", "not-an-ip"));
});

const raw = (over: Partial<RawMetrics> = {}): RawMetrics => ({ time: 0, cpu: { idle: 1000, total: 2000 }, load: [0.5, 0.4, 0.3], memTotal: 1000, memAvailable: 250, diskTotal: 100, diskFree: 40, netRx: 1_000, netTx: 500, ...over });
test("metric samples from counters", () => {
  // over 60 s: 400 cpu ticks passed, 100 of them idle -> 75 % busy; rx grew by 6000 bytes -> 100 B/s
  const s = toSample(raw(), raw({ time: 60_000, cpu: { idle: 1100, total: 2400 }, netRx: 7_000, netTx: 500 }));
  assert.equal(s.cpuPct, 75); assert.equal(s.netRxBps, 100); assert.equal(s.netTxBps, 0);
  assert.equal(s.memPct, 75); assert.equal(s.diskPct, 60); assert.equal(s.load1, 0.5);
});
test("first reading and counter resets give null rates, never negative or huge numbers", () => {
  const first = toSample(null, raw());
  assert.equal(first.cpuPct, null); assert.equal(first.netRxBps, null); assert.equal(first.memPct, 75);
  const rebooted = toSample(raw({ netRx: 9_000_000, cpu: { idle: 9000, total: 10000 } }), raw({ time: 60_000, netRx: 100, cpu: { idle: 10, total: 20 } }));
  assert.equal(rebooted.netRxBps, null); assert.equal(rebooted.cpuPct, null);
  assert.equal(toSample(raw({ netRx: null }), raw({ time: 60_000, netRx: null })).netRxBps, null); // no network counters on this host
});
test("downsample averages into buckets and leaves gaps as null", () => {
  const pts = [{ ts: 5, v: 10 }, { ts: 6, v: 20 }, { ts: 25, v: 40 }, { ts: 26, v: null }, { ts: 999, v: 1 }];
  const out = downsample(pts, 0, 30, 3);
  assert.deepEqual(out.map((p) => p.v), [15, null, 40]);
  assert.deepEqual(out.map((p) => p.ts), [5, 15, 25]);
  assert.deepEqual(downsample(pts, 10, 10, 3), []);
  assert.equal(downsample(pts, 0, 30, 1)[0].v, (10 + 20 + 40) / 3);
});
test("range parsing falls back to 6h", () => {
  assert.equal(parseRange("24h"), "24h"); assert.equal(parseRange("__proto__"), "6h"); assert.equal(parseRange(undefined), "6h");
});
test("nightly job runs once per UTC day after 02:30", () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(nightlyDue(at("2026-09-21T02:29:00Z"), null), false);
  assert.equal(nightlyDue(at("2026-09-21T02:30:00Z"), null), true);
  assert.equal(nightlyDue(at("2026-09-21T14:00:00Z"), "2026-09-20"), true);
  assert.equal(nightlyDue(at("2026-09-21T14:00:00Z"), "2026-09-21"), false);
  assert.equal(nightlyDue(at("2026-09-22T00:10:00Z"), "2026-09-21"), false); // new day but before 02:30
});
