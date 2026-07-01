require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const session  = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path     = require('path');
const pool     = require('./db/pool');
const webPush  = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@preptracker.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function notify(userIds, title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const { rows } = await pool.query(
      'SELECT push_subscription FROM users WHERE id = ANY($1) AND push_subscription IS NOT NULL',
      [userIds]
    );
    await Promise.all(rows.map(r =>
      webPush.sendNotification(r.push_subscription, JSON.stringify({ title, body }))
        .catch(e => console.error('push send error:', e.message))
    ));
  } catch (e) { console.error('notify error:', e.message); }
}

const app    = express();
const PORT   = process.env.PORT || 3000;

app.set('notify', notify);
const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'preptracker-dev-secret')) {
  console.error('FATAL: SESSION_SECRET not set in production.');
  process.exit(1);
}

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:        ["'self'", 'data:'],
      connectSrc:    ["'self'"],
      frameSrc:      ["'none'"],
      objectSrc:     ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'preptracker-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: isProd, sameSite: 'lax' },
}));

const pinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many attempts. Wait 15 minutes.' }, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth/login', pinLimiter);
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/dropoffs',  require('./routes/dropoffs'));
app.use('/api/proteins',  require('./routes/proteins'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/push',      require('./routes/push'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/stock',     require('./routes/stock'));

app.get('/api/vapid-key', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || '' }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`PrepTracker running on port ${PORT}`));
