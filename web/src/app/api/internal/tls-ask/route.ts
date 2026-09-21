import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Caddy asks before issuing an on-demand certificate: only for autoconfig./autodiscover. hosts of hosted domains.
export async function GET(req: NextRequest) {
  const host = (req.nextUrl.searchParams.get("domain") ?? "").toLowerCase();
  if (host === config.mailHostname) return new Response("ok");
  const m = /^(?:autoconfig|autodiscover)\.(.+)$/.exec(host);
  if (m && (await prisma.domain.findUnique({ where: { name: m[1] } }))) return new Response("ok");
  return new Response("no", { status: 404 });
}
