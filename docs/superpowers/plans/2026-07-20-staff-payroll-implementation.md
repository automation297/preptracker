# Staff Time-Tracking & Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PrepTracker a Postgres-backed `staff`/`time_entries` system that is the single source of truth for hours + pay, used by both the WhatsApp bot's new text commands and the existing cashier-app PIN-punch button.

**Architecture:** New Express routes in `preptracker` (`routes/staff.js`, `routes/time.js`) sit behind a shared-secret `requireApiKey` middleware and own all business logic (15-minute punch rule, week math, approval workflow). `MUCHO-ON-BOT` calls this API for every new WhatsApp command and rewires its existing cashier punch routes to call it too, instead of its local `punchRecords`/`STAFF_RATES`/`STAFF_PINS`. Scheduled jobs (3am backstop, Monday notification) stay in the bot since only it holds WhatsApp send credentials.

**Tech Stack:** Node/Express/`pg` (both repos already use this — no new dependencies). Node 18+ global `fetch` for the bot's calls to PrepTracker (both repos declare `"engines": {"node": ">=18.0.0"}`).

## Global Constraints

- Work week = **Monday–Sunday**. The Monday-morning notification reports the week that ended the previous day (Sunday), not the week in progress.
- `openingFloat` (cash-drawer amount) stays bot-local/ephemeral — never written to Postgres.
- All new write endpoints require `x-preptracker-api-key` header matching `PREPTRACKER_API_KEY` (same value set on both Render services) — never make a new endpoint public/CORS-open like `/api/stock/tonight`.
- Every bot edit ends with `node --check index.js` (per `MUCHO-ON-BOT/CLAUDE.md`) before considering the step done.
- Dates in bot commands: **DD/MM/YY**. Times: **24-hour**. Every recorded punch is echoed back to the sender.
- Do not touch unrelated code. Both files are large (`preptracker/index.js` ~130 lines is small; `MUCHO-ON-BOT/index.js` is ~8,000 lines) — surgical edits only, no refactoring beyond what's specified here.
- Names are matched case-insensitively; store `name` lowercase (matching key) and `display_name` in original casing for messages.

---

## Task 1: Schema — `staff`, `time_entries`, `staff_payouts`

**Files:**
- Modify: `db/schema.sql` (append)
- Test: none (this is idempotent DDL, verified by running it)

**Interfaces:**
- Produces: three tables consumed by every task below. Exact columns:
  - `staff(id, name, display_name, hourly_rate, pin, active, created_at)`
  - `time_entries(id, staff_id, clock_in, clock_out, source, status, requested_time, linked_entry_id, notes, created_at)` — `status` is one of `'open'`, `'closed'`, `'pending_approval'`, `'approved'`.
  - `staff_payouts(id, staff_id, week_start, paid_at)`

- [ ] **Step 1: Append the new tables to `db/schema.sql`**

Add this to the end of `db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  hourly_rate NUMERIC(6,2) NOT NULL,
  pin TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('bot','app')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','pending_approval','approved')),
  requested_time TIMESTAMPTZ,
  linked_entry_id INTEGER REFERENCES time_entries(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_staff ON time_entries(staff_id, clock_in);

CREATE TABLE IF NOT EXISTS staff_payouts (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  week_start DATE NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, week_start)
);
```

- [ ] **Step 2: Apply to production**

Run (same approach used earlier for `purchases`/`shift_sessions`/`shift_stock`):

```bash
"$(brew --prefix libpq)/bin/psql" "$PREPTRACKER_DATABASE_URL" -f db/schema.sql -v ON_ERROR_STOP=1
```

Expected: `NOTICE: relation "..." already exists, skipping` for the pre-existing tables, then `CREATE TABLE` three times for `staff`, `time_entries`, `staff_payouts`.

- [ ] **Step 3: Seed the two real staff members**

```bash
"$(brew --prefix libpq)/bin/psql" "$PREPTRACKER_DATABASE_URL" -c "
INSERT INTO staff (name, display_name, hourly_rate) VALUES
  ('delroy porter', 'Delroy Porter', 15.00),
  ('nigel', 'Nigel', 13.26)
ON CONFLICT (name) DO NOTHING;"
```

- [ ] **Step 4: Verify**

```bash
"$(brew --prefix libpq)/bin/psql" "$PREPTRACKER_DATABASE_URL" -c "\dt" -c "SELECT * FROM staff;"
```

Expected: 11 tables total now (was 9), `staff` has 2 rows (Delroy Porter $15.00, Nigel $13.26).

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql
git commit -m "Add staff, time_entries, staff_payouts tables for unified payroll"
```

---

## Task 2: `requireApiKey` middleware

**Files:**
- Create: `routes/apiAuth.js`
- Modify: `.env.example` (add `PREPTRACKER_API_KEY=`)

**Interfaces:**
- Produces: `requireApiKey(req, res, next)` middleware, imported by `routes/staff.js` and `routes/time.js` in later tasks.
- Consumes: `process.env.PREPTRACKER_API_KEY`

- [ ] **Step 1: Create the middleware**

```js
// routes/apiAuth.js
const crypto = require('crypto');

function requireApiKey(req, res, next) {
  const configured = process.env.PREPTRACKER_API_KEY || '';
  if (!configured) {
    return res.status(500).json({ error: 'PREPTRACKER_API_KEY not configured on this server.' });
  }
  const provided = req.get('x-preptracker-api-key') || '';
  let ok = false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(configured);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { /* ok stays false */ }
  if (!ok) return res.status(401).json({ error: 'forbidden' });
  next();
}

module.exports = { requireApiKey };
```

- [ ] **Step 2: Add the env var placeholder**

Append to `.env.example`:

```
PREPTRACKER_API_KEY=
```

- [ ] **Step 3: Verify it loads without syntax errors**

```bash
node -e "require('./routes/apiAuth.js'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add routes/apiAuth.js .env.example
git commit -m "Add shared-secret auth middleware for machine-to-machine API routes"
```

---

## Task 3: `routes/staff.js` — staff CRUD

**Files:**
- Create: `routes/staff.js`
- Modify: `index.js:83` (mount the new router right after the existing `/api/stock` line)

**Interfaces:**
- Consumes: `requireApiKey` from Task 2, `pool` from `db/pool.js`
- Produces: `POST /api/staff`, `GET /api/staff`, `PATCH /api/staff/:name` — used by the bot's `staff add`/`staff list`/`staff rate` commands in Task 9.

- [ ] **Step 1: Write the route file**

```js
// routes/staff.js
const express = require('express');
const pool = require('../db/pool');
const { requireApiKey } = require('./apiAuth');
const router = express.Router();

