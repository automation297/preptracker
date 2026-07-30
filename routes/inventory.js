const express = require('express');
const pool    = require('../db/pool');
const { requireAuth } = require('./auth');
const { requireApiKey } = require('./apiAuth');
const router  = express.Router();

// GET /api/inventory — all open items at Franklin's
router.get('/', requireAuth, async (req, res) => {
  try {
    const proteins = await pool.query(
      `SELECT dp.id, dp.protein_name, dp.weight_kg, dp.unit_count, dp.status, dp.dropoff_id, d.dropped_at,
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

// GET /api/inventory/stock — the persistent raw/ready running totals (Phase 1 inventory,
// distinct from the per-night dropoff/shift_stock workflow above). Any logged-in user
// (owner or prep) can view this.
router.get('/stock', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM inventory_items ORDER BY category, item_name');
    res.json({ items: rows });
  } catch (e) {
    console.error('inventory stock error:', e.message);
    res.status(500).json({ error: 'Could not load stock.' });
  }
});

// POST /api/inventory/raw-add {item_name, qty, unit, category} — increments raw_qty.
// Called by the bot when a protein purchase is logged (see routes/purchases.js hook)
// and by the "Mark Ready" flow's inverse (see routes/proteins.js) to move raw->ready.
// Upserts the item row if it doesn't exist yet (first time this item is ever seen).
async function adjustInventory(itemName, category, unit, rawDelta, readyDelta) {
  await pool.query(
    `INSERT INTO inventory_items (item_name, category, unit, raw_qty, ready_qty)
     VALUES ($1,$2,$3,GREATEST(0,$4),GREATEST(0,$5))
     ON CONFLICT (item_name) DO UPDATE SET
       raw_qty = GREATEST(0, inventory_items.raw_qty + $4),
       ready_qty = GREATEST(0, inventory_items.ready_qty + $5),
       updated_at = NOW()`,
    [itemName, category, unit, rawDelta, readyDelta]
  );
}

// POST /api/inventory/consume {item_name, qty, staff_name, reason} — the "Dinner"
// button. Deducts from ready_qty (never raw_qty -- staff eat finished/prepped food,
// not raw ingredients) and logs who/what/when for accountability.
router.post('/consume', requireAuth, async (req, res) => {
  const itemName = String(req.body.item_name || '').trim();
  const qty = Number(req.body.qty);
  const reason = String(req.body.reason || 'dinner').trim().slice(0, 40);
  const staffName = String(req.body.staff_name || req.session.name || '').trim().slice(0, 60) || null;
  if (!itemName) return res.status(400).json({ error: 'item_name is required.' });
  if (!qty || qty <= 0) return res.status(400).json({ error: 'qty must be greater than 0.' });
  try {
    const { rows } = await pool.query('SELECT * FROM inventory_items WHERE item_name=$1', [itemName]);
    if (!rows.length) return res.status(404).json({ error: 'Unknown inventory item: ' + itemName });
    await adjustInventory(itemName, rows[0].category, rows[0].unit, 0, -qty);
    await pool.query(
      'INSERT INTO inventory_consumption (item_name, qty, reason, staff_name, created_by) VALUES ($1,$2,$3,$4,$5)',
      [itemName, qty, reason, staffName, req.session.userId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('inventory consume error:', e.message);
    res.status(500).json({ error: 'Could not log consumption.' });
  }
});

module.exports = router;
module.exports.adjustInventory = adjustInventory;
