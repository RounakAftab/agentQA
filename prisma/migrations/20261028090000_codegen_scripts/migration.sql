-- CreateTable
CREATE TABLE "CodegenScript" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startUrl" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "recording" JSONB NOT NULL,
    "edits" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodegenScript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodegenScript_updatedAt_idx" ON "CodegenScript"("updatedAt");

-- AddForeignKey
ALTER TABLE "CodegenScript" ADD CONSTRAINT "CodegenScript_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
