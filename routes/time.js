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
        `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, correction_field, notes)
         VALUES ($1,$2,$3,'pending_approval',$4,'in','Clock-in time correction request')`,
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
        `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, correction_field, notes)
         VALUES ($1,$2,$3,'pending_approval',$4,'out','Clock-out time correction request')`,
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
      // Link to that day's entry whether it's still open (forgot to clock out) or
      // already closed (e.g. auto-clocked-out by shift close and the real departure
      // time needs fixing) — status IN (...) instead of ='open' only, so a correction
      // after auto-clockout updates the real entry instead of creating an orphan row.
      const entryRes = await pool.query(
        `SELECT * FROM time_entries WHERE staff_id=$1 AND status IN ('open','closed','approved')
         AND clock_in::date = $2::date ORDER BY clock_in DESC LIMIT 1`,
        [staff.id, req.body.date]
      );
      if (entryRes.rows.length) linkedId = entryRes.rows[0].id;
    }
    const { rows } = await pool.query(
      `INSERT INTO time_entries (staff_id, requested_time, source, status, linked_entry_id, correction_field, notes)
       VALUES ($1,$2,'bot','pending_approval',$3,$4,$5) RETURNING *`,
      [staff.id, requested.toISOString(), linkedId, field, `Clock-${field} correction for ${req.body.date} ${req.body.time}`]
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
      const col = pending.correction_field === 'out' ? 'clock_out' : 'clock_in';
      const updateRes = await pool.query(
        `UPDATE time_entries SET ${col}=$1, status='closed' WHERE id=$2 RETURNING id`,
        [pending.requested_time, pending.linked_entry_id]
      );
      if (!updateRes.rows.length) {
        return res.status(409).json({ error: 'The original entry for this correction no longer exists.' });
      }
    } else {
      // Standalone missed-punch correction with no existing entry — the
      // correction row itself becomes the record; needs both a clock_in
      // and clock_out to count toward hours, so mark it approved but note
      // it may need a matching punch to compute hours.
      const col = pending.correction_field === 'out' ? 'clock_out' : 'clock_in';
      await pool.query(`UPDATE time_entries SET ${col}=$1 WHERE id=$2`, [pending.requested_time, pending.id]);
    }
    await pool.query(`UPDATE time_entries SET status='approved' WHERE id=$1`, [pending.id]);
    res.json({ ok: true, approved: pending });
  } catch (e) {
    console.error('approve error:', e.message);
    res.status(500).json({ error: 'Could not approve correction.' });
  }
});

// Monday-Sunday week containing `ref` (defaults to now), in UTC (simple, documented
// limitation: week boundaries are computed in UTC, not Aruba local time — acceptable
// since punches themselves are timestamped correctly and this only affects which
// week a punch made in the first/last few hours of a boundary day is bucketed into).
function weekBounds(ref = new Date()) {
  const day = ref.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - diffToMonday, 0, 0, 0));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6, 23, 59, 59, 999));
  return { monday, sunday };
}

async function hoursForStaff(staffId, monday, sunday, { includeOpen = false } = {}) {
  const statuses = includeOpen ? "'closed','approved','open'" : "'closed','approved'";
  const { rows } = await pool.query(
    `SELECT * FROM time_entries
     WHERE staff_id=$1 AND status IN (${statuses})
     AND clock_in >= $2 AND clock_in <= $3
     ORDER BY clock_in`,
    [staffId, monday.toISOString(), sunday.toISOString()]
  );
  const now = new Date();
  const totalHours = rows.reduce((sum, r) => {
    // An 'open' entry has no clock_out yet — count it up to right now instead
    // of skipping it, so "hours so far" reflects a still-running punch live.
    const clockOutTime = r.clock_out ? new Date(r.clock_out) : (includeOpen && r.status === 'open' ? now : null);
    if (!clockOutTime) return sum;
    return sum + (clockOutTime - new Date(r.clock_in)) / 3600000;
  }, 0);
  return { entries: rows, totalHours: +totalHours.toFixed(2) };
}

