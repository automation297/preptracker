# Admin Receipt Capture & Spend Tracking — Design

**Status:** Approved by owner 2026-07-24.

## Goal

When an admin (owner) sends ANY photo to the WhatsApp bot, it should never be treated
as a bank-transfer payment proof (admins don't pay via the bot) — it's always a
receipt or document. The bot should: save it, forward it to the accountant (Byron,
`REPORT_PHONE`) with an AI description, acknowledge the sender, and automatically log
it as a purchase entry in PrepTracker for spend tracking — covering both food-truck
business expenses (ingredients, fuel, supplies) and personal spending (meals, alcohol,
clothes, etc.), kept clearly separated so personal spending never pollutes the
existing business Purchases tracker in the PrepTracker app.

## Why this changes existing behavior

Before this change, an admin's photo went through the same bank-transfer/promotion
classification as a customer's photo. If the admin's number happened to have a stray
active/held order awaiting payment, the bot would ask for a "transfer confirmation" —
wrong, since admins never pay through the bot. This change reroutes admin senders to
a dedicated receipt-handling path *before* any of that transfer-matching logic runs,
bypassing it entirely for admin numbers. Customer-facing behavior is completely
unchanged.

## Data model change (PrepTracker: `db/schema.sql`)

```sql
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'business'
  CHECK (scope IN ('business','personal'));
```

Existing rows default to `'business'` — every purchase logged before this change was
an owner-entered ingredient purchase, so this is correct with no backfill needed.

## API changes (PrepTracker: `routes/purchases.js`)

- `GET /api/purchases?range=...`: add `?scope=business|personal|all` (default:
  `business`, preserving today's exact behavior for the existing app UI with zero
  query changes needed there). Add the scope filter to the existing date-range WHERE
  clause.
- `POST /api/purchases`: currently `requireOwner` (session-only — the PrepTracker
  app's own logged-in owner). Add a new `requireOwnerOrApiKey` middleware (in this
  same file) that accepts EITHER a valid `x-preptracker-api-key` header (using the
  same timing-safe comparison pattern as `routes/apiAuth.js`'s `requireApiKey`) OR the
  existing owner-session check — so the bot can call this endpoint too, without
  weakening the app's own auth for human users.
- The POST body gains one new optional field: `scope` (defaults to `'business'` if
  omitted, preserving the existing app's behavior when it doesn't send one).

## Bot changes (`MUCHO-ON-BOT/index.js`)

### New early check in the image handler

Right after `const _fromD = from.replace(/\D/g, '');` inside `message.type ===
'image'`, before the existing "HELD flow order" check, add:

```js
if (isAdmin(from)) {
  // admin photos are never transfer proof — always a receipt/document
  ... handle and return ...
}
```

This must `return` unconditionally for admin senders, so none of the existing
transfer/promotion logic below it ever runs for admin numbers.

### New AI classification: `analyzeReceipt(buffer, mimeType)`

A new function (alongside `analyzeImage`), asking Claude Vision to return:
```json
{"scope":"business|personal","category":"ingredient|fuel|supplies|food|alcohol|clothes|other","item_name":"short description","price_fl":45.00,"description":"one sentence describing what's in the photo"}
```
If the price isn't clearly readable, `price_fl` should be `null` — the bot must not
guess a number; a `null` price means "flag for manual review," not "assume 0."

### Flow for admin photos

1. Download the image (`downloadMetaMedia`, already exists).
2. Call `analyzeReceipt`.
3. Save the image to the existing `PROOF_DIR` with a `receipt_` filename prefix (no
   new directory or route — `/proof/:filename` already serves anything in that
   directory).
4. If `price_fl` is a valid number: call PrepTracker's `POST /api/purchases` with
   `item_name`, `category`, `price_fl`, `qty: 1`, `unit: 'purchase'`, `scope`, and a
   `notes` field noting it was auto-logged via WhatsApp with the image filename for
   traceability.
5. Forward to `REPORT_PHONE` (Byron) with the AI description + `/proof/<filename>`
   link, regardless of whether the purchase-log call succeeded (accounting visibility
   must not depend on the purchases-table write succeeding). Skip this if
   `REPORT_PHONE` equals the sender's own number (avoid a pointless self-forward).
6. Reply to the sender: if logged successfully, confirm what was recorded (item,
   price, scope); if the price couldn't be read, tell them it was forwarded but needs
   manual entry (never fabricate a number in the confirmation either).

## Error handling

- If `analyzeReceipt` throws or returns unparseable JSON, treat it like `analyzeImage`
  already does: fall back to `{ scope: 'business', category: 'other', item_name:
  '(unreadable)', price_fl: null, description: '(could not read image)' }` rather than
  crashing.
- If the PrepTracker `POST /api/purchases` call fails (network, 500, etc.), don't let
  it block saving the file or forwarding to Byron — log the error, still forward, and
  tell the sender the purchase log itself may need manual entry.

## Testing / verification plan

1. `node -c routes/purchases.js` and `node --check index.js` after each edit.
2. Apply the `scope` column to production via `psql -f db/schema.sql` (idempotent).
3. Live-verify `GET /api/purchases` (no `scope` param) still returns only
   `business`-scoped rows, matching current app behavior exactly, before touching the
   bot.
4. Live-verify `POST /api/purchases` works with the API key (no session) with a
   throwaway test row, confirm it appears in the DB, then delete it.
5. Cannot test the bot's WhatsApp-triggered flow without a real photo message — verify
   the new `analyzeReceipt` function and the admin-photo branch via `node --check`
   only, and note this limitation in the final report, same as prior WhatsApp-only
   features this session.
