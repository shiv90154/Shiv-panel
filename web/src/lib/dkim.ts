import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { prisma } from "./db";

export function generateDkimKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey: publicKey.toString("base64"), privateKey };
}

export const dkimTxtValue = (publicKeyB64: string) => `v=DKIM1; k=rsa; p=${publicKeyB64}`;

async function writeAtomic(file: string, data: string, mode: number) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data, { mode });
  await fs.rename(tmp, file);
}

/** Writes every domain's private key + the selector map that Rspamd reads. Idempotent; safe to call any time. */
export async function syncDkimFiles() {
  await fs.mkdir(config.dkimDir, { recursive: true });
  const domains = await prisma.domain.findMany({ select: { name: true, dkimSelector: true, dkimPrivateKey: true } });
  const wanted = new Set<string>();
  for (const d of domains) {
    const f = `${d.name}.${d.dkimSelector}.key`;
    wanted.add(f);
    await writeAtomic(path.join(config.dkimDir, f), d.dkimPrivateKey, 0o644); // volume is only shared with the rspamd container
  }
  await writeAtomic(path.join(config.dkimDir, "selectors.map"), domains.map((d) => `${d.name} ${d.dkimSelector}`).join("\n") + "\n", 0o644);
  for (const f of await fs.readdir(config.dkimDir)) {
    if (f.endsWith(".key") && !wanted.has(f)) await fs.rm(path.join(config.dkimDir, f), { force: true });
  }
}
