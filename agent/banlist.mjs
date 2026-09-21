// fail2ban ban list: a SEPARATE nft table (`inet mailhost_ban`) with two timeout sets, dropped in the prerouting hook (before Docker's DNAT, so bans also
// cover the mail ports published by containers). It is separate from `inet mailhost` on purpose: applying the firewall replaces that table atomically,
// which would wipe the bans. Used by the fail2ban action (deploy/fail2ban/action.d/mailhost-nft.conf -> `node banlist.mjs ban <ip> <seconds>`).
import net from "node:net";
import { pathToFileURL } from "node:url";
import { nftRun } from "./firewall.mjs";

export const BAN_TABLE = "mailhost_ban";
export const MAX_BAN_SEC = 10 * 365 * 86400;

/** Idempotent structure: add is a no-op when the object exists, and the chain is flushed before its rules are re-added. */
export const ensureScript = () => [
  `add table inet ${BAN_TABLE}`,
  `add set inet ${BAN_TABLE} banned4 { type ipv4_addr; flags timeout; }`,
  `add set inet ${BAN_TABLE} banned6 { type ipv6_addr; flags timeout; }`,
  `add chain inet ${BAN_TABLE} prerouting { type filter hook prerouting priority -300; policy accept; }`,
  `flush chain inet ${BAN_TABLE} prerouting`,
  `add rule inet ${BAN_TABLE} prerouting iifname "lo" accept`,
  `add rule inet ${BAN_TABLE} prerouting iifname "docker0" accept`,
  `add rule inet ${BAN_TABLE} prerouting iifname "br-*" accept`,
  `add rule inet ${BAN_TABLE} prerouting ip saddr @banned4 drop`,
  `add rule inet ${BAN_TABLE} prerouting ip6 saddr @banned6 drop`,
].join("\n");

/** Returns { set, addr } for a single host address; throws on anything else (zone ids, CIDRs, hostnames, injection). */
export function parseHost(ip) {
  if (typeof ip !== "string" || ip.length > 45 || ip.includes("%")) throw new Error("invalid ip");
  const fam = net.isIP(ip);
  if (!fam) throw new Error("invalid ip");
  return { set: fam === 4 ? "banned4" : "banned6", addr: ip.toLowerCase() };
}

export function banScript(ip, seconds) {
  const { set, addr } = parseHost(ip);
  if (!Number.isInteger(seconds) || seconds < -1 || seconds === 0 || seconds > MAX_BAN_SEC) throw new Error("invalid ban time");
  const el = seconds === -1 ? addr : `${addr} timeout ${seconds}s`; // -1 = permanent (fail2ban convention)
  return `${ensureScript()}\nadd element inet ${BAN_TABLE} ${set} { ${el} }\n`;
}

export const unbanScript = (ip) => { const { set, addr } = parseHost(ip); return `delete element inet ${BAN_TABLE} ${set} { ${addr} }\n`; };

export async function runAction(argv) {
  const [cmd, ip, secs] = argv;
  if (cmd === "start") return nftRun(["-f", "-"], ensureScript() + "\n");
  if (cmd === "stop") return nftRun(["delete", "table", "inet", BAN_TABLE]).catch(() => {}); // stopping fail2ban lifts its bans (it re-bans from its own DB on start)
  if (cmd === "ban") return nftRun(["-f", "-"], banScript(ip, Number(secs)));
  if (cmd === "unban") return nftRun(["-f", "-"], unbanScript(ip)).catch(() => {}); // already expired = fine
  throw new Error("usage: banlist.mjs start|stop|ban <ip> <seconds>|unban <ip>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAction(process.argv.slice(2)).catch((e) => { console.error(`[banlist] ${e.message}`); process.exit(1); });
}
