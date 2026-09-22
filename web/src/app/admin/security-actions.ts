"use server";

// Firewall / fail2ban / self-update: host-wide, admin only. Malware scans are tenant-scoped (getOwnedSite) and shared with cPanel.
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { clientIp, requireRole, requireSession } from "@/lib/session";
import { getOwnedSite } from "@/lib/tenancy";
import {
  addBlockRule, addOpenPortRule, applyUpdateNow, banIp, disableFirewall, removeFirewallRule, startSiteScan, unbanIp,
} from "@/server/security";

export async function addOpenPortRuleAction(fd: FormData) {
  const sess = await requireRole("admin");
  return run(`${sess.base}/security`, async () => {
    const input = { proto: s(fd, "proto"), port: s(fd, "port"), source: s(fd, "source"), comment: s(fd, "comment") };
    await addOpenPortRule(input);
    await audit(sess, "firewall.rule.add", { target: `open ${input.proto}/${input.port}`, accountId: null, detail: input });
    return "Port opened and firewall re-applied";
  });
}

export async function addBlockRuleAction(fd: FormData) {
  const sess = await requireRole("admin");
  return run(`${sess.base}/security`, async () => {
    const input = { cidr: s(fd, "cidr"), comment: s(fd, "comment") };
    await addBlockRule(input, await clientIp());
    await audit(sess, "firewall.rule.add", { target: `block ${input.cidr}`, accountId: null, detail: input });
    return "Address blocked and firewall re-applied";
  });
}

export async function removeFirewallRuleAction(id: string) {
  const sess = await requireRole("admin");
  return run(`${sess.base}/security`, async () => {
    await removeFirewallRule(id);
    await audit(sess, "firewall.rule.remove", { target: id, accountId: null });
    return "Rule removed and firewall re-applied";
  });
}

export async function disableFirewallAction() {
  const sess = await requireRole("admin");
  return run(`${sess.base}/security`, async () => {
    await disableFirewall();
    await audit(sess, "firewall.disable", { accountId: null });
    return "Firewall disabled (stored rules were kept; re-apply a rule to turn it back on)";
  });
}

export async function banIpAction(fd: FormData) {
  const sess = await requireRole("admin");
  return run(`${sess.base}/security`, async () => {
    const jail = s(fd, "jail"), ip = s(fd, "ip");
    await banIp(jail, ip);
    await audit(sess, "fail2ban.ban", { target: `${jail}: ${ip}`, accountId: null });
    return `${ip} banned in ${jail}`;
  });
}

export async function unbanIpAction(fd: FormData) {
  const sess = await requireRole("admin");
  return run(`${sess.base}/security`, async () => {
    const jail = s(fd, "jail"), ip = s(fd, "ip");
    await unbanIp(jail, ip);
    await audit(sess, "fail2ban.unban", { target: `${jail}: ${ip}`, accountId: null });
    return `${ip} unbanned in ${jail}`;
  });
}

export async function applyUpdateAction(fd: FormData) {
  const sess = await requireRole("admin");
  return run(`${sess.base}/updates`, async () => {
    const expect = s(fd, "expect");
    const r = await applyUpdateNow(expect);
    await audit(sess, "update.apply", { target: expect.slice(0, 12), accountId: null, detail: { via: r.via } });
    return "Update started - this page will show progress as it runs";
  });
}

export async function scanSiteNowAction(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/sites/${id}`, async () => {
    const site = await getOwnedSite(sess, id);
    await startSiteScan(site, "manual");
    await audit(sess, "site.scan", { target: site.name, accountId: site.accountId });
    return "Scan started - refresh in a minute to see the result";
  });
}
