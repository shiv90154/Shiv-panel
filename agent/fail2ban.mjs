// fail2ban status/ban/unban through `fail2ban-client` (the daemon itself and its jails are configured by files in deploy/fail2ban, not through the panel).
// Jail names and addresses are validated and passed as argv elements (never a shell).
//   env: FAIL2BAN_CMD (default fail2ban-client)
import { execFile } from "node:child_process";
import net from "node:net";

export const JAIL_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

/** Pure. `fail2ban-client status` -> ["sshd", "postfix-sasl"] */
export function parseJailList(text) {
  const m = /Jail list:\s*(.*)$/m.exec(text);
  return m ? m[1].split(/[,\s]+/).map((s) => s.trim()).filter((s) => JAIL_RE.test(s)) : [];
}

/** Pure. `fail2ban-client status <jail>` -> counters + banned addresses. */
export function parseJailStatus(text) {
  const num = (label) => Number(new RegExp(`${label}:\\s*(\\d+)`).exec(text)?.[1] ?? 0);
  const list = /Banned IP list:\s*(.*)$/m.exec(text)?.[1] ?? "";
  return {
    currentlyFailed: num("Currently failed"), totalFailed: num("Total failed"),
    currentlyBanned: num("Currently banned"), totalBanned: num("Total banned"),
    banned: list.split(/\s+/).filter((ip) => net.isIP(ip)),
  };
}

const client = (args) => new Promise((resolve, reject) =>
  execFile(process.env.FAIL2BAN_CMD || "fail2ban-client", args, { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }, (err, so, se) => {
    if (!err) return resolve(String(so));
    if (err.code === "ENOENT") return reject(Object.assign(new Error("fail2ban is not installed on the host"), { notInstalled: true }));
    reject(new Error(`fail2ban-client: ${String(se || so || err.message).trim().slice(0, 300)}`));
  }));

const noParams = (p) => { if (p && Object.keys(p).length) throw new Error("This method takes no params"); return {}; };
function validateBan(p) {
  if (typeof p?.jail !== "string" || !JAIL_RE.test(p.jail)) throw new Error("invalid jail");
  if (typeof p.ip !== "string" || p.ip.length > 45 || p.ip.includes("%") || !net.isIP(p.ip)) throw new Error("invalid ip");
  return { jail: p.jail, ip: p.ip };
}
async function knownJail(jail) {
  if (!parseJailList(await client(["status"])).includes(jail)) throw new Error("unknown jail");
}

export const FAIL2BAN_METHODS = {
  "fail2ban.status": {
    scope: "system", validate: noParams,
    run: async () => {
      try {
        const names = parseJailList(await client(["status"]));
        const jails = await Promise.all(names.map(async (name) => ({ name, ...parseJailStatus(await client(["status", name])) })));
        return { installed: true, jails };
      } catch (e) {
        if (e.notInstalled) return { installed: false, jails: [] };
        throw e;
      }
    },
  },
  "fail2ban.ban": { scope: "system", validate: validateBan, run: async (p) => { await knownJail(p.jail); await client(["set", p.jail, "banip", p.ip]); return {}; } },
  "fail2ban.unban": { scope: "system", validate: validateBan, run: async (p) => { await knownJail(p.jail); await client(["set", p.jail, "unbanip", p.ip]); return {}; } },
};
