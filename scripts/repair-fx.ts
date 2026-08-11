/**
 * Recomputes the derived currency side for records saved with an FX rate from a
 * date far from their own transaction date (the transient-error fallback bug).
 * The currency the record settled in is authoritative and is never touched.
 */
import { prisma } from "@/lib/prisma";
import { getRateForDate } from "@/lib/fx";
import { jpyYenToUsdCents, usdCentsToJpyYen } from "@/lib/currency";
import { toDateInputValue } from "@/lib/dates";

const days = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / 86400000);
const APPLY = process.argv.includes("--apply");

function fix(primary: "USD" | "JPY", usd: number, jpy: number, rate: number) {
  return primary === "JPY"
    ? { usdCents: jpyYenToUsdCents(jpy, rate), jpyYen: jpy }
    : { usdCents: usd, jpyYen: usdCentsToJpyYen(usd, rate) };
}

async function main() {
  let changed = 0;

  for (const s of await prisma.sale.findMany({ include: { purchase: { include: { item: { select: { title: true } } } } } })) {
    if (!s.fxDate || days(s.fxDate, s.soldAt) <= 7) continue;
    const good = await getRateForDate(s.soldAt);
    if (good.isFallback) { console.log(`SKIP ${s.purchase.item.title}: still no reliable rate`); continue; }

    const p = s.currency as "USD" | "JPY";
    const g = fix(p, s.grossPriceUsdCents, s.grossPriceJpyYen, good.jpyPerUsd);
    const sc = fix(p, s.shippingCollectedUsdCents, s.shippingCollectedJpyYen, good.jpyPerUsd);
    const pf = fix(p, s.platformFeeUsdCents, s.platformFeeJpyYen, good.jpyPerUsd);
    const shc = fix(p, s.shippingCostUsdCents, s.shippingCostJpyYen, good.jpyPerUsd);
    const of = fix(p, s.otherFeeUsdCents, s.otherFeeJpyYen, good.jpyPerUsd);
    const lp = s.listedPriceUsdCents !== null && s.listedPriceJpyYen !== null
      ? fix(p, s.listedPriceUsdCents, s.listedPriceJpyYen, good.jpyPerUsd) : null;

    console.log(`SALE "${s.purchase.item.title}" sold ${toDateInputValue(s.soldAt)} (settled in ${p})`);
    console.log(`  rate  ${s.fxJpyPerUsd} (from ${toDateInputValue(s.fxDate)})  ->  ${good.jpyPerUsd} (from ${toDateInputValue(good.effectiveDate)})`);
    console.log(`  gross $${(s.grossPriceUsdCents/100).toFixed(2)} -> $${(g.usdCents/100).toFixed(2)}   (¥${s.grossPriceJpyYen} unchanged)`);

    if (APPLY) {
      await prisma.sale.update({ where: { id: s.id }, data: {
        fxJpyPerUsd: good.jpyPerUsd, fxDate: good.effectiveDate,
        grossPriceUsdCents: g.usdCents, grossPriceJpyYen: g.jpyYen,
        shippingCollectedUsdCents: sc.usdCents, shippingCollectedJpyYen: sc.jpyYen,
        platformFeeUsdCents: pf.usdCents, platformFeeJpyYen: pf.jpyYen,
        shippingCostUsdCents: shc.usdCents, shippingCostJpyYen: shc.jpyYen,
        otherFeeUsdCents: of.usdCents, otherFeeJpyYen: of.jpyYen,
        ...(lp ? { listedPriceUsdCents: lp.usdCents, listedPriceJpyYen: lp.jpyYen } : {}),
      }});
    }
    changed++;
  }

  for (const i of await prisma.purchase.findMany({ include: { item: { select: { title: true } } } })) {
    if (!i.purchaseFxDate || days(i.purchaseFxDate, i.acquiredAt) <= 7) continue;
    const good = await getRateForDate(i.acquiredAt);
    if (good.isFallback) { console.log(`SKIP purchase ${i.item.title}`); continue; }
    const m = fix(i.purchaseCurrency as "USD" | "JPY", i.purchaseUsdCents, i.purchaseJpyYen, good.jpyPerUsd);
    console.log(`PURCHASE "${i.item.title}" $${(i.purchaseUsdCents/100).toFixed(2)} -> $${(m.usdCents/100).toFixed(2)}`);
    if (APPLY) await prisma.purchase.update({ where: { id: i.id }, data: {
      purchaseFxJpyPerUsd: good.jpyPerUsd, purchaseFxDate: good.effectiveDate,
      purchaseUsdCents: m.usdCents, purchaseJpyYen: m.jpyYen } });
    changed++;
  }

  for (const e of await prisma.expense.findMany()) {
    if (!e.fxDate || days(e.fxDate, e.incurredAt) <= 7) continue;
    const good = await getRateForDate(e.incurredAt);
    if (good.isFallback) { console.log(`SKIP expense ${e.description}`); continue; }
    const m = fix(e.currency as "USD" | "JPY", e.amountUsdCents, e.amountJpyYen, good.jpyPerUsd);
    console.log(`EXPENSE "${e.description}" $${(e.amountUsdCents/100).toFixed(2)} -> $${(m.usdCents/100).toFixed(2)}`);
    if (APPLY) await prisma.expense.update({ where: { id: e.id }, data: {
      fxJpyPerUsd: good.jpyPerUsd, fxDate: good.effectiveDate,
      amountUsdCents: m.usdCents, amountJpyYen: m.jpyYen } });
    changed++;
  }

  console.log(APPLY ? `\nRepaired ${changed} record(s).` : `\n${changed} record(s) would change. Re-run with --apply.`);
  await prisma.$disconnect();
}
main();
