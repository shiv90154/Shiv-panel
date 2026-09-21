// Authoritative DNS via the PowerDNS HTTP API (pdns_server with the gpgsql backend, installed on the HOST).
// Records live only in PowerDNS; the panel keeps just the zone ownership row. Env:
//   PDNS_API_URL  default http://127.0.0.1:8081     PDNS_API_KEY  (required)     PDNS_NS  comma list of nameserver hostnames
// Every value is validated here (agent = trust boundary for record syntax); zone ownership is checked by the web tier.
import net from "node:net";

export const TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA", "NS"];
const LABEL = "[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?";
export const ZONE_RE = new RegExp(`^(${LABEL}\\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$`); // at least 2 labels, alphabetic (or punycode) TLD
const HOST_RE = new RegExp(`^(${LABEL}\\.)*${LABEL}$`);
const CAA_TAGS = ["issue", "issuewild", "iodef"];

const fqdn = (s) => (s.endsWith(".") ? s : `${s}.`);
const int = (v, min, max, what) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be ${min}-${max}`); return n; };
const host = (v, what) => {
  const h = String(v ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!h || h.length > 253 || !HOST_RE.test(h)) throw new Error(`${what} must be a hostname`);
  return `${h}.`;
};

/** "@" / relative label / FQDN inside the zone -> absolute name with trailing dot. Rejects anything outside the zone. */
export function recordName(zone, input) {
  const raw = String(input ?? "").trim().toLowerCase().replace(/\.$/, "");
  const full = raw === "" || raw === "@" ? zone : raw === zone || raw.endsWith(`.${zone}`) ? raw : `${raw}.${zone}`;
  const rel = full === zone ? "" : full.slice(0, -zone.length - 1);
  if (full.length > 253) throw new Error("name too long");
  for (const [i, l] of (rel ? rel.split(".") : []).entries()) if (!(new RegExp(`^${LABEL}$`).test(l) || (l === "*" && i === 0))) throw new Error(`invalid label "${l}"`);
  return `${full}.`;
}

/** Pure: user-facing fields -> PowerDNS record content string. */
export function buildContent(type, { value, priority }) {
  const v = String(value ?? "").trim();
  switch (type) {
    case "A": if (!net.isIPv4(v)) throw new Error("A needs an IPv4 address"); return v;
    case "AAAA": if (!net.isIPv6(v)) throw new Error("AAAA needs an IPv6 address"); return v;
    case "CNAME": case "NS": return host(v, type);
    case "MX": return `${int(priority ?? 10, 0, 65535, "priority")} ${host(v, "MX target")}`;
    case "TXT": {
      if (!v || v.length > 4000 || /[\u0000-\u001f\u007f]/.test(v)) throw new Error("TXT must be 1-4000 printable characters");
      const q = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return (q.match(/(?:\\.|[^\\]){1,250}/g) ?? [q]).map((c) => `"${c}"`).join(" "); // 255-byte strings, escapes kept whole
    }
    case "SRV": {
      const m = v.split(/\s+/); if (m.length !== 3) throw new Error("SRV value is: weight port target");
      return `${int(priority ?? 0, 0, 65535, "priority")} ${int(m[0], 0, 65535, "weight")} ${int(m[1], 0, 65535, "port")} ${m[2] === "." ? "." : host(m[2], "SRV target")}`;
    }
    case "CAA": {
      const m = v.match(/^(\d{1,3})\s+(\S+)\s+"?([^"\s]{1,255})"?$/); if (!m) throw new Error('CAA value is: flags tag value, e.g. 0 issue letsencrypt.org');
      if (!CAA_TAGS.includes(m[2].toLowerCase())) throw new Error("CAA tag must be issue, issuewild or iodef");
      return `${int(m[1], 0, 255, "flags")} ${m[2].toLowerCase()} "${m[3]}"`;
    }
    default: throw new Error("unsupported record type");
  }
}

export function validateRecord(p, { needContent = true } = {}) {
  if (typeof p?.zone !== "string" || !ZONE_RE.test(p.zone)) throw new Error("invalid zone");
  if (!TYPES.includes(p.type)) throw new Error("unsupported record type");
  const name = recordName(p.zone, p.name);
  if (name === fqdn(p.zone) && p.type === "CNAME") throw new Error("CNAME is not allowed at the zone apex");
  const out = { zone: p.zone, name, type: p.type };
  if (needContent) { out.content = buildContent(p.type, p); out.ttl = int(p.ttl ?? 3600, 60, 86400, "TTL"); }
  else out.content = String(p.content ?? ""); // delete: exact PowerDNS content of the existing record, compared not executed
  if (name === fqdn(p.zone) && p.type === "NS") throw new Error("apex NS records are managed by the server");
  return out;
}

const api = async (path, method = "GET", body) => {
  if (!process.env.PDNS_API_KEY) throw new Error("PDNS_API_KEY is not set on the agent");
  const res = await fetch(`${process.env.PDNS_API_URL || "http://127.0.0.1:8081"}/api/v1/servers/localhost${path}`, {
    method, headers: { "X-API-Key": process.env.PDNS_API_KEY, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  }).catch((e) => { throw new Error(`PowerDNS unreachable: ${e.message}`); });
  const text = await res.text();
  if (!res.ok) throw new Error(`PowerDNS ${res.status}: ${(() => { try { return JSON.parse(text).error; } catch { return text; } })()?.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};
