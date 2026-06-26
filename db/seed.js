require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool   = require('./pool');

async function seed() {
  const users = [
    { name: 'Owner',         role: 'owner', pin: '111111' },
    { name: 'Franklin',      role: 'prep',  pin: '222222' },
    { name: 'Mama Franklin', role: 'prep',  pin: '333333' },
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.pin, 10);
    await pool.query(
      `INSERT INTO users (name, role, pin_hash) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [u.name, u.role, hash]
    );
    console.log(`Seeded: ${u.name} (PIN: ${u.pin})`);
  }
  process.exit(0);
}
seed().catch(e => { console.error(e); process.exit(1); });
