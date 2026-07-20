# Staff Time Tracking & Payroll — Design

**Status:** Approved by owner 2026-07-20. First sub-project of the PrepTracker v2 build
(see `/Users/somoarua/Downloads/preptracker-v2-brief.md`, section 15 + section 14 admin
commands + section 3 tables).

## Goal

One source of truth for staff hours and pay, usable both by the WhatsApp bot
(`MUCHO-ON-BOT`, text commands from a shared work phone) and the existing cashier
app's PIN-punch button — replacing the bot-local `punchRecords`/`STAFF_RATES_JSON`/
`STAFF_PINS_JSON` mechanism with Postgres-backed data in `preptracker-db`.

## Why unify instead of building a parallel system

The cashier app already has a working punch system (`STAFF_RATES`, `STAFF_PINS`,
`punchRecords` in `MUCHO-ON-BOT/index.js`, ~line 5266 and 6800-6870) tied to
register-shift open/close (`openingFloat` for cash reconciliation). Building the new
WhatsApp/Postgres system independently would create two disconnected records of a
person's hours. Per this project's own convention (reuse existing infra, don't build
parallels), the new Postgres tables become the single source of truth; both entry
points (cashier PIN-punch button, WhatsApp text commands) write through the same
PrepTracker API.

`openingFloat` (cash-drawer float) is NOT part of this system — it's a
register-reconciliation detail, kept exactly as-is in the bot's local per-shift state.
Only clock-in/out timestamps, hours, and pay move into Postgres.

## Data model (new tables, `db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,          -- stored lowercase for lookups
  display_name TEXT NOT NULL,         -- original casing for messages/reports
  hourly_rate NUMERIC(6,2) NOT NULL,
  pin TEXT,                            -- optional, matches cashier app's staffPin check
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('bot','app')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','pending_approval','approved')),
  requested_time TIMESTAMPTZ,          -- what the punch claimed, before approval
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_staff ON time_entries(staff_id, clock_in);