const zid = (z) => encodeURIComponent(fqdn(z));

const getRrset = async (zone, name, type) => (await api(`/zones/${zid(zone)}?rrsets=true&rrset_name=${encodeURIComponent(name)}&rrset_type=${type}`)).rrsets?.find((r) => r.name === name && r.type === type);
const patch = (zone, rrsets) => api(`/zones/${zid(zone)}`, "PATCH", { rrsets });

async function addRecord(r) {
  const cur = await getRrset(r.zone, r.name, r.type);
  if (r.type === "CNAME" && cur) throw new Error("a CNAME already exists at this name; delete it first"); // other conflicts: PowerDNS answers 422
  const contents = new Set((cur?.records ?? []).map((x) => x.content)); contents.add(r.content);
  if (r.type === "CNAME" && contents.size > 1) throw new Error("only one CNAME per name");
  await patch(r.zone, [{ name: r.name, type: r.type, ttl: r.ttl, changetype: "REPLACE", records: [...contents].map((content) => ({ content, disabled: false })) }]);
}

async function deleteRecord(r) {
  if (r.type === "SOA") throw new Error("SOA cannot be deleted");
  const cur = await getRrset(r.zone, r.name, r.type);
  const left = (cur?.records ?? []).filter((x) => x.content !== r.content);
  if (!cur || left.length === cur.records.length) throw new Error("record not found");
  await patch(r.zone, [left.length
    ? { name: r.name, type: r.type, ttl: cur.ttl, changetype: "REPLACE", records: left.map((x) => ({ content: x.content, disabled: false })) }
    : { name: r.name, type: r.type, changetype: "DELETE" }]);
}

const zoneOnly = (p) => { if (typeof p?.zone !== "string" || !ZONE_RE.test(p.zone)) throw new Error("invalid zone"); return { zone: p.zone }; };
const nsList = () => (process.env.PDNS_NS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).map(fqdn);

export const DNS_METHODS = {
  // params: { zone, records: [{name,type,value,priority?,ttl?}] } (initial template; each validated like a single add)
  "dns.zoneCreate": {
    scope: "account",
    validate: (p) => {
      const { zone } = zoneOnly(p);
      if (!Array.isArray(p.records) || p.records.length > 50) throw new Error("records must be an array (max 50)");
      return { zone, records: p.records.map((r) => validateRecord({ ...r, zone })) };
    },
    run: async ({ zone, records }) => {
      const ns = nsList(); if (!ns.length) throw new Error("PDNS_NS is not set on the agent (comma-separated nameserver hostnames)");
      await api("/zones", "POST", { name: fqdn(zone), kind: "Native", nameservers: ns });
      try {
        const grouped = new Map();
        for (const r of records) {
          const g = grouped.get(`${r.name}|${r.type}`) ?? { name: r.name, type: r.type, ttl: r.ttl, changetype: "REPLACE", records: [] };
          g.records.push({ content: r.content, disabled: false }); grouped.set(`${r.name}|${r.type}`, g);
        }
        if (grouped.size) await patch(zone, [...grouped.values()]);
      } catch (e) { await api(`/zones/${zid(zone)}`, "DELETE").catch(() => {}); throw e; }
      return {};
    },
  },
  "dns.zoneDelete": { scope: "account", validate: zoneOnly, run: async ({ zone }) => { await api(`/zones/${zid(zone)}`, "DELETE"); return {}; } },
  "dns.zoneGet": {
    scope: "account", validate: zoneOnly,
    run: async ({ zone }) => {
      const z = await api(`/zones/${zid(zone)}`);
      const records = (z.rrsets ?? []).flatMap((s) => s.records.map((r) => ({ name: s.name, type: s.type, ttl: s.ttl, content: r.content })));
      const keys = await api(`/zones/${zid(zone)}/cryptokeys`).catch(() => []);
      return { records, dnssec: { enabled: keys.some((k) => k.active), ds: keys.flatMap((k) => k.ds ?? []) } };
    },
  },
  "dns.recordAdd": { scope: "account", validate: (p) => validateRecord(p), run: async (r) => { await addRecord(r); return {}; } },
  "dns.recordDelete": { scope: "account", validate: (p) => validateRecord(p, { needContent: false }), run: async (r) => { await deleteRecord(r); return {}; } },
  "dns.dnssec": {
    scope: "account",
    validate: (p) => ({ ...zoneOnly(p), enable: p.enable === true }),
    run: async ({ zone, enable }) => {
      const keys = await api(`/zones/${zid(zone)}/cryptokeys`);
      if (enable) { if (!keys.length) await api(`/zones/${zid(zone)}/cryptokeys`, "POST", { keytype: "csk", active: true, published: true, algorithm: "ecdsap256sha256" }); }
      else for (const k of keys) await api(`/zones/${zid(zone)}/cryptokeys/${k.id}`, "DELETE");
      return {};
    },
  },
};
