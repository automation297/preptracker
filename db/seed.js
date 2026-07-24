require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool   = require('./pool');

async function seed() {
  const users = [
    { name: 'Owner', role: 'owner', pin: '1234', active: true },
    { name: 'Franklin', role: 'prep', pin: '2222', active: false },
    { name: 'Rocio', role: 'prep', pin: '0000', active: true },
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.pin, 10);
    await pool.query(
      `INSERT INTO users (name, role, pin_hash, active) VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [u.name, u.role, hash, u.active]
    );
    console.log(`Seeded: ${u.name} (PIN: ${u.pin}, active: ${u.active})`);
  }
  process.exit(0);
}
seed().catch(e => { console.error(e); process.exit(1); });
