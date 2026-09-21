FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN echo "postfix postfix/main_mailer_type select No configuration" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends postfix postfix-pgsql \
      dovecot-core dovecot-imapd dovecot-lmtpd dovecot-pgsql dovecot-sieve \
      supervisor gettext-base openssl ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 5000 vmail && useradd -u 5000 -g vmail -d /var/vmail -s /usr/sbin/nologin vmail \
 && mkdir -p /var/vmail /var/log/mail /etc/ssl/mail && chown vmail:vmail /var/vmail
COPY postfix/ /templates/postfix/
COPY dovecot/ /templates/dovecot/
COPY supervisord.conf /etc/supervisor/conf.d/mail.conf
COPY entrypoint.sh housekeeping.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/housekeeping.sh
EXPOSE 25 143 465 587 993
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
