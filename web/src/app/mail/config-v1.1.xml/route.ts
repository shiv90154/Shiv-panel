import { NextRequest } from "next/server";
import { domainOf, thunderbirdXml, xml } from "@/lib/clientconfig";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("emailaddress");
  const host = (req.headers.get("host") ?? "").split(":")[0].replace(/^autoconfig\./, "");
  const d = await domainOf(email ?? `x@${host}`);
  return d ? xml(thunderbirdXml(d.name)) : new Response("Unknown domain", { status: 404 });
}
