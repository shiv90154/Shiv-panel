-- CreateTable
CREATE TABLE "app_databases" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_sealed" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_databases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_databases_account_id_idx" ON "app_databases"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_databases_engine_name_key" ON "app_databases"("engine", "name");

-- AddForeignKey
ALTER TABLE "app_databases" ADD CONSTRAINT "app_databases_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

