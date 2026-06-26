# PrepTracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first web app for tracking proteins and supplies dropped off at a home prep kitchen, with PIN-only login, progress logging, and browser push notifications.

**Architecture:** Node.js/Express SPA served from Render. Three pre-seeded users (owner + 2 prep) log in with a 6-digit PIN. Owner creates drop-offs; prep team logs progress and marks proteins ready; owner confirms pickup. PostgreSQL tracks all state.

**Tech Stack:** Node.js, Express, PostgreSQL (pg), express-session + connect-pg-simple, bcryptjs, helmet, express-rate-limit, web-push (VAPID), Plus Jakarta Sans (Google Fonts)

## Global Constraints

- PIN is exactly 6 digits, hashed with bcryptjs (cost 10)
- All weights stored and displayed as `NUMERIC(8,1)` — one decimal place, shown as `XX.X kg`
- Proteins list (exact names, used verbatim in DB and UI): `['Flank Steak', 'Chicken Breast', 'Chicken Wings', 'Chicharron / Pork Belly', 'Burger Meat / Carni Mula', 'Bacon']`
- Roles: `owner` (1 user) and `prep` (2 users) — no other roles
- Status values — dropoffs: `open` | `picked_up`; proteins: `in_progress` | `ready`
- Sessions persist 30 days, secure cookie in production
- CSP must include `scriptSrcAttr: ["'unsafe-inline'"]` alongside `scriptSrc` (Helmet quirk — without it, onclick= handlers are blocked)
- Rate limit: 5 PIN attempts per 15 min per IP
- Design: Plus Jakarta Sans font, CSS tokens `--sea:#0A8C9A`, `--coral:#FF4D2E`, `--mango:#FFAA00`, `--green:#00C07F`, `--ink:#111C1B`, `--sand:#FFF4E0`, `--paper:#FFFCF7`
- All touch targets minimum 48px height — accessible for elderly users
- Language support: English + Papiamento (minimal — key labels only)
- Hosting: Render (web service + PostgreSQL)
- Session table: `session` (auto-created by connect-pg-simple)
- No self-signup — accounts are seeded only

---

### Task 1: Project Scaffold + Dependencies

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `index.js`
- Create: `db/pool.js`

**Interfaces:**
- Produces: running Express server on PORT (default 3000), `pool` export for all routes

- [ ] **Step 1: Create package.json**

```json
{
  "name": "preptracker",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js",
    "seed": "node db/seed.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "connect-pg-simple": "^9.0.1",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "express-session": "^1.17.3",
    "helmet": "^7.1.0",
    "pg": "^8.11.3",
    "web-push": "^3.6.7"
  }
}
```

- [ ] **Step 2: Create .env.example**

```
DATABASE_URL=postgres://user:pass@host:5432/preptracker
SESSION_SECRET=change-me-to-a-long-random-string
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=mailto:you@example.com
NODE_ENV=development
PORT=3000
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.env
*.log
```

- [ ] **Step 4: Create db/pool.js**

```js
const { Pool } = require('pg');
// rejectUnauthorized:false is Render's required pattern for their managed PostgreSQL —
// their internal CA cert is not user-accessible. Connection stays on Render's private network.
// If hosting elsewhere, replace with a proper CA bundle.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
module.exports = pool;
```

- [ ] **Step 5: Create index.js**

```js
require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const session  = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path     = require('path');
const pool     = require('./db/pool');

const app    = express();
const PORT   = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'preptracker-dev-secret')) {
  console.error('FATAL: SESSION_SECRET not set in production.');
  process.exit(1);
}

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:        ["'self'", 'data:'],
      connectSrc:    ["'self'"],
      frameSrc:      ["'none'"],
      objectSrc:     ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'preptracker-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: isProd, sameSite: 'lax' },
}));

const pinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many attempts. Wait 15 minutes.' }, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth/login', pinLimiter);
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/dropoffs',  require('./routes/dropoffs'));
app.use('/api/proteins',  require('./routes/proteins'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/push',      require('./routes/push'));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`PrepTracker running on port ${PORT}`));
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Verify syntax**

```bash
node --check index.js db/pool.js
```

Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore index.js db/pool.js
git commit -m "feat: project scaffold — Express server, pool, session, helmet"
```

---

### Task 2: Database Schema + Seed

**Files:**
- Create: `db/schema.sql`
- Create: `db/seed.js`

**Interfaces:**
- Consumes: `db/pool.js` pool export
- Produces: tables `users`, `dropoffs`, `dropoff_proteins`, `protein_logs`, `dropoff_supplies` in PostgreSQL

- [ ] **Step 1: Create db/schema.sql**

```sql
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
```

- [ ] **Step 2: Apply schema to database**

```bash
psql $DATABASE_URL -f db/schema.sql
```

Expected: `CREATE TABLE` printed for each table.

- [ ] **Step 3: Create db/seed.js**

```js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool   = require('./pool');

async function seed() {
  const users = [
    { name: 'Owner',         role: 'owner', pin: '111111' },
    { name: 'Franklin',      role: 'prep',  pin: '222222' },
    { name: 'Mama Franklin', role: 'prep',  pin: '333333' },
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.pin, 10);
    await pool.query(
      `INSERT INTO users (name, role, pin_hash) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [u.name, u.role, hash]
    );
    console.log(`Seeded: ${u.name} (PIN: ${u.pin})`);
  }
  process.exit(0);
}
seed().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run seed**

```bash
node db/seed.js
```

Expected output:
```
Seeded: Owner (PIN: 111111)
Seeded: Franklin (PIN: 222222)
Seeded: Mama Franklin (PIN: 333333)
```

- [ ] **Step 5: Verify in database**

```bash
psql $DATABASE_URL -c "SELECT id, name, role FROM users;"
```

Expected: 3 rows with correct names and roles.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql db/seed.js
git commit -m "feat: database schema and seed users"
```

---

### Task 3: PIN Authentication Routes

**Files:**
- Create: `routes/auth.js`

**Interfaces:**
- Consumes: `db/pool.js`, `bcryptjs`
- Produces:
  - `POST /api/auth/login` → `{ ok: true, user: { id, name, role } }` or `{ error }` 401
  - `POST /api/auth/logout` → `{ ok: true }`
  - `GET /api/auth/me` → `{ user: { id, name, role } }` or `{ user: null }`
  - `PATCH /api/auth/pin/:userId` → `{ ok: true }` (owner only, changes any user's PIN)

- [ ] **Step 1: Create routes/auth.js**

```js
const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const router  = express.Router();

// Middleware: require login
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in.' });
  next();
}
// Middleware: require owner role
function requireOwner(req, res, next) {
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  next();
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ error: 'Enter a 6-digit PIN.' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
    for (const user of rows) {
      if (await bcrypt.compare(pin, user.pin_hash)) {
        req.session.regenerate(err => {
          if (err) return res.status(500).json({ error: 'Session error.' });
          req.session.userId = user.id;
          req.session.role   = user.role;
          req.session.name   = user.name;
          req.session.save(saveErr => {
            if (saveErr) return res.status(500).json({ error: 'Session error.' });
            res.json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
          });
        });
        return;
      }
    }
    res.status(401).json({ error: 'Wrong PIN. Try again.' });
  } catch (e) {
    console.error('login error:', e.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  try {
    const { rows } = await pool.query('SELECT id, name, role FROM users WHERE id=$1', [req.session.userId]);
    res.json({ user: rows[0] || null });
  } catch (e) {
    res.json({ user: null });
  }
});

// PATCH /api/auth/pin/:userId — owner changes any user's PIN
router.patch('/pin/:userId', requireAuth, requireOwner, async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be exactly 6 digits.' });
  }
  try {
    const hash = await bcrypt.hash(pin, 10);
    const r = await pool.query('UPDATE users SET pin_hash=$1 WHERE id=$2 RETURNING id', [hash, req.params.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('pin change error:', e.message);
    res.status(500).json({ error: 'Could not update PIN.' });
  }
});

