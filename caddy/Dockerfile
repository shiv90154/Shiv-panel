# Caddy with the Coraza WAF (OWASP Core Rule Set) module. Optional: only needed when a site's WAF is set to detect/block.
#   docker build -t mailhost-caddy-waf ./caddy      then set CADDY_IMAGE=mailhost-caddy-waf in .env and `docker compose up -d caddy`
# With the stock caddy image a site that asks for the WAF fails to deploy with "unrecognized directive: coraza_waf" (its Caddy config is rolled back).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/corazawaf/coraza-caddy/v2

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
