const express = require('express');
const pool    = require('../db/pool');
const { requireAuth, requireOwner } = require('./auth');
const { hasValidApiKey } = require('./apiAuth');
const { adjustInventory } = require('./inventory');
const router  = express.Router();

// Accepts either a valid PREPTRACKER_API_KEY header (for the bot's automated
// receipt-logging) or the existing owner-session auth (for the app's own UI).
function requireOwnerOrApiKey(req, res, next) {
  if (hasValidApiKey(req)) return next();
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in.' });
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  next();
}

// GET /api/purchases?range=today|week|month|lastmonth&scope=business|personal|all
// requireOwnerOrApiKey (not requireAuth-only) so the bot's automated monthly report
// and manual expense command can both read this via PREPTRACKER_API_KEY, same as POST.
router.get('/', requireOwnerOrApiKey, async (req, res) => {
  const range = req.query.range || 'today';
  let dateFilter;
  if (range === 'lastmonth') dateFilter = "bought_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND bought_at < date_trunc('month', CURRENT_DATE)";
  else if (range === 'month') dateFilter = "bought_at >= date_trunc('month', CURRENT_DATE)";
  else if (range === 'week') dateFilter = "bought_at >= date_trunc('week', CURRENT_DATE)";
  else dateFilter = "bought_at = CURRENT_DATE";

  const scope = req.query.scope || 'business';
  const scopeFilter = scope === 'all' ? '1=1' : 'p.scope = $1';

  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS by_name
       FROM purchases p LEFT JOIN users u ON u.id = p.created_by
       WHERE ${dateFilter} AND ${scopeFilter} ORDER BY p.bought_at DESC, p.created_at DESC`,
      scope === 'all' ? [] : [scope]
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

// POST /api/purchases — log a purchase (owner, or the bot via API key)
router.post('/', requireOwnerOrApiKey, async (req, res) => {
  const { item_name, category, price_fl, qty, unit, notes, bought_at, scope, weight_kg, protein_type, protein_price_fl, unit_count, drink_type, supply_type } = req.body;
  if (!item_name || price_fl == null || qty == null || !unit) {
    return res.status(400).json({ error: 'item_name, price_fl, qty and unit are required.' });
  }
  if (scope !== undefined && scope !== 'business' && scope !== 'personal') {
    return res.status(400).json({ error: "scope must be 'business' or 'personal'." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO purchases (item_name, category, price_fl, qty, unit, notes, bought_at, created_by, scope, weight_kg, protein_type, protein_price_fl, unit_count, drink_type, supply_type)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,COALESCE($9,'business'),$10,$11,$12,$13,$14,$15) RETURNING *`,
      [item_name, category || 'other', Number(price_fl), Number(qty), unit,
       notes || null, bought_at || null, (req.session && req.session.userId) || null, scope || null,
       weight_kg != null ? Number(weight_kg) : null, protein_type || null,
       protein_price_fl != null ? Number(protein_price_fl) : null,
       unit_count != null ? parseInt(unit_count, 10) : null,
       drink_type || null, supply_type || null]
    );
    // Business protein purchases auto-feed the persistent RAW inventory (Phase 1,
    // added 2026-07-30) -- raw material that still needs prepping before it's sellable.
    // Drink purchases (added same day) go STRAIGHT to READY inventory instead -- a
    // canned drink doesn't need a prep step, it's sellable the moment it arrives.
    // Both: going forward only, no retroactive backfill of past purchases (owner's
    // explicit call). Personal-scope purchases never touch stock either way -- a
    // personal steak dinner (or personal soda) isn't truck inventory.
    const p = rows[0];
    if (p.scope !== 'personal') {
      if (p.protein_type && (p.weight_kg != null || p.unit_count != null)) {
        const amount = p.unit_count != null ? Number(p.unit_count) : Number(p.weight_kg);
        const unit = p.unit_count != null ? 'piece' : 'kg';
        adjustInventory(p.protein_type, 'protein', unit, amount, 0).catch(e => console.error('adjustInventory (purchase) error:', e.message));
      } else if (p.drink_type && p.unit_count != null) {
        adjustInventory(p.drink_type, 'drink', 'can', 0, Number(p.unit_count)).catch(e => console.error('adjustInventory (drink purchase) error:', e.message));
      } else if (p.supply_type && p.unit_count != null) {
        adjustInventory(p.supply_type, 'supply', 'piece', 0, Number(p.unit_count)).catch(e => console.error('adjustInventory (supply purchase) error:', e.message));
      }
    }
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
