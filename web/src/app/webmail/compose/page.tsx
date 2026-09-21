import Link from "next/link";
import { simpleParser } from "mailparser";
import { requireWebmail } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fetchSource, withImap } from "@/lib/webmail";
import { Flash } from "@/components/ui";
import { sendAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Compose({ searchParams }: { searchParams: Promise<{ reply?: string; forward?: string; folder?: string; all?: string; error?: string; to?: string }> }) {
  const sp = await searchParams;
  const s = await requireWebmail();
  const aliases = await prisma.alias.findMany({ where: { active: true, destinations: { has: s.email }, NOT: { source: { startsWith: "@" } } }, select: { source: true } });
  let to = sp.to ?? "", cc = "", subject = "", body = "", inReplyTo = "";
  const uid = Number(sp.reply || sp.forward);
  if (uid) {
    const src = await withImap(s, (c) => fetchSource(c, sp.folder || "INBOX", uid)).catch(() => null);
    if (src) {
      const p = await simpleParser(src);
      const who = p.from?.text ?? "";
      const quoted = (p.text ?? "").split("\n").map((l) => "> " + l).join("\n");
      if (sp.reply) {
        subject = /^re:/i.test(p.subject ?? "") ? p.subject! : `Re: ${p.subject ?? ""}`;
        to = p.replyTo?.text || who;
        if (sp.all) cc = [p.to, p.cc].flat().map((a) => a?.text).filter(Boolean).join(", ").split(",").map((x) => x.trim()).filter((x) => x && !x.includes(s.email)).join(", ");
        inReplyTo = p.messageId ?? "";
        body = `\n\nOn ${p.date?.toLocaleString() ?? ""}, ${who} wrote:\n${quoted}`;
      } else {
        subject = /^fwd:/i.test(p.subject ?? "") ? p.subject! : `Fwd: ${p.subject ?? ""}`;
        body = `\n\n---------- Forwarded message ----------\nFrom: ${who}\nSubject: ${p.subject ?? ""}\n\n${p.text ?? ""}`;
      }
    }
  }
  return (
    <div className="main" style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1>New message</h1>
      <p className="sub"><Link href="/webmail/mail">← Back to inbox</Link></p>
      <Flash error={sp.error} />
      <form action={sendAction} className="card">
        <input type="hidden" name="inReplyTo" value={inReplyTo} />
        <div style={{ marginBottom: 10 }}><label>From</label>
          <select name="from" defaultValue={s.email}><option>{s.email}</option>{aliases.map((a) => <option key={a.source}>{a.source}</option>)}</select></div>
        <div style={{ marginBottom: 10 }}><label>To</label><input name="to" defaultValue={to} required /></div>
        <div className="row" style={{ marginBottom: 10 }}><div><label>Cc</label><input name="cc" defaultValue={cc} /></div><div><label>Bcc</label><input name="bcc" /></div></div>
        <div style={{ marginBottom: 10 }}><label>Subject</label><input name="subject" defaultValue={subject} /></div>
        <div style={{ marginBottom: 10 }}><label>Message</label><textarea name="body" rows={16} defaultValue={body} autoFocus /></div>
        <div style={{ marginBottom: 14 }}><label>Attachments</label><input type="file" name="files" multiple /></div>
        <button className="primary">Send</button>
      </form>
    </div>
  );
}
