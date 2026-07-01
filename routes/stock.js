const express = require('express');
const pool    = require('../db/pool');
const { requireAuth } = require('./auth');
const router  = express.Router();

// GET /api/stock/tonight — public (bot + kitchen screen can read)
router.get('/tonight', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date().toISOString().split('T')[0];
    const sess = await pool.query('SELECT * FROM shift_sessions WHERE shift_date=$1', [today]);
    if (!sess.rows.length) return res.json({ session: null, items: [] });
    const session = sess.rows[0];
    const items = await pool.query(
      'SELECT * FROM shift_stock WHERE shift_id=$1 ORDER BY category, item_name',
      [session.id]
    );
    res.json({ session, items: items.rows });
  } catch (e) {
    console.error('stock tonight error:', e.message);
    res.status(500).json({ error: 'Could not load stock.' });
  }
});

// POST /api/stock/open — open tonight's shift with items (auth required)
router.post('/open', requireAuth, async (req, res) => {
  const { items } = req.body; // [{ item_name, category, unit, start_qty }]
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items array required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const today = new Date().toISOString().split('T')[0];
    // Upsert session
    const sess = await client.query(
      `INSERT INTO shift_sessions (shift_date, status)
       VALUES ($1, 'open')
       ON CONFLICT (shift_date) DO UPDATE SET status='open', closed_at=NULL
       RETURNING *`,
      [today]
    );
    const sessionId = sess.rows[0].id;
    // Clear existing items for this session
    await client.query('DELETE FROM shift_stock WHERE shift_id=$1', [sessionId]);
    // Insert new items
    for (const item of items) {
      await client.query(
        `INSERT INTO shift_stock (shift_id, item_name, category, unit, start_qty, current_qty)
         VALUES ($1,$2,$3,$4,$5,$5)`,
        [sessionId, item.item_name, item.category || 'other', item.unit || 'portions',
         Math.round(Number(item.start_qty) * 10) / 10]
      );
    }
    await client.query('COMMIT');
    const stockRows = await pool.query('SELECT * FROM shift_stock WHERE shift_id=$1 ORDER BY category, item_name', [sessionId]);
    res.json({ session: sess.rows[0], items: stockRows.rows });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('stock open error:', e.message);
    res.status(500).json({ error: 'Could not open shift.' });
  } finally {
    client.release();
  }
});

// PATCH /api/stock/use/:id — decrement current_qty (auth required)
router.patch('/use/:id', requireAuth, async (req, res) => {
  const amount = Number(req.body.amount) || 1;
  try {
    const { rows } = await pool.query(
      `UPDATE shift_stock SET current_qty = GREATEST(0, current_qty - $1)
       WHERE id=$2 RETURNING *`,
      [amount, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    res.json({ item: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Could not update.' });
  }
});

// PATCH /api/stock/set/:id — set current_qty (correction, auth required)
router.patch('/set/:id', requireAuth, async (req, res) => {
  const qty = Number(req.body.qty);
  if (isNaN(qty) || qty < 0) return res.status(400).json({ error: 'Invalid qty.' });
  try {
    const { rows } = await pool.query(
      'UPDATE shift_stock SET current_qty=$1 WHERE id=$2 RETURNING *',
      [qty, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    res.json({ item: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Could not update.' });
  }
});

// POST /api/stock/close — close shift with end-of-night counts (auth required)
router.post('/close', requireAuth, async (req, res) => {
  const { items } = req.body; // [{ id, end_qty }]
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const today = new Date().toISOString().split('T')[0];
    await client.query(
      `UPDATE shift_sessions SET status='closed', closed_at=NOW() WHERE shift_date=$1`,
      [today]
    );
    for (const item of (items || [])) {
      if (item.id != null && item.end_qty != null) {
        await client.query(
          'UPDATE shift_stock SET end_qty=$1 WHERE id=$2',
          [Number(item.end_qty), item.id]
        );
      }
    }
    await client.query('COMMIT');
    // Return summary for tomorrow's recommendation
    const summary = await pool.query(
      `SELECT ss.*, ses.shift_date
       FROM shift_stock ss
       JOIN shift_sessions ses ON ses.id = ss.shift_id
       WHERE ses.shift_date=$1 ORDER BY ss.category, ss.item_name`,
      [today]
    );
    res.json({ ok: true, items: summary.rows });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('stock close error:', e.message);
    res.status(500).json({ error: 'Could not close shift.' });
  } finally {
    client.release();
  }
});

module.exports = router;
