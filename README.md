# Collectors Ledger

Tracks trading card and manga purchases, sales, expenses and profit, plus a
sold-comp lookup for pricing things up.

Next.js 14 · TypeScript · Tailwind · Prisma 5.22 · PostgreSQL. Single user, no login.

## Running it

```bash
npm install
npx prisma migrate deploy   # or `migrate dev` when changing the schema
npm run seed                # optional sample data; wipes existing rows
npm run dev                 # http://localhost:3000
```

`DATABASE_URL` lives in `.env` and points at the local Postgres database
`collectors_ledger`. `npm run seed` resets the tables to a small sample set —
run it once to look around, then wipe it and enter your own.

## What it tracks

**Items and purchases** — an **Item** is what the card or volume *is*: type,
title, set/series, number/volume, variant, language. A **Purchase** is one copy
you actually bought, and a card can have as many as you like. Each purchase row
carries its own date, price, currency, source, grading, quantity and status, and
owns its own expenses and sale.

That separation is the point: buy the same card three times — a PSA 10 from
Yahoo Auctions in yen, a raw copy from eBay in dollars, an ARS 10+ later — and
each stays independent. Selling one copy never touches the others.

Purchases can be edited two ways. The pencil on a row opens it inline on the
card's page, for correcting one copy; the card's **Edit** button opens the whole
item — identity plus every row — for bigger changes. Both share the same
validation and FX handling. Editing a row leaves its expenses, its sale and its
sibling rows alone.

Grading is per copy (PSA/BGS/CGC/SGC/TAG/ACE/ARS with grade and cert, or raw
with a free-text condition), because cert numbers belong to a physical slab.
ARS is the one grader whose scale runs to **10+**; the form shows each grader's
ceiling.

A row's **quantity** means "this one purchase covered N identical copies", and
its price is the **total for the row, not per card**. Counts shown as "held" and
"sold" are **cards**, not rows — a card with 18 purchase rows totalling 40
copies reads "40 held · across 18 purchases".

**Sorting** — every column on the collection list except "Grades held" is
sortable: click a heading to sort, click again to flip. Money columns sort by
their **USD** value, since a single ordering has to pick a currency and the rate
moved between purchases. Cards with nothing sold sink to the bottom of a profit
sort in both directions rather than leading the ascending one. Sort and filters
are independent — changing one keeps the other.

**Where you bought and sold** — eBay, SNKRDUNK, PayPay Flea Market / Yahoo Flea,
Yahoo Auctions, Mercari, TCGplayer, Whatnot, Amazon, Facebook, local, and shows.
The collection list filters by source. Picking a Japanese marketplace defaults
the currency to yen.

**Expenses** — a purchase can have as many as you like: grading, inbound
shipping, sleeves, whatever. Each rolls into that copy's cost basis. Any expense
can be edited in place from either the expenses page or the card it belongs to —
the pencil icon expands the row into a form. Changing an expense's date
re-converts it at the rate for the new date, rather than leaving a figure
converted at the old one. Which purchase an expense belongs to is not editable;
delete and re-add to move one. Expenses with no purchase attached are
**general expenses** — supplies, subscriptions, show admission,
mileage — tracked separately and subtracted from overall profit rather than from
any single item. `/expenses` filters between the two.

**Sales** — sale price, date, platform, shipping collected, platform fees,
postage, other fees. Best Offer sales record both the accepted price and the
original asking price.

### How profit is calculated

Everything is computed **per purchase row**, then rolled up to the card and the
portfolio:

```
cost basis     = row's price + that row's expenses
net proceeds   = sale price + shipping collected − fees − postage
row profit     = net proceeds − cost basis
card profit    = Σ profit of that card's sold rows
net profit     = Σ row profit − general expenses
```

Every one of those is computed in USD and JPY at once — see below.

## Currencies

Four are supported, in two roles.

**USD and JPY are the reporting pair.** Every amount is held twice — USD in
cents and JPY in whole yen — and every total, sort and profit figure is computed
in both. Yen has no subunit, so it is never scaled by 100. Both are integers, so
nothing drifts.

**GBP and AUD are transaction currencies.** A purchase paid in either is stored
natively (in pence or Australian cents) alongside the derived USD/JPY pair, so
the figure that actually left your account is preserved exactly while every
rollup keeps working unchanged. The purchase form shows three boxes in that
case — the native currency leading, then USD and JPY — and typing in any one
fills the others.

Amounts are formatted with an explicit symbol rather than left to `Intl`, which
renders AUD as a bare `$` in a US locale and would be indistinguishable from
USD.

Sales, expenses and manual comps accept USD and JPY only. They have nowhere to
record a native GBP/AUD figure, so offering those would silently discard what
was actually paid — say the word and the same native-amount treatment extends
to them.

Each record also stores **the currency it actually settled in and the FX rate on
its own transaction date**. That matters more than it sounds: a card bought on
Yahoo Auctions in yen and sold on eBay in dollars is converted at two different
rates, so the yen profit and the dollar profit are genuinely different numbers,
and each is correct in its own currency. The dashboard reports ROI separately
for exactly this reason.

Because both sides are stored rather than converted on read, a figure stays at
its historical value however rates move afterwards.

### Entering amounts

Every price field is a **pair of boxes, one USD and one JPY**. Type in either and
the other fills at the rate for that record's date; the form shows which rate it
used. Whichever pair is on screen is what gets saved — so when a marketplace
gives you its own conversion (usually with a spread), type both in and your
figures are kept as-is rather than overwritten with the mid-market rate.

