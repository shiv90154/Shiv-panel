import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { config } from "./config";
import type { WebmailSession } from "./session";

// Traffic to the mail container stays on the private docker network; the cert is issued for the public hostname.
const tls = { servername: config.mailHostname, rejectUnauthorized: false };

export function newImap(user: string, pass: string) {
  return new ImapFlow({ host: config.imapHost, port: 993, secure: true, auth: { user, pass }, tls, logger: false });
}

export async function withImap<T>(s: WebmailSession, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = newImap(s.email, s.password);
  await c.connect();
  try { return await fn(c); } finally { await c.logout().catch(() => {}); }
}

export type Folder = { path: string; name: string; specialUse?: string; unseen: number };
const ORDER = ["\\Inbox", "\\Drafts", "\\Sent", "\\Archive", "\\Junk", "\\Trash"];

export async function listFolders(c: ImapFlow): Promise<Folder[]> {
  const list = await c.list();
  const out: Folder[] = [];
  for (const f of list) {
    if (f.flags?.has("\\Noselect")) continue;
    const st = await c.status(f.path, { unseen: true }).catch(() => null);
    out.push({ path: f.path, name: f.path.toUpperCase() === "INBOX" ? "Inbox" : f.name, specialUse: f.path.toUpperCase() === "INBOX" ? "\\Inbox" : f.specialUse, unseen: st?.unseen ?? 0 });
  }
  const rank = (f: Folder) => { const i = ORDER.indexOf(f.specialUse ?? ""); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export const folderBySpecial = (folders: Folder[], use: string, fallback: string) => folders.find((f) => f.specialUse === use)?.path ?? fallback;

export type MessageRow = { uid: number; from: string; subject: string; date: Date; seen: boolean; flagged: boolean };
const PAGE_SIZE = 40;

export async function listMessages(c: ImapFlow, folder: string, page: number, q?: string) {
  const lock = await c.getMailboxLock(folder);
  try {
    const rows: MessageRow[] = [];
    let total = (c.mailbox as { exists: number }).exists;
    let range: string | number[] | null = null;
    if (q) {
      const uids = (await c.search({ or: [{ subject: q }, { from: q }, { body: q }] }, { uid: true })) || [];
      total = uids.length;
      range = uids.slice().reverse().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).join(",");
    } else if (total > 0) {
      const end = total - (page - 1) * PAGE_SIZE;
      if (end >= 1) range = `${Math.max(1, end - PAGE_SIZE + 1)}:${end}`;
    }
    if (range) {
      for await (const m of c.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: !!q })) {
        const f = m.envelope?.from?.[0];
        rows.push({
          uid: m.uid, from: f ? f.name || f.address || "" : "(unknown)", subject: m.envelope?.subject || "(no subject)",
          date: new Date(m.envelope?.date ?? m.internalDate ?? Date.now()), seen: !!m.flags?.has("\\Seen"), flagged: !!m.flags?.has("\\Flagged"),
        });
      }
    }
    rows.sort((a, b) => b.uid - a.uid);
    return { rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  } finally { lock.release(); }
}

export async function fetchSource(c: ImapFlow, folder: string, uid: number, markSeen = false) {
  const lock = await c.getMailboxLock(folder);
  try {
    const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) return null;
    if (markSeen) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    return msg.source;
  } finally { lock.release(); }
}

const addr = (a?: { text?: string } | { text?: string }[]) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : a?.text ?? "");

export async function readMessage(c: ImapFlow, folder: string, uid: number, showImages: boolean) {
  const source = await fetchSource(c, folder, uid, true);
  if (!source) return null;
  const p = await simpleParser(source);
  let html: string | null = null;
  let blocked = false;
  if (p.html) {
    const cids = new Map(p.attachments.filter((a) => a.contentId && a.size < 2_000_000).map((a) => [a.contentId!.replace(/[<>]/g, ""), `data:${a.contentType};base64,${a.content.toString("base64")}`]));
    html = sanitizeHtml(p.html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "font", "center"]),
      allowedAttributes: { "*": ["style", "align", "width", "height", "bgcolor", "color", "colspan", "rowspan"], a: ["href", "name", "target", "rel"], img: ["src", "alt", "width", "height"] },
      allowedSchemes: ["http", "https", "mailto", "tel", "data"],
      allowedSchemesByTag: { img: ["http", "https", "data"] },
      transformTags: {
        a: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
        img: (tag, attribs) => {
          const src = attribs.src ?? "";
          if (src.startsWith("cid:")) return { tagName: tag, attribs: { ...attribs, src: cids.get(src.slice(4)) ?? "" } };
          if (/^https?:/i.test(src) && !showImages) { blocked = true; return { tagName: tag, attribs: { alt: attribs.alt ?? "", width: attribs.width ?? "" } }; }
          return { tagName: tag, attribs };
        },
      },
    });
  }
  return {
    subject: p.subject || "(no subject)", from: addr(p.from), to: addr(p.to), cc: addr(p.cc), replyTo: p.replyTo?.value?.[0]?.address ?? p.from?.value?.[0]?.address ?? "",
    date: p.date ?? null, messageId: p.messageId ?? "", html, blockedImages: blocked, text: p.text ?? "",
    attachments: p.attachments.map((a, i) => ({ index: i, filename: a.filename || `attachment-${i + 1}`, size: a.size, type: a.contentType })),
  };
}

export async function getAttachment(c: ImapFlow, folder: string, uid: number, index: number) {
  const source = await fetchSource(c, folder, uid);
  if (!source) return null;
  return (await simpleParser(source)).attachments[index] ?? null;
}

export async function sendMail(s: WebmailSession, msg: { from: string; fromName?: string; to: string; cc?: string; bcc?: string; subject: string; text: string; inReplyTo?: string; attachments: { filename: string; content: Buffer; contentType: string }[] }) {
  const mail = {
    from: msg.fromName ? { name: msg.fromName, address: msg.from } : msg.from,
    to: msg.to, cc: msg.cc || undefined, bcc: msg.bcc || undefined, subject: msg.subject, text: msg.text,
    inReplyTo: msg.inReplyTo || undefined, references: msg.inReplyTo || undefined, attachments: msg.attachments,
  };
  const raw = await new MailComposer(mail).compile().build();
  const recipients = [msg.to, msg.cc, msg.bcc].filter(Boolean).join(",").split(/[,;]/).map((x) => x.trim().replace(/^.*<(.+)>$/, "$1")).filter(Boolean);
  const transport = nodemailer.createTransport({ host: config.smtpHost, port: 587, secure: false, requireTLS: true, tls, auth: { user: s.email, pass: s.password } });
  await transport.sendMail({ envelope: { from: msg.from, to: recipients }, raw });
  // Keep a copy in Sent
  await withImap(s, async (c) => {
    const sent = folderBySpecial(await listFolders(c), "\\Sent", "Sent");
    await c.append(sent, raw, ["\\Seen"]);
  }).catch((e) => console.error("[webmail] could not save to Sent:", e));
}
