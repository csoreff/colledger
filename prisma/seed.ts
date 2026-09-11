/**
 * Sample data for kicking the tyres. Run with: npm run seed
 *
 * Everything is created under one demo account, and the wipe at the start is
 * scoped to that account. That scoping matters now the app is multi-user: an
 * unqualified `deleteMany()` here would clear every account's ledger, which on
 * a shared deployment is somebody's real collection.
 *
 *   SEED_EMAIL     account to seed into (default demo@collectors-ledger.local)
 *   SEED_PASSWORD  password to set when creating it (default "demo-password")
 *
 * Rates here are fixed rather than fetched, so the sample data is identical on
 * every machine. Real entries get the live rate for their transaction date.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SEED_EMAIL = (process.env.SEED_EMAIL ?? "demo@collectors-ledger.local").toLowerCase();
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "demo-password";

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
  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: {
      email: SEED_EMAIL,
      name: "Demo",
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 12),
      role: "ADMIN",
    },
  });
  const userId = user.id;
  const mine = { userId };

  // Scoped to the demo account — see the note at the top of this file.
  await prisma.soldComp.deleteMany({ where: { search: mine } });
  await prisma.compSearch.deleteMany({ where: mine });
  await prisma.sale.deleteMany({ where: mine });
  await prisma.expense.deleteMany({ where: mine });
  await prisma.purchase.deleteMany({ where: mine });
  await prisma.item.deleteMany({ where: mine });

  // Bought in yen on Yahoo Auctions, graded, sold in dollars on eBay via an
  // accepted Best Offer — the whole cross-currency path in one item.
  const charizard = await prisma.item.create({
    data: {
      userId,
      type: "CARD",
      title: "Charizard",
      setName: "Base Set",
      number: "4/102",
      variant: "Japanese Unlimited Holo",
      language: "Japanese",
      compQuery: "charizard base set japanese",
      purchases: { create: [{
      userId,
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
      expenses: {
        create: [
          {
            userId,
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
            userId,
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
          userId,
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
      }] },
    },
  });

  // A raw manga volume bought in yen on PayPay Flea, still held.
  await prisma.item.create({
    data: {
      userId,
      type: "MANGA",
      title: "Chainsaw Man Vol. 1",
      setName: "Chainsaw Man",
      number: "1",
      variant: "1st print",
      language: "Japanese",
      compQuery: "chainsaw man vol 1 first print",
      purchases: { create: [{
      userId,
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
      expenses: {
        create: {
          userId,
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
      // A second copy of the same volume, bought later and graded — this is
      // what the purchase rows exist for.
      {
        userId,
        grader: "CGC",
        grade: "9.8",
        acquiredAt: daysAgo(20),
        purchaseSource: "SNKRDUNK",
        purchaseCurrency: "JPY",
        purchaseFxJpyPerUsd: RATE.sell,
        purchaseFxDate: daysAgo(20),
        purchaseUsdCents: jpy(12_500, RATE.sell).usdCents,
        purchaseJpyYen: 12_500,
        status: "LISTED",
      }] },
    },
  });

  // A SNKRDUNK purchase sold at a loss, to exercise the negative path.
  await prisma.item.create({
    data: {
      userId,
      type: "MANGA",
      title: "One Piece Vol. 1",
      setName: "One Piece",
      number: "1",
      purchases: { create: [{
      userId,
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
          userId,
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
      }] },
    },
  });

  // General overhead, attached to no item.
  await prisma.expense.createMany({
    data: [
      {
        userId,
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
        userId,
        category: "SUBSCRIPTION",
        description: "eBay store subscription",
        incurredAt: daysAgo(15),
        currency: "USD",
        fxJpyPerUsd: RATE.overhead,
        amountUsdCents: 2_195,
        amountJpyYen: usd(21.95, RATE.overhead).jpyYen,
      },
      {
        userId,
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

  console.log(`Seeded ${SEED_EMAIL}. Charizard item id: ${charizard.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
