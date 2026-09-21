# PROGRESS (update at the end of every session)
Legend: [ ] todo · [~] in progress · [x] done · ✔ verified (how)

## Status snapshot
- Mail platform: **built + e2e verified locally** (2026-09-21): authenticated SMTP send, IMAP delivery, alias delivery, sender-spoof rejection, bad-login rejection, DKIM signature, log ingest, admin/webmail pages load, autoconfig XML.
- NOT verified: webmail UI click-through, admin actions via browser, real DNS/Let's Encrypt, deployment on a real VPS.
- Hosting-panel expansion: planning approved (`docs/SCOPE.md`); implementation not started beyond Step 0.

## Step 0 — context system
- [x] CLAUDE.md, docs/SCOPE.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, PROGRESS.md
- [x] scripts/dc (local compose wrapper), scripts/e2e-mail.py (regression)
- [ ] Run `scripts/e2e-mail.py` from the committed script once and record result here. **Attempt 1 failed to start**: Docker Desktop returned 500 (host disk had 2.6 GB free). The same checks were run manually earlier and passed; the script itself is UNTESTED. Free disk (>10 GB), restart Docker, `scripts/dc up -d --build`, then run it.

## Phase 0 — foundation
- [ ] Prisma: Account, Package, AuditLog, ApiKey; accountId on Domain/Mailbox/Alias (+ migration, keep mailreader grants)
- [ ] Role-aware sessions, TOTP 2FA, impersonation, `scopeFor()` + `requireRole()`
- [ ] Agent skeleton + RPC client (`web/src/server/agent.ts`)
- [ ] cPanel-style UI: design tokens, Tile/Meter/SectionCard/DataTable, user home, WHM shell; migrate existing pages
- [ ] Tenant isolation test (two accounts)
## Phase 1 — websites  [ ]
## Phase 2 — databases, file manager, SFTP/FTP  [ ]
## Phase 3 — PowerDNS  [ ]
## Phase 4 — backups + cron  [ ]
## Phase 5 — reseller/packages enforcement, REST API, webhooks, WHMCS module  [ ]
## Phase 6 — security hardening, monitoring, self-update  [ ]

## Known bugs / notes
- Alias forwarding to external addresses has no SRS.
- Login rate limiter is in-memory (single web instance).
- Dev Docker Desktop needed a purge once; test agent/site features on Linux.

## Next 3 actions
1. Run `python3 scripts/e2e-mail.py` against `scripts/dc up -d --build`; record result.
2. Phase 0: Prisma models + migration for Account/Package/AuditLog.
3. Phase 0: design tokens + cPanel-style shell/home.