// POST /api/staff — add a staff member
router.post('/', requireApiKey, async (req, res) => {
  const displayName = String(req.body.name || '').trim();
  const rate = Number(req.body.hourly_rate);
  if (!displayName) return res.status(400).json({ error: 'name required' });
  if (isNaN(rate) || rate <= 0) return res.status(400).json({ error: 'hourly_rate must be a positive number' });
  const name = displayName.toLowerCase();
  try {
    const existing = await pool.query('SELECT id FROM staff WHERE name=$1', [name]);
    if (existing.rows.length) return res.status(409).json({ error: displayName + ' already exists.' });
    const { rows } = await pool.query(
      `INSERT INTO staff (name, display_name, hourly_rate) VALUES ($1,$2,$3) RETURNING *`,
      [name, displayName, rate]
    );
    res.json({ staff: rows[0] });
  } catch (e) {
    console.error('staff create error:', e.message);
    res.status(500).json({ error: 'Could not add staff member.' });
  }
});

// GET /api/staff — list (active by default, ?all=1 for everyone)
router.get('/', requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      req.query.all ? 'SELECT * FROM staff ORDER BY display_name'
                    : 'SELECT * FROM staff WHERE active=true ORDER BY display_name'
    );
    res.json({ staff: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not list staff.' });
  }
});

