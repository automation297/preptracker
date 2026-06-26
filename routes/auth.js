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
