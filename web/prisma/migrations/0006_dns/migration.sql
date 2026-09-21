-- CreateTable
CREATE TABLE "dns_zones" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dns_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dns_zones_name_key" ON "dns_zones"("name");

-- CreateIndex
CREATE INDEX "dns_zones_account_id_idx" ON "dns_zones"("account_id");

-- AddForeignKey
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