// PATCH /api/staff/:name — update rate and/or active
router.patch('/:name', requireApiKey, async (req, res) => {
  const name = String(req.params.name || '').trim().toLowerCase();
  const fields = [];
  const values = [];
  if (req.body.hourly_rate !== undefined) {
    const rate = Number(req.body.hourly_rate);
    if (isNaN(rate) || rate <= 0) return res.status(400).json({ error: 'hourly_rate must be a positive number' });
    fields.push('hourly_rate=$' + (values.length + 1)); values.push(rate);
  }
  if (req.body.active !== undefined) {
    fields.push('active=$' + (values.length + 1)); values.push(!!req.body.active);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(name);
  try {
    const { rows } = await pool.query(
      `UPDATE staff SET ${fields.join(', ')} WHERE name=$${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Unknown staff member: ' + name });
    res.json({ staff: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Could not update staff member.' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount it in `index.js`**

In `index.js`, right after line 83 (`app.use('/api/stock', require('./routes/stock'));`), add:

```js
app.use('/api/staff', require('./routes/staff'));
```

- [ ] **Step 3: Verify syntax**

```bash
node -c index.js && echo "syntax ok"
```

- [ ] **Step 4: Commit**

```bash
git add routes/staff.js index.js
git commit -m "Add staff CRUD API"
```

(Live-endpoint testing happens in Task 7 once the server is deployed with all routes mounted.)

---

## Task 4: `routes/time.js` — clock-in / clock-out

**Files:**
- Create: `routes/time.js`
- Modify: `index.js` (mount, in Task 6)

**Interfaces:**
- Consumes: `requireApiKey`, `pool`
- Produces: `POST /api/time/clock-in`, `POST /api/time/clock-out` — used by bot commands in Task 10 and the rewired cashier routes in Task 12.

- [ ] **Step 1: Write clock-in/clock-out**

```js
// routes/time.js
const express = require('express');
const pool = require('../db/pool');
const { requireApiKey } = require('./apiAuth');
const router = express.Router();

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

async function findStaff(name) {
  const key = String(name || '').trim().toLowerCase();
  const { rows } = await pool.query('SELECT * FROM staff WHERE name=$1 AND active=true', [key]);
  return rows[0] || null;
}

// POST /api/time/clock-in {name, source, requestedTime?}
router.post('/clock-in', requireApiKey, async (req, res) => {
  const source = req.body.source === 'app' ? 'app' : 'bot';
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  try {
    const openRes = await pool.query(
      `SELECT * FROM time_entries WHERE staff_id=$1 AND status='open'`, [staff.id]
    );
    if (openRes.rows.length) {
      return res.status(409).json({ error: staff.display_name + ' is already clocked in.' });
    }
    const now = new Date();
    const requestedTime = req.body.requestedTime ? new Date(req.body.requestedTime) : null;
    const requestedValid = requestedTime && !isNaN(requestedTime.getTime());
    const withinWindow = requestedValid && Math.abs(now.getTime() - requestedTime.getTime()) <= FIFTEEN_MIN_MS;
    const clockIn = withinWindow ? requestedTime : now;

    const { rows } = await pool.query(
      `INSERT INTO time_entries (staff_id, clock_in, source, status, requested_time)
       VALUES ($1,$2,$3,'open',$4) RETURNING *`,
      [staff.id, clockIn.toISOString(), source, requestedValid ? requestedTime.toISOString() : null]
    );
    const entry = rows[0];

    let pendingNote = null;
    if (requestedValid && !withinWindow) {
      await pool.query(
        `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, notes)
         VALUES ($1,$2,$3,'pending_approval',$4,'Clock-in time correction request')`,
        [staff.id, requestedTime.toISOString(), source, entry.id]
      );
      pendingNote = 'Requested time was more than 15 min from now — clocked in at current time, your requested time was sent for owner approval.';
    }
    res.json({ entry, staff, pendingNote });
  } catch (e) {
    console.error('clock-in error:', e.message);
    res.status(500).json({ error: 'Could not clock in.' });
  }
});

// POST /api/time/clock-out {name, source, requestedTime?}
router.post('/clock-out', requireApiKey, async (req, res) => {
  const source = req.body.source === 'app' ? 'app' : 'bot';
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  try {
    const openRes = await pool.query(
      `SELECT * FROM time_entries WHERE staff_id=$1 AND status='open' ORDER BY clock_in DESC LIMIT 1`,
      [staff.id]
    );
    if (!openRes.rows.length) {
      return res.status(409).json({ error: staff.display_name + ' is not clocked in.' });
    }
    const entry = openRes.rows[0];
    const now = new Date();
    const requestedTime = req.body.requestedTime ? new Date(req.body.requestedTime) : null;
    const requestedValid = requestedTime && !isNaN(requestedTime.getTime());
    const withinWindow = requestedValid && Math.abs(now.getTime() - requestedTime.getTime()) <= FIFTEEN_MIN_MS;
    const clockOut = withinWindow ? requestedTime : now;

    const { rows } = await pool.query(
      `UPDATE time_entries SET clock_out=$1, status='closed' WHERE id=$2 RETURNING *`,
      [clockOut.toISOString(), entry.id]
    );
    const closed = rows[0];
    const hours = (new Date(closed.clock_out) - new Date(closed.clock_in)) / 3600000;

    let pendingNote = null;
    if (requestedValid && !withinWindow) {
      await pool.query(
        `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, notes)
         VALUES ($1,$2,$3,'pending_approval',$4,'Clock-out time correction request')`,
        [staff.id, requestedTime.toISOString(), source, closed.id]
      );
      pendingNote = 'Requested time was more than 15 min from now — clocked out at current time, your requested time was sent for owner approval.';
    }
    res.json({ entry: closed, staff, hours: +hours.toFixed(2), pendingNote });
  } catch (e) {
    console.error('clock-out error:', e.message);
    res.status(500).json({ error: 'Could not clock out.' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node -c routes/time.js && echo "syntax ok"
```

- [ ] **Step 3: Commit**

```bash
git add routes/time.js
git commit -m "Add clock-in/clock-out endpoints with 15-minute punch validation"
```

---

## Task 5: `routes/time.js` — correction and approval

**Files:**
- Modify: `routes/time.js` (append routes to the same router from Task 4)

**Interfaces:**
- Consumes: `findStaff` from Task 4 (same file, already in scope)
- Produces: `POST /api/time/correction`, `POST /api/time/approve` — used by `[name] update` and `approve [name] [date]` bot commands (Task 10).

**Design decision documented here (no further clarification needed):** `/correction` takes an explicit `field` (`'in'` or `'out'`). The bot decides which to send: if the staff member has an `open` entry on that date, default to `'out'` (the common "forgot to clock out" case); otherwise `'in'` (creates a fresh entry for a missed clock-in). This resolves an ambiguity in the original brief (which didn't specify in vs. out for a correction) — documented here rather than re-asking, per instruction to keep moving.

- [ ] **Step 1: Add correction and approve routes**

Append to `routes/time.js`, before `module.exports = router;`:

```js
// POST /api/time/correction {name, date, time, field}
// date: 'YYYY-MM-DD', time: 'HH:MM' (24h), field: 'in' | 'out'
router.post('/correction', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  const field = req.body.field === 'out' ? 'out' : 'in';
  const requested = new Date(`${req.body.date}T${req.body.time}:00`);
  if (isNaN(requested.getTime())) return res.status(400).json({ error: 'Invalid date/time.' });
  try {
    let linkedId = null;
    if (field === 'out') {
      const openRes = await pool.query(
        `SELECT * FROM time_entries WHERE staff_id=$1 AND status='open'
         AND clock_in::date = $2::date ORDER BY clock_in DESC LIMIT 1`,
        [staff.id, req.body.date]
      );
      if (openRes.rows.length) linkedId = openRes.rows[0].id;
    }
    const { rows } = await pool.query(
      `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, notes)
       VALUES ($1,$2,'bot','pending_approval',$3,$4) RETURNING *`,
      [staff.id, requested.toISOString(), linkedId, `Clock-${field} correction for ${req.body.date} ${req.body.time}`]
    );
    res.json({ correction: rows[0], staff });
  } catch (e) {
    console.error('correction error:', e.message);
    res.status(500).json({ error: 'Could not submit correction.' });
  }
});

// POST /api/time/approve {name, date}
router.post('/approve', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  try {
    const pendingRes = await pool.query(
      `SELECT * FROM time_entries WHERE staff_id=$1 AND status='pending_approval'
       AND requested_time::date = $2::date ORDER BY created_at DESC LIMIT 1`,
      [staff.id, req.body.date]
    );
    if (!pendingRes.rows.length) {
      return res.status(404).json({ error: 'No pending correction for ' + staff.display_name + ' on ' + req.body.date + '.' });
    }
    const pending = pendingRes.rows[0];
    if (pending.linked_entry_id) {
      const linked = await pool.query('SELECT * FROM time_entries WHERE id=$1', [pending.linked_entry_id]);
      const isOutCorrection = linked.rows[0] && linked.rows[0].clock_out === null;
      const col = isOutCorrection ? 'clock_out' : 'clock_in';
      await pool.query(
        `UPDATE time_entries SET ${col}=$1, status='closed' WHERE id=$2`,
        [pending.requested_time, pending.linked_entry_id]
      );
    } else {
      // Standalone missed-punch correction with no existing entry — the
      // correction row itself becomes the record; needs both a clock_in
      // and clock_out to count toward hours, so mark it approved but note
      // it may need a matching punch to compute hours.
      await pool.query(`UPDATE time_entries SET clock_in=$1 WHERE id=$2`, [pending.requested_time, pending.id]);
    }
    await pool.query(`UPDATE time_entries SET status='approved' WHERE id=$1`, [pending.id]);
    res.json({ ok: true, approved: pending });
  } catch (e) {
    console.error('approve error:', e.message);
    res.status(500).json({ error: 'Could not approve correction.' });
  }
});
```

- [ ] **Step 2: Verify syntax**

```bash
node -c routes/time.js && echo "syntax ok"
```

- [ ] **Step 3: Commit**

```bash
git add routes/time.js
git commit -m "Add time correction and approval endpoints"
```

---

## Task 6: `routes/time.js` — hours, timesheet, paid, auto-clockout-all; mount router

**Files:**
- Modify: `routes/time.js` (append)
- Modify: `index.js` (mount `/api/time`)

**Interfaces:**
- Produces: `GET /api/time/hours/:name`, `GET /api/time/timesheet`, `POST /api/time/paid`, `POST /api/time/auto-clockout-all` — used by `[name] hours`, `timesheet`/`payroll`, `paid [name]` bot commands (Task 11), and the 3am backstop + `/shift/close` hook (Task 12).

- [ ] **Step 1: Add a week-bounds helper and the four routes**

Append to `routes/time.js`, before `module.exports = router;`:

```js
// Monday-Sunday week containing `ref` (defaults to now), in UTC (simple, documented
// limitation: week boundaries are computed in UTC, not Aruba local time — acceptable
// since punches themselves are timestamped correctly and this only affects which
// week a punch made in the first/last few hours of a boundary day is bucketed into).
function weekBounds(ref = new Date()) {
  const day = ref.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - diffToMonday, 0, 0, 0));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6, 23, 59, 59, 999));
  return { monday, sunday };
}

async function hoursForStaff(staffId, monday, sunday) {
  const { rows } = await pool.query(
    `SELECT * FROM time_entries
     WHERE staff_id=$1 AND status IN ('closed','approved')
     AND clock_in >= $2 AND clock_in <= $3
     ORDER BY clock_in`,
    [staffId, monday.toISOString(), sunday.toISOString()]
  );
  const totalHours = rows.reduce((sum, r) => {
    if (!r.clock_out) return sum;
    return sum + (new Date(r.clock_out) - new Date(r.clock_in)) / 3600000;
  }, 0);
  return { entries: rows, totalHours: +totalHours.toFixed(2) };
}

// GET /api/time/hours/:name — this week's entries + total (self-view)
router.get('/hours/:name', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.params.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.params.name });
  const { monday, sunday } = weekBounds();
  try {
    const result = await hoursForStaff(staff.id, monday, sunday);
    res.json({ staff, weekStart: monday.toISOString().slice(0, 10), ...result });
  } catch (e) {
    res.status(500).json({ error: 'Could not load hours.' });
  }
});

// GET /api/time/timesheet — every active staff member's week (owner view)
router.get('/timesheet', requireApiKey, async (req, res) => {
  const { monday, sunday } = weekBounds();
  try {
    const staffRes = await pool.query('SELECT * FROM staff WHERE active=true ORDER BY display_name');
    const rows = [];
    for (const s of staffRes.rows) {
      const { totalHours } = await hoursForStaff(s.id, monday, sunday);
      rows.push({ staff: s, hours: totalHours, pay: +(totalHours * s.hourly_rate).toFixed(2) });
    }
    res.json({ weekStart: monday.toISOString().slice(0, 10), weekEnd: sunday.toISOString().slice(0, 10), rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load timesheet.' });
  }
});

// POST /api/time/paid {name} — mark the current week paid
router.post('/paid', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  const { monday } = weekBounds();
  try {
    await pool.query(
      `INSERT INTO staff_payouts (staff_id, week_start) VALUES ($1,$2)
       ON CONFLICT (staff_id, week_start) DO UPDATE SET paid_at=NOW()`,
      [staff.id, monday.toISOString().slice(0, 10)]
    );
    res.json({ ok: true, staff, weekStart: monday.toISOString().slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: 'Could not mark as paid.' });
  }
});

// POST /api/time/auto-clockout-all — force-close every open entry
router.post('/auto-clockout-all', requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE time_entries SET clock_out=NOW(), status='closed'
       WHERE status='open' RETURNING *`
    );
    res.json({ closed: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not auto-clockout.' });
  }
});
```

- [ ] **Step 2: Mount the router in `index.js`**

Right after the `/api/staff` line added in Task 3, add:

```js
app.use('/api/time', require('./routes/time'));
```

- [ ] **Step 3: Verify syntax**

```bash
node -c index.js && node -c routes/time.js && echo "syntax ok"
```

- [ ] **Step 4: Commit**

```bash
git add routes/time.js index.js
git commit -m "Add hours/timesheet/paid/auto-clockout-all endpoints, mount /api/time"
```

---

## Task 7: Integration test against the real database

**Files:** none modified — verification only.

**Interfaces:** Exercises every endpoint from Tasks 3–6 end-to-end.

**Prerequisite:** `PREPTRACKER_API_KEY` must be set as an env var on the **local shell**
running these curl commands, on **Render's PrepTracker service**, matching. Since
Claude cannot set Render dashboard env vars, this step requires the owner to have set
`PREPTRACKER_API_KEY` on Render first — if it's not set yet, generate one
(`openssl rand -hex 32`), set it on Render's `preptracker` service env vars, and use
the same value below. The service must be redeployed (Render auto-redeploys on env
var change) before these hit production.

- [ ] **Step 1: Run the app locally against the real (paid) production DB** to test
  before relying on a Render redeploy:

```bash
cd /Users/somoarua/Desktop/preptracker
DATABASE_URL="$PREPTRACKER_DATABASE_URL" PREPTRACKER_API_KEY=testkey123 NODE_ENV=development PORT=4000 node index.js &
sleep 1
```

- [ ] **Step 2: Add a throwaway test staff member, verify, then clean it up**

```bash
curl -s -X POST localhost:4000/api/staff -H "Content-Type: application/json" \
  -H "x-preptracker-api-key: testkey123" -d '{"name":"zztest","hourly_rate":10}'
```
Expected: `{"staff":{"id":...,"name":"zztest",...}}`

- [ ] **Step 3: Clock in, verify already-clocked-in rejection, clock out**

```bash
curl -s -X POST localhost:4000/api/time/clock-in -H "Content-Type: application/json" \
  -H "x-preptracker-api-key: testkey123" -d '{"name":"zztest","source":"bot"}'
# Expected: {"entry":{...,"status":"open"},...}

curl -s -X POST localhost:4000/api/time/clock-in -H "Content-Type: application/json" \
  -H "x-preptracker-api-key: testkey123" -d '{"name":"zztest","source":"bot"}'
# Expected: 409 {"error":"Zztest is already clocked in."}

curl -s -X POST localhost:4000/api/time/clock-out -H "Content-Type: application/json" \
  -H "x-preptracker-api-key: testkey123" -d '{"name":"zztest","source":"bot"}'
# Expected: {"entry":{...,"status":"closed"},"hours":0...}
```

- [ ] **Step 4: Check timesheet includes it, then delete the test staff member and its entries**

```bash
curl -s "localhost:4000/api/time/timesheet" -H "x-preptracker-api-key: testkey123"
# Expected: rows array includes zztest with hours >= 0

"$(brew --prefix libpq)/bin/psql" "$PREPTRACKER_DATABASE_URL" -c "
DELETE FROM time_entries WHERE staff_id = (SELECT id FROM staff WHERE name='zztest');
DELETE FROM staff WHERE name='zztest';"
```

- [ ] **Step 5: Verify the real staff (Delroy, Nigel) are untouched**

```bash
"$(brew --prefix libpq)/bin/psql" "$PREPTRACKER_DATABASE_URL" -c "SELECT * FROM staff;"
```
Expected: exactly Delroy Porter and Nigel, no `zztest` row.

- [ ] **Step 6: Stop the local server**

```bash
kill %1
```

- [ ] **Step 7: Commit** (only if any fixes were needed during this verification pass; otherwise skip — nothing to commit for a clean pass)

---

## Task 8: Bot — `callPreptracker` helper + env var

**Files:**
- Modify: `MUCHO-ON-BOT/index.js` (add helper function near the existing `stock` command, ~line 835, and near `sendWhatsApp` at line 1145)

**Interfaces:**
- Produces: `async function callPreptracker(method, path, body)` → `{ ok, status, data }`, used by every bot command in Tasks 9-11 and by the rewired cashier routes in Task 12.
- Consumes: `process.env.PREPTRACKER_URL` (already exists), `process.env.PREPTRACKER_API_KEY` (new)

- [ ] **Step 1: Add the helper function**

Add this near line 466 (just before `async function handleAdminCommand(from, text) {`):

```js
// Calls PrepTracker's API (Node 18+ global fetch — no new dependency).
// Returns { ok, status, data } — never throws; callers check `ok`.
async function callPreptracker(method, path, body) {
  const prepUrl = process.env.PREPTRACKER_URL;
  const apiKey = process.env.PREPTRACKER_API_KEY;
  if (!prepUrl) return { ok: false, status: 0, data: { error: 'PREPTRACKER_URL not set on Render.' } };
  if (!apiKey) return { ok: false, status: 0, data: { error: 'PREPTRACKER_API_KEY not set on Render.' } };
  try {
    const res = await fetch(prepUrl.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-preptracker-api-key': apiKey },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check index.js && echo "syntax ok"
```

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "Add callPreptracker helper for authenticated PrepTracker API calls"
```

---

## Task 9: Bot — staff management commands (`staff add`/`staff rate`/`staff list`)

**Files:**
- Modify: `MUCHO-ON-BOT/index.js` (inside `handleAdminCommand`, add near the top of the command chain, after line 467 `const t = text.trim().toLowerCase();`)

**Interfaces:**
- Consumes: `callPreptracker` (Task 8), `sendWhatsApp` (existing, line 1145)

- [ ] **Step 1: Add the three commands**

Insert right after line 467 (`const t = text.trim().toLowerCase();`) in `handleAdminCommand`:

```js
  // ── STAFF MANAGEMENT — "staff add [name] [rate]", "staff rate [name] [rate]", "staff list" ──
  if (t === 'staff' || t === 'staff list') {
    const r = await callPreptracker('GET', '/api/staff?all=1');
    if (!r.ok) { await sendWhatsApp(from, '⚠️ Could not load staff: ' + (r.data.error || 'unknown error')); return true; }
    const lines = r.data.staff.map(s => `${s.display_name} — ${s.hourly_rate} AWG/hr${s.active ? '' : ' (inactive)'}`);
    await sendWhatsApp(from, '👥 *Staff:*\n' + (lines.join('\n') || '(none yet)') +
      '\n\nAdd: *staff add [name] [rate]* · Update rate: *staff rate [name] [rate]*');
    return true;
  }
  let mStaffAdd = text.trim().match(/^staff\s+add\s+(.+?)\s+([\d.]+)$/i);
  if (mStaffAdd) {
    const name = mStaffAdd[1].trim();
    const rate = parseFloat(mStaffAdd[2]);
    const r = await callPreptracker('POST', '/api/staff', { name, hourly_rate: rate });
    await sendWhatsApp(from, r.ok
      ? `✅ Added ${r.data.staff.display_name} at ${r.data.staff.hourly_rate} AWG/hr.`
      : `⚠️ Could not add staff: ${r.data.error || 'unknown error'}`);
    return true;
  }
  let mStaffRate = text.trim().match(/^staff\s+rate\s+(.+?)\s+([\d.]+)$/i);
  if (mStaffRate) {
    const name = mStaffRate[1].trim();
    const rate = parseFloat(mStaffRate[2]);
    const r = await callPreptracker('PATCH', '/api/staff/' + encodeURIComponent(name.toLowerCase()), { hourly_rate: rate });
    await sendWhatsApp(from, r.ok
      ? `✅ ${r.data.staff.display_name}'s rate is now ${r.data.staff.hourly_rate} AWG/hr.`
      : `⚠️ Could not update rate: ${r.data.error || 'unknown error'}`);
    return true;
  }
```

- [ ] **Step 2: Verify syntax**

```bash
node --check index.js && echo "syntax ok"
```

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "Add staff add/rate/list WhatsApp commands"
```

---

## Task 10: Bot — clock in/out/update/approve/hours commands

**Files:**
- Modify: `MUCHO-ON-BOT/index.js` (inside `handleAdminCommand`, immediately after the block added in Task 9)

**Interfaces:**
- Consumes: `callPreptracker` (Task 8)
- Produces: none further consumed within the bot, but relies on `/api/time/*` from Tasks 4-6 matching exactly (already implemented server-side).

- [ ] **Step 1: Add clock-in/out (name-based, no explicit "clock" keyword — matches brief's `nigel in` / `nigel out` / `nigel 6:30` forms)**

Insert after the staff-management block from Task 9:

```js
  // ── STAFF CLOCK IN/OUT — "nigel in", "nigel out", "nigel 6:30" (typed time) ──
  // Safe to check this early (before 86/nobo/report/etc. below): the required
  // suffix is exactly "in", "out", or an H:MM time, and the name group only
  // matches letters/spaces — no existing admin command's full text has that
  // shape, so there's no collision even though this block runs first.
  let mPunch = text.trim().match(/^([a-zA-Z ]{2,30}?)\s+(in|out|\d{1,2}:\d{2})$/i);
  if (mPunch) {
    const name = mPunch[1].trim();
    const action = mPunch[2].toLowerCase();
    const isTime = /^\d{1,2}:\d{2}$/.test(action);
    // A bare "<name> <time>" with no prior "in"/"out" context is ambiguous — treat it
    // as clock-IN if not currently clocked in, else clock-OUT. One extra lookup avoids
    // asking the user to disambiguate for the common case.
    let endpoint = action === 'in' ? '/api/time/clock-in' : action === 'out' ? '/api/time/clock-out' : null;
    let requestedTime = null;
    if (isTime) {
      const now = new Date();
      const [hh, mm] = action.split(':').map(Number);
      const guess = new Date(now); guess.setHours(hh, mm, 0, 0);
      requestedTime = guess.toISOString();
      const staffRes = await callPreptracker('GET', '/api/time/hours/' + encodeURIComponent(name));
      if (!staffRes.ok) { await sendWhatsApp(from, '⚠️ ' + (staffRes.data.error || 'Unknown staff member.')); return true; }
      const hasOpen = (staffRes.data.entries || []).some(e => e.status === 'open');
      endpoint = hasOpen ? '/api/time/clock-out' : '/api/time/clock-in';
    }
    const r = await callPreptracker('POST', endpoint, { name, source: 'bot', requestedTime });
    if (!r.ok) { await sendWhatsApp(from, '⚠️ ' + (r.data.error || 'Could not record punch.')); return true; }
    const timeStr = new Date(r.data.entry.clock_out || r.data.entry.clock_in)
      .toLocaleTimeString('en-US', { timeZone: 'America/Aruba', hour: '2-digit', minute: '2-digit' });
    const verb = endpoint === '/api/time/clock-in' ? 'Clocked in' : 'Clocked out';
    let msg = `✅ ${verb}: ${r.data.staff.display_name}, ${timeStr}`;
    if (r.data.hours !== undefined) msg += ` (${r.data.hours}h this shift)`;
    if (r.data.pendingNote) msg += `\n⚠️ ${r.data.pendingNote}`;
    await sendWhatsApp(from, msg);
    return true;
  }
```

- [ ] **Step 2: Add missed-punch correction, approval, and self-view hours**

Insert immediately after the block from Step 1:

```js
  // ── MISSED PUNCH CORRECTION — "nigel update 12/06/26 18:30" ──
  let mUpdate = text.trim().match(/^([a-zA-Z ]{2,30}?)\s+update\s+(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})$/i);
  if (mUpdate) {
    const name = mUpdate[1].trim();
    const [, , dd, mm, yy, hh, min] = mUpdate;
    const date = `20${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    const time = `${hh.padStart(2, '0')}:${min}`;
    // Default to correcting a clock-OUT if there's an open entry that day (most common
    // "forgot to clock out" case), else it's a missed clock-IN — see field decision
    // documented in Task 5 of the implementation plan.
    const hoursRes = await callPreptracker('GET', '/api/time/hours/' + encodeURIComponent(name));
    const hasOpenThatDay = hoursRes.ok && (hoursRes.data.entries || [])
      .some(e => e.status === 'open' && e.clock_in && e.clock_in.slice(0, 10) === date);
    const field = hasOpenThatDay ? 'out' : 'in';
    const r = await callPreptracker('POST', '/api/time/correction', { name, date, time, field });
    await sendWhatsApp(from, r.ok
      ? `📝 Correction submitted for ${r.data.staff.display_name}: ${dd}/${mm}/${yy} ${time} (clock-${field}). Needs owner approval: *approve ${name} ${dd}/${mm}/${yy}*`
      : `⚠️ Could not submit correction: ${r.data.error || 'unknown error'}`);
    return true;
  }
  // ── APPROVE CORRECTION — "approve nigel 12/06/26" ──
  let mApprove = text.trim().match(/^approve\s+([a-zA-Z ]{2,30}?)\s+(\d{1,2})\/(\d{1,2})\/(\d{2})$/i);
  if (mApprove) {
    const name = mApprove[1].trim();
    const [, , dd, mm, yy] = mApprove;
    const date = `20${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    const r = await callPreptracker('POST', '/api/time/approve', { name, date });
    await sendWhatsApp(from, r.ok
      ? `✅ Correction approved for ${name} on ${dd}/${mm}/${yy}.`
      : `⚠️ ${r.data.error || 'Could not approve.'}`);
    return true;
  }
  // ── SELF-VIEW HOURS — "nigel hours" ──
  let mHours = text.trim().match(/^([a-zA-Z ]{2,30}?)\s+hours$/i);
  if (mHours) {
    const name = mHours[1].trim();
    const r = await callPreptracker('GET', '/api/time/hours/' + encodeURIComponent(name));
    if (!r.ok) { await sendWhatsApp(from, '⚠️ ' + (r.data.error || 'Unknown staff member.')); return true; }
    const lines = r.data.entries.map(e => {
      const inT = new Date(e.clock_in).toLocaleTimeString('en-US', { timeZone: 'America/Aruba', hour: '2-digit', minute: '2-digit' });
      const outT = e.clock_out ? new Date(e.clock_out).toLocaleTimeString('en-US', { timeZone: 'America/Aruba', hour: '2-digit', minute: '2-digit' }) : '(open)';
      const day = new Date(e.clock_in).toLocaleDateString('en-US', { timeZone: 'America/Aruba', weekday: 'short', month: 'short', day: 'numeric' });
      return `${day}: ${inT} – ${outT}`;
    });
    await sendWhatsApp(from, `🕐 *${r.data.staff.display_name}'s hours this week:*\n` +
      (lines.join('\n') || '(none yet)') + `\n\nTotal: ${r.data.totalHours}h`);
    return true;
  }
```

- [ ] **Step 3: Verify syntax**

```bash
node --check index.js && echo "syntax ok"
```

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "Add clock in/out, correction, approval, and self-view hours commands"
```

---

## Task 11: Bot — timesheet/payroll/paid commands + migrate the Wednesday pay report

**Files:**
- Modify: `MUCHO-ON-BOT/index.js` (add commands in `handleAdminCommand`; replace body of the existing `setInterval` block at lines 7886-7928)

**Interfaces:**
- Consumes: `callPreptracker` (Task 8)
- Removes dependency on: local `punchRecords`/`STAFF_RATES` for payroll reporting (the cashier routes still get migrated separately in Task 12 — this task only touches the scheduled report).

- [ ] **Step 1: Add `timesheet`/`payroll` and `paid [name]` commands**

Insert after the "SELF-VIEW HOURS" block from Task 10:

```js
  // ── OWNER TIMESHEET/PAYROLL VIEW — "timesheet" or "payroll" ──
  if (t === 'timesheet' || t === 'payroll') {
    const r = await callPreptracker('GET', '/api/time/timesheet');
    if (!r.ok) { await sendWhatsApp(from, '⚠️ ' + (r.data.error || 'Could not load timesheet.')); return true; }
    const lines = r.data.rows.map(row => `${row.staff.display_name}: ${row.hours}h × ${row.staff.hourly_rate} = ${row.pay} AWG`);
    const total = r.data.rows.reduce((s, row) => s + row.pay, 0);
    await sendWhatsApp(from, `💰 *Payroll — week ${r.data.weekStart} to ${r.data.weekEnd}*\n\n` +
      (lines.join('\n') || '(no staff)') + `\n\n*Total: ${total.toFixed(2)} AWG*` +
      `\n\nMark paid: *paid [name]*`);
    return true;
  }
  // ── MARK PAID — "paid nigel" ──
  let mPaid = text.trim().match(/^paid\s+(.+)$/i);
  if (mPaid) {
    const name = mPaid[1].trim();
    const r = await callPreptracker('POST', '/api/time/paid', { name });
    await sendWhatsApp(from, r.ok
      ? `✅ Marked ${r.data.staff.display_name}'s week (${r.data.weekStart}) as paid.`
      : `⚠️ ${r.data.error || 'Could not mark as paid.'}`);
    return true;
  }
```

- [ ] **Step 2: Replace the Wednesday pay-report block to source from PrepTracker**

Replace lines 7886-7928 (the entire `let lastPayReportDay = '';` through the closing
`}, 60000);` of that block) with:

```js
// Wednesday 10AM Aruba (UTC-4) = 14:00 UTC payout reminder, sourced from PrepTracker
let lastPayReportDay = '';
setInterval(async () => {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const todayKey = now.toISOString().slice(0, 10);
  if (utcDay !== 3 || utcHour !== 14 || utcMin !== 0) return;
  if (lastPayReportDay === todayKey) return;
  lastPayReportDay = todayKey;
  const r = await callPreptracker('GET', '/api/time/timesheet');
  if (!r.ok) { console.error('Pay report fetch error:', r.data.error); return; }
  if (!r.data.rows.length) return;
  const lines = r.data.rows.map(row => `${row.staff.display_name}: ${row.hours}h × ${row.staff.hourly_rate} = ${row.pay} AWG`);
  const total = r.data.rows.reduce((s, row) => s + row.pay, 0);
  const msg = `💰 ${CONFIG.BUSINESS.name} — Payout Day (week ${r.data.weekStart} – ${r.data.weekEnd})\n\n` +
    lines.join('\n') + `\n\nTotal payroll: ${total.toFixed(2)} AWG\n\nMark each as paid: *paid [name]*`;
  sendWhatsApp(REPORT_PHONE, msg).catch(e => console.error('Pay report WA error:', e.message));
}, 60000);

