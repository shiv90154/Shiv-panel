// Host firewall (nftables) + the fail2ban ban list. The agent owns ONE table, `inet mailhost`, and replaces it atomically
// (never `flush ruleset`: Docker keeps its own tables). Rules come from the web app as validated data; the ruleset text is built here.
//
//   input      policy DROP; allows established, loopback, docker bridges, ICMP, a fixed base of platform ports (+ SSH_PORT) and the custom open-port rules
//   prerouting priority -300 (before Docker's DNAT): manual IP/CIDR blocks. Because it runs before DNAT it also protects container-published ports (mail).
//
// Port rules only filter services on the host itself (sshd, pdns ...): Docker-published ports are forwarded, not input, so they are protected by the blocks
// and by fail2ban bans, not by "open port" rules. See DECISIONS #23.
//   env: FIREWALL_SSH_PORT (default 22, always open), FIREWALL_STATE (default /etc/mailhost/firewall.nft), NFT_CMD (default nft)
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

export const TABLE = "mailhost";
export const BASE_TCP = [25, 53, 80, 143, 443, 465, 587, 993];
export const BASE_UDP = [53, 443];
export const MAX_OPEN = 200;
export const MAX_BLOCKED = 5000;
const MIN_PREFIX = { 4: 8, 6: 16 }; // a block wider than this is almost certainly a mistake (and a lock-out risk)

export const sshPort = () => {
  const n = Number(process.env.FIREWALL_SSH_PORT ?? 22);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error("FIREWALL_SSH_PORT is invalid");
  return n;
};

/** "1.2.3.4", "1.2.3.0/24", "2001:db8::/32" -> { family, addr, prefix, text } (canonical lower case; a bare address = host route). Throws on anything else. */
export function parseCidr(input, { minPrefix = false } = {}) {
  if (typeof input !== "string" || input.length > 60) throw new Error("invalid address");
  const [addr, pfx, ...rest] = input.toLowerCase().split("/");
  if (rest.length || !addr || addr.includes("%")) throw new Error(`invalid address: ${String(input).slice(0, 60)}`);
  const family = net.isIP(addr);
  if (!family) throw new Error(`invalid address: ${String(input).slice(0, 60)}`);
  const max = family === 4 ? 32 : 128;
  if (pfx !== undefined && !/^\d{1,3}$/.test(pfx)) throw new Error("invalid prefix length");
  const prefix = pfx === undefined ? max : Number(pfx);
  if (prefix > max) throw new Error("invalid prefix length");
  if (minPrefix && prefix < MIN_PREFIX[family]) throw new Error(`refusing a block wider than /${MIN_PREFIX[family]}`);
  return { family, addr, prefix, text: `${addr}/${prefix}` };
}

const port = (v, name) => { if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error(`${name} must be 1-65535`); return v; };

export function validateFirewall(p) {
  if (!p || typeof p !== "object") throw new Error("params required");
  const openPorts = (p.openPorts ?? []).map((r) => {
    if (!r || !["tcp", "udp"].includes(r.proto)) throw new Error("proto must be tcp or udp");
    const from = port(r.from, "port"), to = port(r.to ?? r.from, "port");
    if (to < from) throw new Error("port range is reversed");
    return { proto: r.proto, from, to, source: r.source ? parseCidr(r.source) : null };
  });
  if (openPorts.length > MAX_OPEN) throw new Error(`at most ${MAX_OPEN} open-port rules`);
  const blocked = (p.blocked ?? []).map((b) => parseCidr(b, { minPrefix: true }));
  if (blocked.length > MAX_BLOCKED) throw new Error(`at most ${MAX_BLOCKED} blocked addresses`);
  return { openPorts, blocked };
}

const setDecl = (name, type, els) =>
  [`\tset ${name} {`, `\t\ttype ${type}`, "\t\tflags interval", "\t\tauto-merge", ...(els.length ? [`\t\telements = { ${els.map((e) => e.text).join(", ")} }`] : []), "\t}"];

// Traffic that arrives on a local interface (loopback, Docker bridges) is ours: never blocked, always accepted on input.
const LOCAL_IFACES = ["lo", "docker0", "br-*"].map((i) => `iifname "${i}" accept`);

