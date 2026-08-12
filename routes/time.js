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

// POST /api/time/fix-punch {name, field:'in'|'out', time}
// Directly corrects ONE end of the most recent entry, for the owner's "✏️ Fix time"
// button on a punch notification. Deliberately not the /correction + /approve pair:
// that files a pending_approval row and needs a second command, which is wrong when the
// owner is already looking at the punch and telling us the right time. Applied straight
// away because only admin numbers can reach it.
router.post('/fix-punch', requireApiKey, async (req, res) => {
  try {
    const staff = await findStaff(req.body.name);
    if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });
    const field = req.body.field === 'out' ? 'out' : 'in';
    const t = new Date(req.body.time);
    if (isNaN(t.getTime())) return res.status(400).json({ error: 'Invalid time.' });

    // For an IN fix prefer the entry they are currently inside; otherwise the latest one.
    const { rows } = await pool.query(
      `SELECT * FROM time_entries
        WHERE staff_id=$1 AND clock_in IS NOT NULL AND status IN ('open','closed','approved')
        ORDER BY (status='open') DESC, clock_in DESC LIMIT 1`,
      [staff.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No punch found for ' + staff.display_name + '.' });
    const entry = rows[0];

    if (field === 'out' && !entry.clock_out && entry.status === 'open') {
      return res.status(409).json({ error: staff.display_name + ' is still clocked in — there is no clock-out to fix yet.' });
    }
    const col = field === 'out' ? 'clock_out' : 'clock_in';
    const other = field === 'out' ? entry.clock_in : entry.clock_out;
    if (other) {
      const a = field === 'out' ? new Date(other) : t;
      const b = field === 'out' ? t : new Date(other);
      if (b <= a) return res.status(400).json({ error: 'That would put clock-out before clock-in.' });
      // Absolute backstop. set-shift already refuses >24h; this route did not, so a
      // mis-anchored correction could silently write a THIRTY-HOUR shift straight into
      // payroll (that exact bug existed in the bot's 3am flow). 16h is above any real
      // shift here — the truck runs roughly 6:30PM to 3AM at the outside.
      const hrs = (b - a) / 3600000;
      if (hrs > 16) {
        return res.status(400).json({ error: 'That makes a ' + hrs.toFixed(1) + '-hour shift — check the date/time. Nothing was changed.' });
      }
    }
    const upd = await pool.query(
      `UPDATE time_entries SET ${col}=$1 WHERE id=$2 RETURNING *`, [t.toISOString(), entry.id]
    );
    const e = upd.rows[0];
    const hours = (e.clock_in && e.clock_out) ? +(((new Date(e.clock_out) - new Date(e.clock_in)) / 3600000).toFixed(2)) : null;
    res.json({ entry: e, staff, hours, field });
  } catch (e) {
    console.error('fix-punch error:', e.message);
    res.status(500).json({ error: 'Could not fix that punch.' });
  }
});

