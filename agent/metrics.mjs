// Raw host counters for the resource graphs. The agent only reads; the web app samples once a minute and turns the counters into rates.
// Linux: /proc. Anywhere else (dev on macOS) it falls back to `os` for cpu/mem/load and reports no network counters.
import fs from "node:fs";
import os from "node:os";

/** Pure. First line of /proc/stat: cpu user nice system idle iowait irq softirq steal [guest guest_nice] (guest is already inside user). */
export function parseCpu(text) {
  const f = /^cpu\s+(.*)$/m.exec(text)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
  if (!f || f.length < 4 || f.some((n) => !Number.isFinite(n))) return null;
  return { idle: f[3] + (f[4] ?? 0), total: f.reduce((a, b) => a + b, 0) };
}

/** Pure. bytes from /proc/meminfo (kB values). */
export function parseMem(text) {
  const kb = (k) => { const m = new RegExp(`^${k}:\\s+(\\d+) kB`, "m").exec(text); return m ? Number(m[1]) * 1024 : null; };
  const total = kb("MemTotal"), avail = kb("MemAvailable");
  return total && avail !== null ? { total, available: avail } : null;
}

export const parseLoad = (text) => { const l = text.trim().split(/\s+/).slice(0, 3).map(Number); return l.length === 3 && l.every(Number.isFinite) ? l : null; };

// virtual interfaces would double-count (traffic crosses a veth AND the bridge AND the NIC)
const VIRTUAL_IFACE = /^(lo|docker\d*|br-.*|veth.*|virbr.*|cni.*|flannel.*|cali.*|tun\d*|tap\d*)$/;

/** Pure. /proc/net/dev -> summed rx/tx bytes over physical interfaces. */
export function parseNet(text) {
  let rx = 0, tx = 0, n = 0;
  for (const line of text.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || VIRTUAL_IFACE.test(name.trim())) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    if (f.length < 16 || f.some((x) => !Number.isFinite(x))) continue;
    rx += f[0]; tx += f[8]; n++;
  }
  return n ? { rx, tx } : null;
}

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

export function collectMetrics() {
  const cpuText = read("/proc/stat"), memText = read("/proc/meminfo"), loadText = read("/proc/loadavg"), netText = read("/proc/net/dev");
  const cpu = (cpuText && parseCpu(cpuText)) ?? (() => {
    const t = os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, total: 0 });
    return t.total ? t : null;
  })();
  const mem = (memText && parseMem(memText)) ?? { total: os.totalmem(), available: os.freemem() };
  const net = netText ? parseNet(netText) : null;
  const st = fs.statfsSync("/");
  return {
    time: Date.now(), cpu, load: (loadText && parseLoad(loadText)) ?? os.loadavg(),
    memTotal: mem.total, memAvailable: mem.available, diskTotal: st.blocks * st.bsize, diskFree: st.bavail * st.bsize,
    netRx: net?.rx ?? null, netTx: net?.tx ?? null,
  };
}

export const METRIC_METHODS = {
  "system.metrics": {
    scope: "system", validate: (p) => { if (p && Object.keys(p).length) throw new Error("This method takes no params"); return {}; },
    run: async () => collectMetrics(),
  },
};
