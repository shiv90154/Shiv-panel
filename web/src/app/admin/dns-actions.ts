"use server";

// DNS actions, shared by WHM (/admin) and cPanel (/cpanel). Session -> getOwnedZone (tenant scope) -> mutate.
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { assertInScope, getOwnedZone } from "@/lib/tenancy";
import { addRecord, createZone, deleteRecord, deleteZone, setDnssec } from "@/server/dns";

export async function addZone(fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/dns`, async () => {
    const ownerId = s(fd, "ownerId") || sess.account.id;
    await assertInScope(sess, ownerId);
    const zn = await createZone({ accountId: ownerId, name: s(fd, "name"), template: fd.get("template") === "on" });
    await audit(sess, "dns.zone.create", { target: zn.name, accountId: ownerId });
    return `Zone ${zn.name} created. Point the domain's nameservers at this server to make it live.`;
  });
}

export async function removeZone(id: string, fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/dns`, async () => {
    const zn = await getOwnedZone(sess, id);
    if (s(fd, "confirm") !== zn.name) throw new Error("Type the zone name to confirm");
    await deleteZone(zn.id);
    await audit(sess, "dns.zone.delete", { target: zn.name, accountId: zn.accountId });
    return `Zone ${zn.name} deleted`;
  });
}

export async function addZoneRecord(id: string, fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/dns/${id}`, async () => {
    const zn = await getOwnedZone(sess, id);
    const r = await addRecord(zn, { name: s(fd, "name"), type: s(fd, "type"), value: s(fd, "value"), priority: s(fd, "priority") || undefined, ttl: s(fd, "ttl") || undefined });
    await audit(sess, "dns.record.add", { target: `${r.type} ${r.name || "@"}.${zn.name}`, accountId: zn.accountId });
    return "Record saved";
  });
}

export async function removeZoneRecord(id: string, fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/dns/${id}`, async () => {
    const zn = await getOwnedZone(sess, id);
    const r = { name: s(fd, "name"), type: s(fd, "type"), content: String(fd.get("content") ?? "") };
    await deleteRecord(zn, r);
    await audit(sess, "dns.record.delete", { target: `${r.type} ${r.name}`, accountId: zn.accountId });
    return "Record deleted";
  });
}

export async function toggleDnssec(id: string, enable: boolean) {
  const sess = await requireSession();
  return run(`${sess.base}/dns/${id}`, async () => {
    const zn = await getOwnedZone(sess, id);
    await setDnssec(zn, enable);
    await audit(sess, enable ? "dns.dnssec.enable" : "dns.dnssec.disable", { target: zn.name, accountId: zn.accountId });
    return enable ? "DNSSEC enabled. Add the DS record at your registrar." : "DNSSEC disabled. Remove the DS record at your registrar first if you have not.";
  });
}
