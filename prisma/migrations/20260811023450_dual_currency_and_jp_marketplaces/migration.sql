/*
  Warnings:

  - You are about to drop the column `amountCents` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `purchasePriceCents` on the `Item` table. All the data in the column will be lost.
  - You are about to drop the column `grossPriceCents` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `listedPriceCents` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `otherFeeCents` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `platformFeeCents` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `shippingCollectedCents` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `shippingCostCents` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `listedPriceCents` on the `SoldComp` table. All the data in the column will be lost.
  - You are about to drop the column `manualPriceCents` on the `SoldComp` table. All the data in the column will be lost.
  - You are about to drop the column `salePriceCents` on the `SoldComp` table. All the data in the column will be lost.
  - You are about to drop the column `shippingCents` on the `SoldComp` table. All the data in the column will be lost.
  - The `currency` column on the `SoldComp` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `amountJpyYen` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountUsdCents` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `purchaseJpyYen` to the `Item` table without a default value. This is not possible if the table is not empty.
  - Added the required column `purchaseUsdCents` to the `Item` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossPriceJpyYen` to the `Sale` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossPriceUsdCents` to the `Sale` table without a default value. This is not possible if the table is not empty.
  - Added the required column `salePriceJpyYen` to the `SoldComp` table without a default value. This is not possible if the table is not empty.
  - Added the required column `salePriceUsdCents` to the `SoldComp` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'JPY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "amountCents",
ADD COLUMN     "amountJpyYen" INTEGER NOT NULL,
ADD COLUMN     "amountUsdCents" INTEGER NOT NULL,
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'USD',
ADD COLUMN     "fxDate" TIMESTAMP(3),
ADD COLUMN     "fxJpyPerUsd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Item" DROP COLUMN "purchasePriceCents",
ADD COLUMN     "purchaseCurrency" "Currency" NOT NULL DEFAULT 'USD',
ADD COLUMN     "purchaseFxDate" TIMESTAMP(3),
ADD COLUMN     "purchaseFxJpyPerUsd" DOUBLE PRECISION,
ADD COLUMN     "purchaseJpyYen" INTEGER NOT NULL,
ADD COLUMN     "purchaseUsdCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Sale" DROP COLUMN "grossPriceCents",
DROP COLUMN "listedPriceCents",
DROP COLUMN "otherFeeCents",
DROP COLUMN "platformFeeCents",
DROP COLUMN "shippingCollectedCents",
DROP COLUMN "shippingCostCents",
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'USD',
ADD COLUMN     "fxDate" TIMESTAMP(3),
ADD COLUMN     "fxJpyPerUsd" DOUBLE PRECISION,
ADD COLUMN     "grossPriceJpyYen" INTEGER NOT NULL,
ADD COLUMN     "grossPriceUsdCents" INTEGER NOT NULL,
ADD COLUMN     "listedPriceJpyYen" INTEGER,
ADD COLUMN     "listedPriceUsdCents" INTEGER,
ADD COLUMN     "otherFeeJpyYen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otherFeeUsdCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platformFeeJpyYen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platformFeeUsdCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingCollectedJpyYen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingCollectedUsdCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingCostJpyYen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingCostUsdCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SoldComp" DROP COLUMN "listedPriceCents",
DROP COLUMN "manualPriceCents",
DROP COLUMN "salePriceCents",
DROP COLUMN "shippingCents",
ADD COLUMN     "fxDate" TIMESTAMP(3),
ADD COLUMN     "fxJpyPerUsd" DOUBLE PRECISION,
ADD COLUMN     "listedPriceJpyYen" INTEGER,
ADD COLUMN     "listedPriceUsdCents" INTEGER,
ADD COLUMN     "manualPriceJpyYen" INTEGER,
ADD COLUMN     "manualPriceUsdCents" INTEGER,
ADD COLUMN     "salePriceJpyYen" INTEGER NOT NULL,
ADD COLUMN     "salePriceUsdCents" INTEGER NOT NULL,
ADD COLUMN     "shippingJpyYen" INTEGER,
ADD COLUMN     "shippingUsdCents" INTEGER,
DROP COLUMN "currency",
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "jpyPerUsd" DOUBLE PRECISION NOT NULL,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'frankfurter',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_requestedDate_key" ON "FxRate"("requestedDate");

-- CreateIndex
CREATE INDEX "FxRate_effectiveDate_idx" ON "FxRate"("effectiveDate");
