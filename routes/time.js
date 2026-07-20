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
  try {
    const staff = await findStaff(req.body.name);
    if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
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

    let entry;
    try {
      const { rows } = await pool.query(
        `INSERT INTO time_entries (staff_id, clock_in, source, status, requested_time)
         VALUES ($1,$2,$3,'open',$4) RETURNING *`,
        [staff.id, clockIn.toISOString(), source, requestedValid ? requestedTime.toISOString() : null]
      );
      entry = rows[0];
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: staff.display_name + ' is already clocked in.' });
      }
      throw e;
    }

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
  try {
    const staff = await findStaff(req.body.name);
    if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
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
      `UPDATE time_entries SET clock_out=$1, status='closed' WHERE id=$2 AND status='open' RETURNING *`,
      [clockOut.toISOString(), entry.id]
    );
    if (!rows.length) {
      return res.status(409).json({ error: staff.display_name + ' was already clocked out (possibly by a concurrent request).' });
    }
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

// POST /api/time/correction {name, date, time, field}
// date: 'YYYY-MM-DD', time: 'HH:MM' (24h), field: 'in' | 'out'
router.post('/correction', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  const field = req.body.field === 'out' ? 'out' : 'in';
  const requested = new Date(`${req.body.date}T${req.body.time}:00`);
  if (isNaN(requested.getTime())) return res.status(400).json({ error: 'Invalid date/time.' });
  try {
    let linkedId = null;
    if (field === 'out') {
      const openRes = await pool.query(
        `SELECT * FROM time_entries WHERE staff_id=$1 AND status='open'
         AND clock_in::date = $2::date ORDER BY clock_in DESC LIMIT 1`,
        [staff.id, req.body.date]
      );
      if (openRes.rows.length) linkedId = openRes.rows[0].id;
    }
    const { rows } = await pool.query(
      `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, notes)
       VALUES ($1,$2,'bot','pending_approval',$3,$4) RETURNING *`,
      [staff.id, requested.toISOString(), linkedId, `Clock-${field} correction for ${req.body.date} ${req.body.time}`]
    );
    res.json({ correction: rows[0], staff });
  } catch (e) {
    console.error('correction error:', e.message);
    res.status(500).json({ error: 'Could not submit correction.' });
  }
});

// POST /api/time/approve {name, date}
router.post('/approve', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  try {
    const pendingRes = await pool.query(
      `SELECT * FROM time_entries WHERE staff_id=$1 AND status='pending_approval'
       AND requested_time::date = $2::date ORDER BY created_at DESC LIMIT 1`,
      [staff.id, req.body.date]
    );
    if (!pendingRes.rows.length) {
      return res.status(404).json({ error: 'No pending correction for ' + staff.display_name + ' on ' + req.body.date + '.' });
    }
    const pending = pendingRes.rows[0];
    if (pending.linked_entry_id) {
      const linked = await pool.query('SELECT * FROM time_entries WHERE id=$1', [pending.linked_entry_id]);
      const isOutCorrection = linked.rows[0] && linked.rows[0].clock_out === null;
      const col = isOutCorrection ? 'clock_out' : 'clock_in';
      await pool.query(
        `UPDATE time_entries SET ${col}=$1, status='closed' WHERE id=$2`,
        [pending.requested_time, pending.linked_entry_id]
      );
    } else {
      // Standalone missed-punch correction with no existing entry — the
      // correction row itself becomes the record; needs both a clock_in
      // and clock_out to count toward hours, so mark it approved but note
      // it may need a matching punch to compute hours.
      await pool.query(`UPDATE time_entries SET clock_in=$1 WHERE id=$2`, [pending.requested_time, pending.id]);
    }
    await pool.query(`UPDATE time_entries SET status='approved' WHERE id=$1`, [pending.id]);
    res.json({ ok: true, approved: pending });
  } catch (e) {
    console.error('approve error:', e.message);
    res.status(500).json({ error: 'Could not approve correction.' });
  }
});

module.exports = router;
