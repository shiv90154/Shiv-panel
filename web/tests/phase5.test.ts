import test from "node:test";
import assert from "node:assert/strict";
import { packageOverruns, type PackageLimits } from "../src/lib/tenancy-core.ts";
import { checkWebhookUrl, isPrivateIp, signPayload } from "../src/lib/webhook-core.ts";

const base: PackageLimits = { diskMb: 0, bandwidthMb: 0, maxDomains: 0, maxSites: 0, maxMailboxes: 0, maxDatabases: 0, maxFtpUsers: 0, maxCronJobs: 0, cpuPercent: 0, ramMb: 0 };

test("package overruns: unlimited parent allows anything", () => assert.deepEqual(packageOverruns({ ...base, maxSites: 99 }, base), []));
test("package overruns: capped parent", () => {
  const parent = { ...base, maxSites: 10, diskMb: 1000 };
  assert.deepEqual(packageOverruns({ ...base, maxSites: 10, diskMb: 500 }, parent), []);
  assert.deepEqual(packageOverruns({ ...base, maxSites: 11, diskMb: 0 }, parent).sort(), ["diskMb", "maxSites"]);
});
test("private ip detection", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1"]) assert.ok(!isPrivateIp(ip), ip);
});
test("webhook url check", () => {
  assert.ok(checkWebhookUrl("https://example.com/hook"));
  for (const u of ["http://example.com", "https://localhost/x", "https://127.0.0.1/x", "https://u:p@example.com", "https://[::1]/x", "nope"]) assert.throws(() => checkWebhookUrl(u), u);
});
test("signature is stable and secret dependent", () => {
  assert.equal(signPayload("s", 1, "{}"), signPayload("s", 1, "{}"));
  assert.notEqual(signPayload("s", 1, "{}"), signPayload("t", 1, "{}"));
});
