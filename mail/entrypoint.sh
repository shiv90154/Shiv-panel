#!/bin/sh
set -e
: "${MAIL_HOSTNAME:?}" "${MAIL_DB_PASSWORD:?}" "${POSTGRES_DB:=mail}"
export MAIL_HOSTNAME MAIL_DB_PASSWORD POSTGRES_DB
export POSTFIX_INET_PROTOCOLS="${POSTFIX_INET_PROTOCOLS:-ipv4}"
VARS='${MAIL_HOSTNAME} ${MAIL_DB_PASSWORD} ${POSTGRES_DB} ${POSTFIX_INET_PROTOCOLS}'

render() { envsubst "$VARS" < "$1" > "$2"; }

# --- Postfix ---
mkdir -p /etc/postfix/pgsql
render /templates/postfix/main.cf.tmpl /etc/postfix/main.cf
cp /templates/postfix/master.cf /etc/postfix/master.cf
for f in /templates/postfix/pgsql/*.tmpl; do
  render "$f" "/etc/postfix/pgsql/$(basename "${f%.tmpl}")"
done
chmod 640 /etc/postfix/pgsql/*.cf && chgrp postfix /etc/postfix/pgsql/*.cf
echo "postmaster: root" > /etc/aliases && newaliases

# --- Dovecot ---
render /templates/dovecot/dovecot.conf.tmpl /etc/dovecot/dovecot.conf
render /templates/dovecot/dovecot-sql.conf.ext.tmpl /etc/dovecot/dovecot-sql.conf.ext
chmod 600 /etc/dovecot/dovecot-sql.conf.ext
mkdir -p /etc/dovecot/sieve
cp /templates/dovecot/sieve/spam.sieve /etc/dovecot/sieve/spam.sieve
sievec /etc/dovecot/sieve/spam.sieve

# --- TLS: self-signed fallback until Caddy has issued the real certificate ---
if [ ! -s /etc/ssl/mail/fullchain.pem ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 -subj "/CN=$MAIL_HOSTNAME" \
    -keyout /etc/ssl/mail/privkey.pem -out /etc/ssl/mail/fullchain.pem 2>/dev/null
  touch /etc/ssl/mail/.selfsigned
fi
chmod 600 /etc/ssl/mail/privkey.pem
/usr/local/bin/housekeeping.sh certs-once || true

# --- Filesystem ---
chown vmail:vmail /var/vmail
touch /var/log/mail/mail.log && chmod 644 /var/log/mail/mail.log
echo '{"total":0,"active":0,"deferred":0,"updated":0}' > /var/log/mail/queue.json && chmod 644 /var/log/mail/queue.json
postfix check

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
