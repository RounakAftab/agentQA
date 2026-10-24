-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'SUPERSEDED';

-- DropForeignKey
ALTER TABLE "Approval" DROP CONSTRAINT "Approval_assignedToId_fkey";

-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "agentRunId" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ALTER COLUMN "assignedToId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Approval_agentRunId_key" ON "Approval"("agentRunId");

-- CreateIndex
CREATE INDEX "Approval_status_createdAt_idx" ON "Approval"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: the latest verified QA Agent run per ticket that finished before approvals existed
-- gets a pending review. Older runs of the same ticket are left out (they were superseded).
INSERT INTO "Approval" ("id", "projectId", "agentRunId", "type", "title", "description", "status", "requestedBy", "codePreview", "createdAt", "updatedAt")
SELECT DISTINCT ON (r."projectId", r."issueKey")
    'apr_' || r."id",
    r."projectId",
    r."id",
    'automation_script',
    LEFT(r."issueKey" || ': ' || COALESCE(NULLIF(r."issueSummary", ''), 'Generated test'), 300),
    'Playwright spec ' || COALESCE(r."specPath", '') || ' written by the QA Agent and verified passing.' ||
        CASE WHEN r."prUrl" IS NOT NULL THEN ' Pull request: ' || r."prUrl" ELSE '' END,
    'PENDING',
    'QA Agent',
    r."specContent",
    COALESCE(r."finishedAt", r."queuedAt"),
    CURRENT_TIMESTAMP
FROM "AgentRun" r
WHERE r."status" = 'PASSED' AND r."verifiedPass" = true AND r."specContent" IS NOT NULL
ORDER BY r."projectId", r."issueKey", r."finishedAt" DESC NULLS LAST;