// POST /api/time/set-shift {name, clockIn, clockOut, source?}
// Writes a COMPLETE closed shift in one call, for the bot's "Nigel 6:30pm-2:45am" command.
//
// Why this exists rather than reusing clock-in + clock-out: both of those clamp
// requestedTime to a 15-minute window (FIFTEEN_MIN_MS) and, outside it, record the CURRENT
// time and file a pending-approval row instead. That is correct for a live punch but makes
// it impossible to enter last night's shift after the fact, which is exactly what the
// owner types this command for.
//
// Never inserts a duplicate: if an entry already exists for that staff member on that
// calendar day — including one they are still clocked into — it is UPDATED in place.
// Two rows for one night would silently double that person's hours in payroll.
router.post('/set-shift', requireApiKey, async (req, res) => {
  const source = req.body.source === 'app' ? 'app' : 'bot';
  try {
    const staff = await findStaff(req.body.name);
    if (!staff) return res.status(404).json({ error: 'Unknown staff member: ' + req.body.name });

    const clockIn = new Date(req.body.clockIn);
    const clockOut = new Date(req.body.clockOut);
    if (isNaN(clockIn.getTime()) || isNaN(clockOut.getTime())) {
      return res.status(400).json({ error: 'clockIn and clockOut must both be valid timestamps.' });
    }
    if (clockOut <= clockIn) {
      return res.status(400).json({ error: 'Clock-out must be after clock-in.' });
    }
    const hours = (clockOut - clockIn) / 3600000;
    if (hours > 24) return res.status(400).json({ error: 'Shift longer than 24 hours — check the times.' });

    // Match on the SERVICE DAY of the clock-in, in Aruba time. A shift starting 6:30 PM
    // Tuesday and ending 2:45 AM Wednesday belongs to Tuesday.
    const dayKey = clockIn.toLocaleDateString('en-CA', { timeZone: 'America/Aruba' });
    const { rows: existing } = await pool.query(
      `SELECT * FROM time_entries
        WHERE staff_id=$1
          AND clock_in IS NOT NULL
          AND (clock_in AT TIME ZONE 'America/Aruba')::date = $2::date
          AND status IN ('open','closed','approved')
        ORDER BY clock_in ASC LIMIT 1`,
      [staff.id, dayKey]
    );

    let entry, replaced = null;
    if (existing.length) {
      replaced = { clock_in: existing[0].clock_in, clock_out: existing[0].clock_out, status: existing[0].status };
      const { rows } = await pool.query(
        `UPDATE time_entries
            SET clock_in=$1, clock_out=$2, status='closed', source=$3,
                notes=COALESCE(notes,'') || ' [shift set via bot ' || now()::date || ']'
          WHERE id=$4 RETURNING *`,
        [clockIn.toISOString(), clockOut.toISOString(), source, existing[0].id]
      );
      entry = rows[0];
    } else {
      const { rows } = await pool.query(
        `INSERT INTO time_entries (staff_id, clock_in, clock_out, source, status, notes)
         VALUES ($1,$2,$3,$4,'closed','Shift set via bot') RETURNING *`,
        [staff.id, clockIn.toISOString(), clockOut.toISOString(), source]
      );
      entry = rows[0];
    }
    res.json({ entry, staff, hours: +hours.toFixed(2), replaced });
  } catch (e) {
    console.error('set-shift error:', e.message);
    res.status(500).json({ error: 'Could not set shift.' });
  }
});

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

// GET /api/time/labor-cost?month=YYYY-MM — total payroll cost for a calendar month
// (added 2026-08-03, for the bot's combined monthly sales+spend report). Computed
// directly from time_entries/staff for the given calendar month -- NOT built from
// the Mon-Sun weekly timesheet above, since a month rarely aligns to week
// boundaries and summing partial weeks would double-count or miss days at the
// edges. Only counts closed/approved entries -- a still-open punch mid-month isn't
// counted (same as hoursForStaff's default, non-live-counting behavior).
router.get('/labor-cost', requireApiKey, async (req, res) => {
  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.display_name, s.hourly_rate,
              COALESCE(SUM(EXTRACT(EPOCH FROM (e.clock_out - e.clock_in)) / 3600), 0) AS hours
       FROM staff s
       LEFT JOIN time_entries e ON e.staff_id = s.id AND e.status IN ('closed','approved')
         AND e.clock_in >= ($1 || '-01')::date AND e.clock_in < (($1 || '-01')::date + INTERVAL '1 month')
       GROUP BY s.id, s.display_name, s.hourly_rate
       HAVING COALESCE(SUM(EXTRACT(EPOCH FROM (e.clock_out - e.clock_in)) / 3600), 0) > 0
       ORDER BY s.display_name`,
      [month]
    );
    const staffRows = rows.map(r => ({
      name: r.display_name, hours: +Number(r.hours).toFixed(2), rate: Number(r.hourly_rate),
      pay: +(Number(r.hours) * Number(r.hourly_rate)).toFixed(2)
    }));
    const total = +staffRows.reduce((s, r) => s + r.pay, 0).toFixed(2);
    res.json({ month, staff: staffRows, total });
  } catch (e) {
    console.error('labor-cost error:', e.message);
    res.status(500).json({ error: 'Could not compute labor cost.' });
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
