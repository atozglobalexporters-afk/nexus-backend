// server.js
require('dotenv').config();
const http      = require('http');
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const jwt       = require('jsonwebtoken');
const path      = require('path');
const fs        = require('fs');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 5000;

['uploads/chat','uploads/avatars','uploads/documents'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ['https://atoz-ems-frontend-sr59.vercel.app','http://localhost:3000','http://localhost:5173'], credentials: true}));
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined'));
app.use(rateLimit({ windowMs: 15*60*1000, max: 500 }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ems')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB error:', err.message); process.exit(1); });

app.get('/health', (_, res) => res.json({ status:'ok', time: new Date().toISOString() }));
app.use('/api', require('./src/routes'));
app.use('/api/chat', require('./src/routes/chat'));
app.use((req, res) => res.status(404).json({ success:false, message:`${req.method} ${req.url} not found` }));
app.use((err, req, res, next) => res.status(500).json({ success:false, message: err.message }));

const io = new Server(server, {
  cors: { origin: ['https://atoz-ems-frontend-sr59.vercel.app','http://localhost:3000','http://localhost:5173'], credentials: true },
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
    if (['admin','super_admin'].includes(socket.role)) {
      io.emit('notification', { title:'Announcement', message: msg, type:'info', time: new Date().toISOString() });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.userId);
    io.emit('online_users', Array.from(onlineUsers.values()));
  });
});

app.set('io', io);

setInterval(async () => {
  const { Attendance } = require('./src/models');
  const cutoff = new Date(Date.now() - parseInt(process.env.AUTO_LOGOUT_HOURS||'10') * 3600000);
  const stale  = await Attendance.find({ checkOut: null, checkIn: { $lt: cutoff } });
  for (const a of stale) {
    a.checkOut = new Date();
    a.totalHours = parseFloat(((a.checkOut - a.checkIn)/3600000).toFixed(2));
    a.autoClosed = true;
    await a.save();
  }
}, 3600000);

server.listen(PORT, () => console.log(`🚀 EMS Server running on port ${PORT} [${process.env.NODE_ENV||'development'}]`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