// Monday 9AM Aruba (13:00 UTC) — review window opens for last week's hours
let lastMondayReportDay = '';
setInterval(async () => {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const todayKey = now.toISOString().slice(0, 10);
  if (utcDay !== 1 || utcHour !== 13 || utcMin !== 0) return;
  if (lastMondayReportDay === todayKey) return;
  lastMondayReportDay = todayKey;
  const r = await callPreptracker('GET', '/api/time/timesheet');
  if (!r.ok) { console.error('Monday report fetch error:', r.data.error); return; }
  if (!r.data.rows.length) return;
  const lines = r.data.rows.map(row => `${row.staff.display_name}: ${row.hours}h × ${row.staff.hourly_rate} = ${row.pay} AWG`);
  const total = r.data.rows.reduce((s, row) => s + row.pay, 0);
  const msg = `🕐 ${CONFIG.BUSINESS.name} — Last Week's Hours (${r.data.weekStart} – ${r.data.weekEnd})\n\n` +
    lines.join('\n') + `\n\nTotal: ${total.toFixed(2)} AWG\n\nReview window is open — staff can text *[name] hours* to check, corrections via *[name] update [date] [time]*. Payout Wednesday.`;
  sendWhatsApp(REPORT_PHONE, msg).catch(e => console.error('Monday report WA error:', e.message));
}, 60000);

