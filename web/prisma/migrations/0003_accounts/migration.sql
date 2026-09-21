-- Phase 0: accounts (admin/reseller/user tree), packages, audit log, API keys, and ownership (account_id)
-- on domains/mailboxes/aliases. Existing admin_users become role=admin accounts (same ids) and own all existing data.
-- The mailreader role keeps its column-limited grants from 0002; the new columns are intentionally NOT granted.

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "parent_id" TEXT,
    "package_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "suspend_reason" TEXT,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_last_step" INTEGER,
    "recovery_codes" TEXT[],
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "disk_mb" INTEGER NOT NULL DEFAULT 0,
    "bandwidth_mb" INTEGER NOT NULL DEFAULT 0,
    "max_domains" INTEGER NOT NULL DEFAULT 0,
    "max_sites" INTEGER NOT NULL DEFAULT 0,
    "max_mailboxes" INTEGER NOT NULL DEFAULT 0,
    "max_databases" INTEGER NOT NULL DEFAULT 0,
    "max_ftp_users" INTEGER NOT NULL DEFAULT 0,
    "max_cron_jobs" INTEGER NOT NULL DEFAULT 0,
    "cpu_percent" INTEGER NOT NULL DEFAULT 0,
    "ram_mb" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "account_id" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip" TEXT,
    "detail" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_key" ON "accounts"("username");
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");
CREATE INDEX "accounts_parent_id_idx" ON "accounts"("parent_id");
CREATE UNIQUE INDEX "packages_owner_id_name_key" ON "packages"("owner_id", "name");
CREATE INDEX "audit_logs_time_idx" ON "audit_logs"("time");
CREATE INDEX "audit_logs_account_id_time_idx" ON "audit_logs"("account_id", "time");
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_account_id_idx" ON "api_keys"("account_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packages" ADD CONSTRAINT "packages_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over existing admins (same id, unique username derived from the email local part).
INSERT INTO "accounts" ("id", "username", "email", "password_hash", "role", "created_at", "updated_at")
SELECT id,
       CASE WHEN rn = 1 THEN base ELSE base || rn::text END,
       lower(email), password_hash, 'admin', created_at, CURRENT_TIMESTAMP
FROM (
  SELECT a.*, COALESCE(NULLIF(lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9]', '', 'g')), ''), 'admin') AS base,
         row_number() OVER (PARTITION BY COALESCE(NULLIF(lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9]', '', 'g')), ''), 'admin') ORDER BY created_at, id) AS rn
  FROM "admin_users" a
) t;

-- Ownership columns: add nullable, backfill with the oldest admin, then make required.
ALTER TABLE "domains" ADD COLUMN "account_id" TEXT;
ALTER TABLE "mailboxes" ADD COLUMN "account_id" TEXT;
ALTER TABLE "aliases" ADD COLUMN "account_id" TEXT;

UPDATE "domains" SET "account_id" = (SELECT id FROM "accounts" WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);
UPDATE "mailboxes" m SET "account_id" = d."account_id" FROM "domains" d WHERE d.id = m."domain_id";
UPDATE "aliases" a SET "account_id" = d."account_id" FROM "domains" d WHERE d.id = a."domain_id";

ALTER TABLE "domains" ALTER COLUMN "account_id" SET NOT NULL;
ALTER TABLE "mailboxes" ALTER COLUMN "account_id" SET NOT NULL;
ALTER TABLE "aliases" ALTER COLUMN "account_id" SET NOT NULL;

CREATE INDEX "domains_account_id_idx" ON "domains"("account_id");
CREATE INDEX "mailboxes_account_id_idx" ON "mailboxes"("account_id");
CREATE INDEX "aliases_account_id_idx" ON "aliases"("account_id");

ALTER TABLE "domains" ADD CONSTRAINT "domains_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropTable
DROP TABLE "admin_users";
