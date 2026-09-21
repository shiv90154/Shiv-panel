# Architecture

## Services (docker-compose)
postgres · redis · rspamd (milter :11332, controller :11334 internal) · mail (Postfix 25/465/587 + Dovecot 143/993, LMTP+SASL unix sockets in `/var/spool/postfix/private`) · web (Next.js :3000) · caddy (80/443, on-demand TLS).
Volumes: `pgdata`, `vmail` (Maildir), `dkim` (web writes, rspamd reads), `maillog` (mail writes `mail.log`+`queue.json`, web reads), `caddy_data` (certs → mail container syncs to `/etc/ssl/mail`), `postfix_spool`.
Planned additions: `agent` (host), site containers, mariadb, pdns, sftp, restic repo.

## Mail data flow
Inbound: internet → Postfix :25 → Rspamd milter (SPF/DKIM/DMARC/spam) → LMTP → Dovecot (sieve `X-Spam*` → Junk, quota via maildirsize) → Maildir.
Outbound: client → :587/:465 (SASL via Dovecot, sender must match `sender-login.cf`) → Rspamd (DKIM sign per domain, selector map) → internet.
Lookups: `domains.cf`, `mailboxes.cf`, `aliases.cf`, `sender-login.cf` (Postfix pgsql); Dovecot `dovecot-sql.conf.ext`.

## Web app
Admin JWT cookie `admin_session` (jose); webmail cookie `wm_session`. Middleware: host gating (only autoconfig paths on non-primary hosts), redirects, `/api/internal/*` blocked when `X-Forwarded-For` present.
Background jobs (`instrumentation.ts` → `server/jobs.ts`): bootstrap admin from env + DKIM file sync, log ingest (5s), usage refresh (5m), log prune, DNS recheck (12h).

## Data model (current)
AdminUser · Domain(name, dkim*, dmarc*, spf, quota defaults, dns status) · Mailbox(email, passwordHash, quotaMb, usage) · Alias(source, destinations[]) · MailLog · Setting(key/value; log offset).
Grants: `mailreader` SELECT on limited columns of domains/mailboxes/aliases (migration 0002).

## Planned (see PROGRESS.md)
Account(role, parentId, status, totp) · Package · AuditLog · ApiKey · Site · Runtime · Database/DbUser · FtpUser · DnsZone/records (PowerDNS) · BackupJob/Snapshot · CronJob/CronRun · Webhook. All resource tables get `accountId`.
Agent RPC: `site.create|start|stop|delete|logs|exec`, `caddy.upsertRoute`, `db.create|drop`, `fs.list|read|write|zip` (jailed), `sftp.sync`, `backup.run|restore`, `cron.sync`, `firewall.apply`. Auth: shared secret over unix socket; every call carries accountId and is validated against the whitelist.

## Security model
TLS 1.2+ required for mail auth; sender = owned address; login rate limits (in-memory; move to Redis if scaled); DKIM private keys never readable by mailreader; webmail HTML sandboxed iframe with remote images blocked; path-jail on all file ops.
