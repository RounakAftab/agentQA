-- CreateTable
CREATE TABLE "LoadTestDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "error" TEXT,
    "costUsd" DOUBLE PRECISION,
    "workerId" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LoadTestDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoadTestDraft_status_createdAt_idx" ON "LoadTestDraft"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "LoadTestDraft" ADD CONSTRAINT "LoadTestDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
