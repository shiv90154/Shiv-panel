import { NextRequest } from "next/server";
import { getWebmailSession } from "@/lib/session";
import { getAttachment, withImap } from "@/lib/webmail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await getWebmailSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const q = req.nextUrl.searchParams;
  const att = await withImap(s, (c) => getAttachment(c, q.get("folder") ?? "INBOX", Number(q.get("uid")), Number(q.get("i"))));
  if (!att) return new Response("Not found", { status: 404 });
  const name = encodeURIComponent(att.filename || "attachment");
  return new Response(new Uint8Array(att.content), {
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${name}`, "X-Content-Type-Options": "nosniff" },
  });
}
