import test from "node:test";
import assert from "node:assert/strict";
import { buildContent, recordName, validateRecord, ZONE_RE } from "../dns.mjs";

test("record names stay inside the zone", () => {
  assert.equal(recordName("a.com", "@"), "a.com.");
  assert.equal(recordName("a.com", "www"), "www.a.com.");
  assert.equal(recordName("a.com", "www.a.com."), "www.a.com.");
  assert.equal(recordName("a.com", "*.app"), "*.app.a.com.");
  assert.equal(recordName("a.com", "x.a.com.evil.org"), "x.a.com.evil.org.a.com."); // treated as relative, never escapes
  for (const bad of ["a b", "x/y", "-x", "*.*", "a.*"]) assert.throws(() => recordName("a.com", bad), undefined, bad);
});
test("content builders", () => {
  assert.equal(buildContent("A", { value: "1.2.3.4" }), "1.2.3.4");
  assert.throws(() => buildContent("A", { value: "1.2.3" }));
  assert.throws(() => buildContent("AAAA", { value: "1.2.3.4" }));
  assert.equal(buildContent("MX", { value: "Mail.A.com", priority: 5 }), "5 mail.a.com.");
  assert.equal(buildContent("CNAME", { value: "b.com." }), "b.com.");
  assert.equal(buildContent("TXT", { value: 'v=spf1 "x" \\ -all' }), '"v=spf1 \\"x\\" \\\\ -all"');
  assert.equal(buildContent("TXT", { value: "a".repeat(600) }).split('" "').length, 3);
  assert.throws(() => buildContent("TXT", { value: "a\nb" }));
  assert.equal(buildContent("SRV", { value: "5 5060 sip.a.com", priority: 10 }), "10 5 5060 sip.a.com.");
  assert.equal(buildContent("CAA", { value: "0 issue letsencrypt.org" }), '0 issue "letsencrypt.org"');
  assert.throws(() => buildContent("CAA", { value: "0 bogus x" }));
  assert.throws(() => buildContent("MX", { value: "a.com", priority: 70000 }));
});
test("record validation", () => {
  assert.throws(() => validateRecord({ zone: "a.com", name: "@", type: "CNAME", value: "b.com" }), /apex/);
  assert.throws(() => validateRecord({ zone: "a.com", name: "@", type: "NS", value: "ns.b.com" }), /apex/);
  assert.throws(() => validateRecord({ zone: "a.com", name: "x", type: "A", value: "1.1.1.1", ttl: 5 }), /TTL/);
  assert.throws(() => validateRecord({ zone: "a.com", name: "x", type: "SOA", value: "x" }), /unsupported/);
  assert.equal(validateRecord({ zone: "a.com", name: "x", type: "A", value: "1.1.1.1" }).ttl, 3600);
  for (const bad of ["com", "a..com", "a.com.", "A.com", "-a.com", "a.c0m", "a.com/../x"]) assert.ok(!ZONE_RE.test(bad), bad);
});
