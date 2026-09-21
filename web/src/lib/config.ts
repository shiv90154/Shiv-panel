const env = (k: string, d = "") => process.env[k] ?? d;

export const config = {
  mailHostname: env("MAIL_HOSTNAME", "mail.localhost").toLowerCase(),
  ipv4: env("SERVER_IPV4"),
  ipv6: env("SERVER_IPV6"),
  sessionSecret: env("SESSION_SECRET", "dev-insecure-secret-change-me-please-32"),
  imapHost: env("IMAP_HOST", "127.0.0.1"),
  smtpHost: env("SMTP_HOST", "127.0.0.1"),
  rspamdUrl: env("RSPAMD_URL", "http://rspamd:11334"),
  vmailDir: env("VMAIL_DIR", "/var/vmail"),
  dkimDir: env("DKIM_DIR", "/var/lib/dkim"),
  mailLogDir: env("MAIL_LOG_DIR", "/var/log/mail"),
  cloudflareToken: env("CLOUDFLARE_API_TOKEN"),
  secureCookies: env("COOKIE_SECURE", process.env.NODE_ENV === "production" ? "true" : "false") === "true",
};
