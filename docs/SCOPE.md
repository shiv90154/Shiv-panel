# Scope (definition of done). Not listed = out of scope.

## Mail (implemented, keep working)
- [x] Unlimited domains, DNS record generator + verification (MX/SPF/DKIM/DMARC/autoconfig), DKIM rotation
- [x] Mailboxes (create/edit/disable/delete, quota + usage), aliases (multi-destination, catch-all, send-as)
- [x] Postfix/Dovecot/Rspamd, IMAP/SMTP, Gmail/Outlook/Thunderbird support, autoconfig/autodiscover
- [x] Webmail, mail logs, server status
## Accounts & tenancy
- [ ] Roles: admin (WHM), reseller, user (cPanel); account tree; suspend/unsuspend/terminate
- [ ] Packages (disk, bandwidth, domains, sites, mailboxes, DBs, FTP users, cron jobs, CPU, RAM) with enforcement
- [ ] TOTP 2FA, login-as (impersonation), audit log
- [ ] Reseller white-label (name/logo/domain)
## Websites
- [ ] Runtimes: static, PHP (8.1–8.4), Node (18/20/22), Python (WSGI/ASGI), Docker image/compose
- [ ] Subdomains, addon domains, redirects, force-HTTPS, automatic SSL, env vars, logs, Git deploy
- [ ] One-click WordPress
## Databases
- [ ] MariaDB + PostgreSQL: create DB/user/grants with limits; phpMyAdmin/Adminer SSO
## Files
- [ ] File manager (browse/upload/edit/zip/unzip/chmod/delete), path-jailed
- [ ] SFTP (chrooted, virtual users) and FTP (TLS only)
## DNS
- [ ] PowerDNS authoritative: zone editor (A/AAAA/CNAME/MX/TXT/SRV/CAA/NS), templates, DNSSEC; Cloudflare as alternative provider
## Backups & cron
- [ ] restic backups (files, DBs, Maildir), schedules, retention, restore
- [ ] Cron jobs with run history/output
## Billing / API
- [ ] Provisioning REST API (API keys), webhooks, WHMCS server module
## Security & ops
- [x] Firewall (nftables) + fail2ban, WAF option, ClamAV, resource graphs, self-update
## UI
- [ ] cPanel-style user home (search + icon tiles + usage sidebar) and WHM-style admin/reseller shell; existing pages migrated
## Marketing site
- [x] Public static landing page for shivdomains.in (`marketing/public/`, no framework, no auth) - light theme only, honest feature copy, no fabricated stats/testimonials/pricing; served by Caddy via `marketing/caddy/*.caddy`
