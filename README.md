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

**Items** — a card or a manga volume. Graded (PSA/BGS/CGC/SGC/TAG/ACE, with grade
and cert number) or raw with a free-text condition. Cards get set + card number;
manga gets series + volume. Same model, relabelled per type.

**Expenses** — an item can have as many as you like: grading, inbound shipping,
sleeves, whatever. Each one rolls into that item's cost basis. Expenses with no
item attached are **general expenses** — supplies, subscriptions, show admission,
mileage — tracked separately and subtracted from overall profit rather than from
any single item. `/expenses` filters between the two.

**Sales** — sale price, date, platform, shipping collected, platform fees,
postage, other fees. Best Offer sales record both the accepted price and the
original asking price.

### How profit is calculated

```
cost basis    = purchase price + that item's expenses
net proceeds  = sale price + shipping collected − fees − postage
item profit   = net proceeds − cost basis
net profit    = Σ item profit − general expenses
```

Money is stored as integer cents throughout, so nothing drifts. Amounts are
parsed leniently on input (`$1,234.56` is fine).

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

That leaves one legitimate route to the real number: eBay's **Marketplace
Insights API**. It reports `lastSoldPrice` — the amount actually transacted,
which for a Best Offer listing *is* the accepted offer. Comps from it are marked
confirmed.

The catch: eBay gates the `buy.marketplace.insights` scope behind a business
approval request. A new developer keyset doesn't have it. Until yours does, the
comps page tells you exactly what's missing and manual entry still works.

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
prisma/schema.prisma        data model (money = integer cents)
src/lib/profit.ts           cost basis, net proceeds, profit, ROI
src/lib/money.ts            parsing + formatting
src/lib/comps/              provider interface, eBay API client, caching, stats
src/lib/actions.ts          server actions (create/update/delete)
src/app/                    dashboard, items, expenses, comps
```

## Verified

Build and typecheck pass. Financial math checked by hand against seeded data;
unit assertions cover profit, money parsing, comp stats and grade inference;
a Playwright pass drives every form in a real browser — item creation, item
expense, a Best Offer sale, validation errors, general expenses, and manual comp
entry — with no console errors.
