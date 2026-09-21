# Architecture

## Services (docker-compose)
postgres · redis · rspamd (milter :11332, controller :11334 internal) · mail (Postfix 25/465/587 + Dovecot 143/993, LMTP+SASL unix sockets in `/var/spool/postfix/private`) · web (Next.js :3000) · caddy (80/443, on-demand TLS).
Volumes: `pgdata`, `vmail` (Maildir), `dkim` (web writes, rspamd reads), `maillog` (mail writes `mail.log`+`queue.json`, web reads), `caddy_data` (certs → mail container syncs to `/etc/ssl/mail`), `postfix_spool`.
Host `agent` (systemd, `agent/`) exists (skeleton). Planned additions: site containers, mariadb, pdns, sftp, restic repo.

## Mail data flow
Inbound: internet → Postfix :25 → Rspamd milter (SPF/DKIM/DMARC/spam) → LMTP → Dovecot (sieve `X-Spam*` → Junk, quota via maildirsize) → Maildir.
Outbound: client → :587/:465 (SASL via Dovecot, sender must match `sender-login.cf`) → Rspamd (DKIM sign per domain, selector map) → internet.
Lookups: `domains.cf`, `mailboxes.cf`, `aliases.cf`, `sender-login.cf` (Postfix pgsql); Dovecot `dovecot-sql.conf.ext`.

## Web app
Sessions: one signed JWT cookie `panel_session` for every role ({sub, imp?, pv}); `pv` = fingerprint of the password hash, so a password change signs the account out everywhere. Webmail keeps its own AES-GCM cookie `wm_session`. Two-step login uses a 5-minute `login_2fa` cookie.
Two shells over the same pages: `/admin/**` (WHM: admin + reseller) and `/cpanel/**` (user). Mail pages live once under `app/admin/(panel)/` and are re-exported by `app/cpanel/*`; they derive links from `session.base` and scope queries with `scopeFor(session)`.
Middleware: host gating (only autoconfig paths on non-primary hosts), coarse cookie-presence redirect to `/login` (real authorization = `requireSession/requireRole` in layouts, pages and actions), `/api/internal/*` blocked when `X-Forwarded-For` present.
Background jobs (`instrumentation.ts` -> `server/jobs.ts`): bootstrap admin account from env + DKIM file sync, log ingest (5s), usage refresh (5m), log prune, DNS recheck (12h).

## Data model (current)
Account(username, email, role admin|reseller|user, parentId tree, packageId, status active|suspended, TOTP fields) · Package(ownerId, limits, 0 = unlimited) · AuditLog(actor, accountId scope, action, target, ip; no FKs so history survives termination) · ApiKey(hashed; no UI yet) · Domain/Mailbox/Alias (all carry `accountId`, RESTRICT) · MailLog (server-wide, admin only) · Setting(key/value; log offset).
Tree: admin -> reseller -> user (admin may also own users directly). Scope: admin = everything, reseller = self + direct customers, user = self (`lib/tenancy-core.ts`, unit-tested).
Grants: `mailreader` SELECT on limited columns of domains/mailboxes/aliases (migration 0002); `account_id` and the new tables are NOT granted.

## Planned (see PROGRESS.md)
Site · Runtime · Database/DbUser · FtpUser · DnsZone/records (PowerDNS) · BackupJob/Snapshot · CronJob/CronRun · Webhook. All resource tables get `accountId`.
Agent RPC (implemented: `agent.ping`, `system.info`; protocol = POST /rpc, bearer secret, `{method, accountId, params}`; unix socket or TCP): `site.create|start|stop|delete|logs|exec`, `caddy.upsertRoute`, `db.create|drop`, `fs.list|read|write|zip` (jailed), `sftp.sync`, `backup.run|restore`, `cron.sync`, `firewall.apply`. Auth: shared secret over unix socket; every call carries accountId and is validated against the whitelist.

## Security model
TLS 1.2+ required for mail auth; sender = owned address; login rate limits (in-memory; move to Redis if scaled); DKIM private keys never readable by mailreader; webmail HTML sandboxed iframe with remote images blocked; path-jail on all file ops.
