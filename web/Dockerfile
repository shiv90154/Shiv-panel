FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 5000 vmail && useradd -u 5000 -g 5000 -m vmail
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Volumes (vmail / dkim / maillog) inherit this ownership on first mount.
RUN mkdir -p /var/vmail /var/lib/dkim /var/log/mail && chown -R vmail:vmail /var/vmail /var/lib/dkim /app
USER vmail
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
