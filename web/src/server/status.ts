import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";

function probe(host: string, port: number, timeout = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("timeout", () => { s.destroy(); resolve(false); });
    s.once("error", () => resolve(false));
  });
}

export async function getServerStatus() {
  const services = await Promise.all([
    ["SMTP (25)", config.smtpHost, 25], ["Submission (587)", config.smtpHost, 587], ["SMTPS (465)", config.smtpHost, 465],
    ["IMAP (143)", config.imapHost, 143], ["IMAPS (993)", config.imapHost, 993],
    ["Rspamd milter", "rspamd", 11332], ["Redis", "redis", 6379],
  ].map(async ([name, host, port]) => ({ name: name as string, up: await probe(host as string, port as number) })));

  const db = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  services.unshift({ name: "PostgreSQL", up: db });

  const queue = await fs.readFile(path.join(config.mailLogDir, "queue.json"), "utf8").then((t) => JSON.parse(t) as { total: number; active: number; deferred: number; updated: number }).catch(() => null);
  const disk = await fs.statfs(config.vmailDir).then((s) => ({ total: s.blocks * s.bsize, free: s.bavail * s.bsize })).catch(() => null);
  const rspamd = await fetch(`${config.rspamdUrl}/stat`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json() as Promise<{ scanned: number; spam_count: number; ham_count: number; actions: Record<string, number> }>).catch(() => null);
  const [load1] = os.loadavg();
  return { services, queue, disk, rspamd, load1, memTotal: os.totalmem(), memFree: os.freemem(), uptime: os.uptime() };
}
