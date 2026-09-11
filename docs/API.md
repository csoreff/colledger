# Collectors Ledger API

A REST API over the ledger, authenticated with API keys. It exists so a ledger
can be seeded, updated or queried from somewhere other than the browser — an
import script, a spreadsheet exporter, a scheduled job on another machine.

Base path: `/api/v1`

---

## Authentication

Create a key at **Settings → Create an API key**. The plaintext is shown once;
only its SHA-256 is stored, so a lost key must be replaced rather than
recovered.

Send it as a bearer token:

```bash
curl -H "Authorization: Bearer cl_xxxxxxxx…" \
     https://your-app.vercel.app/api/v1/stats
```

`X-API-Key: cl_…` works too, for clients that reserve the Authorization header.

### Scopes

| Scope | Allows |
| --- | --- |
| `READ` | Listing and fetching. |
| `WRITE` | Creating, updating, deleting. Implies `READ`. |
| `ADMIN_ALL` | Acting on any account, and managing users. Implies the other two. Only an admin account can mint one. |

### Acting on another account

A key acts on its owner's ledger. A key with `ADMIN_ALL` can point at a
different one — this is how a single admin key seeds every user from one
script:

```bash
curl -H "Authorization: Bearer cl_…" \
     -H "X-Ledger-User: someone@example.com" \
     https://your-app.vercel.app/api/v1/items
```

The header takes an email or a user id. `?userId=` / `?userEmail=` work
identically for clients that can't set headers.

### Errors

Every failure is the same shape, with a `code` worth branching on:

```json
{ "error": { "code": "invalid_request", "message": "purchases[0] price: …" } }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | Missing, unknown, revoked or expired key. |
| `forbidden` | 403 | Key lacks the scope, or tried to reach another account. |
| `not_found` | 404 | No such row in this ledger. |
| `invalid_request` | 422 | Body failed validation; `details` lists the fields. |
| `conflict` | 409 | Already exists (e.g. a duplicate email). |
| `server_error` | 500 | Unhandled. |

---

## Money

Every amount is stored twice — USD cents and whole yen — at the exchange rate
for that record's own transaction date. **Yen has no subunit**: ¥68,000 is
`68000`, never `6800000`.

An amount can be given three ways:

```jsonc
{ "currency": "USD", "amount": 780.00 }   // major units
{ "currency": "JPY", "minor": 68000 }     // minor units (cents / pence / yen)
{ "usdCents": 78000, "jpyYen": 123396 }   // both sides stated outright
```

Stating both sides wins and skips the rate lookup entirely. Use it when
importing historical records whose real conversion is already known — a
marketplace's own rate beats a mid-market one, and it is also the fallback when
no rate is published for a date.

`GBP` and `AUD` are accepted as transaction currencies on purchases: the native
figure is kept alongside the converted pair. Expenses and sales have no native
column, so an amount in those currencies is converted and recorded as USD.

Dates are `YYYY-MM-DD` or full ISO timestamps.

---

## Idempotency: `externalRef`

Every writable resource takes an `externalRef` — your own identifier for the
row. It is unique per account, and any write that carries one **upserts**:

```bash
# Run this twice: one item, updated the second time, not two items.
curl -X POST /api/v1/items -H "Authorization: Bearer cl_…" \
  -d '{"externalRef":"sheet-row-42","type":"CARD","title":"Charizard"}'
