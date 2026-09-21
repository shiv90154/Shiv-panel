import crypto from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) - what Google Authenticator, Authy, 1Password etc. implement.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[\s=-]/g, "")) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP);

/** Returns the matched step (so the caller can store it and reject replays), or null. Accepts +-1 step of clock drift. */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepAt(now);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const want = hotp(secretB32, step);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return step;
  }
  return null;
}

export const otpauthUri = (issuer: string, label: string, secretB32: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
