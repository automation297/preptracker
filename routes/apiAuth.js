const crypto = require('crypto');

function requireApiKey(req, res, next) {
  const configured = process.env.PREPTRACKER_API_KEY || '';
  if (!configured) {
    return res.status(500).json({ error: 'PREPTRACKER_API_KEY not configured on this server.' });
  }
  const provided = req.get('x-preptracker-api-key') || '';
  let ok = false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(configured);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { /* ok stays false */ }
  if (!ok) return res.status(401).json({ error: 'forbidden' });
  next();
}

module.exports = { requireApiKey };
