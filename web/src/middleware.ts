import { NextRequest, NextResponse } from "next/server";

const primaryHosts = () => new Set([(process.env.MAIL_HOSTNAME ?? "").toLowerCase(), "localhost", "127.0.0.1", "web"]);
const AUTOCONFIG = ["/mail/config-v1.1.xml", "/autodiscover/autodiscover.xml", "/.well-known/autoconfig/mail/config-v1.1.xml"];

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const url = req.nextUrl.clone();
  const lower = url.pathname.toLowerCase();

  // Outlook requests /Autodiscover/Autodiscover.xml (case varies)
  if (lower === "/autodiscover/autodiscover.xml" && url.pathname !== lower) { url.pathname = lower; return NextResponse.rewrite(url); }
  if (lower === "/.well-known/autoconfig/mail/config-v1.1.xml") { url.pathname = "/mail/config-v1.1.xml"; return NextResponse.rewrite(url); }

  // The TLS "ask" endpoint is for Caddy only (direct docker-network call, never carries X-Forwarded-For).
  if (lower.startsWith("/api/internal") && req.headers.get("x-forwarded-for")) return new NextResponse("Not found", { status: 404 });

  // autoconfig.<domain> / autodiscover.<domain> hosts may only serve client-configuration documents.
  if (!primaryHosts().has(host) && !AUTOCONFIG.includes(lower) && !lower.startsWith("/api/internal")) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (lower.startsWith("/admin/login")) { url.pathname = "/login"; return NextResponse.redirect(url); } // old login URL
  // Coarse gate only: real authorization (signature, role, status) happens in requireSession()/requireRole().
  if ((lower === "/admin" || lower.startsWith("/admin/") || lower === "/cpanel" || lower.startsWith("/cpanel/")) && !req.cookies.get("panel_session")) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (lower.startsWith("/webmail") && !lower.startsWith("/webmail/login") && !req.cookies.get("wm_session")) {
    url.pathname = "/webmail/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
