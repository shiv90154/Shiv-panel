// Pure 5-field cron (minute hour day-of-month month day-of-week), evaluated in UTC. No dependencies, no server-only (unit-tested).
// Supports: * , lists (1,5), ranges (1-5), steps (*/15, 10-30/5), month/day names are NOT supported (numbers only), plus @hourly @daily @weekly @monthly.
// Day-of-month and day-of-week follow the classic rule: when both are restricted, either one matching is enough.
export type CronFields = { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean };

const ALIASES: Record<string, string> = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *" };
const RANGES: [string, number, number][] = [["minute", 0, 59], ["hour", 0, 23], ["day of month", 1, 31], ["month", 1, 12], ["day of week", 0, 7]];

function parseField(src: string, name: string, lo: number, hi: number): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid ${name} field: "${src}"`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`Invalid step in ${name} field`);
    let from = lo, to = hi;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-");
      from = Number(a); to = b === undefined ? (m[2] === undefined ? from : hi) : Number(b);
    }
    if (from < lo || to > hi || from > to) throw new Error(`${name} must be ${lo}-${hi}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const norm = ALIASES[expr.trim()] ?? expr.trim();
  const parts = norm.split(/\s+/);
  if (parts.length !== 5) throw new Error("Schedule needs 5 fields: minute hour day-of-month month day-of-week");
  const sets = parts.map((p, i) => parseField(p, RANGES[i][0], RANGES[i][1], RANGES[i][2]));
  const dow = new Set([...sets[4]].map((d) => d % 7)); // 7 = Sunday too
  return { min: sets[0], hour: sets[1], dom: sets[2], mon: sets[3], dow, domStar: parts[2].startsWith("*"), dowStar: parts[4].startsWith("*") };
}

export function cronMatches(f: CronFields, d: Date): boolean {
  if (!f.min.has(d.getUTCMinutes()) || !f.hour.has(d.getUTCHours()) || !f.mon.has(d.getUTCMonth() + 1)) return false;
  const dom = f.dom.has(d.getUTCDate()), dow = f.dow.has(d.getUTCDay());
  return f.domStar && f.dowStar ? true : f.domStar ? dow : f.dowStar ? dom : dom || dow;
}

/** Smallest gap in minutes between two runs, sampled over one week (used to refuse "every minute" jobs). */
export function minIntervalMinutes(f: CronFields): number {
  let prev = -1, best = Infinity;
  const t0 = Date.UTC(2024, 0, 1); // a Monday; a week covers every dow/hour/minute combination (dom/month restrictions only make gaps larger)
  for (let i = 0; i < 7 * 24 * 60; i++) {
    if (cronMatches(f, new Date(t0 + i * 60_000))) { if (prev >= 0) best = Math.min(best, i - prev); prev = i; }
  }
  return best === Infinity ? 7 * 24 * 60 : best;
}
