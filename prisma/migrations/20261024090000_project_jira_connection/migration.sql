-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "e2ePasswordEnc" TEXT,
ADD COLUMN     "e2eUsername" TEXT,
ADD COLUMN     "jiraApiTokenEnc" TEXT,
ADD COLUMN     "jiraBaseUrl" TEXT,
ADD COLUMN     "jiraEmail" TEXT,
ADD COLUMN     "jiraStatusDone" TEXT,
ADD COLUMN     "jiraStatusInProgress" TEXT;

