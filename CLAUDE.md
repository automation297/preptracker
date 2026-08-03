# CLAUDE.md — PrepTracker

This file tells Claude Code how this project works. Read it before making any change.

## What this is
A Node/Express + Postgres staff-management app for **Mucho On Food Truck** (Aruba): drop-off/prep tracking, persistent raw/ready inventory, staff time-tracking + payroll, a purchase/spend tracker, and a nightly shift-stock countdown. Served as a single-page app (`public/index.html` + `public/app.js`, no framework, no build step).

**On-screen display name vs. codebase name:** staff/owner using the app see it branded as **"Mucho On Prep Station"** (page `<title>`, PIN-screen logo, nav-bar logo, push-notification fallback title — all in `public/index.html`/`public/sw.js`). "PrepTracker" remains the name of the *codebase* everywhere else — repo name, `package.json`, the Postgres db (`preptracker-db`), env vars (`PREPTRACKER_API_KEY`), API paths/headers (`x-preptracker-api-key`), code comments/identifiers, and this doc's own title. Don't conflate the two: when a user-facing string is added or changed, use "Mucho On Prep Station"; internal/engineering references stay "PrepTracker"/"preptracker".

- **Repo:** github.com/automation297/preptracker
- **Stack:** Node + Express + `pg` (Postgres) + `express-session` (`connect-pg-simple`) + `bcryptjs` + `web-push` + `helmet`, hosted on **Render** (`render.yaml`: one `web` service + one Postgres db, `preptracker-db`, plan `basic-256mb`).
- **No test suite, no build step, no `engines` field.** `npm start` runs `node index.js` directly.

## ⚠️ Sibling project: MUCHO-ON-BOT
This app has **no database of its own concept independent of the bot** — it exists specifically to give the WhatsApp ordering bot (`automation297/MUCHO-ON-BOT`, a separate repo, its own `CLAUDE.md`) somewhere to persist staff hours, purchases, and inventory. The bot calls this app's API via `callPreptracker(method, path, body)`, authenticated with a shared secret (`PREPTRACKER_API_KEY`, must match exactly on both services' Render env vars). **Read `MUCHO-ON-BOT/CLAUDE.md`'s "PrepTracker integration" section for the full cross-repo history** (inventory Phase 1/2 rollout, hotdog/drink/supply_type pack-size lookups, sales-decrement matching, the whole `analyzeReceipt()` → purchase → inventory pipeline) — that file is the system-of-record for anything spanning both repos. This file covers PrepTracker's own internals: schema, routes, auth, frontend structure, deploy.

## Identity model — two SEPARATE tables, don't confuse them
- **`users`** — app login (PIN-based, session-auth). Role is exactly `'owner'` or `'prep'` (DB `CHECK` constraint, `routes/auth.js`). This is who can log into the web app.
- **`staff`** — payroll/time-tracking identity (name, hourly_rate, PIN, active), keyed by lowercase `name`. **No FK to `users` at all.** A person can exist in one table, both, or neither — e.g. the bot's own punch-clock commands operate purely against `staff`/`time_entries`, with zero relationship to who can log into the PrepTracker web app.

## PIN length: 4 digits, not 6 — old design docs are wrong
`docs/superpowers/specs/2026-06-26-preptracker-design.md` (an early planning doc, not maintained) specifies a 6-digit PIN. The actual code (`routes/auth.js`, `/^\d{4}$/`; `db/seed.js` seeds `1234`/`2222`/`0000`) uses **4 digits** — changed by commit `1b3b46b "Switch to 4-digit PINs, add user active flag, deactivate Franklin"`. **The code is authoritative, the docs under `docs/superpowers/` are historical planning artifacts that drift out of sync — don't trust them over the actual running code.** Same caveat applies to other claims in those docs (e.g. one references a `package.json` `engines` field that doesn't actually exist).

## Auth — two independent mechanisms, several hybrid guards
**Session-based** (`routes/auth.js`, exported for other routers to `require`):
- `requireAuth` — 401 unless `req.session.userId` is set (any logged-in role).
- `requireOwner` — 403 unless `req.session.role === 'owner'`.
- `POST /api/auth/login`: PIN must match `/^\d{4}$/`. Loads every active user, `bcrypt.compare`s the PIN against each `pin_hash` in turn (first match wins — fine at this user count, would need indexing by PIN-lookup at real scale). Rate-limited: 5 attempts / 15 min via `express-rate-limit` (`index.js`), applied specifically to this route.
- `routes/proteins.js` additionally defines a local `requirePrep` (403 unless `role==='prep'`), not shared elsewhere.

**API-key based** (`routes/apiAuth.js` — a helper module, NOT itself mounted as a route):
```js
function hasValidApiKey(req) {
  const configured = process.env.PREPTRACKER_API_KEY || '';
  if (!configured) return false;
  const provided = req.get('x-preptracker-api-key') || '';
  const a = Buffer.from(provided), b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```
