-- AlterTable
ALTER TABLE "CIRun" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "runUrl" TEXT;

-- AlterTable
ALTER TABLE "CIFailure" ALTER COLUMN "aiAnalysis" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CIRun_projectId_startedAt_idx" ON "CIRun"("projectId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CIRun_projectId_externalId_key" ON "CIRun"("projectId", "externalId");