// 3am hard backstop — auto-clockout anyone still on the clock
let lastAutoClockoutDay = '';
setInterval(async () => {
  const now = new Date();
  const utcHour = now.getUTCHours(); // 3am Aruba = 07:00 UTC
  const utcMin = now.getUTCMinutes();
  const todayKey = now.toISOString().slice(0, 10);
  if (utcHour !== 7 || utcMin !== 0) return;
  if (lastAutoClockoutDay === todayKey) return;
  lastAutoClockoutDay = todayKey;
  const r = await callPreptracker('POST', '/api/time/auto-clockout-all');
  if (r.ok && r.data.closed && r.data.closed.length) {
    sendWhatsApp(REPORT_PHONE, `⏰ 3am backstop: auto-clocked-out ${r.data.closed.length} open shift(s).`)
      .catch(e => console.error('Auto-clockout notify error:', e.message));
  }
}, 60000);
```

- [ ] **Step 3: Verify syntax**

```bash
node --check index.js && echo "syntax ok"
```

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "Add timesheet/paid commands, Monday review notification, migrate Wednesday payout report and 3am backstop to PrepTracker API"
```

---

## Task 12: Bot — rewire cashier routes + kitchen shift-close hook

**Files:**
- Modify: `MUCHO-ON-BOT/index.js:6800-6870` (the four `/cashier/*` punch routes)
- Modify: `MUCHO-ON-BOT/index.js:5282` (`/shift/close` handler)