```

Without an `externalRef`, a POST always inserts.

`externalRef` also works in place of an id anywhere a path takes one:
`GET /api/v1/items/sheet-row-42`.

---

## Endpoints

### `GET /api/v1/me`

Confirms which key is in use, what it can do, and whose ledger it is pointed
at. The first call to make when wiring up a script.

### Items

| | |
| --- | --- |
| `GET /api/v1/items` | Filters: `q`, `type`, `status`, `grader`, `source`, `externalRef`. `?rollup=1` adds computed cost basis, proceeds and realized profit. |
| `POST /api/v1/items` | One item or an array. Upserts on `externalRef`. |
| `GET /api/v1/items/{id}` | With every copy, expense and sale, plus the rollup. |
| `PATCH /api/v1/items/{id}` | Identity fields only; omitted keys are left alone. |
| `DELETE /api/v1/items/{id}` | Cascades to copies, expenses and sales. |

```bash
curl -X POST https://your-app.vercel.app/api/v1/items \
  -H "Authorization: Bearer cl_…" -H "Content-Type: application/json" \
  -d '{
    "externalRef": "charizard-base-4",
    "type": "CARD",
    "title": "Charizard",
    "setName": "Base Set",
    "number": "4/102",
    "language": "Japanese",
    "purchases": [{
      "externalRef": "charizard-base-4-copy1",
      "grader": "PSA",
      "grade": "8",
      "certNumber": "12345678",
      "acquiredAt": "2026-04-12",
      "purchaseSource": "YAHOO_AUCTIONS",
      "price": { "currency": "JPY", "minor": 68000 },
      "status": "OWNED"
    }]
  }'
```

Copies absent from a payload are left alone, not deleted — a push that names
two copies is saying "these exist", not "and nothing else does".

### Purchases

| | |
| --- | --- |
| `GET /api/v1/purchases` | Filters: `itemId`, `status`, `grader`, `source`, `acquiredSince`, `acquiredUntil`. `?financials=1` adds per-copy cost basis and profit. |
| `POST /api/v1/purchases` | Adds copies to existing cards; name the card with `itemId` or `itemRef`. |
| `GET/PUT/DELETE /api/v1/purchases/{id}` | `PUT` is a full replace — price, currency and FX date are derived together, so send the whole copy. |

### Expenses

| | |
| --- | --- |
| `GET /api/v1/expenses` | `?scope=general` (overhead) or `?scope=item`. Also `category`, `since`, `until`. Returns totals across the whole filtered set, not just the page. |
| `POST /api/v1/expenses` | Attach to a copy with `purchaseId`/`purchaseRef`; omit both for general overhead. |
| `GET/PUT/DELETE /api/v1/expenses/{id}` | |

### Sales

| | |
| --- | --- |
| `GET /api/v1/sales` | Filters: `purchaseId`, `platform`, `since`, `until`. Each row includes `net` (after fees and postage). |
| `POST /api/v1/sales` | Also marks the copy `SOLD`. A Best Offer sale needs `listedPrice` as well as `grossPrice`. |
| `DELETE /api/v1/sales/{id}` | Removing a copy's last sale returns it to inventory. |

### `GET /api/v1/stats`

The dashboard figures as JSON — net profit, proceeds, cost basis and ROI in
both currencies, plus expenses by category. Computed through the same code the
web page uses, so the two can't disagree.

### `POST /api/v1/import`

Seeds or refreshes a whole ledger in one call. Writes in dependency order:
items and their copies first, so expenses and sales can reference a copy by
`purchaseRef` in the same payload.

```jsonc
{
  "dryRun": false,
  "items": [ /* as POST /items */ ],
  "expenses": [{
    "externalRef": "exp-1",
    "purchaseRef": "charizard-base-4-copy1",
    "category": "GRADING",
    "description": "PSA Value submission",
    "incurredAt": "2026-05-02",
    "amount": { "currency": "USD", "amount": 25 }
  }],
  "sales": [{
    "externalRef": "sale-1",
    "purchaseRef": "charizard-base-4-copy1",
    "soldAt": "2026-08-20",
    "platform": "EBAY",
    "grossPrice": { "currency": "USD", "amount": 780 },
    "wasBestOffer": true,
    "listedPrice": { "currency": "USD", "amount": 900 },
    "platformFee": { "currency": "USD", "amount": 105.30 }
  }]
}
```

Run it with `"dryRun": true` first against a ledger that matters: it reports
unresolvable references without writing anything.

### Users — `ADMIN_ALL` only

| | |
| --- | --- |
| `GET /api/v1/users` | Every account with row counts. Never returns password hashes. |
| `POST /api/v1/users` | Provision an account: `email`, `password`, optional `name` and `role`. |

---

## Paging

List endpoints take `?limit=` (default 50, max 500) and `?offset=`, and return:

```json
{
  "data": [ … ],
  "pagination": { "limit": 50, "offset": 0, "total": 249, "hasMore": true }
}
```
