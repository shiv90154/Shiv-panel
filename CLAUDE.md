# CLAUDE.md — MailHost → cPanel-style hosting panel

**Read `PROGRESS.md` first. Update it last.** Scope is fixed in `docs/SCOPE.md`; anything not listed there is out of scope. Design rationale: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.

## What this is
Self-hosted hosting panel for a VPS. Working today: multi-domain **mail** platform (Postfix, Dovecot, Rspamd, Caddy, PostgreSQL, Redis) + Next.js admin panel + webmail. Being extended (see PROGRESS.md) to sites, databases, files/SFTP, DNS, backups/cron, resellers/packages/billing API, with a cPanel-style UI.

## Commands
- Local stack (Docker, no Caddy, mail ports 2525/2465/2587/2143/2993, web http://localhost:3100): `scripts/dc up -d --build`, `scripts/dc ps`, `scripts/dc logs mail web`, `scripts/dc down -v`
- Mail regression test (run after EVERY phase): `python3 scripts/e2e-mail.py` (must print all PASS)
- Web: `cd web && npx tsc --noEmit && npx next build` (both must pass before finishing any task)
- Prisma: edit `web/prisma/schema.prisma`, then `cd web && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` (no local Postgres; write a new `prisma/migrations/NNNN_name/migration.sql` by hand from the diff). Migrations run on web container start.
- Local admin login: admin@test.local / supersecretadmin (test env only, from scripts/dc).

## Repo map
- `docker-compose.yml`, `Caddyfile`, `.env.example` — deployment. `postgres/init/` creates the read-only `mailreader` role.
- `mail/` — Postfix + Dovecot image. Configs are `*.tmpl` rendered by `entrypoint.sh` (envsubst on an explicit var list). Postfix/Dovecot read PostgreSQL live (`postfix/pgsql/*.tmpl`, `dovecot/dovecot-sql.conf.ext.tmpl`).
- `rspamd/local.d/` — spam, DKIM signing (keys from shared `dkim` volume).
- `web/src/lib/` — config, db, session (admin JWT + encrypted webmail cookie), password (`{BLF-CRYPT}` $2y$), dkim, dns (record generator + verifier), cloudflare, webmail (IMAP/SMTP), actions-util.
- `web/src/server/` — domains (create/delete/DNS verify, mailboxes, aliases), logs (Postfix log → `mail_logs`), usage (maildirsize), status, jobs (started from `instrumentation.ts`).
- `web/src/app/admin/(panel)/` admin pages; `web/src/app/webmail/`; `web/src/middleware.ts` (host gating, auth redirects, autoconfig).

## Conventions
- Mutations = server actions in `app/**/actions.ts`: call auth guard first, wrap body in `run(path, fn)` (`lib/actions-util.ts`) which redirects with `?ok=`/`?error=`. Validate with zod.
- Prisma models use camelCase fields with `@map("snake_case")` and `@@map("plural_table")`. Postfix/Dovecot SQL uses the snake_case names — changing `domains`/`mailboxes`/`aliases` columns requires updating the mailreader grants (new migration) AND the SQL templates.
- Emails/domains/local parts are stored lowercase. Maildir path: `/var/vmail/<domain>/<local>/Maildir`.
- Every filesystem path built from user input must be resolved and prefix-checked (see `removeMailData` in `server/domains.ts`).
- Dynamic pages: `export const dynamic = "force-dynamic"`. Next 15: `params`/`searchParams`/`cookies()` are async.

## Hard rules
1. Never mount `docker.sock` or run privileged operations in the `web` container. Privileged work goes through the host **agent** (typed, whitelisted RPC).
2. Every mutation checks ownership (tenant scope) and package limits once tenancy exists.
3. No features outside `docs/SCOPE.md`. No placeholder/mock UI: a page ships only if it is wired to real data/actions.
4. Postfix/Dovecot DB role must stay read-only and column-limited.
5. Verify before claiming done: typecheck + build + e2e mail test (+ the phase's own checks). State honestly what was not tested.

## Known environment notes
- Dev machine is macOS; Docker Desktop was corrupted once (needed a purge). Agent/site/DNS features must be verified on a Linux VPS or VM.
- Postfix 3.7 logs syslog-style timestamps (no year); parser handles that.
- Port 3000 on the dev Mac is often taken → local web uses 3100.