Header is exactly `x-preptracker-api-key`, comparison is constant-time and length-checked first (avoids `timingSafeEqual` throwing on mismatched lengths). `requireApiKey` (500 if the env var isn't configured at all, 401 if the provided key doesn't match) is the **sole** guard on `routes/staff.js` and `routes/time.js` — bot-only, no session-auth alternative exists for those.

**Hybrid guards** (API key OR session, so both the bot and the human UI can hit the same endpoint) — each defined locally in its own route file, not shared:
- `requireOwnerOrApiKey` in `routes/purchases.js` and (separately) `routes/dropoffs.js`.
- `requireAuthOrApiKey` in `routes/inventory.js` (any logged-in role OR API key — not owner-restricted, since the Dinner button works for any staff role).

## Routes (`routes/*.js`, all mounted under `/api/...` except `apiAuth.js`)
| File | Mount | What it does |
|---|---|---|
| `auth.js` | `/api/auth` | PIN login/logout/me/PIN-change. Exports `requireAuth`/`requireOwner`. |
| `dropoffs.js` | `/api/dropoffs` | Create/list/detail a protein+supplies drop-off; pickup confirmation; push-notifies prep users on create. |
| `proteins.js` | `/api/proteins` | Prep logs kg progress on a dropoff protein; marks "ready" (moves raw→ready via `adjustInventory`, notifies owners). |
| `inventory.js` | `/api/inventory` | `GET /` (per-night dropoff view), `GET /stock` (persistent `inventory_items`), `POST /consume` (Dinner button). Exports `adjustInventory()` — the single upsert path into `inventory_items`, used by `proteins.js` and `purchases.js`. Never write to that table directly from anywhere else. |
| `purchases.js` | `/api/purchases` | Spend-tracker CRUD; hooks protein/drink/supply purchases into `adjustInventory`. |
| `push.js` | `/api/push` | Subscribe/unsubscribe a logged-in user's browser for web-push. |
| `staff.js` | `/api/staff` | Add/list/patch payroll `staff` records. API-key only. |
| `stock.js` | `/api/stock` | Nightly shift-stock: `GET /tonight` (public, `Access-Control-Allow-Origin: *`), open/use/set/close. |
| `time.js` | `/api/time` | Clock in/out, correction request + approval, hours (weekly/today), timesheet, mark-paid, auto-clockout-all, labor-cost (calendar-month total). API-key only. |
| `apiAuth.js` | *(not mounted)* | `hasValidApiKey`/`requireApiKey` helper, imported by other routers. |

