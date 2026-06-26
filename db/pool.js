const { Pool } = require('pg');
// rejectUnauthorized:false is Render's required pattern for their managed PostgreSQL —
// their internal CA cert is not user-accessible. Connection stays on Render's private network.
// If hosting elsewhere, replace with a proper CA bundle.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
module.exports = pool;
