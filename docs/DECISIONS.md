# Decisions
1. **Host agent** for privileged ops. web is internet-facing; docker.sock in web = root compromise. Agent exposes typed, whitelisted RPC over a unix socket/mTLS.
2. **Container per site**, files under `/srv/accounts/<account>/<site>`, cgroup limits from the package. Runtimes are images listed in a `Runtime` table.
3. **Caddy Admin API** for per-site routes + on-demand TLS (existing `tls-ask` endpoint gates issuance).
4. **PowerDNS + PostgreSQL backend**, managed via its HTTP API; `expectedRecords()` (web/src/lib/dns.ts) is the zone template; Cloudflare stays behind a `DnsProvider` interface.
5. **restic** for backups (local/S3/SFTP targets).
6. **Postfix/Dovecot read PostgreSQL directly** through a read-only, column-limited role → adding domains needs no restarts.
7. **Bcrypt `{BLF-CRYPT}` ($2y$)** mailbox hashes, verified by Dovecot and by webmail login.
8. **Webmail session** = AES-256-GCM cookie holding credentials (IMAP/SMTP need the password); 8h expiry.
9. **Tenancy**: `Account` tree + `scopeFor(session)` applied to every Prisma query; ownership FK on every resource.
