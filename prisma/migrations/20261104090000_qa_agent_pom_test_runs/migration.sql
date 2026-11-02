-- QA Agent tests are written with page objects, and a run's saved test can be run again.
ALTER TABLE "AgentRun" ADD COLUMN "pageObjects" JSONB;

CREATE TABLE "AgentTestRun" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "headed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "console" TEXT NOT NULL DEFAULT '',
    "results" JSONB,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "workerId" TEXT,
    "hostname" TEXT,
    "requestedById" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTestRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentTestRun_agentRunId_createdAt_idx" ON "AgentTestRun"("agentRunId", "createdAt");
CREATE INDEX "AgentTestRun_status_createdAt_idx" ON "AgentTestRun"("status", "createdAt");

ALTER TABLE "AgentTestRun" ADD CONSTRAINT "AgentTestRun_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentTestRun" ADD CONSTRAINT "AgentTestRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
