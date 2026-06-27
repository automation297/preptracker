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
    // Notify all owner users
    const { rows: owners } = await pool.query("SELECT id FROM users WHERE role='owner'");
    const { rows: prot } = await pool.query('SELECT protein_name FROM dropoff_proteins WHERE id=$1', [req.params.id]);
    const name = prot[0]?.protein_name || 'A protein';
    req.app.get('notify')(owners.map(u => u.id), '✅ Ready for pickup!', name + ' is ready.').catch(()=>{});
    res.json({ ok: true });
  } catch (e) {
    console.error('mark ready error:', e.message);
    res.status(500).json({ error: 'Could not mark as ready.' });
  }
});

module.exports = router;
