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
