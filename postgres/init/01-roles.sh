#!/bin/sh
# Least-privilege role used by Postfix and Dovecot (read-only, limited columns; grants are applied by a Prisma migration).
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE mailreader LOGIN PASSWORD '${MAIL_DB_PASSWORD}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO mailreader;
GRANT USAGE ON SCHEMA public TO mailreader;
SQL
