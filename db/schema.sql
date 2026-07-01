CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('owner','prep')),
  pin_hash         TEXT NOT NULL,
  push_subscription JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

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
