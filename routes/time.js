// routes/time.js
const express = require('express');
const pool = require('../db/pool');
const { requireApiKey } = require('./apiAuth');
const router = express.Router();

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

async function findStaff(name) {
  const key = String(name || '').trim().toLowerCase();
  const { rows } = await pool.query('SELECT * FROM staff WHERE name=$1 AND active=true', [key]);
  return rows[0] || null;
}

// POST /api/time/clock-in {name, source, requestedTime?}
router.post('/clock-in', requireApiKey, async (req, res) => {
  const source = req.body.source === 'app' ? 'app' : 'bot';
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  try {
    const openRes = await pool.query(
      `SELECT * FROM time_entries WHERE staff_id=$1 AND status='open'`, [staff.id]
    );
    if (openRes.rows.length) {
      return res.status(409).json({ error: staff.display_name + ' is already clocked in.' });
    }
    const now = new Date();
    const requestedTime = req.body.requestedTime ? new Date(req.body.requestedTime) : null;
    const requestedValid = requestedTime && !isNaN(requestedTime.getTime());
    const withinWindow = requestedValid && Math.abs(now.getTime() - requestedTime.getTime()) <= FIFTEEN_MIN_MS;
    const clockIn = withinWindow ? requestedTime : now;

    const { rows } = await pool.query(
      `INSERT INTO time_entries (staff_id, clock_in, source, status, requested_time)
       VALUES ($1,$2,$3,'open',$4) RETURNING *`,
      [staff.id, clockIn.toISOString(), source, requestedValid ? requestedTime.toISOString() : null]
    );
    const entry = rows[0];

    let pendingNote = null;
    if (requestedValid && !withinWindow) {
      await pool.query(
        `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, notes)
         VALUES ($1,$2,$3,'pending_approval',$4,'Clock-in time correction request')`,
        [staff.id, requestedTime.toISOString(), source, entry.id]
      );
      pendingNote = 'Requested time was more than 15 min from now — clocked in at current time, your requested time was sent for owner approval.';
    }
    res.json({ entry, staff, pendingNote });
  } catch (e) {
    console.error('clock-in error:', e.message);
    res.status(500).json({ error: 'Could not clock in.' });
  }
});

// POST /api/time/clock-out {name, source, requestedTime?}
router.post('/clock-out', requireApiKey, async (req, res) => {
  const source = req.body.source === 'app' ? 'app' : 'bot';
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  try {
    const openRes = await pool.query(
      `SELECT * FROM time_entries WHERE staff_id=$1 AND status='open' ORDER BY clock_in DESC LIMIT 1`,
      [staff.id]
    );
    if (!openRes.rows.length) {
      return res.status(409).json({ error: staff.display_name + ' is not clocked in.' });
    }
    const entry = openRes.rows[0];
    const now = new Date();
    const requestedTime = req.body.requestedTime ? new Date(req.body.requestedTime) : null;
    const requestedValid = requestedTime && !isNaN(requestedTime.getTime());
    const withinWindow = requestedValid && Math.abs(now.getTime() - requestedTime.getTime()) <= FIFTEEN_MIN_MS;
    const clockOut = withinWindow ? requestedTime : now;

    const { rows } = await pool.query(
      `UPDATE time_entries SET clock_out=$1, status='closed' WHERE id=$2 RETURNING *`,
      [clockOut.toISOString(), entry.id]
    );
    const closed = rows[0];
    const hours = (new Date(closed.clock_out) - new Date(closed.clock_in)) / 3600000;

    let pendingNote = null;
    if (requestedValid && !withinWindow) {
      await pool.query(
        `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, notes)
         VALUES ($1,$2,$3,'pending_approval',$4,'Clock-out time correction request')`,
        [staff.id, requestedTime.toISOString(), source, closed.id]
      );
      pendingNote = 'Requested time was more than 15 min from now — clocked out at current time, your requested time was sent for owner approval.';
    }
    res.json({ entry: closed, staff, hours: +hours.toFixed(2), pendingNote });
  } catch (e) {
    console.error('clock-out error:', e.message);
    res.status(500).json({ error: 'Could not clock out.' });
  }
});

module.exports = router;
