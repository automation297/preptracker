const express = require('express');
const pool    = require('../db/pool');
const { requireAuth } = require('./auth');
const { adjustInventory } = require('./inventory');
const router  = express.Router();

function requirePrep(req, res, next) {
  if (req.session.role !== 'prep') return res.status(403).json({ error: 'Prep team only.' });
  next();
}

// Maps dropoff_proteins.protein_name (human label, shown in the drop-off UI) to the
// bot's protein_type key (used everywhere in inventory_items/purchases). Proteins with
// no bot-side equivalent yet (Chicharron, Bacon) still get their own inventory bucket,
// just never auto-fed by a bot purchase -- only by a manually-created drop-off.
const PROTEIN_LABEL_TO_KEY = {
  'Flank Steak': 'steak', 'Chicken Breast': 'chicken', 'Chicken Wings': 'chicken',
  'Chicharron / Pork Belly': 'pork', 'Burger Meat / Carni Mula': 'burger', 'Bacon': 'bacon',
  'Hotdog': 'hotdog', 'Chorizo': 'chorizo', 'Salchi': 'salchi',
};

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
       RETURNING id, protein_name, weight_kg, unit_count`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Protein not found or already ready.' });
    const p = r.rows[0];
    // Move raw -> ready in the persistent inventory (Phase 1) — the batch just finished
    // prepping is no longer raw material, it's now sellable stock. Only proteins with a
    // known bot-side key move inventory; others (Chicharron, Bacon) just don't have a
    // bucket yet, which is fine — this never blocks marking ready.
    const invKey = PROTEIN_LABEL_TO_KEY[p.protein_name];
    if (invKey) {
      const amount = p.unit_count != null ? Number(p.unit_count) : Number(p.weight_kg);
      const unit = p.unit_count != null ? 'piece' : 'kg';
      if (amount > 0) adjustInventory(invKey, 'protein', unit, -amount, amount).catch(e => console.error('adjustInventory (ready) error:', e.message));
    }
    // Notify all owner users
    const { rows: owners } = await pool.query("SELECT id FROM users WHERE role='owner'");
    req.app.get('notify')(owners.map(u => u.id), '✅ Ready for pickup!', p.protein_name + ' is ready.').catch(()=>{});
    res.json({ ok: true });
  } catch (e) {
    console.error('mark ready error:', e.message);
    res.status(500).json({ error: 'Could not mark as ready.' });
  }
});

module.exports = router;
