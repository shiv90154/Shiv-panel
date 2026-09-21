import { notFound } from "next/navigation";
import Link from "next/link";
import path from "node:path";
import { prisma } from "@/lib/db";
import { DataTable, Flash, SectionCard, bytes } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireSession } from "@/lib/session";
import { getOwnedSite, scopeFor } from "@/lib/tenancy";
import { agentCall, agentConfigured, type FileEntry } from "@/server/agent";
import { chmodEntry, deleteEntry, makeDir, newFile, renameEntry, saveFile, unzipEntry, uploadFile, zipEntry } from "../../files-actions";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; site?: string; path?: string; edit?: string };

export default async function Files({ searchParams }: { searchParams: Promise<SP> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const sites = await prisma.site.findMany({ where: await scopeFor(s), orderBy: { name: "asc" }, include: { account: { select: { username: true } } } });
  const multi = s.role !== "user";
  const label = (x: (typeof sites)[number]) => (multi ? `${x.account.username} / ${x.name}` : x.name);
  const picker = (
    <SectionCard title="Site">
      <form method="get" className="row">
        <div><select name="site" defaultValue={sp.site ?? ""}><option value="" disabled>Choose a site…</option>{sites.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</select></div>
        <div className="auto"><button>Open</button></div>
      </form>
    </SectionCard>
  );
  if (!sp.site) return <><h1>File manager</h1><Flash {...sp} />{picker}</>;

  const found = (await getOwnedSite(s, sp.site).catch(() => null));
  if (!found) notFound(); // out-of-scope ids look like missing ones (404, not 500)
  const site = found;
  const dir = path.posix.join("/", sp.path ?? "/");
  const here = (p: string, extra = "") => `${s.base}/files?site=${site.id}&path=${encodeURIComponent(p)}${extra}`;
  const crumbs = dir.split("/").filter(Boolean);

  let entries: FileEntry[] = [], listErr = "", editing: { name: string; content: string } | null = null, editErr = "";
  if (agentConfigured()) {
    try { entries = (await agentCall("file.list", { siteId: site.id, runtime: site.runtime, path: dir }, site.accountId, 15_000)).entries; }
    catch (e) { listErr = e instanceof Error ? e.message : "Cannot list files"; }
    if (sp.edit) {
      try { editing = { name: sp.edit, content: (await agentCall("file.read", { siteId: site.id, runtime: site.runtime, path: path.posix.join(dir, sp.edit) }, site.accountId, 15_000)).content }; }
      catch (e) { editErr = e instanceof Error ? e.message : "Cannot open file"; }
    }
  } else listErr = "The host agent is not configured (AGENT_URL / AGENT_SECRET).";
  entries.sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
  const hidden = (n: string) => (dir === "/" ? "" : dir) + "/" + n;

  return (
    <>
      <h1>File manager · {site.name}</h1>
      <p className="sub"><Link href={`${s.base}/sites/${site.id}`}>← Site settings</Link></p>
      <Flash {...sp} error={sp.error ?? (editErr || undefined)} />
      {picker}
      <SectionCard title={<span className="mono"><Link href={here("/")}>root</Link>{crumbs.map((c, i) => <span key={i}> / <Link href={here("/" + crumbs.slice(0, i + 1).join("/"))}>{c}</Link></span>)}</span>}>
        {listErr && <p className="flash bad">{listErr}</p>}
        <DataTable
          rows={entries} rowKey={(e) => e.name} empty="This folder is empty."
          columns={[
            { header: "Name", className: "mono", render: (e) => e.type === "dir" ? <Link href={here(hidden(e.name))}>📁 {e.name}</Link> : e.type === "link" ? <>🔗 {e.name}</> : <Link href={here(dir, `&edit=${encodeURIComponent(e.name)}`)}>{e.name}</Link> },
            { header: "Size", nowrap: true, render: (e) => (e.type === "file" ? bytes(e.size) : "") },
            { header: "Mode", className: "mono", render: (e) => e.mode },
            { header: "Modified", nowrap: true, render: (e) => e.mtime.slice(0, 16).replace("T", " ") },
            { header: "", render: (e) => (
              <div className="row">
                <form action={renameEntry.bind(null, site.id)} className="row"><input type="hidden" name="dir" value={dir} /><input type="hidden" name="name" value={e.name} /><input name="newName" placeholder="rename to" style={{ width: 110 }} required /><button className="sm">Rename</button></form>
                {e.type !== "link" && <form action={chmodEntry.bind(null, site.id)} className="row"><input type="hidden" name="dir" value={dir} /><input type="hidden" name="name" value={e.name} /><input name="mode" defaultValue={e.mode} style={{ width: 52 }} pattern="[0-7]{3}" required /><button className="sm">chmod</button></form>}
                {e.type !== "link" && <form action={zipEntry.bind(null, site.id)}><input type="hidden" name="dir" value={dir} /><input type="hidden" name="name" value={e.name} /><button className="sm">Zip</button></form>}
                {e.type === "file" && e.name.toLowerCase().endsWith(".zip") && <form action={unzipEntry.bind(null, site.id)}><input type="hidden" name="dir" value={dir} /><input type="hidden" name="name" value={e.name} /><button className="sm">Unzip</button></form>}
                <form action={deleteEntry.bind(null, site.id)}><input type="hidden" name="dir" value={dir} /><input type="hidden" name="name" value={e.name} /><ConfirmButton message={`Delete ${e.name}${e.type === "dir" ? " and everything in it" : ""}?`}>Delete</ConfirmButton></form>
              </div>
            ) },
          ]}
        />
      </SectionCard>

      {editing && (
        <SectionCard title={`Edit ${editing.name}`}>
          <form action={saveFile.bind(null, site.id)}>
            <input type="hidden" name="dir" value={dir} /><input type="hidden" name="name" value={editing.name} />
            <textarea name="content" rows={22} className="mono" defaultValue={editing.content} spellCheck={false} />
            <p><button className="primary">Save</button> <Link href={here(dir)}>Close</Link></p>
          </form>
        </SectionCard>
      )}

      <SectionCard title="Add to this folder">
        <div className="row">
          <form action={uploadFile.bind(null, site.id)} className="row"><input type="hidden" name="dir" value={dir} /><input type="file" name="file" required /><button>Upload (max 25 MB)</button></form>
          <form action={makeDir.bind(null, site.id)} className="row"><input type="hidden" name="dir" value={dir} /><input name="name" placeholder="new-folder" required /><button>New folder</button></form>
          <form action={newFile.bind(null, site.id)} className="row"><input type="hidden" name="dir" value={dir} /><input name="name" placeholder="index.html" required /><button>New file</button></form>
        </div>
      </SectionCard>
    </>
  );
}
