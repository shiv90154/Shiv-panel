import bcrypt from "bcryptjs";

// Dovecot verifies {BLF-CRYPT} hashes ($2y$ prefix) for IMAP and SMTP AUTH.
export async function hashMailboxPassword(pw: string): Promise<string> {
  const h = await bcrypt.hash(pw, 11);
  return "{BLF-CRYPT}" + h.replace(/^\$2[abx]\$/, "$2y$");
}

export async function verifyMailboxPassword(pw: string, stored: string): Promise<boolean> {
  const h = stored.replace(/^\{BLF-CRYPT\}/, "").replace(/^\$2y\$/, "$2b$");
  return bcrypt.compare(pw, h);
}

export const hashAdminPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyAdminPassword = (pw: string, h: string) => bcrypt.compare(pw, h);
