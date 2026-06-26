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