CREATE TABLE IF NOT EXISTS staff_payouts (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  week_start DATE NOT NULL,           -- the Monday the paid week started
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, week_start)
);
```

Hours are computed at query time (`EXTRACT(EPOCH FROM (clock_out - clock_in))/3600`),
not stored, so an approved correction just updates `clock_in`/`clock_out` and every
downstream total reflects it automatically.

Seed data migrates the two staff already live in `STAFF_RATES_JSON`/`STAFF_PINS_JSON`:
Delroy Porter ($15/hr), Nigel ($13.26/hr).

## API (new `routes/time.js` + `routes/staff.js` in preptracker)

Machine-to-machine auth: new `requireApiKey` middleware (mirrors `requireAuth` in
`routes/auth.js` but checks header `x-preptracker-api-key` against
`process.env.PREPTRACKER_API_KEY`) — these endpoints move money, so unlike the
public/CORS-open `/api/stock/tonight`, they must not be open.

- `POST /api/staff` `{name, hourly_rate}` — create staff (rejects duplicate name)
- `PATCH /api/staff/:name` `{hourly_rate?, active?}`
- `GET /api/staff` — list all (for `staff list` command)
- `POST /api/time/clock-in` `{name, source, requestedTime?}`
  - Rejects (400) if already has an `open` entry for that staff — bot relays "already
    clocked in."
  - If no `requestedTime`, uses server `NOW()`.
  - The entry is always created with status `open` (the shift is live either way).
    The 15-minute rule only decides whether `requestedTime` is trusted as the actual
    `clock_in` outright, or whether the server's `NOW()` is used instead and a linked
    `pending_approval` correction is created for the requested time, so the owner can
    approve backdating it later.
  - Day-closed / outside-operating-hours validation is the bot's job (it owns the
    schedule state, `hoursOverride`, `deliveryOff`-style logic) — the bot checks this
    BEFORE calling clock-in and never calls the endpoint if rejected locally. The API
    does not duplicate schedule logic.
- `POST /api/time/clock-out` `{name, source, requestedTime?}` — same 15-minute logic,
  closes the open entry, returns computed hours.
- `POST /api/time/correction` `{name, date, time}` — creates a new `time_entries` row
  (or amends the relevant one) with `status='pending_approval'` and
  `requested_time` set; does not affect totals until approved.
- `POST /api/time/approve` `{name, date}` — flips the matching `pending_approval` row
  to `approved` (or `closed` if it's a normal entry), applying `requested_time` to
  `clock_in`/`clock_out`.
- `GET /api/time/hours/:name?week=current` — that person's entries for the Mon–Sun
  week containing today, plus total hours (self-view; matches `[name] hours`).
- `GET /api/time/timesheet?week=current` — every active staff member's week hours ×
  rate (owner view; matches `timesheet`/`payroll`).
- `POST /api/time/paid` `{name}` — marks the current week's payout as recorded (a
  `paid_weeks` marker; simplest implementation is a `paid_at` timestamp column on a
  per-week aggregate, added as `staff_payouts(staff_id, week_start, paid_at)`).
- `POST /api/time/auto-clockout-all` — force-closes every `open` entry (used by the
  3am backstop and the kitchen `/shift/close` hook), returns the list closed so the
  bot can notify the owner who got auto-clocked-out.

Work week = **Monday through Sunday**. The Monday-morning payroll notification reports
the week that just ended yesterday (Sunday), not the week in progress.

## Bot side (`MUCHO-ON-BOT/index.js`)

New WhatsApp admin/staff commands, each a thin wrapper calling the API above and
formatting the reply — no business logic duplicated in the bot:

`[name] in` · `[name] out` · `[name] [time]` (typed-time variant of in/out) ·
`[name] update [date] [time]` · `approve [name] [date]` · `[name] hours` ·
`timesheet` / `payroll` · `paid [name]` · `staff add [name] [rate]` ·
`staff rate [name] [rate]` · `staff list`

Dates parsed as **DD/MM/YY**, times as **24-hour** (Aruba standard); every recorded
punch is echoed back (e.g. "Clocked in: Nigel, 18:30") so a misread is caught
immediately, per the brief.

Existing cashier routes (`/cashier/shift/open`, `/cashier/shift/close`,
`/cashier/staff/active`, `/cashier/punchout`) are rewired to call the PrepTracker API
instead of the local `punchRecords` array/`STAFF_RATES`/`STAFF_PINS` constants. Cashier
app UI and its PIN-gate (`CASHIER_PIN`, per-staff `staffPin`) are unchanged — only the
backend implementation of those four routes changes. `openingFloat` stays local to the
bot's in-memory per-`shiftId` record as today.

New env vars needed on the bot's Render service: `PREPTRACKER_URL` (already exists for
`stock`), `PREPTRACKER_API_KEY` (new, shared with PrepTracker's own env).

## Scheduled jobs (stay in the bot — only side holding WhatsApp send credentials)

- **3am backstop:** calls `POST /api/time/auto-clockout-all`, sends the owner a
  WhatsApp summary of anyone force-clocked-out.
- **Monday morning:** calls `GET /api/time/timesheet`, sends the owner the past
  week's hours + pay per employee.
- **Kitchen shift-close hook:** the existing `POST /shift/close` handler
  (`index.js:5282`) also calls `auto-clockout-all` immediately after closing the
  shift, in addition to the 3am backstop.

## Error handling

- API returns `{error: "..."}` with appropriate 4xx/5xx status, matching existing
  route conventions in `routes/stock.js`/`routes/auth.js`.
- Bot never lets a schedule/API failure silently drop a punch: if the PrepTracker API
  call fails, the bot tells the sender "Couldn't record that, try again" rather than
  claiming success.
- `requireApiKey` failures return 401 and are logged server-side (no key value in
  logs).

## Testing / verification plan

1. `node --check index.js` on the bot after every edit (mandatory per bot's CLAUDE.md).
2. Apply the new `staff`/`time_entries`/`staff_payouts` tables to production via
   `psql -f db/schema.sql` (idempotent, additive — same approach used earlier today
   for the missing purchases/stock tables).
3. Seed Delroy Porter and Nigel into `staff` with their current rates.
4. Exercise each new API endpoint directly with `curl` against the real (now-paid)
   Postgres, using the two real staff names, then verify via `SELECT` that rows look
   correct — clean up any purely-test rows (e.g. a throwaway "test" staff entry) before
   calling it done, real Delroy/Nigel entries are fine to leave (they reflect real
   punches if actually punched, but if only used for connectivity testing, remove).
5. Confirm `node --check` still passes and start the bot locally (`PORT` override) to
   confirm it boots with the new env vars unset (should fail closed/log clearly, not
   crash unhandled) and set (should work end-to-end for a scripted clock-in/out).
6. Manual smoke test is NOT possible against the live WhatsApp number without sending
   real messages — so verification here is via direct HTTP calls to the bot's own
   endpoints/handlers rather than actually texting from a phone. Flag this limitation
   in the final report rather than claiming a full end-to-end WhatsApp test happened.

## Rollout order

1. PrepTracker: schema + API + `PREPTRACKER_API_KEY` env var → commit, push, deploy.
2. Bot: new commands + cashier route rewiring + `PREPTRACKER_API_KEY` env var on
   Render → commit, push, deploy.
3. Render env vars (`PREPTRACKER_API_KEY` on both services, matching value) must be
   set by the owner in the dashboard — **Claude cannot set Render env vars**; this is
   called out explicitly as a manual step required before the new commands work in
   production, same as any other Render env var in this codebase.
