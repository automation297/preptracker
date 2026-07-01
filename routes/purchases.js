const express = require('express');
const pool    = require('../db/pool');
const { requireAuth, requireOwner } = require('./auth');
const router  = express.Router();

// GET /api/purchases?range=today|week|month
router.get('/', requireAuth, async (req, res) => {
  const range = req.query.range || 'today';
  let dateFilter;
  if (range === 'month') dateFilter = "bought_at >= date_trunc('month', CURRENT_DATE)";
  else if (range === 'week') dateFilter = "bought_at >= date_trunc('week', CURRENT_DATE)";
  else dateFilter = "bought_at = CURRENT_DATE";

  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS by_name
       FROM purchases p LEFT JOIN users u ON u.id = p.created_by
       WHERE ${dateFilter} ORDER BY p.bought_at DESC, p.created_at DESC`
    );
    const total = rows.reduce((s, r) => s + parseFloat(r.price_fl), 0);
    const byCategory = {};
    rows.forEach(r => {
      byCategory[r.category] = (byCategory[r.category] || 0) + parseFloat(r.price_fl);
    });
    res.json({ purchases: rows, total: total.toFixed(2), byCategory });
  } catch (e) {
    console.error('purchases list error:', e.message);
    res.status(500).json({ error: 'Could not load purchases.' });
  }
});

// POST /api/purchases — log a purchase (owner only)
router.post('/', requireOwner, async (req, res) => {
  const { item_name, category, price_fl, qty, unit, notes, bought_at } = req.body;
  if (!item_name || price_fl == null || qty == null || !unit) {
    return res.status(400).json({ error: 'item_name, price_fl, qty and unit are required.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO purchases (item_name, category, price_fl, qty, unit, notes, bought_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8) RETURNING *`,
      [item_name, category || 'other', Number(price_fl), Number(qty), unit,
       notes || null, bought_at || null, req.session.userId]
    );
    res.status(201).json({ purchase: rows[0] });
  } catch (e) {
    console.error('purchase create error:', e.message);
    res.status(500).json({ error: 'Could not save purchase.' });
  }
});

// DELETE /api/purchases/:id (owner only)
router.delete('/:id', requireOwner, async (req, res) => {
  try {
    await pool.query('DELETE FROM purchases WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete.' });
  }
});

module.exports = router;
