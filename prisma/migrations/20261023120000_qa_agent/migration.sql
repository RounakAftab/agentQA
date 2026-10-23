-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "appBaseUrl" TEXT,
ADD COLUMN     "jiraProjectKey" TEXT;

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "issueSummary" TEXT NOT NULL DEFAULT '',
    "issueSnapshot" JSONB,
    "testPlan" JSONB,
    "specPath" TEXT,
    "specContent" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "step" TEXT,
    "verifiedPass" BOOLEAN NOT NULL DEFAULT false,
    "testAttempts" INTEGER NOT NULL DEFAULT 0,
    "branch" TEXT,
    "prUrl" TEXT,
    "costUsd" DOUBLE PRECISION,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedById" TEXT,
    "workerId" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentWorker" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentWorker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_status_queuedAt_idx" ON "AgentRun"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "AgentRun_projectId_issueKey_idx" ON "AgentRun"("projectId", "issueKey");

-- CreateIndex
CREATE INDEX "AgentRunEvent_runId_at_idx" ON "AgentRunEvent"("runId", "at");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

