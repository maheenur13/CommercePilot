-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "contentSha256" TEXT NOT NULL DEFAULT '';
-- Rows from before this column never match a real hash, so applying them by previewId is refused.
ALTER TABLE "ImportJob" ALTER COLUMN "contentSha256" DROP DEFAULT;
