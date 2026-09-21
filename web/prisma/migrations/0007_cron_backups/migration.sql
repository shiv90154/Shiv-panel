-- CreateTable
CREATE TABLE "cron_jobs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_exit_code" INTEGER,
    "running_since" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cron_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "exit_code" INTEGER,
    "output" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_policies" (
    "account_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "hour" INTEGER NOT NULL DEFAULT 3,
    "keep_daily" INTEGER NOT NULL DEFAULT 7,
    "keep_weekly" INTEGER NOT NULL DEFAULT 4,
    "keep_monthly" INTEGER NOT NULL DEFAULT 3,
    "include_sites" BOOLEAN NOT NULL DEFAULT true,
    "include_databases" BOOLEAN NOT NULL DEFAULT true,
    "include_mail" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),

    CONSTRAINT "backup_policies_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "results" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cron_jobs_account_id_idx" ON "cron_jobs"("account_id");

-- CreateIndex
CREATE INDEX "cron_jobs_site_id_idx" ON "cron_jobs"("site_id");

-- CreateIndex
CREATE INDEX "cron_runs_job_id_started_at_idx" ON "cron_runs"("job_id", "started_at");

-- CreateIndex
CREATE INDEX "backup_runs_account_id_started_at_idx" ON "backup_runs"("account_id", "started_at");

-- AddForeignKey
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cron_runs" ADD CONSTRAINT "cron_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "cron_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