**`GET /api/time/labor-cost?month=YYYY-MM`** (added 2026-08-03, for the bot's combined monthly report): deliberately does NOT reuse `weekBounds`/`hoursForStaff` — those are Mon-Sun week-aligned, and a calendar month rarely lines up with week boundaries, so summing weekly totals would double-count or miss days at the edges. Instead runs its own direct SQL aggregate over `time_entries` filtered to `clock_in` within the given month. Only counts `closed`/`approved` entries (a still-open punch mid-month isn't counted, same as the weekly path's default). If a similar "give me a total for an arbitrary date range" need comes up again, follow this same direct-SQL pattern rather than trying to stitch weekly numbers together.

## Database — `db/schema.sql` (no migration runner, see below)
13 tables. `users`/`staff` covered above under Identity model.
- `dropoffs` → `dropoff_proteins` (weight_kg nullable, OR `unit_count` for piece-portioned proteins like hotdogs — app enforces "one or the other," DB doesn't) → `protein_logs` (progress entries). `dropoff_supplies` is free-text `amount`, not numeric.
- `purchases` — `item_name, category, price_fl, qty, unit, notes, bought_at, created_by, scope('business'|'personal')`, plus `weight_kg`/`protein_type`/`protein_price_fl` (protein cost isolated from the receipt's whole total — see MUCHO-ON-BOT's CLAUDE.md for why that split exists), `unit_count`, `drink_type`, `supply_type` (tortilla/bread, one shared "bread" bucket covering both burger buns and sandwich bread).
- `inventory_items` — the ONE persistent raw/ready total per item, survives across nights (unlike `shift_stock` or the `dropoffs` workflow, both of which are per-night/per-batch and reset). `item_name` is the bot's internal key (`steak`/`chicken`/.../`cola`/`color`/`tortilla`/`bread`), NOT `dropoff_proteins.protein_name`'s human label.
- `inventory_consumption` — the Dinner button, deducts `ready_qty` only, deliberately kept separate from any future customer-sales decrement so a staff meal is never mistaken for a sale.
- `shift_sessions` / `shift_stock` — nightly countdown workflow, `UNIQUE(shift_id, item_name)`.
- `time_entries` — `status CHECK IN('open','closed','pending_approval','approved')`, self-referential `linked_entry_id` (a correction row points back at the entry it's amending), partial unique index `idx_time_entries_one_open_per_staff ON time_entries(staff_id) WHERE status='open'` — enforces one open punch per staff member at the DB level, not just in application code.
- `staff_payouts` — `UNIQUE(staff_id, week_start)`, marks a week paid.

**No migration mechanism exists.** Confirmed by grepping the whole repo for `migrate`/`schema.sql` outside `node_modules` — zero hits. `schema.sql` is a flat, idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) file meant to be applied by hand. **Whenever `schema.sql` changes, it must be run manually against production** — `psql "<DATABASE_URL from Render's Connect tab>"`, or paste the new `ALTER TABLE` line directly into a `psql` session. Nothing in `index.js`/`db/pool.js`/`db/seed.js` runs it automatically, and there's no drift-detection — a column that exists in `schema.sql` but was never actually applied to prod will make the corresponding route throw at insert time with a plain Postgres "column does not exist" error, not a friendly message.

One exception: the `session` table (for `express-session`) is auto-created by `connect-pg-simple` itself (`createTableIfMissing: true` in `index.js`) — that one table is NOT in `schema.sql` and needs no manual step.

## Server entrypoint (`index.js`)
- `helmet()` with a custom CSP: `scriptSrc`/`scriptSrcAttr` allow `'unsafe-inline'` (needed for the inline `onclick=` handlers `public/app.js` still uses in a few places — if you ever tighten this CSP, check for silently-broken `onclick`s first, same gotcha documented in the MUCHO-ON-BOT sibling project).
- Session cookie: 30-day maxAge, `httpOnly`, `secure` only in production, `sameSite: 'lax'`. `app.set('trust proxy', 1)` — required for `secure` cookies to work behind Render's proxy; removing it silently breaks login in production only (works fine locally, where `secure` is off).
- **Fatal startup guard:** exits immediately if `NODE_ENV==='production'` and `SESSION_SECRET` is unset or still equal to whatever dev default the code ships with. Don't remove this — it's the thing that stops a misconfigured prod deploy from silently running with a guessable session secret.
- `app.set('notify', notify)` exposes a `notify(userIds, title, body)` web-push helper on the Express `app` object; route handlers call it via `req.app.get('notify')(...)` (`dropoffs.js`, `proteins.js`). `notify()` no-ops if `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` aren't both set — push is optional, never required for core functionality.
- Catch-all `app.get('*', ...)` serves `public/index.html` — this is a client-routed SPA (`go(pageId)` in `app.js` just toggles which `.page` div is visible), not server-side routing. Adding a new "page" means adding a new `<div class="page" id="...">` in `index.html` + wiring `go()`/a loader function in `app.js`, not a new server route.

## Frontend (`public/index.html` + `public/app.js`, no framework)
14 pages (`<div class="page" id="...">`): `pin`, `owner-home`, `prep-home`, `new-dropoff`, `dropoff-list`, `dropoff-detail`, `dinner`, `log-progress`, `prep-history`, `seasoning`, `portions`, `settings`, `purchases`, `stock`.

`app.js` (~1,370 lines) is organized into commented sections, roughly one per page/feature: PIN entry & boot → Owner inventory dashboard & drop-off list/detail/form → Owner settings → Prep home & log-progress → Dinner/staff consumption → Prep history → Push notifications → Portion/seasoning calculator → Purchases tracker → Stock/kitchen countdown. No shared render function across sections — if you fix a rendering bug in one page (e.g. a `fmtKg`/unit-label issue), check whether the same pattern exists in other pages' render functions before assuming it's isolated.

**Two inventory-adjacent things that look similar but aren't:**
1. `renderOwnerStock()` (Owner Home) — reads persistent `inventory_items` via `GET /api/inventory/stock`. This is the ONE place to check current raw/ready stock across nights.
2. `loadStock()`/`renderLiveCountdown()` (the `stock` page, 📦 nav icon) — reads the *nightly* `shift_stock` table via `GET /api/stock/tonight`. Resets every shift, unrelated to `inventory_items`. Don't conflate "check stock" requests — ask which one the owner means if unclear, since both use the word "stock."

The seasoning/bag-cut calculator (`calcSeasoning`/`BAG_CUTS`/`calcPlanNight`) recommends how many oz-bags to cut from a kg of raw protein — this is entirely independent of MUCHO-ON-BOT's own `PORTION_OZ` prep-recommendation math (different app, different file) and has drifted out of sync with it before (see MUCHO-ON-BOT's CLAUDE.md, 2026-07-31 entry) — if the owner ever changes bagging/portion sizes again, check BOTH this calculator and the bot's `PORTION_OZ`/`prepRecommendationMsg`, they don't share a source of truth.
