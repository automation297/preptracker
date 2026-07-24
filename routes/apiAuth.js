const crypto = require('crypto');

// Reusable check (no response side-effects) so other routes can accept an API key
// as an alternative to session auth, e.g. requireOwnerOrApiKey in routes/purchases.js.
function hasValidApiKey(req) {
  const configured = process.env.PREPTRACKER_API_KEY || '';
  if (!configured) return false;
  const provided = req.get('x-preptracker-api-key') || '';
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(configured);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

function requireApiKey(req, res, next) {
  if (!process.env.PREPTRACKER_API_KEY) {
    return res.status(500).json({ error: 'PREPTRACKER_API_KEY not configured on this server.' });
  }
  if (!hasValidApiKey(req)) return res.status(401).json({ error: 'forbidden' });
  next();
}

module.exports = { requireApiKey, hasValidApiKey };
