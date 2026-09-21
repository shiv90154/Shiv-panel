# MailHost - multi-domain self-hosted email platform

Real mail server stack, driven by a Next.js admin panel and webmail. No SMTP/IMAP is reimplemented.

| Concern | Software |
|---|---|
| SMTP receive/send (25, 465, 587) | **Postfix** (virtual domains/mailboxes/aliases read live from PostgreSQL) |
| IMAP (143 STARTTLS, 993 TLS), quotas, Sieve | **Dovecot** (SQL auth + userdb, Maildir, LMTP delivery) |
| Spam, SPF/DKIM/DMARC checks, DKIM signing | **Rspamd** + Redis |
| TLS certificates (auto-renew) | **Caddy** (Let's Encrypt) - certs are shared with Postfix/Dovecot |
| Admin panel + webmail + client autoconfig | **Next.js / TypeScript / Prisma / PostgreSQL** |

Adding a domain = one row in PostgreSQL. Postfix/Dovecot query the DB on every lookup and Rspamd reads
DKIM keys from a shared volume, so **no code change, config edit or restart is needed for new domains**.

## Requirements
- VPS with a public IPv4, Docker + Compose plugin, ports **25, 80, 143, 443, 465, 587, 993** open.
- Provider must allow **outbound port 25** (many block it by default - ask support) and let you set **reverse DNS (PTR)** for the IP.
- A hostname for the server, e.g. `mail.example.com` with an **A record -> VPS IP** (before first start, so Let's Encrypt works).

## Install
```bash
cp .env.example .env      # fill in every value (see comments)
docker compose up -d --build
docker compose logs -f web mail
```
1. Open `https://MAIL_HOSTNAME/login`, sign in with `ADMIN_EMAIL` (or username `admin`) / `ADMIN_PASSWORD` (change it and enable 2FA under *My account*). Create resellers and hosting accounts under *Accounts*.
2. **Domains -> Add domain**. The domain page lists the exact MX / SPF / DKIM / DMARC (+ autoconfig/autodiscover) records.
   Copy them to your DNS provider - or, if `CLOUDFLARE_API_TOKEN` is set, click **Publish to Cloudflare**. Click **Verify DNS**.
3. **Mailboxes -> Create mailbox**, then sign in at `https://MAIL_HOSTNAME/webmail` or add the account to a client.
4. Set the **PTR** for your IP to `MAIL_HOSTNAME` at your VPS provider (Server status page checks this).

Until Caddy issues the certificate (a minute after first start) the mail services use a self-signed one, then switch automatically.

## Client settings (Gmail app, Outlook, Thunderbird, iOS/Android Mail ...)
| | Server | Port | Security |
|---|---|---|---|
| IMAP | `MAIL_HOSTNAME` | 993 | SSL/TLS (or 143 + STARTTLS) |
| SMTP | `MAIL_HOSTNAME` | 465 SSL/TLS (or 587 STARTTLS) | |
| Username | full email address | | password authentication |

Gmail app: *Add another email address -> Other*, enter the address, choose IMAP, use the values above.
Thunderbird and Outlook auto-detect through `autoconfig.<domain>` / `autodiscover.<domain>` (CNAMEs the panel gives you;
certificates for these are issued on demand only for domains that exist in the database).

## Features
- **Domains**: unlimited; DNS record generator + live verification (MX, SPF, DKIM key match, DMARC, autoconfig), 12-hourly re-check, DKIM rotation, per-domain DMARC/SPF policy, default quota, mailbox cap, enable/disable, delete.
- **Mailboxes**: create/edit/disable/delete, password reset, per-mailbox quota (enforced by Dovecot; over-quota mail is rejected), live usage bars.
- **Aliases**: single or multiple destinations, external forwards, catch-all (`*`). Alias destinations may send *as* the alias (Postfix sender-login maps).
- **Security**: TLS 1.2+ required for auth, submission requires login and *enforces sender = owned address*, Rspamd (SPF/DKIM/DMARC, RBLs, Bayes, greylist, rate limits) with spam auto-filed to **Junk** via Sieve, DKIM signing for every domain, Postfix rate limits, login throttling in admin + webmail, Postfix/Dovecot use a **read-only, column-limited DB role** (cannot read DKIM keys or admin data), Rspamd controller never exposed.
- **Logs**: Postfix log parsed into a searchable table (delivered / deferred / bounced / rejected / failed logins).
- **Server status**: service probes, queue size, disk, load, memory, Rspamd stats, A/PTR checks.
- **Webmail**: folders, search, read (sandboxed HTML, remote images blocked until allowed), reply/forward, attachments both ways, send-as-alias, spam/delete/star, copy saved to Sent.

## Operations
- Backups: volumes `pgdata` (accounts), `vmail` (mail), `dkim`, `caddy_data` (certs). Example: `docker run --rm -v mailhost_vmail:/d -v $PWD:/b alpine tar czf /b/vmail.tgz -C /d .`
- Update: `git pull && docker compose up -d --build` (migrations run automatically).
- Queue: `docker compose exec mail postqueue -p` / `postqueue -f`.
- Spam tuning: Rspamd thresholds are in `rspamd/local.d/actions.conf`.
- Local dev of the web app: `cd web && npm i && DATABASE_URL=... npm run dev`.

## Known limitations / next steps
- Forwarding aliases to *external* addresses is done without SRS; strict SPF destinations may reject those forwards.
- Only super-admins exist (no per-domain admin roles). No ClamAV by default (add a `clamav` service and Rspamd `antivirus.conf` if you need it).
- The mail containers were written against Debian bookworm (Postfix 3.7 / Dovecot 2.3) - first-boot testing on your VPS is recommended; check `docker compose logs mail`.