### Where the rates come from

Historical ECB rates via [frankfurter.dev](https://frankfurter.dev) — free, no
API key. JPY, GBP and AUD come back in a single call per date and are cached
together in the `FxRate` table. A date cached before GBP/AUD support holds only
a JPY rate, so asking for one of the others refetches and fills it in.
Three behaviours worth knowing, all verified against the live API:

- **Weekends and holidays** have no published rate, so the previous business day
  is used and the form says so ("markets were shut on 2026-03-01, using
  2026-02-27").
- **Outside the series** (before 1999-01-04, or a future date) the rate clamps to
  the *nearer* end — the 1999 opening rate for an old date, the latest
  publication for a future one. Never unconditionally "today".
- **Transient upstream errors are not treated as "no rate exists."** A 5xx or a
  network blip is retried, then falls back to the nearest *cached* rate by date.
  Conflating the two is how a 2020 purchase ends up priced at today's rate.
- **With no usable cache**, you're told to enter both amounts by hand — which
  always works.

Every substitution reports how many days away the rate came from. A one-day
weekend roll-back is shown quietly; anything beyond a week is highlighted and
tells you to enter both amounts yourself.

`npm run fx:audit` lists any stored record whose rate came from a date far from
its own transaction date; `npm run fx:repair` recomputes the derived currency
side at the correct rate, leaving the currency the record settled in untouched.

## Sold comps, and the Best Offer problem

You asked for true accepted Best Offer prices rather than asking prices. That's
worth being precise about, because it constrains the design:

- eBay **deliberately hides** the accepted amount on sold Best Offer listings.
  The listing shows the original asking price and a "Best offer accepted" label.
- eBay's public **Browse API has no sold data at all**.
- eBay **blocks scripted access to its search pages** — `/sch/` returns a bot
  error page, verified against the live site.
- 130point.com, which does surface true accepted offers, sits behind a
  Cloudflare JavaScript challenge. Getting through it means defeating an
  anti-bot control, so this app doesn't attempt it.

That leaves one route to the real number: eBay's **Marketplace Insights API**.
It reports `lastSoldPrice` — the amount actually transacted, which for a Best
Offer listing *is* the accepted offer. Comps from it are marked confirmed.

The catch, verified against a live production keyset in August 2026: the
`buy.marketplace.insights` scope returns `invalid_scope`. It is a Limited
Release API and eBay's own documentation states it is restricted and **not open
to new users**. So the integration is built and works the moment a keyset is
granted the scope, but that grant is not currently obtainable by applying.

The other routes are closed rather than merely inconvenient:

| Route | State (Aug 2026) |
|---|---|
| Marketplace Insights API | `invalid_scope` — Limited Release, closed to new users |
| Finding API `findCompletedItems` | Restricted Oct 2020, API decommissioned Feb 2025 — endpoint returns HTTP 418 |
| Browse API | Active listings only; no sold data |
| eBay sold-search pages | Bot-blocked to scripted access |
| 130point.com | Cloudflare JS challenge |

Which is why manual entry is the working path, not a placeholder.

### Providers

Set `COMP_PROVIDER` in `.env`:

| Value | Behaviour |
|---|---|
| `ebay-api` | Marketplace Insights. Needs `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` and the approved scope. Reports true accepted offer prices. |
| `manual` | No network calls. You enter every comp yourself. |

Providers implement `CompProvider` in `src/lib/comps/types.ts`, so adding another
source later is a single file plus a registry line in `src/lib/comps/index.ts`.

### Confirmed vs unconfirmed prices

Every comp carries a `priceIsConfirmed` flag:

- **confirmed** — the price is what the buyer actually paid.
- **unconfirmed** — the listing closed via Best Offer and the provider couldn't
  see the accepted amount, so the stored figure is only the asking price, i.e.
  an upper bound.

Unconfirmed comps are **excluded from the median/average/low/high** so a hidden
offer can't bias your pricing upward. They're still listed, struck through, with
a pencil icon — type in the real number (from the buyer's feedback, your own
records, wherever) and it counts from then on. Your number always beats the
provider's, and it survives refreshes.

Searches are cached in the database for `COMP_CACHE_MINUTES` (default 12 hours);
"Refresh" forces a re-fetch. Hand-added comps and manual corrections are never
overwritten by a refresh.

## Layout

```
prisma/schema.prisma        data model (every amount stored in USD cents + JPY yen)
src/lib/profit.ts           per-row financials, card rollup, portfolio totals
src/lib/currency.ts         the USD/JPY Money pair: conversion, parsing, formatting
src/lib/fx.ts               historical rate lookup + caching + fallbacks
src/lib/comps/              provider interface, eBay API client, caching, stats
src/lib/actions.ts          server actions (create/update/delete)
src/components/PurchaseRows.tsx  the repeatable purchase-row editor
src/components/PurchaseCard.tsx  one expandable row on the item page
src/app/                    dashboard, items, expenses, comps
```

## Verified

Build and typecheck pass. Financial math checked by hand against seeded data.
Unit assertions cover profit, cross-currency conversion, comp stats, and grade
inference (including ARS 10+ and CGC 9.8). FX caching, weekend roll-back,
out-of-range fallback and offline behaviour are tested against the live API.
Playwright drives every form in a real browser — creating a card with two
purchase rows in different currencies, checking each row converts at its own
date's rate, selling only one copy and confirming the others are untouched,
adding a third copy from the item page, and the aggregated collection list —
with no console errors and no hydration mismatches.
