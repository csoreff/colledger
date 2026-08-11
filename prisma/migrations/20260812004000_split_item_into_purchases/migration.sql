-- Splits Item into identity (Item) and per-copy acquisition (Purchase).
--
-- Written by hand rather than generated, because the generated version drops
-- the existing rows. Each existing Item becomes exactly one Purchase, and the
-- Purchase deliberately REUSES the Item's id: that makes Expense.itemId and
-- Sale.itemId already-correct references to the new Purchase, so repointing
-- them is a column rename with no data movement at all.

-- 1. The new per-copy table.
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "grader" "Grader" NOT NULL DEFAULT 'RAW',
    "grade" TEXT,
    "certNumber" TEXT,
    "condition" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "purchaseSource" "Marketplace" NOT NULL DEFAULT 'OTHER',
    "purchaseUsdCents" INTEGER NOT NULL,
    "purchaseJpyYen" INTEGER NOT NULL,
    "purchaseCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "purchaseFxJpyPerUsd" DOUBLE PRECISION,
    "purchaseFxDate" TIMESTAMP(3),
    "purchaseNotes" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'OWNED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- 2. Carry every existing item across as its single first purchase.
INSERT INTO "Purchase" (
    "id", "itemId", "grader", "grade", "certNumber", "condition", "quantity",
    "acquiredAt", "purchaseSource", "purchaseUsdCents", "purchaseJpyYen",
    "purchaseCurrency", "purchaseFxJpyPerUsd", "purchaseFxDate",
    "purchaseNotes", "status", "createdAt", "updatedAt"
)
SELECT
    "id", "id", "grader", "grade", "certNumber", "condition", "quantity",
    "acquiredAt", "purchaseSource", "purchaseUsdCents", "purchaseJpyYen",
    "purchaseCurrency", "purchaseFxJpyPerUsd", "purchaseFxDate",
    "purchaseNotes", "status", "createdAt", "updatedAt"
FROM "Item";

-- 3. Expenses now hang off a purchase. NULL still means a general expense.
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_itemId_fkey";
DROP INDEX IF EXISTS "Expense_itemId_idx";
ALTER TABLE "Expense" RENAME COLUMN "itemId" TO "purchaseId";

-- 4. Sales likewise.
ALTER TABLE "Sale" DROP CONSTRAINT IF EXISTS "Sale_itemId_fkey";
DROP INDEX IF EXISTS "Sale_itemId_idx";
ALTER TABLE "Sale" RENAME COLUMN "itemId" TO "purchaseId";

-- 5. Item keeps identity only; everything else moved to Purchase.
DROP INDEX IF EXISTS "Item_status_idx";
DROP INDEX IF EXISTS "Item_acquiredAt_idx";
ALTER TABLE "Item"
    DROP COLUMN "grader",
    DROP COLUMN "grade",
    DROP COLUMN "certNumber",
    DROP COLUMN "condition",
    DROP COLUMN "quantity",
    DROP COLUMN "acquiredAt",
    DROP COLUMN "purchaseSource",
    DROP COLUMN "purchaseUsdCents",
    DROP COLUMN "purchaseJpyYen",
    DROP COLUMN "purchaseCurrency",
    DROP COLUMN "purchaseFxJpyPerUsd",
    DROP COLUMN "purchaseFxDate",
    DROP COLUMN "purchaseNotes",
    DROP COLUMN "status";

-- 6. Indexes and foreign keys.
CREATE INDEX "Item_title_idx" ON "Item"("title");
CREATE INDEX "Purchase_itemId_idx" ON "Purchase"("itemId");
CREATE INDEX "Purchase_status_idx" ON "Purchase"("status");
CREATE INDEX "Purchase_acquiredAt_idx" ON "Purchase"("acquiredAt");
CREATE INDEX "Purchase_grader_idx" ON "Purchase"("grader");
CREATE INDEX "Purchase_purchaseSource_idx" ON "Purchase"("purchaseSource");
CREATE INDEX "Expense_purchaseId_idx" ON "Expense"("purchaseId");
CREATE INDEX "Sale_purchaseId_idx" ON "Sale"("purchaseId");

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