module.exports = router;
module.exports.requireAuth  = requireAuth;
module.exports.requireOwner = requireOwner;
```

- [ ] **Step 2: Verify syntax**

```bash
node --check routes/auth.js
```

Expected: no output (clean).

- [ ] **Step 3: Test login endpoint**

Start server: `node index.js` (in a separate terminal)

```bash
# Test wrong PIN
curl -s -c /tmp/pt.jar -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"pin":"000000"}'
```
Expected: `{"error":"Wrong PIN. Try again."}`

```bash
# Test correct PIN (Owner)
curl -s -c /tmp/pt.jar -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"pin":"111111"}'
```
Expected: `{"ok":true,"user":{"id":1,"name":"Owner","role":"owner"}}`

```bash
# Test /me while logged in
curl -s -b /tmp/pt.jar http://localhost:3000/api/auth/me
```
Expected: `{"user":{"id":1,"name":"Owner","role":"owner"}}`

```bash
# Test logout
curl -s -b /tmp/pt.jar -c /tmp/pt.jar -X POST http://localhost:3000/api/auth/logout
curl -s -b /tmp/pt.jar http://localhost:3000/api/auth/me
```
Expected after logout: `{"user":null}`

- [ ] **Step 4: Commit**

```bash
git add routes/auth.js
git commit -m "feat: PIN auth — login, logout, /me, owner PIN change"
```

---

### Task 4: Drop-off Routes (Create, List, Detail, Pickup)

**Files:**
- Create: `routes/dropoffs.js`

**Interfaces:**
- Consumes: `routes/auth.js` exports `requireAuth`, `requireOwner`
- Produces:
  - `POST /api/dropoffs` → `{ ok: true, dropoff: { id, dropped_at } }` (owner only)
  - `GET /api/dropoffs` → `{ dropoffs: [...] }`
  - `GET /api/dropoffs/:id` → `{ dropoff: { ...proteins, ...supplies } }`
  - `POST /api/dropoffs/:id/pickup` → `{ ok: true }` (owner only)

Request body for POST /api/dropoffs:
```json
{
  "notes": "optional text",
  "proteins": [
    { "protein_name": "Flank Steak", "weight_kg": 100.3 }
  ],
  "supplies": [
    { "name": "Salt", "amount": "500g" }
  ]
}
```

- [ ] **Step 1: Create routes/dropoffs.js**

```js
const express = require('express');
const pool    = require('../db/pool');
const { requireAuth, requireOwner } = require('./auth');
const router  = express.Router();

const VALID_PROTEINS = ['Flank Steak','Chicken Breast','Chicken Wings','Chicharron / Pork Belly','Burger Meat / Carni Mula','Bacon'];