**Interfaces:**
- Consumes: `callPreptracker` (Task 8)
- Removes: reliance on local `punchRecords`/`STAFF_RATES`/`STAFF_PINS` for these four routes (the constants themselves can stay defined for `STAFF_PINS` checks, which remain local since PIN-gating the cashier app is unrelated to hours storage).

- [ ] **Step 1: Replace `/cashier/shift/open`**

Replace the existing handler (lines 6800-6818) with:

```js
app.post('/cashier/shift/open', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const pin = req.body && req.body.pin ? String(req.body.pin) : '';
  if (pin !== CASHIER_PIN) return res.status(403).json({ error: 'forbidden' });
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const staffPin = String(req.body.staffPin || '');
  const key = name.toLowerCase();
  if (STAFF_PINS[key] !== undefined && STAFF_PINS[key] !== staffPin) {
    return res.status(401).json({ error: 'Wrong staff PIN' });
  }
  const shiftId = String(req.body.shiftId || Date.now());
  const r = await callPreptracker('POST', '/api/time/clock-in', { name, source: 'app' });
  if (!r.ok) return res.status(409).json({ error: r.data.error || 'Could not clock in.' });
  cashierShiftMap.set(shiftId, { name, timeEntryId: r.data.entry.id, openingFloat: Number(req.body.openingFloat) || 0 });
  res.json({ ok: true });
});
```

