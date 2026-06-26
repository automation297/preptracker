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
