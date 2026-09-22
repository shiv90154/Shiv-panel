// Pure helpers for the security & ops pages (no server-only imports: unit-tested with node --test).
// The agent re-validates everything (agent/firewall.mjs); these run first so the admin gets a clean error message.
import net from "node:net";

export const WAF_MODES = ["off", "detect", "block"] as const;
export type WafMode = (typeof WAF_MODES)[number];
export const wafLabel: Record<WafMode, string> = { off: "Off", detect: "Detect only (log, never block)", block: "Block attacks" };

const MIN_BLOCK_PREFIX = { 4: 8, 6: 16 } as const;

export type Cidr = { family: 4 | 6; text: string };

/** "1.2.3.4" | "1.2.3.0/24" | "2001:db8::/32" -> canonical CIDR. `block`: refuse very wide networks (lock-out protection). */
export function parseCidr(input: string, { block = false } = {}): Cidr {
  const raw = input.trim().toLowerCase();
  const [addr, pfx, ...rest] = raw.split("/");
  const family = addr && !addr.includes("%") && !rest.length ? net.isIP(addr) : 0;
  if (family !== 4 && family !== 6) throw new Error("Enter an IPv4/IPv6 address or a network like 203.0.113.0/24");
  const max = family === 4 ? 32 : 128;
  if (pfx !== undefined && !/^\d{1,3}$/.test(pfx)) throw new Error("Invalid prefix length");
  const prefix = pfx === undefined ? max : Number(pfx);
  if (prefix > max) throw new Error("Invalid prefix length");
  if (block && prefix < MIN_BLOCK_PREFIX[family]) throw new Error(`Refusing to block a network wider than /${MIN_BLOCK_PREFIX[family]}`);
  return { family, text: `${addr}/${prefix}` };
}

/** "80" or "8000-8100" -> { from, to } */
export function parsePortSpec(input: string): { from: number; to: number } {
  const m = /^\s*(\d{1,5})(?:\s*-\s*(\d{1,5}))?\s*$/.exec(input);
  if (!m) throw new Error("Port must be a number (80) or a range (8000-8100)");
  const from = Number(m[1]), to = m[2] === undefined ? from : Number(m[2]);
  if (from < 1 || to > 65535) throw new Error("Ports are 1-65535");
  if (to < from) throw new Error("The port range is reversed");
  return { from, to };
}

/** Does `cidr` contain `ip`? (Used to refuse a block that would cut off the admin's own connection.) */
export function cidrContains(cidr: string, ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]; // IPv4 clients often show up as ::ffff:a.b.c.d
  const addr = mapped ?? ip;
  const fam = net.isIP(addr);
  const [base, pfx] = cidr.split("/");
  const bf = net.isIP(base);
  if (!fam || !bf || fam !== bf) return false;
  const list = new net.BlockList();
  list.addSubnet(base, Number(pfx), bf === 4 ? "ipv4" : "ipv6");
  return list.check(addr, fam === 4 ? "ipv4" : "ipv6");
}

// ---------- resource graphs ----------
export type RawMetrics = {
  time: number; cpu: { idle: number; total: number } | null; load: number[]; memTotal: number; memAvailable: number;
  diskTotal: number; diskFree: number; netRx: number | null; netTx: number | null;
};
export type Sample = { cpuPct: number | null; load1: number | null; memPct: number | null; diskPct: number | null; netRxBps: number | null; netTxBps: number | null };

const pct = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;

/** Counters -> a sample. `prev` = the previous raw reading (null on the first one). Counter resets (reboot) yield null rates instead of garbage. */
export function toSample(prev: RawMetrics | null, cur: RawMetrics): Sample {
  const dt = prev ? (cur.time - prev.time) / 1000 : 0;
  let cpuPct: number | null = null;
  if (prev?.cpu && cur.cpu) {
    const dTotal = cur.cpu.total - prev.cpu.total, dIdle = cur.cpu.idle - prev.cpu.idle;
    if (dTotal > 0 && dIdle >= 0 && dIdle <= dTotal) cpuPct = pct((1 - dIdle / dTotal) * 100);
  }
  const rate = (a: number | null | undefined, b: number | null) => (dt > 0 && a != null && b != null && b >= a ? Math.round((b - a) / dt) : null);
  return {
    cpuPct, load1: cur.load[0] ?? null,
    memPct: cur.memTotal > 0 ? pct(((cur.memTotal - cur.memAvailable) / cur.memTotal) * 100) : null,
    diskPct: cur.diskTotal > 0 ? pct(((cur.diskTotal - cur.diskFree) / cur.diskTotal) * 100) : null,
    netRxBps: rate(prev?.netRx, cur.netRx), netTxBps: rate(prev?.netTx, cur.netTx),
  };
}

export type Point = { ts: number; v: number | null };

/** Average points into at most `buckets` equal time slots between `from` and `to` (ms). Empty slots stay null (a gap, not a zero). */
export function downsample(points: Point[], from: number, to: number, buckets: number): Point[] {
  if (to <= from || buckets < 1) return [];
  const width = (to - from) / buckets;
  const sum = new Array<number>(buckets).fill(0), n = new Array<number>(buckets).fill(0);
  for (const p of points) {
    if (p.v === null || p.ts < from || p.ts > to) continue;
    const i = Math.min(buckets - 1, Math.floor((p.ts - from) / width));
    sum[i] += p.v; n[i]++;
  }
  return sum.map((s, i) => ({ ts: Math.round(from + (i + 0.5) * width), v: n[i] ? s / n[i] : null }));
}

export const RANGES = { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 24 * 3600_000, "7d": 7 * 86400_000 } as const;
export type RangeKey = keyof typeof RANGES;
export const parseRange = (v: unknown): RangeKey => (typeof v === "string" && Object.hasOwn(RANGES, v) ? (v as RangeKey) : "6h");

// ---------- nightly job ----------
/** Should the nightly job start now? `lastDay` = the UTC day (YYYY-MM-DD) it last started. Runs once per day, after hh:mm UTC. */
export function nightlyDue(now: Date, lastDay: string | null, hour = 2, minute = 30): boolean {
  const today = now.toISOString().slice(0, 10);
  if (lastDay === today) return false;
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= hour * 60 + minute;
}
