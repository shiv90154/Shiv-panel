#!/bin/sh
# Background chores: TLS cert sync from Caddy, queue statistics for the admin UI, log rotation.
CERT_DIR=/etc/ssl/mail
LOG=/var/log/mail/mail.log

sync_certs() {
  crt=$(find /caddy-data/caddy/certificates -name "${MAIL_HOSTNAME}.crt" 2>/dev/null | head -n1)
  key=$(find /caddy-data/caddy/certificates -name "${MAIL_HOSTNAME}.key" 2>/dev/null | head -n1)
  [ -n "$crt" ] && [ -n "$key" ] || return 0
  if ! cmp -s "$crt" $CERT_DIR/fullchain.pem; then
    cp "$crt" $CERT_DIR/fullchain.pem
    cp "$key" $CERT_DIR/privkey.pem && chmod 600 $CERT_DIR/privkey.pem
    rm -f $CERT_DIR/.selfsigned
    echo "housekeeping: installed new TLS certificate for $MAIL_HOSTNAME"
    return 1   # changed
  fi
}

queue_stats() {
  out=$(postqueue -j 2>/dev/null)
  total=$(printf '%s' "$out" | grep -c queue_name)
  active=$(printf '%s' "$out" | grep -c '"queue_name": *"active"')
  deferred=$(printf '%s' "$out" | grep -c '"queue_name": *"deferred"')
  printf '{"total":%s,"active":%s,"deferred":%s,"updated":%s}\n' "$total" "$active" "$deferred" "$(date +%s)" > /var/log/mail/queue.json.tmp
  mv /var/log/mail/queue.json.tmp /var/log/mail/queue.json; chmod 644 /var/log/mail/queue.json
}

rotate_log() {
  size=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
  if [ "$size" -gt 52428800 ]; then
    mv "$LOG" "$LOG.1"; postfix logrotate; chmod 644 "$LOG" 2>/dev/null
  fi
}

reload_tls() { postfix reload >/dev/null 2>&1; doveadm reload >/dev/null 2>&1; }

if [ "$1" = "certs-once" ]; then sync_certs; exit 0; fi

i=0
while true; do
  sleep 30; i=$((i+1))
  queue_stats
  if [ $((i % 2)) -eq 0 ]; then sync_certs || reload_tls; fi
  if [ $((i % 120)) -eq 0 ]; then rotate_log; fi
done
