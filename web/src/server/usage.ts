import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";

/** Dovecot's maildir quota backend keeps Maildir/maildirsize: line 1 = limits, then "<bytes> <messages>" deltas. */
async function readMaildirSize(domain: string, local: string) {
  try {
    const txt = await fs.readFile(path.join(config.vmailDir, domain, local, "Maildir", "maildirsize"), "utf8");
    let bytes = 0, count = 0;
    for (const line of txt.split("\n").slice(1)) {
      const m = line.trim().match(/^(-?\d+)\s+(-?\d+)$/);
      if (m) { bytes += Number(m[1]); count += Number(m[2]); }
    }
    return { bytes: Math.max(0, bytes), count: Math.max(0, count) };
  } catch {
    return { bytes: 0, count: 0 };
  }
}

export async function refreshUsage() {
  const boxes = await prisma.mailbox.findMany({ select: { id: true, localPart: true, domain: { select: { name: true } } } });
  for (const b of boxes) {
    const u = await readMaildirSize(b.domain.name, b.localPart);
    await prisma.mailbox.update({ where: { id: b.id }, data: { usedBytes: BigInt(u.bytes), messageCount: u.count, usageUpdatedAt: new Date() } });
  }
}
