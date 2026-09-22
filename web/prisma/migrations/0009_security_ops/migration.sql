-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "waf" TEXT NOT NULL DEFAULT 'off';

-- CreateTable
CREATE TABLE "firewall_rules" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "proto" TEXT,
    "port_from" INTEGER,
    "port_to" INTEGER,
    "cidr" TEXT,
    "comment" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firewall_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_runs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "findings" JSONB NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_samples" (
    "ts" TIMESTAMP(3) NOT NULL,
    "cpu_pct" DOUBLE PRECISION,
    "load1" DOUBLE PRECISION,
    "mem_pct" DOUBLE PRECISION,
    "disk_pct" DOUBLE PRECISION,
    "net_rx_bps" DOUBLE PRECISION,
    "net_tx_bps" DOUBLE PRECISION,

    CONSTRAINT "metric_samples_pkey" PRIMARY KEY ("ts")
);

-- CreateIndex
CREATE INDEX "scan_runs_site_id_started_at_idx" ON "scan_runs"("site_id", "started_at");

-- CreateIndex
CREATE INDEX "scan_runs_account_id_idx" ON "scan_runs"("account_id");

-- AddForeignKey
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

