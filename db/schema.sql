CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('owner','prep')),
  pin_hash         TEXT NOT NULL,
  push_subscription JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS dropoffs (
  id          SERIAL PRIMARY KEY,
  created_by  INTEGER REFERENCES users(id),
  dropped_at  TIMESTAMPTZ DEFAULT NOW(),
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','picked_up')),
  picked_up_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dropoff_proteins (
  id           SERIAL PRIMARY KEY,
  dropoff_id   INTEGER REFERENCES dropoffs(id) ON DELETE CASCADE,
  protein_name TEXT NOT NULL,
  weight_kg    NUMERIC(8,1) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','ready')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- Piece-portioned proteins (hotdogs) track a unit count instead of weight -- weight_kg
-- is no longer always required (application code enforces "weight_kg OR unit_count").
ALTER TABLE dropoff_proteins ALTER COLUMN weight_kg DROP NOT NULL;
ALTER TABLE dropoff_proteins ADD COLUMN IF NOT EXISTS unit_count INTEGER;

CREATE TABLE IF NOT EXISTS protein_logs (
  id                  SERIAL PRIMARY KEY,
  dropoff_protein_id  INTEGER REFERENCES dropoff_proteins(id) ON DELETE CASCADE,
  logged_by           INTEGER REFERENCES users(id),
  kg_done             NUMERIC(8,1) NOT NULL,
  note                TEXT,
  logged_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dropoff_supplies (
  id         SERIAL PRIMARY KEY,
  dropoff_id INTEGER REFERENCES dropoffs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  amount     TEXT NOT NULL
);

-- Purchase cost tracker
CREATE TABLE IF NOT EXISTS purchases (
  id         SERIAL PRIMARY KEY,
  item_name  TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'other',
  price_fl   NUMERIC(8,2) NOT NULL,
  qty        NUMERIC(10,2) NOT NULL,
  unit       TEXT NOT NULL,
  notes      TEXT,
  bought_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'business'
  CHECK (scope IN ('business','personal'));
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(8,3);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS protein_type TEXT;
-- Price for JUST the protein line item, separate from price_fl (the whole receipt's
-- total). A bundled multi-item receipt's total is not the protein's own cost — see
-- CLAUDE.md "protein_price_fl" note for the real bug this fixes.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS protein_price_fl NUMERIC(8,2);
-- Individual piece count for unit-portioned proteins (hotdogs) -- these portion by
-- piece count, not oz weight, so weight_kg doesn't drive their prep math.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS unit_count INTEGER;

-- Persistent running inventory (added 2026-07-30) -- everything above (shift_stock
-- below, dropoff_proteins above) is workflow/per-night state that resets; this is the
-- one number per item that survives across nights. raw_qty = bought but not yet
-- prepped; ready_qty = prepped and sellable. item_name is the bot's protein_type key
-- ('steak','chicken','burger','hotdog','chorizo','salchi') or a future drink key, NOT
-- the human-readable dropoff_proteins.protein_name label (see index.js's
-- PROTEIN_DROPOFF_NAME map for that translation).
CREATE TABLE IF NOT EXISTS inventory_items (
  id         SERIAL PRIMARY KEY,
  item_name  TEXT NOT NULL UNIQUE,
  category   TEXT NOT NULL DEFAULT 'protein',
  unit       TEXT NOT NULL DEFAULT 'kg',
  raw_qty    NUMERIC(10,2) NOT NULL DEFAULT 0,
  ready_qty  NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff-meal / other consumption against ready inventory -- the "Dinner" button. Kept
-- separate from customer sales (which don't touch this table in Phase 1 -- see
-- CLAUDE.md, sales-matching is explicitly Phase 2) so staff meals never get confused
-- with what's actually available to sell.
CREATE TABLE IF NOT EXISTS inventory_consumption (
  id         SERIAL PRIMARY KEY,
  item_name  TEXT NOT NULL,
  qty        NUMERIC(10,2) NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'dinner',
  staff_name TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nightly shift sessions
CREATE TABLE IF NOT EXISTS shift_sessions (
  id         SERIAL PRIMARY KEY,
  shift_date DATE NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at  TIMESTAMPTZ DEFAULT NOW(),
  closed_at  TIMESTAMPTZ
);

-- Per-item stock counts for each shift
CREATE TABLE IF NOT EXISTS shift_stock (
  id          SERIAL PRIMARY KEY,
  shift_id    INTEGER REFERENCES shift_sessions(id) ON DELETE CASCADE,
  item_name   TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',
  unit        TEXT NOT NULL DEFAULT 'portions',
  start_qty   NUMERIC(8,1) NOT NULL,
  current_qty NUMERIC(8,1) NOT NULL,
  end_qty     NUMERIC(8,1),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shift_id, item_name)
);

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
  correction_field TEXT CHECK (correction_field IN ('in','out')),
  linked_entry_id INTEGER REFERENCES time_entries(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_staff ON time_entries(staff_id, clock_in);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_open_per_staff
  ON time_entries(staff_id) WHERE status='open';

CREATE TABLE IF NOT EXISTS staff_payouts (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  week_start DATE NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, week_start)
);