- [ ] **Step 2: Add the `cashierShiftMap` it relies on**

Right before line 5266 (`let punchRecords = []; // cashier staff clock-in/out, persisted to disk`), add:

```js
const cashierShiftMap = new Map(); // shiftId -> { name, timeEntryId, openingFloat } — ephemeral, register-session only
```

Leave the existing `let punchRecords = [];` line and its load/save references in place for now — it becomes dead state (no longer written to) but removing it entirely means also touching `saveState`/`loadState`'s field lists, which is out of scope here since it doesn't break anything left as an unused persisted array. Do not delete it in this task.

- [ ] **Step 3: Replace `/cashier/shift/close`**

Replace the existing handler (lines 6820-6839, now shifted slightly by Step 1's edit — locate by its route path, not line number) with:

```js
app.post('/cashier/shift/close', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const pin = req.body && req.body.pin ? String(req.body.pin) : '';
  if (pin !== CASHIER_PIN) return res.status(403).json({ error: 'forbidden' });
  const shiftId = String(req.body.shiftId || '');
  const shiftInfo = cashierShiftMap.get(shiftId);
  let summary = { hours: 0, orders: 0, sales: 0, pay: 0, rate: 0 };
  if (shiftInfo) {
    const r = await callPreptracker('POST', '/api/time/clock-out', { name: shiftInfo.name, source: 'app' });
    if (r.ok) {
      const punchInMs = new Date(r.data.entry.clock_in).getTime();
      const punchOutMs = new Date(r.data.entry.clock_out).getTime();
      const shiftOrders = ordersQueue.filter(o => o.source === 'walkup' && o.placedAt >= punchInMs && o.placedAt <= punchOutMs && !o.cancelled);
      const sales = +shiftOrders.reduce((s, o) => s + (o.total || 0), 0).toFixed(2);
      summary = { hours: r.data.hours, orders: shiftOrders.length, sales, pay: +(r.data.hours * r.data.staff.hourly_rate).toFixed(2), rate: r.data.staff.hourly_rate };
    }
    cashierShiftMap.delete(shiftId);
  }
  res.json({ ok: true, summary });
});
```

- [ ] **Step 4: Replace `/cashier/staff/active`**

```js
app.get('/cashier/staff/active', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  if ((req.query.pin || '') !== CASHIER_PIN) return res.status(403).json({ error: 'forbidden' });
  const r = await callPreptracker('GET', '/api/staff?all=1');
  if (!r.ok) return res.json([]);
  const now = Date.now();
  const active = [];
  for (const [shiftId, info] of cashierShiftMap.entries()) {
    active.push({ name: info.name, shiftId, elapsedHours: null });
  }
  res.json(active);
});
```

(`elapsedHours` is left `null` here since computing it live would require another API round-trip per entry; this is an acceptable simplification — the cashier UI already recomputes elapsed time client-side from `punchIn`, which we don't have without a further fetch. If the existing cashier UI breaks visibly on this, it needs `punchIn` too — flag this in the final report as a known follow-up, don't silently under-deliver without noting it.)

- [ ] **Step 5: Replace `/cashier/punchout`**

Replace the existing handler (originally lines 6862-6878 — locate by route path, since
prior edits in this task shift line numbers) with:

```js
app.post('/cashier/punchout', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const pin = req.body && req.body.pin ? String(req.body.pin) : '';
  if (pin !== CASHIER_PIN) return res.status(403).json({ error: 'forbidden' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const staffPin = String(req.body.staffPin || '');
  const key = name.toLowerCase();
  if (STAFF_PINS[key] !== undefined && STAFF_PINS[key] !== staffPin) {
    return res.status(401).json({ error: 'Wrong staff PIN' });
  }
  const r = await callPreptracker('POST', '/api/time/clock-out', { name, source: 'app' });
  if (!r.ok) return res.status(404).json({ error: r.data.error || 'No active punch for this person' });
  for (const [shiftId, info] of cashierShiftMap.entries()) {
    if (info.name === name) cashierShiftMap.delete(shiftId);
  }
  res.json({ ok: true });
});
```

- [ ] **Step 6: Hook kitchen shift-close to auto-clockout**

In the `/shift/close` handler (around line 5282), immediately after the line
`currentShift.closedAt = new Date().toISOString();`, add:

```js
  callPreptracker('POST', '/api/time/auto-clockout-all').then(r => {
    if (r.ok && r.data.closed && r.data.closed.length) {
      sendWhatsApp(REPORT_PHONE, `👋 Kitchen shift closed — auto-clocked-out ${r.data.closed.length} staff still on the clock.`)
        .catch(e => console.error('Shift-close clockout notify error:', e.message));
    }
  }).catch(e => console.error('Shift-close auto-clockout error:', e.message));
```

- [ ] **Step 7: Verify syntax**

```bash
node --check index.js && echo "syntax ok"
```

- [ ] **Step 8: Commit**

```bash
git add index.js
git commit -m "Rewire cashier punch routes and kitchen shift-close hook to PrepTracker API"
```

---

## Task 13: Final verification and deploy

**Files:** none — verification and deployment only.

- [ ] **Step 1: Full syntax check**

```bash
cd /Users/somoarua/Desktop/MUCHO-ON-BOT && node --check index.js && echo "bot syntax ok"
cd /Users/somoarua/Desktop/preptracker && node -c index.js && node -c routes/time.js && node -c routes/staff.js && node -c routes/apiAuth.js && echo "preptracker syntax ok"
```

- [ ] **Step 2: Confirm `PREPTRACKER_API_KEY` is set on both Render services**

This cannot be done by Claude — Render dashboard env vars require the owner. If not
already set (see Task 7's prerequisite), flag this clearly in the final report as an
outstanding manual step, since none of the new commands work in production without it.

- [ ] **Step 3: Push preptracker**

```bash
cd /Users/somoarua/Desktop/preptracker && git push
```

- [ ] **Step 4: Push MUCHO-ON-BOT**

```bash
cd /Users/somoarua/Desktop/MUCHO-ON-BOT && git push
```

- [ ] **Step 5: Write a final summary**

State plainly, in the final report to the owner:
- What was built and pushed (both repos, commit list).
- The one manual step still required (`PREPTRACKER_API_KEY` on both Render services, then redeploy) before any of this works live.
- The known simplification from Task 12 Step 4 (`elapsedHours` not computed for the cashier "who's active" panel).
- That end-to-end WhatsApp testing was NOT possible (no real phone number to text from in this environment) — verification was via direct API calls only. Recommend the owner test one real `nigel in` / `nigel out` exchange after deploy.
