// routes/staff.js
const express = require('express');
const pool = require('../db/pool');
const { requireApiKey } = require('./apiAuth');
const router = express.Router();

// POST /api/staff — add a staff member
router.post('/', requireApiKey, async (req, res) => {
  const displayName = String(req.body.name || '').trim();
  const rate = Number(req.body.hourly_rate);
  if (!displayName) return res.status(400).json({ error: 'name required' });
  if (isNaN(rate) || rate <= 0) return res.status(400).json({ error: 'hourly_rate must be a positive number' });
  const name = displayName.toLowerCase();
  try {
    const existing = await pool.query('SELECT id FROM staff WHERE name=$1', [name]);
    if (existing.rows.length) return res.status(409).json({ error: displayName + ' already exists.' });
    const { rows } = await pool.query(
      `INSERT INTO staff (name, display_name, hourly_rate) VALUES ($1,$2,$3) RETURNING *`,
      [name, displayName, rate]
    );
    res.json({ staff: rows[0] });
  } catch (e) {
    console.error('staff create error:', e.message);
    res.status(500).json({ error: 'Could not add staff member.' });
  }
});

// GET /api/staff — list (active by default, ?all=1 for everyone)
router.get('/', requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      req.query.all ? 'SELECT * FROM staff ORDER BY display_name'
                    : 'SELECT * FROM staff WHERE active=true ORDER BY display_name'
    );
    res.json({ staff: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not list staff.' });
  }
});

// PATCH /api/staff/:name — update rate and/or active
router.patch('/:name', requireApiKey, async (req, res) => {
  const name = String(req.params.name || '').trim().toLowerCase();
  const fields = [];
  const values = [];
  if (req.body.hourly_rate !== undefined) {
    const rate = Number(req.body.hourly_rate);
    if (isNaN(rate) || rate <= 0) return res.status(400).json({ error: 'hourly_rate must be a positive number' });
    fields.push('hourly_rate=$' + (values.length + 1)); values.push(rate);
  }
  if (req.body.active !== undefined) {
    fields.push('active=$' + (values.length + 1)); values.push(!!req.body.active);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(name);
  try {
    const { rows } = await pool.query(
      `UPDATE staff SET ${fields.join(', ')} WHERE name=$${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Unknown staff member: ' + name });
    res.json({ staff: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Could not update staff member.' });
  }
});

module.exports = router;
