-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "start_command" TEXT,
    "force_https" BOOLEAN NOT NULL DEFAULT true,
    "env_sealed" TEXT,
    "redirects" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'creating',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_domains" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "site_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_account_id_name_key" ON "sites"("account_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "site_domains_name_key" ON "site_domains"("name");

-- CreateIndex
CREATE INDEX "site_domains_site_id_idx" ON "site_domains"("site_id");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

