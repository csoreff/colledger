/**
 * Sample data for kicking the tyres. Run with: npm run seed
 * Safe to re-run — it clears the tables it owns first.
 *
 * Rates here are fixed rather than fetched, so the sample data is identical on
 * every machine. Real entries get the live rate for their transaction date.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date;
}

/** Yen per dollar on the day of each sample transaction. */
const RATE = { buy: 152.4, grade: 154.1, sell: 158.2, overhead: 157.0 };

const usd = (dollars: number, rate: number) => ({
  usdCents: Math.round(dollars * 100),
  jpyYen: Math.round(dollars * rate),
});

const jpy = (yen: number, rate: number) => ({
  usdCents: Math.round((yen / rate) * 100),
  jpyYen: yen,
});

async function main() {
  await prisma.soldComp.deleteMany();
  await prisma.compSearch.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.item.deleteMany();

  // Bought in yen on Yahoo Auctions, graded, sold in dollars on eBay via an
  // accepted Best Offer — the whole cross-currency path in one item.
  const charizard = await prisma.item.create({
    data: {
      type: "CARD",
      title: "Charizard",
      setName: "Base Set",
      number: "4/102",
      variant: "Japanese Unlimited Holo",
      language: "Japanese",
      grader: "PSA",
      grade: "8",
      certNumber: "12345678",
      acquiredAt: daysAgo(120),
      purchaseSource: "YAHOO_AUCTIONS",
      purchaseCurrency: "JPY",
      purchaseFxJpyPerUsd: RATE.buy,
      purchaseFxDate: daysAgo(120),
      purchaseUsdCents: jpy(68_000, RATE.buy).usdCents,
      purchaseJpyYen: 68_000,
      status: "SOLD",
      compQuery: "charizard base set japanese",
      expenses: {
        create: [
          {
            category: "GRADING",
            description: "PSA Value submission",
            incurredAt: daysAgo(100),
            currency: "USD",
            fxJpyPerUsd: RATE.grade,
            amountUsdCents: usd(25, RATE.grade).usdCents,
            amountJpyYen: usd(25, RATE.grade).jpyYen,
            vendor: "PSA",
          },
          {
            category: "SHIPPING_IN",
            description: "Domestic shipping to forwarder",
            incurredAt: daysAgo(100),
            currency: "JPY",
            fxJpyPerUsd: RATE.grade,
            amountUsdCents: jpy(1_200, RATE.grade).usdCents,
            amountJpyYen: 1_200,
          },
        ],
      },
      sales: {
        create: {
          soldAt: daysAgo(20),
          platform: "EBAY",
          currency: "USD",
          fxJpyPerUsd: RATE.sell,
          fxDate: daysAgo(20),
          // Listed at $900, accepted an offer of $780.
          grossPriceUsdCents: 78_000,
          grossPriceJpyYen: usd(780, RATE.sell).jpyYen,
          listedPriceUsdCents: 90_000,
          listedPriceJpyYen: usd(900, RATE.sell).jpyYen,
          wasBestOffer: true,
          platformFeeUsdCents: 10_530,
          platformFeeJpyYen: usd(105.3, RATE.sell).jpyYen,
          shippingCostUsdCents: 1_200,
          shippingCostJpyYen: usd(12, RATE.sell).jpyYen,
        },
      },
    },
  });

  // A raw manga volume bought in yen on PayPay Flea, still held.
  await prisma.item.create({
    data: {
      type: "MANGA",
      title: "Chainsaw Man Vol. 1",
      setName: "Chainsaw Man",
      number: "1",
      variant: "1st print",
      language: "Japanese",
      grader: "RAW",
      condition: "Like New",
      acquiredAt: daysAgo(45),
      purchaseSource: "PAYPAY_FLEA",
      purchaseCurrency: "JPY",
      purchaseFxJpyPerUsd: RATE.buy,
      purchaseFxDate: daysAgo(45),
      purchaseUsdCents: jpy(1_800, RATE.buy).usdCents,
      purchaseJpyYen: 1_800,
      status: "OWNED",
      compQuery: "chainsaw man vol 1 first print",
      expenses: {
        create: {
          category: "SUPPLIES",
          description: "Mylar sleeve",
          incurredAt: daysAgo(44),
          currency: "USD",
          fxJpyPerUsd: RATE.buy,
          amountUsdCents: 300,
          amountJpyYen: usd(3, RATE.buy).jpyYen,
        },
      },
    },
  });

  // A SNKRDUNK purchase sold at a loss, to exercise the negative path.
  await prisma.item.create({
    data: {
      type: "MANGA",
      title: "One Piece Vol. 1",
      setName: "One Piece",
      number: "1",
      grader: "CGC",
      grade: "9.8",
      acquiredAt: daysAgo(80),
      purchaseSource: "SNKRDUNK",
      purchaseCurrency: "JPY",
      purchaseFxJpyPerUsd: RATE.buy,
      purchaseFxDate: daysAgo(80),
      purchaseUsdCents: jpy(48_000, RATE.buy).usdCents,
      purchaseJpyYen: 48_000,
      status: "SOLD",
      sales: {
        create: {
          soldAt: daysAgo(5),
          platform: "EBAY",
          currency: "USD",
          fxJpyPerUsd: RATE.sell,
          fxDate: daysAgo(5),
          grossPriceUsdCents: 26_000,
          grossPriceJpyYen: usd(260, RATE.sell).jpyYen,
          shippingCollectedUsdCents: 800,
          shippingCollectedJpyYen: usd(8, RATE.sell).jpyYen,
          platformFeeUsdCents: 3_500,
          platformFeeJpyYen: usd(35, RATE.sell).jpyYen,
          shippingCostUsdCents: 950,
          shippingCostJpyYen: usd(9.5, RATE.sell).jpyYen,
        },
      },
    },
  });

  // General overhead, attached to no item.
  await prisma.expense.createMany({
    data: [
      {
        category: "SUPPLIES",
        description: "Bubble mailers (100 ct)",
        incurredAt: daysAgo(30),
        currency: "USD",
        fxJpyPerUsd: RATE.overhead,
        amountUsdCents: 3_400,
        amountJpyYen: usd(34, RATE.overhead).jpyYen,
        vendor: "Uline",
      },
      {
        category: "SUBSCRIPTION",
        description: "eBay store subscription",
        incurredAt: daysAgo(15),
        currency: "USD",
        fxJpyPerUsd: RATE.overhead,
        amountUsdCents: 2_195,
        amountJpyYen: usd(21.95, RATE.overhead).jpyYen,
      },
      {
        category: "TRAVEL",
        description: "Card show admission + train",
        incurredAt: daysAgo(60),
        currency: "JPY",
        fxJpyPerUsd: RATE.overhead,
        amountUsdCents: jpy(6_500, RATE.overhead).usdCents,
        amountJpyYen: 6_500,
      },
    ],
  });

  console.log(`Seeded. Charizard item id: ${charizard.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