// Aruba has no DST — a fixed -04:00 offset day boundary, same convention the
// bot uses for typed-time punches.
function arubaTodayBounds() {
  const todayAruba = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Aruba' });
  return { start: new Date(`${todayAruba}T00:00:00-04:00`), end: new Date(`${todayAruba}T23:59:59-04:00`) };
}

// GET /api/time/hours/:name — this week's entries + total (self-view).
// Optional ?days=N widens the window to the last N days instead of the
// current Mon-Sun week (used by the cashier app's month/history view).
// Optional ?ref=<date> shifts which Mon-Sun week is shown (e.g. last week).
// Optional ?today=1 returns TODAY only and includes a still-open punch,
// counted live up to now — used for "hours so far" mid-shift.
router.get('/hours/:name', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.params.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.params.name });
  if (req.query.today !== undefined) {
    const { start, end } = arubaTodayBounds();
    try {
      const result = await hoursForStaff(staff.id, start, end, { includeOpen: true });
      return res.json({ staff, today: start.toISOString().slice(0, 10), ...result });
    } catch (e) {
      return res.status(500).json({ error: 'Could not load hours.' });
    }
  }
  let start, end;
  if (req.query.days !== undefined) {
    const days = parseInt(req.query.days, 10);
    if (isNaN(days) || days <= 0) return res.status(400).json({ error: 'Invalid days.' });
    end = new Date();
    start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  } else {
    const refDate = req.query.ref ? new Date(req.query.ref) : new Date();
    if (isNaN(refDate.getTime())) return res.status(400).json({ error: 'Invalid ref date.' });
    ({ monday: start, sunday: end } = weekBounds(refDate));
  }
  try {
    const result = await hoursForStaff(staff.id, start, end);
    res.json({ staff, weekStart: start.toISOString().slice(0, 10), ...result });
  } catch (e) {
    res.status(500).json({ error: 'Could not load hours.' });
  }
});

// GET /api/time/timesheet — every active staff member's week (owner view)
router.get('/timesheet', requireApiKey, async (req, res) => {
  const refDate = req.query.ref ? new Date(req.query.ref) : new Date();
  if (isNaN(refDate.getTime())) return res.status(400).json({ error: 'Invalid ref date.' });
  const { monday, sunday } = weekBounds(refDate);
  try {
    const staffRes = await pool.query('SELECT * FROM staff WHERE active=true ORDER BY display_name');
    const rows = [];
    for (const s of staffRes.rows) {
      const { totalHours } = await hoursForStaff(s.id, monday, sunday);
      rows.push({ staff: s, hours: totalHours, pay: +(totalHours * s.hourly_rate).toFixed(2) });
    }
    res.json({ weekStart: monday.toISOString().slice(0, 10), weekEnd: sunday.toISOString().slice(0, 10), rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load timesheet.' });
  }
});

// POST /api/time/paid {name} — mark the current week paid
router.post('/paid', requireApiKey, async (req, res) => {
  const staff = await findStaff(req.body.name);
  if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
  const refDate = req.body.ref ? new Date(req.body.ref) : new Date();
  if (isNaN(refDate.getTime())) return res.status(400).json({ error: 'Invalid ref date.' });
  const { monday } = weekBounds(refDate);
  try {
    await pool.query(
      `INSERT INTO staff_payouts (staff_id, week_start) VALUES ($1,$2)
       ON CONFLICT (staff_id, week_start) DO UPDATE SET paid_at=NOW()`,
      [staff.id, monday.toISOString().slice(0, 10)]
    );
    res.json({ ok: true, staff, weekStart: monday.toISOString().slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: 'Could not mark as paid.' });
  }
});

// POST /api/time/auto-clockout-all — force-close every open entry
router.post('/auto-clockout-all', requireApiKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE time_entries e SET clock_out=NOW(), status='closed'
       WHERE status='open'
       RETURNING e.*, (SELECT display_name FROM staff WHERE staff.id = e.staff_id) AS display_name`
    );
    res.json({ closed: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not auto-clockout.' });
  }
});

module.exports = router;
