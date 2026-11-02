-- CreateTable
CREATE TABLE "LoadTest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "url" TEXT NOT NULL,
    "body" TEXT,
    "headersEnc" TEXT,
    "headerNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vus" INTEGER NOT NULL DEFAULT 10,
    "rampUpSec" INTEGER NOT NULL DEFAULT 30,
    "durationSec" INTEGER NOT NULL DEFAULT 60,
    "maxP95Ms" INTEGER,
    "maxErrorRatePct" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoadTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadRun" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "config" JSONB NOT NULL,
    "samples" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB,
    "console" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "workerId" TEXT,
    "hostname" TEXT,
    "requestedById" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LoadRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoadTest_projectId_updatedAt_idx" ON "LoadTest"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "LoadRun_testId_createdAt_idx" ON "LoadRun"("testId", "createdAt");

-- CreateIndex
CREATE INDEX "LoadRun_status_createdAt_idx" ON "LoadRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "LoadTest" ADD CONSTRAINT "LoadTest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadTest" ADD CONSTRAINT "LoadTest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadRun" ADD CONSTRAINT "LoadRun_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LoadTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadRun" ADD CONSTRAINT "LoadRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

