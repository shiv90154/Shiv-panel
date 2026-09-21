-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dkim_selector" TEXT NOT NULL DEFAULT 'mail',
    "dkim_private_key" TEXT NOT NULL,
    "dkim_public_key" TEXT NOT NULL,
    "dmarc_policy" TEXT NOT NULL DEFAULT 'quarantine',
    "dmarc_report_email" TEXT,
    "spf_qualifier" TEXT NOT NULL DEFAULT '~all',
    "default_quota_mb" INTEGER NOT NULL DEFAULT 1024,
    "max_mailboxes" INTEGER NOT NULL DEFAULT 0,
    "dns_status" JSONB,
    "dns_checked_at" TIMESTAMP(3),
    "dns_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "local_part" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "password_hash" TEXT NOT NULL,
    "quota_mb" INTEGER NOT NULL DEFAULT 1024,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "usage_updated_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aliases" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "destinations" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_logs" (
    "id" SERIAL NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "queue_id" TEXT,
    "direction" TEXT NOT NULL,
    "sender" TEXT,
    "recipient" TEXT,
    "status" TEXT NOT NULL,
    "relay" TEXT,
    "delay" DOUBLE PRECISION,
    "dsn" TEXT,
    "message" TEXT,

    CONSTRAINT "mail_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "domains_name_key" ON "domains"("name");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_email_key" ON "mailboxes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_domain_id_local_part_key" ON "mailboxes"("domain_id", "local_part");

-- CreateIndex
CREATE UNIQUE INDEX "aliases_source_key" ON "aliases"("source");

-- CreateIndex
CREATE INDEX "mail_logs_time_idx" ON "mail_logs"("time");

-- CreateIndex
CREATE INDEX "mail_logs_status_idx" ON "mail_logs"("status");

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