/** Pure (unit-tested). `cfg` is the output of validateFirewall. */
export function buildRuleset(cfg, ssh = 22) {
  const tcp = [...new Set([ssh, ...BASE_TCP])].sort((a, b) => a - b), udp = [...BASE_UDP];
  const b4 = cfg.blocked.filter((b) => b.family === 4), b6 = cfg.blocked.filter((b) => b.family === 6);
  const custom = cfg.openPorts.map((r) => {
    const dport = r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`;
    const src = r.source ? `${r.source.family === 4 ? "ip" : "ip6"} saddr ${r.source.text} ` : "";
    return `\t\t${src}${r.proto} dport ${dport} accept`;
  });
  return [
    `table inet ${TABLE}`, // makes the delete below succeed on the first run; the pair replaces the table atomically
    `delete table inet ${TABLE}`,
    `table inet ${TABLE} {`,
    ...setDecl("blocked4", "ipv4_addr", b4),
    ...setDecl("blocked6", "ipv6_addr", b6),
    "\tchain prerouting {",
    "\t\ttype filter hook prerouting priority -300; policy accept;",
    ...LOCAL_IFACES.map((l) => `\t\t${l}`),
    "\t\tip saddr @blocked4 drop",
    "\t\tip6 saddr @blocked6 drop",
    "\t}",
    "\tchain input {",
    "\t\ttype filter hook input priority 0; policy drop;",
    "\t\tct state established,related accept",
    "\t\tct state invalid drop",
    ...LOCAL_IFACES.map((l) => `\t\t${l}`),
    "\t\tip protocol icmp accept",
    "\t\tmeta l4proto ipv6-icmp accept", // IPv6 needs ND/RA to work at all
    `\t\ttcp dport { ${tcp.join(", ")} } accept`,
    `\t\tudp dport { ${udp.join(", ")} } accept`,
    ...custom,
    "\t}",
    "}",
    "",
  ].join("\n");
}

// ---------- nft ----------
const nftCmd = () => process.env.NFT_CMD || "nft";
const stateFile = () => process.env.FIREWALL_STATE || "/etc/mailhost/firewall.nft";

const nft = (args, stdin) => new Promise((resolve, reject) => {
  const child = spawn(nftCmd(), args, { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("error", (e) => { clearTimeout(timer); reject(new Error(e.code === "ENOENT" ? "nft is not installed on the host" : `nft: ${e.message}`)); });
  child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`nft failed: ${err.trim().slice(0, 500)}`)); });
  child.stdin.on("error", () => {});
  child.stdin.end(stdin ?? "");
});
export const nftRun = nft;

export async function applyFirewall(cfg) {
  const text = buildRuleset(cfg, sshPort());
  await nft(["-c", "-f", "-"], text); // syntax/semantic check first: a bad ruleset never reaches the kernel
  await nft(["-f", "-"], text); // atomic: the whole file is one transaction
  const f = stateFile();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + ".tmp", text, { mode: 0o600 }); fs.renameSync(f + ".tmp", f);
  } catch (e) { throw new Error(`Firewall is active but could not be saved for reboot: ${e.message}`); }
}

/** Called once at agent start: re-load the last applied ruleset (nftables is not persistent across reboots). */
export async function restoreFirewall() {
  const f = stateFile();
  if (!fs.existsSync(f)) return false;
  await nft(["-f", f]);
  return true;
}

export const FIREWALL_METHODS = {
  "firewall.apply": {
    scope: "system", validate: validateFirewall,
    run: async (cfg) => { await applyFirewall(cfg); return { openPorts: cfg.openPorts.length, blocked: cfg.blocked.length }; },
  },
  "firewall.disable": {
    scope: "system", validate: (p) => { if (p && Object.keys(p).length) throw new Error("This method takes no params"); return {}; },
    run: async () => {
      await nft(["delete", "table", "inet", TABLE]).catch((e) => { if (!/No such file|does not exist/i.test(e.message)) throw e; });
      fs.rmSync(stateFile(), { force: true });
      return {};
    },
  },
  "firewall.status": {
    scope: "system", validate: (p) => { if (p && Object.keys(p).length) throw new Error("This method takes no params"); return {}; },
    run: async () => {
      try { return { installed: true, active: true, ruleset: (await nft(["list", "table", "inet", TABLE])).slice(0, 100_000), sshPort: sshPort() }; }
      catch (e) {
        if (/not installed/.test(e.message)) return { installed: false, active: false, ruleset: "", sshPort: sshPort() };
        return { installed: true, active: false, ruleset: "", sshPort: sshPort() };
      }
    },
  },
};
