-- Postfix/Dovecot connect as the read-only "mailreader" role (created by postgres/init/01-roles.sh).
-- It can only see the columns needed for routing and authentication (never DKIM private keys or admin data).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mailreader') THEN
    GRANT SELECT (id, name, active) ON "domains" TO mailreader;
    GRANT SELECT (id, domain_id, email, password_hash, quota_mb, active) ON "mailboxes" TO mailreader;
    GRANT SELECT (id, domain_id, source, destinations, active) ON "aliases" TO mailreader;
  END IF;
END $$;
