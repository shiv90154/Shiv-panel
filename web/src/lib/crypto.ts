import "server-only";
import crypto from "node:crypto";
import { config } from "./config";

// AES-256-GCM sealing for secrets stored at rest (TOTP secrets) or handed to the browser briefly (recovery codes).
const key = () => crypto.createHash("sha256").update("seal:" + config.sessionSecret).digest();

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
}

export function unseal(sealed: string): string | null {
  try {
    const b = Buffer.from(sealed, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
