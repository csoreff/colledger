-- Multi-user: logins, API keys, and an owner on every ledger row.
--
-- This migration is hand-written rather than generated because the database it
-- first ran against already held a real ledger. A generated migration would
-- have added a required `userId` to populated tables and failed, or dropped
-- them. Instead the existing rows are adopted by a placeholder account which a
-- real login can then claim -- see `npm run user:adopt`.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ApiScope" AS ENUM ('READ', 'WRITE', 'ADMIN_ALL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" "ApiScope"[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Adopt whatever is already here.
--
-- The placeholder is only created when there is in fact pre-existing data, so
-- a brand-new database comes up with no accounts at all. Its empty
-- passwordHash makes signing in impossible until the account is claimed.
-- ---------------------------------------------------------------------------
INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "createdAt", "updatedAt")
SELECT
    'legacy-owner',
    'legacy-owner@collectors-ledger.local',
    'Original ledger',
    '',
    'ADMIN',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Item")
   OR EXISTS (SELECT 1 FROM "Expense")
   OR EXISTS (SELECT 1 FROM "CompSearch");

-- ---------------------------------------------------------------------------
-- Owner column on every ledger table: add nullable, backfill, then require it.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "userId" TEXT, ADD COLUMN "externalRef" TEXT;
UPDATE "Item" SET "userId" = 'legacy-owner' WHERE "userId" IS NULL;
ALTER TABLE "Item" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "userId" TEXT, ADD COLUMN "externalRef" TEXT;
UPDATE "Purchase" SET "userId" = 'legacy-owner' WHERE "userId" IS NULL;
ALTER TABLE "Purchase" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "userId" TEXT, ADD COLUMN "externalRef" TEXT;
UPDATE "Expense" SET "userId" = 'legacy-owner' WHERE "userId" IS NULL;
ALTER TABLE "Expense" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "userId" TEXT, ADD COLUMN "externalRef" TEXT;
UPDATE "Sale" SET "userId" = 'legacy-owner' WHERE "userId" IS NULL;
ALTER TABLE "Sale" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CompSearch" ADD COLUMN "userId" TEXT;
UPDATE "CompSearch" SET "userId" = 'legacy-owner' WHERE "userId" IS NULL;
ALTER TABLE "CompSearch" ALTER COLUMN "userId" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- A comp cache key is now unique per user, not globally: two accounts
-- researching the same card each keep their own results and corrections.
-- ---------------------------------------------------------------------------
-- DropIndex
DROP INDEX "CompSearch_cacheKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "CompSearch_userId_cacheKey_key" ON "CompSearch"("userId", "cacheKey");
CREATE INDEX "CompSearch_userId_idx" ON "CompSearch"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_userId_externalRef_key" ON "Item"("userId", "externalRef");
CREATE INDEX "Item_userId_idx" ON "Item"("userId");
CREATE UNIQUE INDEX "Purchase_userId_externalRef_key" ON "Purchase"("userId", "externalRef");
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");
CREATE UNIQUE INDEX "Expense_userId_externalRef_key" ON "Expense"("userId", "externalRef");
CREATE INDEX "Expense_userId_idx" ON "Expense"("userId");
CREATE UNIQUE INDEX "Sale_userId_externalRef_key" ON "Sale"("userId", "externalRef");
CREATE INDEX "Sale_userId_idx" ON "Sale"("userId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompSearch" ADD CONSTRAINT "CompSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
