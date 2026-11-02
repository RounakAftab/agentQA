-- AlterTable
ALTER TABLE "LoadTest" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'request',
ADD COLUMN     "steps" JSONB;

-- AlterTable
ALTER TABLE "LoadRun" ADD COLUMN     "stepStats" JSONB;

