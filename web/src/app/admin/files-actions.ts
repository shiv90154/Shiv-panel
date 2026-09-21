"use server";

// File manager actions, shared by WHM and cPanel. Session -> getOwnedSite (tenant scope) -> agent (path-jailed on the host).
import path from "node:path";
import { z } from "zod";
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { getOwnedSite } from "@/lib/tenancy";
import { agentCall, type FileTarget } from "@/server/agent";

const MAX_UPLOAD = 25 * 1024 * 1024;
const leafSchema = z.string().trim().regex(/^[^\/\0]{1,255}$/, "Invalid file name").refine((n) => n !== "." && n !== "..", "Invalid file name");
const modeSchema = z.string().trim().regex(/^[0-7]{3}$/, "Mode: 3 octal digits, e.g. 644");

/** Normalise a directory taken from a form to an absolute in-site path ("/" = site root). The agent jails it again. */
const dirOf = (fd: FormData) => path.posix.join("/", s(fd, "dir"));

async function act(siteId: string, fd: FormData, action: string, fn: (t: (p: string) => FileTarget, site: Awaited<ReturnType<typeof getOwnedSite>>) => Promise<string>, detail?: (fd: FormData) => string) {
  const sess = await requireSession();
  const dir = dirOf(fd);
  return run(`${sess.base}/files?site=${encodeURIComponent(siteId)}&path=${encodeURIComponent(dir)}`, async () => {
    const site = await getOwnedSite(sess, siteId);
    const msg = await fn((p) => ({ siteId: site.id, runtime: site.runtime, path: path.posix.join(dir, p) }), site);
    await audit(sess, action, { target: `${site.name}:${detail ? detail(fd) : dir}`, accountId: site.accountId });
    return msg;
  });
}

export async function uploadFile(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.upload", async (t, site) => {
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) throw new Error("Choose a file");
  if (f.size > MAX_UPLOAD) throw new Error("File too large (max 25 MB)");
  const name = leafSchema.parse(f.name);
  await agentCall("file.write", { ...t(name), contentB64: Buffer.from(await f.arrayBuffer()).toString("base64") }, site.accountId, 120_000);
  return `Uploaded ${name}`;
}, () => "upload");
}

export async function saveFile(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.edit", async (t, site) => {
  const name = leafSchema.parse(s(fd, "name"));
  const content = String(fd.get("content") ?? "");
  if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("File too large to edit (max 1 MB)");
  await agentCall("file.write", { ...t(name), contentB64: Buffer.from(content.replace(/\r\n/g, "\n")).toString("base64") }, site.accountId, 30_000);
  return `Saved ${name}`;
}, (fd) => s(fd, "name"));
}

export async function makeDir(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.mkdir", async (t, site) => {
  await agentCall("file.mkdir", t(leafSchema.parse(s(fd, "name"))), site.accountId);
  return "Folder created";
}, (fd) => s(fd, "name"));
}

export async function newFile(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.create", async (t, site) => {
  const name = leafSchema.parse(s(fd, "name"));
  await agentCall("file.write", { ...t(name), contentB64: "" }, site.accountId);
  return `Created ${name}`;
}, (fd) => s(fd, "name"));
}

export async function deleteEntry(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.delete", async (t, site) => {
  const name = leafSchema.parse(s(fd, "name"));
  await agentCall("file.delete", t(name), site.accountId, 60_000);
  return `Deleted ${name}`;
}, (fd) => s(fd, "name"));
}

export async function renameEntry(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.rename", async (t, site) => {
  const name = leafSchema.parse(s(fd, "name")), newName = leafSchema.parse(s(fd, "newName"));
  await agentCall("file.rename", { ...t(name), newName }, site.accountId);
  return `Renamed to ${newName}`;
}, (fd) => `${s(fd, "name")} -> ${s(fd, "newName")}`);
}

export async function chmodEntry(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.chmod", async (t, site) => {
  const name = leafSchema.parse(s(fd, "name")), mode = modeSchema.parse(s(fd, "mode"));
  await agentCall("file.chmod", { ...t(name), mode }, site.accountId);
  return `Mode of ${name} set to ${mode}`;
}, (fd) => `${s(fd, "name")} ${s(fd, "mode")}`);
}

export async function zipEntry(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.zip", async (t, site) => {
  const r = await agentCall("file.zip", t(leafSchema.parse(s(fd, "name"))), site.accountId, 300_000);
  return `Created ${r.name}`;
}, (fd) => s(fd, "name"));
}

export async function unzipEntry(siteId: string, fd: FormData) {
  return act(siteId, fd, "file.unzip", async (t, site) => {
  await agentCall("file.unzip", t(leafSchema.parse(s(fd, "name"))), site.accountId, 300_000);
  return "Extracted (existing files were not overwritten)";
}, (fd) => s(fd, "name"));
}
