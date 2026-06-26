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