// POST /api/dropoffs — create a new drop-off (owner only)
router.post('/', requireAuth, requireOwner, async (req, res) => {
  const { notes, proteins = [], supplies = [] } = req.body;
  if (!proteins.length) return res.status(400).json({ error: 'Add at least one protein.' });
  for (const p of proteins) {
    if (!VALID_PROTEINS.includes(p.protein_name)) return res.status(400).json({ error: `Unknown protein: ${p.protein_name}` });
    if (!p.weight_kg || Number(p.weight_kg) <= 0) return res.status(400).json({ error: 'Weight must be greater than 0.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dr = await client.query(
      'INSERT INTO dropoffs (created_by, notes) VALUES ($1,$2) RETURNING id, dropped_at',
      [req.session.userId, notes || null]
    );
    const dropoffId = dr.rows[0].id;
    for (const p of proteins) {
      await client.query(
        'INSERT INTO dropoff_proteins (dropoff_id, protein_name, weight_kg) VALUES ($1,$2,$3)',
        [dropoffId, p.protein_name, Number(p.weight_kg).toFixed(1)]
      );
    }
    for (const s of supplies) {
      if (s.name && s.amount) {
        await client.query(
          'INSERT INTO dropoff_supplies (dropoff_id, name, amount) VALUES ($1,$2,$3)',
          [dropoffId, String(s.name).trim(), String(s.amount).trim()]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, dropoff: dr.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('create dropoff error:', e.message);
    res.status(500).json({ error: 'Could not save drop-off.' });
  } finally {
    client.release();
  }
});

// GET /api/dropoffs — list all drop-offs (all logged-in users)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.dropped_at, d.status, d.picked_up_at, u.name AS dropped_by,
              COUNT(dp.id) AS protein_count,
              SUM(CASE WHEN dp.status='ready' THEN 1 ELSE 0 END) AS ready_count
       FROM dropoffs d
       JOIN users u ON u.id = d.created_by
       LEFT JOIN dropoff_proteins dp ON dp.dropoff_id = d.id
       GROUP BY d.id, u.name
       ORDER BY d.dropped_at DESC`
    );
    res.json({ dropoffs: rows });
  } catch (e) {
    console.error('list dropoffs error:', e.message);
    res.status(500).json({ error: 'Could not load drop-offs.' });
  }
});

// GET /api/dropoffs/:id — single drop-off with proteins and supplies
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const dr = await pool.query('SELECT d.*, u.name AS dropped_by FROM dropoffs d JOIN users u ON u.id=d.created_by WHERE d.id=$1', [req.params.id]);
    if (!dr.rows.length) return res.status(404).json({ error: 'Drop-off not found.' });
    const proteins = await pool.query(
      `SELECT dp.*,
              COALESCE((SELECT kg_done FROM protein_logs WHERE dropoff_protein_id=dp.id ORDER BY logged_at DESC LIMIT 1), 0) AS latest_kg_done,
              COALESCE((SELECT note FROM protein_logs WHERE dropoff_protein_id=dp.id ORDER BY logged_at DESC LIMIT 1), '') AS latest_note
       FROM dropoff_proteins dp WHERE dp.dropoff_id=$1 ORDER BY dp.id`,
      [req.params.id]
    );
    const supplies = await pool.query('SELECT * FROM dropoff_supplies WHERE dropoff_id=$1 ORDER BY id', [req.params.id]);
    res.json({ dropoff: { ...dr.rows[0], proteins: proteins.rows, supplies: supplies.rows } });
  } catch (e) {
    console.error('get dropoff error:', e.message);
    res.status(500).json({ error: 'Could not load drop-off.' });
  }
});

// POST /api/dropoffs/:id/pickup — confirm pickup (owner only)
router.post('/:id/pickup', requireAuth, requireOwner, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE dropoffs SET status='picked_up', picked_up_at=NOW()
       WHERE id=$1 AND status='open' RETURNING id`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Drop-off not found or already picked up.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('pickup error:', e.message);
    res.status(500).json({ error: 'Could not confirm pickup.' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node --check routes/dropoffs.js
```

Expected: no output.

- [ ] **Step 3: Test drop-off creation**

First log in as owner (reuse cookie from Task 3 tests or re-login):
```bash
curl -s -c /tmp/pt.jar -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"pin":"111111"}'

curl -s -b /tmp/pt.jar -X POST http://localhost:3000/api/dropoffs \
  -H 'Content-Type: application/json' \
  -d '{"proteins":[{"protein_name":"Flank Steak","weight_kg":100.3},{"protein_name":"Bacon","weight_kg":15.0}],"supplies":[{"name":"Salt","amount":"500g"}]}'
```
Expected: `{"ok":true,"dropoff":{"id":1,"dropped_at":"..."}}`

```bash
# List drop-offs
curl -s -b /tmp/pt.jar http://localhost:3000/api/dropoffs
```
Expected: array with 1 drop-off, `protein_count: "2"`, `ready_count: "0"`.

```bash
# Get detail
curl -s -b /tmp/pt.jar http://localhost:3000/api/dropoffs/1
```
Expected: full object with proteins and supplies arrays.

- [ ] **Step 4: Commit**

```bash
git add routes/dropoffs.js
git commit -m "feat: drop-off routes — create, list, detail, confirm pickup"
```

---

### Task 5: Progress Logging + Inventory Routes

**Files:**
- Create: `routes/proteins.js`
- Create: `routes/inventory.js`

**Interfaces:**
- Consumes: `routes/auth.js` exports `requireAuth`
- Produces:
  - `POST /api/proteins/:id/log` → `{ ok: true }` (prep only — log kg_done + note)
  - `PATCH /api/proteins/:id/ready` → `{ ok: true }` (prep only — mark protein ready)
  - `GET /api/inventory` → `{ proteins: [...], supplies: [...] }` — current open items

- [ ] **Step 1: Create routes/proteins.js**

```js
const express = require('express');
const pool    = require('../db/pool');
const { requireAuth } = require('./auth');
const router  = express.Router();

function requirePrep(req, res, next) {
  if (req.session.role !== 'prep') return res.status(403).json({ error: 'Prep team only.' });
  next();
}

// POST /api/proteins/:id/log — log progress on a protein
router.post('/:id/log', requireAuth, requirePrep, async (req, res) => {
  const kg_done = Number(req.body.kg_done);
  if (isNaN(kg_done) || kg_done < 0) return res.status(400).json({ error: 'kg_done must be a positive number.' });
  const note = String(req.body.note || '').trim().slice(0, 300);
  try {
    // Verify the protein exists and belongs to an open drop-off
    const check = await pool.query(
      `SELECT dp.id FROM dropoff_proteins dp
       JOIN dropoffs d ON d.id = dp.dropoff_id
       WHERE dp.id=$1 AND d.status='open'`,
      [req.params.id]
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Protein not found or drop-off already picked up.' });
    await pool.query(
      'INSERT INTO protein_logs (dropoff_protein_id, logged_by, kg_done, note) VALUES ($1,$2,$3,$4)',
      [req.params.id, req.session.userId, Number(kg_done).toFixed(1), note || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('log progress error:', e.message);
    res.status(500).json({ error: 'Could not save progress.' });
  }
});

// PATCH /api/proteins/:id/ready — mark protein as ready for pickup
router.patch('/:id/ready', requireAuth, requirePrep, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE dropoff_proteins SET status='ready'
       WHERE id=$1 AND status='in_progress'
       RETURNING id`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Protein not found or already ready.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('mark ready error:', e.message);
    res.status(500).json({ error: 'Could not mark as ready.' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Create routes/inventory.js**

```js
const express = require('express');
const pool    = require('../db/pool');
const { requireAuth } = require('./auth');
const router  = express.Router();

// GET /api/inventory — all open items at Franklin's
router.get('/', requireAuth, async (req, res) => {
  try {
    const proteins = await pool.query(
      `SELECT dp.id, dp.protein_name, dp.weight_kg, dp.status, dp.dropoff_id, d.dropped_at,
              COALESCE((SELECT kg_done FROM protein_logs WHERE dropoff_protein_id=dp.id ORDER BY logged_at DESC LIMIT 1), 0) AS latest_kg_done,
              COALESCE((SELECT note FROM protein_logs WHERE dropoff_protein_id=dp.id ORDER BY logged_at DESC LIMIT 1), '') AS latest_note
       FROM dropoff_proteins dp
       JOIN dropoffs d ON d.id = dp.dropoff_id
       WHERE d.status = 'open'
       ORDER BY d.dropped_at DESC, dp.id`
    );
    const supplies = await pool.query(
      `SELECT ds.id, ds.name, ds.amount, ds.dropoff_id, d.dropped_at
       FROM dropoff_supplies ds
       JOIN dropoffs d ON d.id = ds.dropoff_id
       WHERE d.status = 'open'
       ORDER BY d.dropped_at DESC, ds.id`
    );
    res.json({ proteins: proteins.rows, supplies: supplies.rows });
  } catch (e) {
    console.error('inventory error:', e.message);
    res.status(500).json({ error: 'Could not load inventory.' });
  }
});

module.exports = router;
```

- [ ] **Step 3: Verify syntax**

```bash
node --check routes/proteins.js routes/inventory.js
```

Expected: no output.

- [ ] **Step 4: Test progress logging**

Log in as Franklin:
```bash
curl -s -c /tmp/franklin.jar -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"pin":"222222"}'

# Log progress on protein id 1
curl -s -b /tmp/franklin.jar -X POST http://localhost:3000/api/proteins/1/log \
  -H 'Content-Type: application/json' -d '{"kg_done":45.5,"note":"Marinating overnight"}'
```
Expected: `{"ok":true}`

```bash
# Mark protein 1 ready
curl -s -b /tmp/franklin.jar -X PATCH http://localhost:3000/api/proteins/1/ready
```
Expected: `{"ok":true}`

```bash
# Check inventory
curl -s -b /tmp/franklin.jar http://localhost:3000/api/inventory
```
Expected: proteins array with status `ready` for protein 1, `in_progress` for protein 2.

```bash
# Confirm pickup as owner
curl -s -b /tmp/pt.jar -X POST http://localhost:3000/api/dropoffs/1/pickup
curl -s -b /tmp/pt.jar http://localhost:3000/api/inventory
```
Expected: empty proteins and supplies arrays after pickup.

- [ ] **Step 5: Commit**

```bash
git add routes/proteins.js routes/inventory.js
git commit -m "feat: progress logging, mark ready, inventory routes"
```

---

### Task 6: Frontend Shell — PIN Keypad + Page Routing

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`

**Interfaces:**
- Produces: SPA shell with PIN keypad login screen, page routing `go(id)`, `api()` helper, design system CSS tokens, i18n T[] object (English + Papiamento)

- [ ] **Step 1: Create public/index.html** (shell with login screen + all page containers)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrepTracker</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
:root{
  --sea:#0A8C9A;--sea-deep:#065260;--coral:#FF4D2E;--mango:#FFAA00;
  --green:#00C07F;--sand:#FFF4E0;--paper:#FFFCF7;--ink:#111C1B;--dim:#5A6B69;
  --line:rgba(10,140,154,.14);--shadow-sm:0 2px 12px -2px rgba(6,82,96,.12);
  --shadow-md:0 8px 32px -8px rgba(6,82,96,.22);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--sand);color:var(--ink);line-height:1.5;min-height:100vh}
.page{display:none}.page.active{display:block}

/* NAV */
.nav{display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:64px;background:#fff;border-bottom:1px solid var(--line);box-shadow:var(--shadow-sm)}
.nav-logo{font-size:20px;font-weight:800;color:var(--sea-deep);display:flex;align-items:center;gap:8px}
.nav-logo .mark{background:var(--sea);color:#fff;border-radius:10px;width:36px;height:36px;display:grid;place-items:center;font-size:18px}
.nav-right{display:flex;gap:10px;align-items:center}

/* BUTTONS */
.btn{display:inline-flex;align-items:center;gap:6px;padding:12px 20px;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;border:none;transition:.15s}
.btn-primary{background:var(--sea);color:#fff}.btn-primary:hover{background:var(--sea-deep)}
.btn-coral{background:var(--coral);color:#fff}.btn-coral:hover{filter:brightness(.9)}
.btn-ghost{background:transparent;border:1.5px solid var(--line);color:var(--sea)}.btn-ghost:hover{border-color:var(--sea);background:rgba(10,140,154,.06)}
.btn-sm{padding:9px 14px;font-size:13px;border-radius:9px}

/* CARDS */
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:var(--shadow-sm);margin-bottom:12px}

/* STATUS BADGES */
.badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700}
.badge-progress{background:rgba(255,170,0,.15);color:#a06800}
.badge-ready{background:rgba(0,192,127,.15);color:#007a50}
.badge-picked{background:rgba(10,140,154,.1);color:var(--sea-deep)}

/* PIN SCREEN */
.pin-screen{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:linear-gradient(135deg,var(--sea-deep) 0%,var(--sea) 60%,var(--coral) 100%)}
.pin-logo{color:#fff;font-size:28px;font-weight:800;margin-bottom:32px;display:flex;align-items:center;gap:10px}
.pin-logo .mark{background:rgba(255,255,255,.2);border-radius:12px;width:44px;height:44px;display:grid;place-items:center;font-size:22px}
.pin-card{background:#fff;border-radius:24px;padding:32px 28px;width:100%;max-width:340px;box-shadow:var(--shadow-md)}
.pin-card h2{font-size:20px;font-weight:800;margin-bottom:6px;color:var(--ink)}
.pin-card .sub{color:var(--dim);font-size:14px;margin-bottom:24px}
.pin-dots{display:flex;justify-content:center;gap:14px;margin-bottom:28px}
.pin-dot{width:18px;height:18px;border-radius:50%;background:var(--line);transition:.15s}
.pin-dot.filled{background:var(--sea)}
.pin-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.pin-key{height:64px;border-radius:14px;border:none;background:var(--sand);font-size:24px;font-weight:700;color:var(--ink);cursor:pointer;transition:.1s;-webkit-tap-highlight-color:transparent}
.pin-key:hover{background:var(--line)}.pin-key:active{transform:scale(.95)}
.pin-key.zero{grid-column:2}.pin-key.back{grid-column:3;font-size:18px}
.pin-error{color:var(--coral);font-size:13px;font-weight:600;text-align:center;min-height:20px;margin-top:12px}

/* WRAP */
.wrap{max-width:480px;margin:0 auto;padding:20px 16px}

/* SECTION HEADER */
.sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.sec-head h2{font-size:20px;font-weight:800;letter-spacing:-.5px}
.sec-head p{color:var(--dim);font-size:14px;margin-top:2px}

/* PROTEIN ROW */
.protein-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--line)}
.protein-row:last-child{border-bottom:none}
.protein-name{font-weight:700;font-size:15px}
.protein-weight{font-size:13px;color:var(--dim);margin-top:2px}
.protein-note{font-size:12px;color:var(--dim);margin-top:2px;font-style:italic}

/* FORM */
.field{margin-bottom:16px}
.field label{display:block;font-size:13px;font-weight:700;color:var(--dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
.field input,.field select,.field textarea{width:100%;padding:14px 16px;border:1.5px solid var(--line);border-radius:10px;font-size:16px;font-family:inherit;background:#fff;color:var(--ink);appearance:none}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--sea);border-left:3px solid var(--coral)}
.field textarea{resize:vertical;min-height:80px}

/* TOAST */
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:13px 22px;border-radius:12px;font-weight:600;font-size:14px;z-index:200;opacity:0;transition:.3s;pointer-events:none}
.toast.show{opacity:1}

/* EMPTY STATE */
.empty{text-align:center;padding:48px 24px;color:var(--dim)}
.empty h3{font-size:18px;font-weight:700;margin-bottom:8px;color:var(--ink)}
</style>
</head>
<body>

<!-- PIN LOGIN SCREEN -->
<div class="page active" id="pin">
  <div class="pin-screen">
    <div class="pin-logo"><span class="mark">🥩</span>PrepTracker</div>
    <div class="pin-card">
      <h2 data-i18n="pinTitle">Enter your PIN</h2>
      <p class="sub" data-i18n="pinSub">6-digit code</p>
      <div class="pin-dots" id="pinDots">
        <div class="pin-dot" id="d0"></div><div class="pin-dot" id="d1"></div>
        <div class="pin-dot" id="d2"></div><div class="pin-dot" id="d3"></div>
        <div class="pin-dot" id="d4"></div><div class="pin-dot" id="d5"></div>
      </div>
      <div class="pin-pad">
        <button class="pin-key" onclick="pinKey('1')">1</button>
        <button class="pin-key" onclick="pinKey('2')">2</button>
        <button class="pin-key" onclick="pinKey('3')">3</button>
        <button class="pin-key" onclick="pinKey('4')">4</button>
        <button class="pin-key" onclick="pinKey('5')">5</button>
        <button class="pin-key" onclick="pinKey('6')">6</button>
        <button class="pin-key" onclick="pinKey('7')">7</button>
        <button class="pin-key" onclick="pinKey('8')">8</button>
        <button class="pin-key" onclick="pinKey('9')">9</button>
        <button class="pin-key zero" onclick="pinKey('0')">0</button>
        <button class="pin-key back" onclick="pinBack()">⌫</button>
      </div>
      <div class="pin-error" id="pinError"></div>
    </div>
  </div>
</div>

<!-- OWNER HOME -->
<div class="page" id="owner-home">
  <nav class="nav">
    <div class="nav-logo"><span class="mark">🥩</span>PrepTracker</div>
    <div class="nav-right">
      <span id="navUserName" style="font-size:13px;font-weight:600;color:var(--dim)"></span>
      <button class="btn btn-ghost btn-sm" onclick="doLogout()" data-i18n="logout">Log out</button>
    </div>
  </nav>
  <div class="wrap">
    <div class="sec-head" style="margin-top:20px">
      <div><h2 data-i18n="atFranklins">At Franklin's</h2><p data-i18n="inventorySub">Current inventory</p></div>
      <button class="btn btn-primary btn-sm" onclick="go('new-dropoff')" data-i18n="newDropoff">+ Drop-off</button>
    </div>
    <div id="ownerInventory"></div>
    <div class="sec-head" style="margin-top:24px">
      <div><h2 data-i18n="history">History</h2></div>
      <button class="btn btn-ghost btn-sm" onclick="go('dropoff-list')" data-i18n="viewAll">View all →</button>
    </div>
    <div id="ownerRecentList"></div>
  </div>
</div>

<!-- PREP HOME -->
<div class="page" id="prep-home">
  <nav class="nav">
    <div class="nav-logo"><span class="mark">🥩</span>PrepTracker</div>
    <div class="nav-right">
      <span id="prepUserName" style="font-size:13px;font-weight:600;color:var(--dim)"></span>
      <button class="btn btn-ghost btn-sm" onclick="doLogout()" data-i18n="logout">Log out</button>
    </div>
  </nav>
  <div class="wrap">
    <div class="sec-head" style="margin-top:20px">
      <div><h2 data-i18n="toProcess">To Process</h2><p data-i18n="toProcessSub">Log your progress below</p></div>
    </div>
    <div id="prepInventory"></div>
  </div>
</div>

<!-- NEW DROP-OFF FORM (owner) -->
<div class="page" id="new-dropoff">
  <nav class="nav">
    <div class="nav-logo"><button class="btn btn-ghost btn-sm" onclick="go('owner-home')">← Back</button></div>
    <div class="nav-right"><span style="font-weight:800;color:var(--sea-deep)" data-i18n="newDropoff">New Drop-off</span></div>
  </nav>
  <div class="wrap">
    <div id="dropoffForm" style="margin-top:20px"></div>
    <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" onclick="submitDropoff()" data-i18n="saveDropoff">Save Drop-off</button>
  </div>
</div>

<!-- DROP-OFF LIST (owner) -->
<div class="page" id="dropoff-list">
  <nav class="nav">
    <div class="nav-logo"><button class="btn btn-ghost btn-sm" onclick="go('owner-home')">← Back</button></div>
    <div class="nav-right"><span style="font-weight:800;color:var(--sea-deep)" data-i18n="history">History</span></div>
  </nav>
  <div class="wrap" style="margin-top:20px">
    <div id="dropoffList"></div>
  </div>
</div>

<!-- DROP-OFF DETAIL -->
<div class="page" id="dropoff-detail">
  <nav class="nav">
    <div class="nav-logo"><button class="btn btn-ghost btn-sm" id="detailBack" onclick="go('owner-home')">← Back</button></div>
    <div class="nav-right"><span style="font-weight:800;color:var(--sea-deep)" data-i18n="dropoffDetail">Drop-off Detail</span></div>
  </nav>
  <div class="wrap" style="margin-top:20px">
    <div id="dropoffDetail"></div>
  </div>
</div>

<!-- PREP PROGRESS SCREEN -->
<div class="page" id="log-progress">
  <nav class="nav">
    <div class="nav-logo"><button class="btn btn-ghost btn-sm" onclick="go('prep-home')">← Back</button></div>
    <div class="nav-right"><span style="font-weight:800;color:var(--sea-deep)" id="logProgressTitle">Log Progress</span></div>
  </nav>
  <div class="wrap" style="margin-top:20px">
    <div id="logProgressForm"></div>
  </div>
</div>

<!-- SETTINGS (owner — change PINs) -->
<div class="page" id="settings">
  <nav class="nav">
    <div class="nav-logo"><button class="btn btn-ghost btn-sm" onclick="go('owner-home')">← Back</button></div>
    <div class="nav-right"><span style="font-weight:800;color:var(--sea-deep)" data-i18n="settings">Settings</span></div>
  </nav>
  <div class="wrap" style="margin-top:20px" id="settingsContent"></div>
</div>

<div class="toast" id="toast"></div>
<script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create public/app.js** (routing, PIN entry, i18n, helpers — NO feature screens yet)

```js
// PrepTracker frontend

let CURRENT_USER = null;
let LANG = 'en';

const $ = id => document.getElementById(id);

const T = {
  en: {
    pinTitle:'Enter your PIN', pinSub:'6-digit code', pinWrong:'Wrong PIN. Try again.',
    atFranklins:"At Franklin's", inventorySub:'Current inventory', newDropoff:'+ Drop-off',
    history:'History', viewAll:'View all →', toProcess:'To Process', toProcessSub:'Log your progress below',
    saveDropoff:'Save Drop-off', dropoffDetail:'Drop-off Detail', settings:'Settings',
    logout:'Log out', inProgress:'In Progress', ready:'✅ Ready', pickedUp:'📦 Picked up',
    noInventory:'Nothing here yet.', confirmPickup:'Confirm Pickup',
    kgDone:'kg done so far', note:'Note (optional)', markReady:'Mark Ready',
    logProgress:'Log Progress', kg:'kg', of:'of', pinChange:'Change PIN',
    save:'Save', cancel:'Cancel',
  },
  pap: {
    pinTitle:'Pon bo PIN', pinSub:'6 sífra', pinWrong:'PIN robes. Purba di nuevo.',
    atFranklins:'Na Franklin su kas', inventorySub:'Inventario aktual', newDropoff:'+ Entrega',
    history:'Historial', viewAll:'Mira tur →', toProcess:'Pa Prepará', toProcessSub:'Log bo progreso aki',
    saveDropoff:'Salbá Entrega', dropoffDetail:'Detaye di Entrega', settings:'Konfigurasjon',
    logout:'Sali', inProgress:'Den Progreso', ready:'✅ Listu', pickedUp:'📦 Rekohí',
    noInventory:'Nada akí ainda.', confirmPickup:'Konfirmá Rekòhi',
    kgDone:'kg hasi asina leu', note:'Nota (opsional)', markReady:'Markrá Listu',
    logProgress:'Log Progreso', kg:'kg', of:'di', pinChange:'Kambia PIN',
    save:'Salbá', cancel:'Kansela',
  },
};

function t(key){ return T[LANG][key] || T.en[key] || key; }

function go(id){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = $(id); if (pg) pg.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    ...opts,
  });
  let data = {};
  try { data = await r.json(); } catch(e) {}
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function esc(s){ return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtKg(n){ return Number(n).toFixed(1) + ' kg'; }
function statusBadge(s){
  if (s==='in_progress') return `<span class="badge badge-progress">${t('inProgress')}</span>`;
  if (s==='ready')       return `<span class="badge badge-ready">${t('ready')}</span>`;
  if (s==='picked_up')   return `<span class="badge badge-picked">${t('pickedUp')}</span>`;
  return '';
}
function fmtDate(d){ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }

// ---------- PIN entry ----------
let PIN = '';

function updateDots() {
  for (let i = 0; i < 6; i++) {
    $('d'+i).classList.toggle('filled', i < PIN.length);
  }
}

function pinKey(digit) {
  if (PIN.length >= 6) return;
  PIN += digit;
  updateDots();
  $('pinError').textContent = '';
  if (PIN.length === 6) submitPin();
}

function pinBack() {
  PIN = PIN.slice(0, -1);
  updateDots();
}

async function submitPin() {
  try {
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    CURRENT_USER = res.user;
    PIN = '';
    updateDots();
    afterLogin();
  } catch (e) {
    $('pinError').textContent = t('pinWrong');
    PIN = '';
    updateDots();
  }
}

function afterLogin() {
  if ($('navUserName')) $('navUserName').textContent = CURRENT_USER.name;
  if ($('prepUserName')) $('prepUserName').textContent = CURRENT_USER.name;
  if (CURRENT_USER.role === 'owner') {
    go('owner-home');
    loadOwnerHome();
  } else {
    go('prep-home');
    loadPrepHome();
  }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  CURRENT_USER = null;
  PIN = ''; updateDots();
  go('pin');
}

// ---------- boot ----------
(async function(){
  try {
    const res = await api('/auth/me');
    if (res.user) { CURRENT_USER = res.user; afterLogin(); }
    else go('pin');
  } catch(e) { go('pin'); }
})();
```

- [ ] **Step 3: Verify syntax**

```bash
node --check public/app.js
```

Expected: no output.

- [ ] **Step 4: Manual test — start server and open in browser**

```bash
node index.js
# Open http://localhost:3000 in browser
```

Expected: PIN keypad screen shows. Enter 111111 → navigates to owner-home (empty for now). Enter wrong PIN → shows error message. After login, refresh page → stays logged in (session cookie). Click Log out → returns to PIN screen.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: frontend shell — PIN keypad, routing, i18n, helpers"
```

---

### Task 7: Owner Screens — Dashboard, New Drop-off, Detail + Pickup

**Files:**
- Modify: `public/app.js` — add `loadOwnerHome()`, `loadDropoffList()`, `openDropoff()`, `renderDropoffDetail()`, `submitDropoff()`, `confirmPickup()`, `loadSettings()`, `changePinFor()`

- [ ] **Step 1: Add owner functions to public/app.js** (append to end of file, before closing)

```js
// ---------- OWNER: inventory dashboard ----------
async function loadOwnerHome() {
  $('navUserName').textContent = CURRENT_USER.name;
  try {
    const inv = await api('/inventory');
    renderOwnerInventory(inv);
  } catch(e) { $('ownerInventory').innerHTML = `<div class="empty"><h3>${t('noInventory')}</h3></div>`; }
  try {
    const dl = await api('/dropoffs');
    $('ownerRecentList').innerHTML = dl.dropoffs.slice(0,3).map(dropoffCard).join('') ||
      `<div class="empty"><h3>${t('noInventory')}</h3></div>`;
  } catch(e) {}
}

function renderOwnerInventory(inv) {
  const el = $('ownerInventory');
  if (!inv.proteins.length && !inv.supplies.length) {
    el.innerHTML = `<div class="empty"><h3>${t('noInventory')}</h3><p>Drop something off to get started.</p></div>`;
    return;
  }
  // Group proteins by status
  const ready = inv.proteins.filter(p => p.status === 'ready');
  const inProg = inv.proteins.filter(p => p.status === 'in_progress');

  let html = '';
  if (ready.length) {
    html += `<div class="card" style="border-left:4px solid var(--green)">
      <div style="font-weight:800;margin-bottom:12px;color:var(--green)">✅ ${t('ready')}</div>`;
    html += ready.map(p => proteinRowHtml(p)).join('');
    html += `<button class="btn btn-coral" style="width:100%;justify-content:center;margin-top:16px" onclick="openDropoff(${ready[0].dropoff_id})">${t('confirmPickup')} →</button>`;
    html += '</div>';
  }
  if (inProg.length) {
    html += `<div class="card">
      <div style="font-weight:800;margin-bottom:12px;color:var(--mango)">🟡 ${t('inProgress')}</div>`;
    html += inProg.map(p => proteinRowHtml(p)).join('');
    html += '</div>';
  }
  if (inv.supplies.length) {
    html += `<div class="card"><div style="font-weight:800;margin-bottom:12px">📦 Supplies</div>`;
    html += inv.supplies.map(s => `<div class="protein-row"><span class="protein-name">${esc(s.name)}</span><span class="protein-weight">${esc(s.amount)}</span></div>`).join('');
    html += '</div>';
  }
  el.innerHTML = html;
}

function proteinRowHtml(p) {
  const kg = parseFloat(p.latest_kg_done);
  const total = parseFloat(p.weight_kg);
  return `<div class="protein-row">
    <div>
      <div class="protein-name">${esc(p.protein_name)}</div>
      <div class="protein-weight">${fmtKg(kg)} ${t('of')} ${fmtKg(total)}</div>
      ${p.latest_note ? `<div class="protein-note">"${esc(p.latest_note)}"</div>` : ''}
    </div>
    ${statusBadge(p.status)}
  </div>`;
}

function dropoffCard(d) {
  const allReady = Number(d.ready_count) === Number(d.protein_count);
  const badge = d.status === 'picked_up' ? statusBadge('picked_up') :
    allReady ? statusBadge('ready') : statusBadge('in_progress');
  return `<div class="card" style="cursor:pointer" onclick="openDropoff(${d.id})">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700">${fmtDate(d.dropped_at)}</div>
        <div style="font-size:13px;color:var(--dim)">${d.protein_count} proteins · by ${esc(d.dropped_by)}</div>
      </div>
      ${badge}
    </div>
  </div>`;
}

// ---------- OWNER: drop-off list ----------
async function loadDropoffList() {
  try {
    const dl = await api('/dropoffs');
    $('dropoffList').innerHTML = dl.dropoffs.map(dropoffCard).join('') ||
      `<div class="empty"><h3>${t('noInventory')}</h3></div>`;
  } catch(e) { toast(e.message); }
}

// ---------- OWNER: drop-off detail ----------
let CURRENT_DROPOFF_ID = null;
async function openDropoff(id) {
  CURRENT_DROPOFF_ID = id;
  go('dropoff-detail');
  try {
    const { dropoff: d } = await api('/dropoffs/' + id);
    const allReady = d.proteins.length > 0 && d.proteins.every(p => p.status === 'ready');
    let html = `<div style="margin-bottom:16px">
      <div style="font-size:14px;color:var(--dim)">${fmtDate(d.dropped_at)}</div>
      ${d.notes ? `<div style="margin-top:6px;font-style:italic;color:var(--dim)">${esc(d.notes)}</div>` : ''}
    </div>`;
    html += d.proteins.map(p => `
      <div class="card" style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="protein-name">${esc(p.protein_name)}</div>
            <div class="protein-weight">${fmtKg(p.latest_kg_done)} ${t('of')} ${fmtKg(p.weight_kg)}</div>
            ${p.latest_note ? `<div class="protein-note">"${esc(p.latest_note)}"</div>` : ''}
          </div>
          ${statusBadge(p.status)}
        </div>
      </div>`).join('');
    if (d.supplies.length) {
      html += `<div class="card"><div style="font-weight:700;margin-bottom:10px">Supplies</div>`;
      html += d.supplies.map(s => `<div class="protein-row"><span>${esc(s.name)}</span><span>${esc(s.amount)}</span></div>`).join('');
      html += '</div>';
    }
    if (d.status === 'open' && allReady) {
      html += `<button class="btn btn-coral" style="width:100%;justify-content:center;margin-top:16px" onclick="confirmPickup(${d.id})">${t('confirmPickup')}</button>`;
    }
    $('dropoffDetail').innerHTML = html;
  } catch(e) { toast(e.message); }
}

async function confirmPickup(id) {
  if (!confirm('Confirm pickup of this drop-off?')) return;
  try {
    await api('/dropoffs/' + id + '/pickup', { method: 'POST' });
    toast('Pickup confirmed!');
    go('owner-home');
    loadOwnerHome();
  } catch(e) { toast(e.message); }
}

// ---------- OWNER: new drop-off form ----------
const PROTEINS = ['Flank Steak','Chicken Breast','Chicken Wings','Chicharron / Pork Belly','Burger Meat / Carni Mula','Bacon'];

function renderDropoffForm() {
  let html = '<div class="card">';
  html += '<div style="font-weight:800;margin-bottom:16px">Proteins (kg)</div>';
  html += PROTEINS.map(name => `
    <div class="field">
      <label>${esc(name)}</label>
      <input type="number" step="0.1" min="0" id="p_${esc(name.replace(/[^a-z]/gi,'_'))}" placeholder="e.g. 25.5">
    </div>`).join('');
  html += '</div>';
  html += '<div class="card" style="margin-top:0"><div style="font-weight:800;margin-bottom:16px">Supplies</div>';
  html += '<div id="suppliesRows"></div>';
  html += `<button class="btn btn-ghost btn-sm" onclick="addSupplyRow()">+ Add supply</button>`;
  html += '</div>';
  html += '<div class="field" style="margin-top:12px"><label>Notes (optional)</label><textarea id="dropoffNotes" rows="2"></textarea></div>';
  $('dropoffForm').innerHTML = html;
  addSupplyRow();
}

let supplyCount = 0;
function addSupplyRow() {
  supplyCount++;
  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:10px';
  div.id = 'sup_' + supplyCount;
  div.innerHTML = `
    <input type="text" placeholder="Name (e.g. Salt)" id="sname_${supplyCount}">
    <input type="text" placeholder="Amount (e.g. 500g)" id="samt_${supplyCount}">
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sup_${supplyCount}').remove()">✕</button>`;
  $('suppliesRows').appendChild(div);
}

async function submitDropoff() {
  const proteins = PROTEINS
    .map(name => ({ protein_name: name, weight_kg: parseFloat(document.getElementById('p_'+name.replace(/[^a-z]/gi,'_'))?.value||0)||0 }))
    .filter(p => p.weight_kg > 0);
  if (!proteins.length) { toast('Add at least one protein weight.'); return; }

  const supplies = [];
  for (let i = 1; i <= supplyCount; i++) {
    const n = document.getElementById('sname_'+i), a = document.getElementById('samt_'+i);
    if (n && a && n.value.trim() && a.value.trim()) supplies.push({ name: n.value.trim(), amount: a.value.trim() });
  }
  const notes = $('dropoffNotes')?.value.trim();
  try {
    await api('/dropoffs', { method: 'POST', body: JSON.stringify({ proteins, supplies, notes }) });
    toast('Drop-off saved!');
    go('owner-home');
    loadOwnerHome();
    supplyCount = 0;
  } catch(e) { toast(e.message); }
}

// ---------- OWNER: settings (change PINs) ----------
async function loadSettings() {
  try {
    const { rows } = await (async () => {
      const r = await api('/auth/me'); return { rows: [] };
    })();
    // Fetch users list — for now hardcode the 3 known users from /auth/users if we add it,
    // or use a simple form where owner types the userId
  } catch(e) {}
  $('settingsContent').innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:16px">${t('pinChange')}</div>
      <div class="field"><label>User ID (1=Owner, 2=Franklin, 3=Mama Franklin)</label>
        <input type="number" id="pinUserId" min="1" max="3" placeholder="e.g. 2"></div>
      <div class="field"><label>New PIN (6 digits)</label>
        <input type="text" id="newPinVal" maxlength="6" placeholder="••••••" inputmode="numeric"></div>
      <button class="btn btn-primary" style="width:100%" onclick="changePin()">${t('save')}</button>
    </div>`;
}

async function changePin() {
  const userId = $('pinUserId').value;
  const pin = $('newPinVal').value.trim();
  if (!/^\d{6}$/.test(pin)) { toast('PIN must be exactly 6 digits.'); return; }
  try {
    await api('/auth/pin/'+userId, { method: 'PATCH', body: JSON.stringify({ pin }) });
    toast('PIN updated!');
    $('newPinVal').value = '';
    $('pinUserId').value = '';
  } catch(e) { toast(e.message); }
}
```

- [ ] **Step 2: Wire up renderDropoffForm on page navigation**

In the `go()` function in app.js, add a call when going to `new-dropoff`:

Find the `go(id)` function and extend it:

```js
function go(id){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = $(id); if (pg) pg.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'new-dropoff') { supplyCount = 0; renderDropoffForm(); }
  if (id === 'dropoff-list') loadDropoffList();
  if (id === 'settings') loadSettings();
}
```

- [ ] **Step 3: Verify syntax**

```bash
node --check public/app.js
```

Expected: no output.

- [ ] **Step 4: Manual test**

Start server (`node index.js`), open browser, log in as Owner (111111):
- Dashboard shows empty inventory
- Click "+ Drop-off" → form renders with all 6 proteins
- Enter 100.3 for Flank Steak, add a supply → click Save → toast "Drop-off saved!" → back to dashboard
- Dashboard now shows the protein as In Progress
- Click drop-off card → detail view shows protein + supply
- Click "View all →" → list of all drop-offs

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: owner screens — dashboard, new drop-off, detail, pickup"
```

---

### Task 8: Prep Team Screens — Dashboard + Progress Logging

**Files:**
- Modify: `public/app.js` — add `loadPrepHome()`, `openLogProgress()`, `submitProgress()`, `markReady()`

- [ ] **Step 1: Append prep functions to public/app.js**

```js
// ---------- PREP: home dashboard ----------
async function loadPrepHome() {
  $('prepUserName').textContent = CURRENT_USER.name;
  try {
    const inv = await api('/inventory');
    const el = $('prepInventory');
    if (!inv.proteins.length && !inv.supplies.length) {
      el.innerHTML = `<div class="empty"><h3>${t('noInventory')}</h3><p>Nothing to process right now.</p></div>`;
      return;
    }
    let html = '';
    inv.proteins.forEach(p => {
      const kg = parseFloat(p.latest_kg_done);
      const total = parseFloat(p.weight_kg);
      const pct = total > 0 ? Math.min(100, Math.round((kg / total) * 100)) : 0;
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div class="protein-name">${esc(p.protein_name)}</div>
            <div class="protein-weight">${fmtKg(kg)} ${t('of')} ${fmtKg(total)}</div>
            ${p.latest_note ? `<div class="protein-note">"${esc(p.latest_note)}"</div>` : ''}
          </div>
          ${statusBadge(p.status)}
        </div>
        <div style="background:var(--line);border-radius:99px;height:8px;margin-bottom:14px">
          <div style="background:var(--sea);height:8px;border-radius:99px;width:${pct}%;transition:.3s"></div>
        </div>
        ${p.status === 'in_progress' ? `
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="openLogProgress(${p.id},'${esc(p.protein_name)}',${p.weight_kg})">${t('logProgress')}</button>
            <button class="btn btn-ghost btn-sm" onclick="markReady(${p.id})">${t('markReady')}</button>
          </div>` : ''}
      </div>`;
    });
    if (inv.supplies.length) {
      html += `<div class="card"><div style="font-weight:700;margin-bottom:10px">📦 Supplies available</div>`;
      html += inv.supplies.map(s => `<div class="protein-row"><span>${esc(s.name)}</span><span>${esc(s.amount)}</span></div>`).join('');
      html += '</div>';
    }
    el.innerHTML = html;
  } catch(e) { toast(e.message); }
}

// ---------- PREP: log progress ----------
let LOG_PROTEIN_ID = null;

function openLogProgress(id, name, weightKg) {
  LOG_PROTEIN_ID = id;
  $('logProgressTitle').textContent = name;
  $('logProgressForm').innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:4px">${esc(name)}</div>
      <div style="color:var(--dim);font-size:14px;margin-bottom:20px">Total: ${fmtKg(weightKg)}</div>
      <div class="field">
        <label>${t('kgDone')}</label>
        <input type="number" id="lgKg" step="0.1" min="0" max="${weightKg}" placeholder="e.g. 45.5" style="font-size:20px;font-weight:700">
      </div>
      <div class="field">
        <label>${t('note')}</label>
        <textarea id="lgNote" rows="2" placeholder="e.g. Marinating overnight"></textarea>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;font-size:16px;height:52px" onclick="submitProgress()">${t('save')}</button>
    </div>`;
  go('log-progress');
}

async function submitProgress() {
  const kg = parseFloat($('lgKg').value);
  if (isNaN(kg) || kg < 0) { toast('Enter a valid weight.'); return; }
  const note = $('lgNote').value.trim();
  try {
    await api('/proteins/' + LOG_PROTEIN_ID + '/log', { method: 'POST', body: JSON.stringify({ kg_done: kg, note }) });
    toast('Progress saved!');
    go('prep-home');
    loadPrepHome();
  } catch(e) { toast(e.message); }
}

async function markReady(id) {
  if (!confirm('Mark this protein as ready for pickup?')) return;
  try {
    await api('/proteins/' + id + '/ready', { method: 'PATCH' });
    toast('Marked ready!');
    loadPrepHome();
  } catch(e) { toast(e.message); }
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check public/app.js
```

Expected: no output.

- [ ] **Step 3: Manual end-to-end test**

Start server. Open browser:

1. Log in as Franklin (222222) → prep home shows proteins from Task 7's test drop-off
2. Tap "Log Progress" on Flank Steak → enter 45.5 → Save → toast "Progress saved!"
3. Back to prep home → progress bar shows ~45% filled
4. Tap "Mark Ready" → confirm → badge changes to ✅ Ready
5. Log out → log in as Owner (111111) → dashboard shows Flank Steak as Ready
6. Tap "Confirm Pickup" → confirm dialog → "Pickup confirmed!" → inventory empties

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: prep team screens — dashboard, progress logging, mark ready"
```

---

### Task 9: Push Notifications

**Files:**
- Create: `routes/push.js`
- Modify: `index.js` — import push module, add notify helper
- Modify: `routes/dropoffs.js` — call notify on new drop-off
- Modify: `routes/proteins.js` — call notify when protein marked ready
- Modify: `public/index.html` — add service worker registration
- Create: `public/sw.js` — service worker
- Modify: `public/app.js` — push subscription flow

**Interfaces:**
- Produces: `notify(userIds, title, body)` helper in `index.js`; service worker at `/sw.js`

- [ ] **Step 1: Generate VAPID keys**

```bash
node -e "const wp=require('web-push'); const keys=wp.generateVAPIDKeys(); console.log('PUBLIC:',keys.publicKey); console.log('PRIVATE:',keys.privateKey);"
```

Copy the output and add to `.env`:
```
VAPID_PUBLIC_KEY=<paste public key>
VAPID_PRIVATE_KEY=<paste private key>
VAPID_EMAIL=mailto:owner@preptracker.app
```

- [ ] **Step 2: Create routes/push.js**

```js
const express  = require('express');
const pool     = require('../db/pool');
const { requireAuth } = require('./auth');
const router   = express.Router();

// POST /api/push/subscribe — save or update push subscription for current user
router.post('/subscribe', requireAuth, async (req, res) => {
  const sub = req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription.' });
  try {
    await pool.query('UPDATE users SET push_subscription=$1 WHERE id=$2', [JSON.stringify(sub), req.session.userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('push subscribe error:', e.message);
    res.status(500).json({ error: 'Could not save subscription.' });
  }
});

// DELETE /api/push/subscribe — remove subscription
router.delete('/subscribe', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET push_subscription=NULL WHERE id=$1', [req.session.userId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove subscription.' });
  }
});

module.exports = router;
```

- [ ] **Step 3: Add notify helper to index.js**

After the `pool` require at the top of index.js, add:

```js
const webPush = require('web-push');
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@preptracker.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function notify(userIds, title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const { rows } = await pool.query(
      'SELECT push_subscription FROM users WHERE id = ANY($1) AND push_subscription IS NOT NULL',
      [userIds]
    );
    await Promise.all(rows.map(r =>
      webPush.sendNotification(r.push_subscription, JSON.stringify({ title, body }))
        .catch(e => console.error('push send error:', e.message))
    ));
  } catch (e) { console.error('notify error:', e.message); }
}

// Make notify available to routes
app.set('notify', notify);
```

- [ ] **Step 4: Call notify in routes/dropoffs.js on new drop-off**

In the POST `/` handler, after `COMMIT`, add:

```js
// Notify all prep users
const { rows: prepUsers } = await pool.query("SELECT id FROM users WHERE role='prep'");
const proteinNames = proteins.map(p => p.protein_name).join(', ');
req.app.get('notify')(prepUsers.map(u => u.id), 'New drop-off!', proteinNames + ' ready to prep').catch(()=>{});
```

- [ ] **Step 5: Call notify in routes/proteins.js when marked ready**

In the PATCH `/:id/ready` handler, after the UPDATE, add:

```js
// Notify all owner users
const { rows: owners } = await pool.query("SELECT id FROM users WHERE role='owner'");
const { rows: prot } = await pool.query('SELECT protein_name FROM dropoff_proteins WHERE id=$1', [req.params.id]);
const name = prot[0]?.protein_name || 'A protein';
req.app.get('notify')(owners.map(u => u.id), '✅ Ready for pickup!', name + ' is ready.').catch(()=>{});
```

- [ ] **Step 6: Create public/sw.js** (service worker)

```js
self.addEventListener('push', e => {
  let data = { title: 'PrepTracker', body: 'Update available.' };
  try { data = e.data.json(); } catch(err) {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
```

- [ ] **Step 7: Register service worker and subscribe in public/app.js**

Append to app.js:

```js
// ---------- PUSH NOTIFICATIONS ----------
const VAPID_PUBLIC_KEY = document.currentScript?.dataset?.vapidKey || '';

async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(document.getElementById('vapidKey')?.dataset?.key || ''),
    });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
  } catch(e) { console.log('push setup:', e.message); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
```

- [ ] **Step 8: Add VAPID public key to index.html and call registerPush after login**

In `public/index.html`, add a hidden element in the body before the script tag:

```html
<div id="vapidKey" data-key="" style="display:none"></div>
```

In `index.js`, serve the VAPID public key by injecting it before the static file serve, or add a route:

```js
app.get('/api/vapid-key', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || '' }));
```

In `public/app.js`, in the `afterLogin()` function, add:

```js
async function afterLogin() {
  if ($('navUserName')) $('navUserName').textContent = CURRENT_USER.name;
  if ($('prepUserName')) $('prepUserName').textContent = CURRENT_USER.name;
  // Register push after login
  try {
    const { key } = await api('/vapid-key');
    if (key && $('vapidKey')) $('vapidKey').dataset.key = key;
    registerPush();
  } catch(e) {}
  if (CURRENT_USER.role === 'owner') { go('owner-home'); loadOwnerHome(); }
  else { go('prep-home'); loadPrepHome(); }
}
```

- [ ] **Step 9: Verify syntax**

```bash
node --check routes/push.js index.js routes/dropoffs.js routes/proteins.js public/app.js
```

Expected: no output.

- [ ] **Step 10: Test push manually**

Start server. Log in on two different browser tabs — one as Owner, one as Franklin. Mark a protein ready as Franklin → Owner tab should receive a browser push notification "✅ Ready for pickup!". Create a new drop-off as Owner → Franklin tab should receive "New drop-off!".

- [ ] **Step 11: Commit**

```bash
git add routes/push.js public/sw.js public/index.html public/app.js index.js routes/dropoffs.js routes/proteins.js
git commit -m "feat: browser push notifications — new drop-off and ready alerts"
```

---

### Task 10: Render Deploy + Final Polish

**Files:**
- Create: `render.yaml` (optional — for Render blueprint)
- Modify: `public/index.html` — responsive CSS polish, large touch targets audit
- Modify: `public/app.js` — any missing edge cases

**Interfaces:**
- Produces: live app on Render at a public URL

- [ ] **Step 1: Add render.yaml for one-click deploy (optional)**

```yaml
services:
  - type: web
    name: preptracker
    runtime: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: SESSION_SECRET
        generateValue: true
      - key: DATABASE_URL
        fromDatabase:
          name: preptracker-db
          property: connectionString

databases:
  - name: preptracker-db
    plan: free
```

- [ ] **Step 2: Add mobile CSS polish to index.html**

Add inside the `<style>` block:

```css
/* Mobile: ensure all buttons are at least 48px tall */
@media(max-width:480px){
  .btn { min-height:48px; }
  .pin-key { height:72px; font-size:28px; }
  .pin-card { padding:28px 20px; }
  .wrap { padding:16px 12px; }
  .card { padding:16px; }
  .field input, .field select, .field textarea { font-size:16px; } /* prevents iOS zoom */
}
```

- [ ] **Step 3: Create GitHub repo and push**

```bash
git remote add origin https://github.com/automation297/preptracker.git
git push -u origin main
```

- [ ] **Step 4: Deploy on Render**

1. Go to render.com → New → Web Service
2. Connect `automation297/preptracker` repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables: `DATABASE_URL`, `SESSION_SECRET` (random string), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `NODE_ENV=production`
6. Create PostgreSQL database → copy connection string to `DATABASE_URL`

- [ ] **Step 5: Run schema + seed on production DB**

```bash
DATABASE_URL=<render-postgres-url> node -e "
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
client.connect().then(() => client.query(fs.readFileSync('./db/schema.sql','utf8'))).then(() => { console.log('Schema applied'); client.end(); });
"

DATABASE_URL=<render-postgres-url> NODE_ENV=production node db/seed.js
```

- [ ] **Step 6: Smoke test on live URL**

- Open the live URL on mobile (iPhone/Android)
- Log in as Owner (111111) → create a drop-off
- Log in as Franklin (222222) on another device → see the drop-off, log progress, mark ready
- Receive push notification on Owner's device
- Owner confirms pickup → inventory clears

- [ ] **Step 7: Final commit**

```bash
git add render.yaml public/index.html
git commit -m "feat: render deploy config, mobile CSS polish"
git push
```

---

## Summary of Files Created

| File | Purpose |
|------|---------|
| `index.js` | Express server, middleware, Helmet CSP, session, rate limit, notify helper |
| `db/pool.js` | PostgreSQL pool |
| `db/schema.sql` | 5 tables: users, dropoffs, dropoff_proteins, protein_logs, dropoff_supplies |
| `db/seed.js` | Pre-create Owner, Franklin, Mama Franklin with default PINs |
| `routes/auth.js` | PIN login/logout/me, owner PIN change |
| `routes/dropoffs.js` | Create drop-off, list, detail, confirm pickup |
| `routes/proteins.js` | Log progress, mark ready |
| `routes/inventory.js` | Current open items at Franklin's |
| `routes/push.js` | Save/remove push subscriptions |
| `public/index.html` | SPA shell, all CSS, page containers |
| `public/app.js` | All frontend JS: PIN entry, routing, owner screens, prep screens, push |
| `public/sw.js` | Service worker for push notifications |
| `render.yaml` | Render deploy blueprint |
