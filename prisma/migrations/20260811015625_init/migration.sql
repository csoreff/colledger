-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('CARD', 'MANGA');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('OWNED', 'LISTED', 'SOLD', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "Grader" AS ENUM ('RAW', 'PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('SHIPPING_IN', 'SHIPPING_OUT', 'GRADING', 'SUPPLIES', 'PLATFORM_FEE', 'TAX', 'TRAVEL', 'SUBSCRIPTION', 'STORAGE', 'AUTHENTICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('EBAY', 'TCGPLAYER', 'WHATNOT', 'MERCARI', 'AMAZON', 'FACEBOOK', 'LOCAL', 'SHOW', 'OTHER');

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "setName" TEXT,
    "number" TEXT,
    "variant" TEXT,
    "language" TEXT NOT NULL DEFAULT 'English',
    "grader" "Grader" NOT NULL DEFAULT 'RAW',
    "grade" TEXT,
    "certNumber" TEXT,
    "condition" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "purchasePriceCents" INTEGER NOT NULL,
    "purchaseSource" "Marketplace" NOT NULL DEFAULT 'OTHER',
    "purchaseNotes" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'OWNED',
    "imageUrl" TEXT,
    "notes" TEXT,
    "compQuery" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "itemId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "vendor" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "platform" "Marketplace" NOT NULL DEFAULT 'EBAY',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grossPriceCents" INTEGER NOT NULL,
    "shippingCollectedCents" INTEGER NOT NULL DEFAULT 0,
    "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCostCents" INTEGER NOT NULL DEFAULT 0,
    "otherFeeCents" INTEGER NOT NULL DEFAULT 0,
    "wasBestOffer" BOOLEAN NOT NULL DEFAULT false,
    "listedPriceCents" INTEGER,
    "buyer" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompSearch" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "itemType" "ItemType",
    "grader" "Grader",
    "grade" TEXT,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "warning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoldComp" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "imageUrl" TEXT,
    "soldAt" TIMESTAMP(3),
    "salePriceCents" INTEGER NOT NULL,
    "listedPriceCents" INTEGER,
    "shippingCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "wasBestOffer" BOOLEAN NOT NULL DEFAULT false,
    "priceIsConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "manualPriceCents" INTEGER,
    "grader" "Grader",
    "grade" TEXT,
    "condition" TEXT,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldComp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Item_type_idx" ON "Item"("type");

-- CreateIndex
CREATE INDEX "Item_status_idx" ON "Item"("status");

-- CreateIndex
CREATE INDEX "Item_acquiredAt_idx" ON "Item"("acquiredAt");

-- CreateIndex
CREATE INDEX "Expense_itemId_idx" ON "Expense"("itemId");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "Expense_incurredAt_idx" ON "Expense"("incurredAt");

-- CreateIndex
CREATE INDEX "Sale_itemId_idx" ON "Sale"("itemId");

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompSearch_cacheKey_key" ON "CompSearch"("cacheKey");

-- CreateIndex
CREATE INDEX "CompSearch_query_idx" ON "CompSearch"("query");

-- CreateIndex
CREATE INDEX "SoldComp_searchId_idx" ON "SoldComp"("searchId");

-- CreateIndex
CREATE INDEX "SoldComp_soldAt_idx" ON "SoldComp"("soldAt");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoldComp" ADD CONSTRAINT "SoldComp_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "CompSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
