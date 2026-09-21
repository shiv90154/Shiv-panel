import Link from "next/link";
import { requireWebmail } from "@/lib/session";
import { listFolders, listMessages, readMessage, withImap } from "@/lib/webmail";
import { bytes } from "@/components/ui";
import { messageAction, webmailLogout } from "../actions";

export const dynamic = "force-dynamic";

type SP = { folder?: string; uid?: string; page?: string; q?: string; images?: string; sent?: string };

export default async function Mail({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await requireWebmail();
  const folder = sp.folder || "INBOX";
  const page = Math.max(1, Number(sp.page) || 1);
  const uid = Number(sp.uid) || 0;
  let data;
  try {
    data = await withImap(s, async (c) => ({
      folders: await listFolders(c),
      list: await listMessages(c, folder, page, sp.q),
      msg: uid ? await readMessage(c, folder, uid, sp.images === "1") : null,
    }));
  } catch (e) {
    return <div className="center"><div className="card login"><h2>Cannot reach mail server</h2><p className="muted">{e instanceof Error ? e.message : "Error"}</p><Link className="btn" href="/webmail/login">Sign in again</Link></div></div>;
  }
  const { folders, list, msg } = data;
  const cur = folders.find((f) => f.path === folder);
  const link = (extra: Partial<SP>) => `/webmail/mail?${new URLSearchParams(Object.entries({ folder, ...(sp.q && { q: sp.q }), ...(page > 1 && { page: String(page) }), ...extra }).filter(([, v]) => v) as [string, string][])}`;
  const isJunk = cur?.specialUse === "\\Junk";
  const Op = ({ op, label }: { op: string; label: string }) => (
    <form action={messageAction}><input type="hidden" name="folder" value={folder} /><input type="hidden" name="uid" value={uid} /><input type="hidden" name="op" value={op} /><button className="sm">{label}</button></form>
  );
  return (
    <div className="wm">
      <div className="folders">
        <Link className="btn primary" style={{ width: "100%", textAlign: "center", marginBottom: 12 }} href="/webmail/compose">Compose</Link>
        {folders.map((f) => (
          <Link key={f.path} href={`/webmail/mail?folder=${encodeURIComponent(f.path)}`} className={f.path === folder ? "cur" : ""}>
            <span>{f.name}</span>{f.unseen > 0 && <span className="badge ok">{f.unseen}</span>}
          </Link>
        ))}
        <div className="muted" style={{ padding: "14px 10px 4px", wordBreak: "break-all" }}>{s.email}</div>
        <form action={webmailLogout} style={{ padding: "0 10px" }}><button className="sm">Sign out</button></form>
      </div>
      <div>
        <form style={{ padding: 10, borderBottom: "1px solid var(--line)" }}>
          <input type="hidden" name="folder" value={folder} />
          <input name="q" placeholder={`Search ${cur?.name ?? "mail"}`} defaultValue={sp.q} />
        </form>
        {sp.sent && <div className="flash ok" style={{ margin: 10 }}>Message sent</div>}
        {list.rows.map((m) => (
          <Link key={m.uid} href={link({ uid: String(m.uid), images: undefined })} className={`msg ${m.seen ? "" : "unseen"} ${m.uid === uid ? "cur" : ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{m.flagged && "★ "}{m.from}</b><span className="muted" style={{ whiteSpace: "nowrap" }}>{m.date.toLocaleDateString()}</span></div>
            <div className="s">{m.subject}</div>
          </Link>
        ))}
        {!list.rows.length && <p className="muted" style={{ padding: 16 }}>No messages.</p>}
        <div className="actions" style={{ padding: 10 }}>
          {page > 1 && <Link className="btn sm" href={link({ page: String(page - 1), uid: undefined })}>← Newer</Link>}
          {page < list.pages && <Link className="btn sm" href={link({ page: String(page + 1), uid: undefined })}>Older →</Link>}
          <span className="muted">{list.total} messages</span>
        </div>
      </div>
      <div className="view">
        {!msg ? <p className="muted">{uid ? "Message not found." : "Select a message to read it."}</p> : (
          <>
            <div className="actions" style={{ marginBottom: 14 }}>
              <Link className="btn sm" href={`/webmail/compose?reply=${uid}&folder=${encodeURIComponent(folder)}`}>Reply</Link>
              <Link className="btn sm" href={`/webmail/compose?reply=${uid}&folder=${encodeURIComponent(folder)}&all=1`}>Reply all</Link>
              <Link className="btn sm" href={`/webmail/compose?forward=${uid}&folder=${encodeURIComponent(folder)}`}>Forward</Link>
              <Op op="unread" label="Mark unread" />
              <Op op="star" label="★" />
              <Op op={isJunk ? "notspam" : "spam"} label={isJunk ? "Not spam" : "Spam"} />
              <Op op="delete" label="Delete" />
            </div>
            <h2>{msg.subject}</h2>
            <p className="muted">From <b>{msg.from}</b><br />To {msg.to}{msg.cc && <><br />Cc {msg.cc}</>}<br />{msg.date?.toLocaleString()}</p>
            {msg.attachments.length > 0 && (
              <p className="actions">{msg.attachments.map((a) => (
                <a key={a.index} className="btn sm" href={`/webmail/attachment?folder=${encodeURIComponent(folder)}&uid=${uid}&i=${a.index}`}>📎 {a.filename} ({bytes(a.size)})</a>
              ))}</p>
            )}
            {msg.blockedImages && <p className="flash" style={{ background: "var(--warnbg)", color: "var(--warn)" }}>Remote images are blocked. <Link href={link({ uid: String(uid), images: "1" })}>Show images</Link></p>}
            {msg.html
              ? <iframe title="Message" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={`<base target="_blank"><style>body{font:14px system-ui,sans-serif;margin:12px;color:#111}img{max-width:100%;height:auto}</style>${msg.html}`} />
              : <pre>{msg.text}</pre>}
          </>
        )}
      </div>
    </div>
  );
}
