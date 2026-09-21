import { NextRequest } from "next/server";
import { domainOf, outlookXml, xml } from "@/lib/clientconfig";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const email = /<EMailAddress>\s*([^<\s]+)\s*<\/EMailAddress>/i.exec(body)?.[1];
  const d = await domainOf(email);
  return d && email ? xml(outlookXml(email)) : new Response("Unknown domain", { status: 404 });
}
