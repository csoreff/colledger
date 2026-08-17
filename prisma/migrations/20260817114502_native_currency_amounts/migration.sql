-- Records the amount in the currency actually paid, so GBP and AUD purchases
-- keep an authoritative figure. USD and JPY already have a reporting column
-- each, so for those the native amount simply mirrors it.

ALTER TABLE "FxRate" ADD COLUMN "gbpPerUsd" DOUBLE PRECISION;
ALTER TABLE "FxRate" ADD COLUMN "audPerUsd" DOUBLE PRECISION;

ALTER TABLE "Purchase" ADD COLUMN "purchaseNativeMinor" INTEGER;
ALTER TABLE "Purchase" ADD COLUMN "purchaseFxNativePerUsd" DOUBLE PRECISION;

-- Backfill: every existing row settled in USD or JPY, so the native amount is
-- whichever reporting column matches its currency.
UPDATE "Purchase"
SET "purchaseNativeMinor" = CASE
        WHEN "purchaseCurrency" = 'JPY' THEN "purchaseJpyYen"
        ELSE "purchaseUsdCents"
    END,
    "purchaseFxNativePerUsd" = CASE
        WHEN "purchaseCurrency" = 'JPY' THEN "purchaseFxJpyPerUsd"
        ELSE 1
    END;
