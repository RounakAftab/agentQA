-- AlterTable
ALTER TABLE "CodegenScript" ADD COLUMN     "e2ePasswordEnc" TEXT,
ADD COLUMN     "e2eUsername" TEXT;

-- CreateTable
CREATE TABLE "CodegenRun" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'run',
    "style" TEXT NOT NULL DEFAULT 'pom',
    "headed" BOOLEAN NOT NULL DEFAULT false,
    "fromRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "console" TEXT NOT NULL DEFAULT '',
    "results" JSONB,
    "healedSource" TEXT,
    "healSummary" TEXT,
    "appliedAt" TIMESTAMP(3),
    "costUsd" DOUBLE PRECISION,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "workerId" TEXT,
    "hostname" TEXT,
    "requestedById" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CodegenRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodegenRun_scriptId_createdAt_idx" ON "CodegenRun"("scriptId", "createdAt");

-- CreateIndex
CREATE INDEX "CodegenRun_status_createdAt_idx" ON "CodegenRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CodegenRun" ADD CONSTRAINT "CodegenRun_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "CodegenScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodegenRun" ADD CONSTRAINT "CodegenRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

