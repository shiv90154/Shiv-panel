import { prisma } from "./db";
import { config } from "./config";

export async function domainOf(email: string | null | undefined) {
  const dom = email?.split("@")[1]?.toLowerCase().trim();
  if (!dom) return null;
  return prisma.domain.findFirst({ where: { name: dom, active: true }, select: { name: true } });
}

export const xml = (body: string) => new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });

export function thunderbirdXml(domain: string) {
  const h = config.mailHostname;
  return `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="${domain}">
    <domain>${domain}</domain>
    <displayName>${domain} Mail</displayName>
    <displayShortName>${domain}</displayShortName>
    <incomingServer type="imap">
      <hostname>${h}</hostname><port>993</port><socketType>SSL</socketType>
      <authentication>password-cleartext</authentication><username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>${h}</hostname><port>465</port><socketType>SSL</socketType>
      <authentication>password-cleartext</authentication><username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;
}

export function outlookXml(email: string) {
  const h = config.mailHostname;
  const proto = (type: string, port: number) =>
    `<Protocol><Type>${type}</Type><Server>${h}</Server><Port>${port}</Port><DomainRequired>off</DomainRequired><LoginName>${email}</LoginName><SPA>off</SPA><SSL>on</SSL><AuthRequired>on</AuthRequired></Protocol>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <Account><AccountType>email</AccountType><Action>settings</Action>
      ${proto("IMAP", 993)}
      ${proto("SMTP", 465)}
    </Account>
  </Response>
</Autodiscover>`;
}
