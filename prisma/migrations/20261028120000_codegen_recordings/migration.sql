-- CreateTable
CREATE TABLE "CodegenRecording" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "liveCode" TEXT,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "scriptId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "workerId" TEXT,
    "hostname" TEXT,
    "requestedById" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodegenRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodegenRecording_status_createdAt_idx" ON "CodegenRecording"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CodegenRecording" ADD CONSTRAINT "CodegenRecording_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
