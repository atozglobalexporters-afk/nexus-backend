// server.js
require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Trust Railway / Vercel proxy headers (fixes express-rate-limit X-Forwarded-For warning)
app.set('trust proxy', 1);

['uploads/chat', 'uploads/avatars', 'uploads/documents'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    'https://atoz-ems-frontend-sr59.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ems')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB error:', err.message); process.exit(1); });

app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api', require('./src/routes'));
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/banking', require('./src/routes/banking'));
app.use((req, res) => res.status(404).json({ success: false, message: `${req.method} ${req.url} not found` }));
app.use((err, req, res, next) => res.status(500).json({ success: false, message: err.message }));

const io = new Server(server, {
  cors: { origin: ['https://atoz-ems-frontend-sr59.vercel.app', 'http://localhost:3000', 'http://localhost:5173'], credentials: true },
  maxHttpBufferSize: 50 * 1024 * 1024
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = d.id; socket.role = d.role; socket.userName = d.name;
    next();
  } catch { next(new Error('Invalid token')); }
});

const onlineUsers = new Map();

io.on('connection', socket => {
  console.log(`🟢 ${socket.userName} connected`);
  onlineUsers.set(socket.userId, { name: socket.userName, role: socket.role, socketId: socket.id, userId: socket.userId });
  io.emit('online_users', Array.from(onlineUsers.values()));

  socket.on('join:conversation', conversationId => socket.join(conversationId));
  socket.on('leave:conversation', conversationId => socket.leave(conversationId));

  socket.on('typing:start', ({ conversationId }) => {
    socket.to(conversationId).emit('typing:start', { userId: socket.userId, userName: socket.userName, conversationId });
  });
  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(conversationId).emit('typing:stop', { userId: socket.userId, conversationId });
  });

  socket.on('broadcast', msg => {
    if (['admin', 'super_admin'].includes(socket.role)) {
      io.emit('notification', { title: 'Announcement', message: msg, type: 'info', time: new Date().toISOString() });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.userId);
    io.emit('online_users', Array.from(onlineUsers.values()));
  });
});

app.set('io', io);

// NOTE: Legacy 10-hour auto-closer removed. The new auto-end cron in src/routes/index.js
// handles session closure properly (uses computeStatus to recompute final status correctly).

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME REPAIR: fix corrupted createdAt/updatedAt fields on User documents.
// Some user docs were saved with date fields as objects { $date: "..." } instead
// of real BSON dates, which makes Mongoose throw "Cast to date failed" on login.
// This runs once on boot, repairs every affected doc directly via the raw driver
// (bypassing Mongoose casting), then logs the result. Safe to leave in — it's a
// no-op once all docs are clean. Remove after confirming login works.
// ─────────────────────────────────────────────────────────────────────────────
async function repairCorruptedUserDates() {
  try {
    const coll = mongoose.connection.db.collection('users');
    const all = await coll.find({}).toArray();
    let fixed = 0;
    for (const u of all) {
      const update = {};
      // If createdAt is an object (not a Date), unwrap or regenerate it
      if (u.createdAt && typeof u.createdAt === 'object' && !(u.createdAt instanceof Date)) {
        const raw = u.createdAt.$date || u.createdAt['$date'];
        const d = raw ? new Date(raw) : new Date();
        update.createdAt = isNaN(d.getTime()) ? new Date() : d;
      }
      if (u.updatedAt && typeof u.updatedAt === 'object' && !(u.updatedAt instanceof Date)) {
        const raw = u.updatedAt.$date || u.updatedAt['$date'];
        const d = raw ? new Date(raw) : new Date();
        update.updatedAt = isNaN(d.getTime()) ? new Date() : d;
      }
      // Also clear any stale lock state left over from failed logins
      if (u.lockUntil && typeof u.lockUntil === 'object' && !(u.lockUntil instanceof Date)) {
        update.lockUntil = null;
      }
      if (Object.keys(update).length > 0) {
        await coll.updateOne({ _id: u._id }, { $set: update });
        fixed++;
      }
    }
    console.log(`🔧 User date repair complete — ${fixed} document(s) fixed, ${all.length} checked.`);

    // ── ONE-TIME ADMIN PASSWORD RESET ──
    // Locked-out admin account recovery. Sets a known password + clears lock state.
    // REMOVE THIS BLOCK once login is confirmed working.
    const RESET_EMAIL = 'syedzaidtoufeeq@gmail.com';
    const RESET_HASH  = '$2b$12$R0bBSNdh6MaVd6GG940cEOO9qxXhNipFuwYNRIQfdc8xo409BOtfq'; // password: 786786786
    const r = await coll.updateOne(
      { email: RESET_EMAIL },
      { $set: { password: RESET_HASH, isActive: true, loginAttempts: 0, lockUntil: null } }
    );
    console.log(`🔑 Admin password reset for ${RESET_EMAIL} — matched ${r.matchedCount}, modified ${r.modifiedCount}.`);
  } catch (e) {
    console.error('⚠️  User date repair failed:', e.message);
  }
}

// Run repair once the DB connection is ready
mongoose.connection.once('open', () => { repairCorruptedUserDates(); });

server.listen(PORT, () => console.log(`🚀 EMS Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
