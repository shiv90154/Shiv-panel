"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clearAttempts, recordAttempt, tooManyAttempts } from "@/lib/ratelimit";
import { clientIp, createWebmailSession, destroyWebmailSession, requireWebmail } from "@/lib/session";
import { folderBySpecial, listFolders, newImap, sendMail, withImap } from "@/lib/webmail";

const enc = encodeURIComponent;

export async function webmailLogin(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const key = `wm:${await clientIp()}:${email}`;
  if (tooManyAttempts(key)) redirect("/webmail/login?error=" + enc("Too many attempts, try again later"));
  let ok = false;
  try {
    const c = newImap(email, password);
    await c.connect();
    await c.logout();
    ok = true;
  } catch { /* wrong credentials or server down */ }
  if (!ok) { recordAttempt(key); redirect("/webmail/login?error=" + enc("Sign-in failed. Check your address and password.")); }
  clearAttempts(key);
  await prisma.mailbox.updateMany({ where: { email }, data: { lastLoginAt: new Date() } });
  await createWebmailSession(email, password);
  redirect("/webmail/mail");
}

export async function webmailLogout() {
  await destroyWebmailSession();
  redirect("/webmail/login");
}

export async function messageAction(fd: FormData) {
  const s = await requireWebmail();
  const folder = String(fd.get("folder")), uid = Number(fd.get("uid")), op = String(fd.get("op"));
  await withImap(s, async (c) => {
    const folders = await listFolders(c);
    const trash = folderBySpecial(folders, "\\Trash", "Trash");
    const junk = folderBySpecial(folders, "\\Junk", "Junk");
    const inbox = "INBOX";
    const lock = await c.getMailboxLock(folder);
    try {
      const u = String(uid);
      if (op === "delete") folder === trash ? await c.messageDelete(u, { uid: true }) : await c.messageMove(u, trash, { uid: true });
      else if (op === "spam") await c.messageMove(u, junk, { uid: true });
      else if (op === "notspam") await c.messageMove(u, inbox, { uid: true });
      else if (op === "unread") await c.messageFlagsRemove(u, ["\\Seen"], { uid: true });
      else if (op === "star") await c.messageFlagsAdd(u, ["\\Flagged"], { uid: true });
      else if (op === "unstar") await c.messageFlagsRemove(u, ["\\Flagged"], { uid: true });
    } finally { lock.release(); }
  });
  redirect(["delete", "spam", "notspam"].includes(op) ? `/webmail/mail?folder=${enc(folder)}` : `/webmail/mail?folder=${enc(folder)}&uid=${uid}`);
}

export async function sendAction(fd: FormData) {
  const s = await requireWebmail();
  const files = (fd.getAll("files") as File[]).filter((f) => f.size > 0);
  const mailbox = await prisma.mailbox.findUnique({ where: { email: s.email }, select: { displayName: true } });
  const from = String(fd.get("from") || s.email);
  let error = "";
  try {
    const to = String(fd.get("to") ?? "").trim();
    if (!to) throw new Error("Add at least one recipient");
    await sendMail(s, {
      from, fromName: from === s.email ? mailbox?.displayName ?? undefined : undefined,
      to, cc: String(fd.get("cc") ?? ""), bcc: String(fd.get("bcc") ?? ""), subject: String(fd.get("subject") ?? ""), text: String(fd.get("body") ?? ""),
      inReplyTo: String(fd.get("inReplyTo") ?? ""),
      attachments: await Promise.all(files.map(async (f) => ({ filename: f.name, content: Buffer.from(await f.arrayBuffer()), contentType: f.type || "application/octet-stream" }))),
    });
  } catch (e) { error = e instanceof Error ? e.message : "Send failed"; }
  if (error) redirect("/webmail/compose?error=" + enc(error));
  redirect("/webmail/mail?sent=1");
}
