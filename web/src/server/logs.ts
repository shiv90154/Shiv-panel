import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";

type Row = { time: Date; queueId: string | null; direction: string; sender: string | null; recipient: string | null; status: string; relay: string | null; delay: number | null; dsn: string | null; message: string | null };

const LINE = /^([A-Z][a-z]{2} +\d+ \d\d:\d\d:\d\d|\d{4}-\d\d-\d\dT\S+) \S+ postfix\/([\w\/-]+)\[\d+\]: (.*)$/;
const senders = new Map<string, string>();

/** Postfix logs "Sep 21 07:24:00" (UTC in the container, no year) or ISO timestamps. */
function parseTime(ts: string): Date | null {
  if (ts.includes("T")) { const d = new Date(ts); return isNaN(d.getTime()) ? null : d; }
  const now = new Date();
  const d = new Date(`${ts} ${now.getUTCFullYear()} UTC`);
  if (isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime() + 864e5) d.setUTCFullYear(d.getUTCFullYear() - 1); // Dec log read in Jan
  return d;
}

export function parseLine(line: string): Row | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const [, ts, fullSvc, rest] = m;
  const svc = fullSvc.split("/").pop()!; // e.g. "submission/smtpd" -> "smtpd"
  const time = parseTime(ts);
  if (!time) return null;

  const q = /^([0-9A-F]{6,}|[0-9A-Za-z]{10,}): (.*)$/.exec(rest);
  if (q && svc === "qmgr") {
    const f = /from=<([^>]*)>/.exec(q[2]);
    if (f) { if (senders.size > 20000) senders.clear(); senders.set(q[1], f[1]); }
    return null;
  }
  if (q && (svc === "smtp" || svc === "lmtp")) {
    const to = /to=<([^>]*)>/.exec(q[2]);
    const st = /status=(\w+) \((.*)\)\s*$/.exec(q[2]);
    if (!to || !st) return null;
    const status = st[1] === "sent" ? "sent" : st[1] === "deferred" ? "deferred" : "bounced";
    return {
      time, queueId: q[1], direction: svc === "lmtp" ? "inbound" : "outbound",
      sender: senders.get(q[1]) ?? null, recipient: to[1],
      status, relay: /relay=([^,]+)/.exec(q[2])?.[1] ?? null,
      delay: Number(/delay=([\d.]+)/.exec(q[2])?.[1]) || null, dsn: /dsn=([\d.]+)/.exec(q[2])?.[1] ?? null,
      message: st[2].slice(0, 500),
    };
  }
  if (rest.startsWith("NOQUEUE: reject:")) {
    const r = /reject: \w+ from (\S+): (.*)$/.exec(rest);
    return {
      time, queueId: null, direction: "rejected", sender: /from=<([^>]*)>/.exec(rest)?.[1] ?? null,
      recipient: /to=<([^>]*)>/.exec(rest)?.[1] ?? null, status: "rejected",
      relay: r?.[1] ?? null, delay: null, dsn: /^\d{3} (\d\.\d\.\d+)/.exec(r?.[2] ?? "")?.[1] ?? null, message: (r?.[2] ?? rest).slice(0, 500),
    };
  }
  const auth = /warning: ([^:]+): SASL (\w+) authentication failed/.exec(rest);
  if (auth) return { time, queueId: null, direction: "auth", sender: null, recipient: null, status: "auth_failed", relay: auth[1], delay: null, dsn: null, message: `SASL ${auth[2]} authentication failed` };
  return null;
}

async function getSetting(key: string) { return (await prisma.setting.findUnique({ where: { key } }))?.value; }
const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

async function readFrom(file: string, offset: number, max = 8 * 1024 * 1024) {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size - offset, max);
    if (len <= 0) return { text: "", consumed: 0 };
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, offset);
    const end = buf.lastIndexOf(10); // only whole lines
    if (end < 0) return { text: "", consumed: 0 };
    return { text: buf.subarray(0, end + 1).toString("utf8"), consumed: end + 1 };
  } finally { await fh.close(); }
}

let running = false;
/** Tails the Postfix log file (shared volume) into the mail_logs table. Keeps its offset across restarts and log rotation. */
export async function ingestLogs() {
  if (running) return;
  running = true;
  try {
    const file = path.join(config.mailLogDir, "mail.log");
    const st = await fs.stat(file).catch(() => null);
    if (!st) return;
    let offset = Number((await getSetting("log.offset")) ?? 0);
    const savedInode = Number((await getSetting("log.inode")) ?? 0);
    const rows: Row[] = [];
    const collect = (text: string) => { for (const l of text.split("\n")) { const r = parseLine(l); if (r) rows.push(r); } };

    if (savedInode && savedInode !== st.ino) {
      // rotated: finish the old file (mail.log.1), then start over on the new one
      const old = await fs.stat(file + ".1").catch(() => null);
      if (old && old.ino === savedInode) { const { text } = await readFrom(file + ".1", offset); collect(text); }
      offset = 0;
    } else if (st.size < offset) offset = 0;

    let consumedTotal = 0;
    for (let i = 0; i < 20; i++) {
      const { text, consumed } = await readFrom(file, offset + consumedTotal);
      if (!consumed) break;
      collect(text); consumedTotal += consumed;
    }
    if (rows.length) await prisma.mailLog.createMany({ data: rows });
    await setSetting("log.offset", String(offset + consumedTotal));
    await setSetting("log.inode", String(st.ino));
  } finally { running = false; }
}

export const pruneLogs = (days = 30) => prisma.mailLog.deleteMany({ where: { time: { lt: new Date(Date.now() - days * 864e5) } } });
