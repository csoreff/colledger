/**
 * Sample data for kicking the tyres. Run with: npm run seed
 * Safe to re-run — it clears the tables it owns first.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date;
}

async function main() {
  await prisma.soldComp.deleteMany();
  await prisma.compSearch.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.item.deleteMany();

  // A graded card, bought raw, graded, then sold via accepted Best Offer.
  const charizard = await prisma.item.create({
    data: {
      type: "CARD",
      title: "Charizard",
      setName: "Base Set",
      number: "4/102",
      variant: "Unlimited Holo",
      grader: "PSA",
      grade: "8",
      certNumber: "12345678",
      acquiredAt: daysAgo(120),
      purchasePriceCents: 45_000,
      purchaseSource: "EBAY",
      status: "SOLD",
      compQuery: "charizard base set unlimited",
      expenses: {
        create: [
          {
            category: "GRADING",
            description: "PSA Value submission",
            amountCents: 2_500,
            incurredAt: daysAgo(100),
            vendor: "PSA",
          },
          {
            category: "SHIPPING_IN",
            description: "Shipping to PSA",
            amountCents: 1_800,
            incurredAt: daysAgo(100),
          },
        ],
      },
      sales: {
        create: {
          soldAt: daysAgo(20),
          platform: "EBAY",
          // Listed at $900, accepted an offer of $780.
          grossPriceCents: 78_000,
          listedPriceCents: 90_000,
          wasBestOffer: true,
          shippingCollectedCents: 0,
          platformFeeCents: 10_530,
          shippingCostCents: 1_200,
        },
      },
    },
  });

  // A raw manga volume, still held.
  await prisma.item.create({
    data: {
      type: "MANGA",
      title: "Chainsaw Man Vol. 1",
      setName: "Chainsaw Man",
      number: "1",
      variant: "1st print",
      grader: "RAW",
      condition: "Like New",
      acquiredAt: daysAgo(45),
      purchasePriceCents: 1_200,
      purchaseSource: "LOCAL",
      status: "OWNED",
      compQuery: "chainsaw man vol 1 first print",
      expenses: {
        create: {
          category: "SUPPLIES",
          description: "Mylar sleeve",
          amountCents: 300,
          incurredAt: daysAgo(44),
        },
      },
    },
  });

  // A graded manga that lost money, to exercise the negative path.
  await prisma.item.create({
    data: {
      type: "MANGA",
      title: "One Piece Vol. 1",
      setName: "One Piece",
      number: "1",
      grader: "CGC",
      grade: "9.8",
      acquiredAt: daysAgo(80),
      purchasePriceCents: 32_000,
      purchaseSource: "MERCARI",
      status: "SOLD",
      sales: {
        create: {
          soldAt: daysAgo(5),
          platform: "EBAY",
          grossPriceCents: 26_000,
          shippingCollectedCents: 800,
          platformFeeCents: 3_500,
          shippingCostCents: 950,
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
        amountCents: 3_400,
        incurredAt: daysAgo(30),
        vendor: "Uline",
      },
      {
        category: "SUBSCRIPTION",
        description: "eBay store subscription",
        amountCents: 2_195,
        incurredAt: daysAgo(15),
      },
      {
        category: "TRAVEL",
        description: "Card show admission + parking",
        amountCents: 4_500,
        incurredAt: daysAgo(60),
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
