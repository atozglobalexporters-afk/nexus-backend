// src/controllers/controllers.js
const bcrypt = require('bcryptjs');
const { User, Attendance, WorkLog, Salary, Company, Buyer, Order, AuditLog, Notification } = require('../models');

// ── USERS ─────────────────────────────────────────────────────
const getUsers = async (req, res) => {
  try {
    const { search, role, page = 1, limit = 50 } = req.query;
    const q = { isActive: true };
    if (role) q.role = role;
    if (search) q.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }];
    const users = await User.find(q).select('-password').sort({ createdAt: -1 }).skip((page-1)*limit).limit(parseInt(limit));
    const total = await User.countDocuments(q);
    res.json({ success:true, data: users, total, page: parseInt(page), pages: Math.ceil(total/limit) });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success:false, message:'User not found' });
    res.json({ success:true, data: user });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const updateUser = async (req, res) => {
  try {
    const { password, role, ...updates } = req.body;
    const isSelf = req.user.id === req.params.id;
    if (!isSelf && !['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success:false, message:'Forbidden' });
    if (role && !['admin','super_admin'].includes(req.user.role)) delete updates.role;
    if (password) updates.password = await bcrypt.hash(password, 12);
    if (role && ['admin','super_admin'].includes(req.user.role)) updates.role = role;
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new:true }).select('-password');
    await AuditLog.create({ user: req.user.id, action: 'UPDATE_USER', target: req.params.id, details: updates });
    res.json({ success:true, data: user });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const deleteUser = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    await AuditLog.create({ user: req.user.id, action: 'DELETE_USER', target: req.params.id });
    res.json({ success:true, message:'User deactivated' });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── ATTENDANCE ────────────────────────────────────────────────
const getAttendance = async (req, res) => {
  try {
    const { date, userId, startDate, endDate, page = 1, limit = 100 } = req.query;
    const q = {};
    if (date) q.date = date;
    if (startDate && endDate) q.date = { $gte: startDate, $lte: endDate };
    if (userId) q.user = userId;
    else if (req.user.role === 'employee') q.user = req.user.id;
    const data = await Attendance.find(q).populate('user','name email jobTitle').sort({ date:-1, createdAt:-1 }).skip((page-1)*limit).limit(parseInt(limit));
    const total = await Attendance.countDocuments(q);
    res.json({ success:true, data, total });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const checkOut = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const att   = await Attendance.findOne({ user: req.user.id, date: today });
    if (!att) return res.status(404).json({ success:false, message:'No check-in found for today' });
    if (att.checkOut) return res.status(400).json({ success:false, message:'Already checked out' });
    att.checkOut   = new Date();
    att.totalHours = parseFloat(((att.checkOut - att.checkIn) / 3600000).toFixed(2));
    if (att.totalHours < 4) att.status = 'half-day';
    await att.save();
    res.json({ success:true, data: att });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const getAttendanceSummary = async (req, res) => {
  try {
    const { month } = req.query;
    const [year, m] = (month || new Date().toISOString().slice(0,7)).split('-');
    const start = `${year}-${m}-01`;
    const end   = `${year}-${m}-31`;
    const userId = req.user.role === 'employee' ? req.user.id : req.query.userId;
    const q = { date: { $gte: start, $lte: end } };
    if (userId) q.user = userId;
    const records = await Attendance.find(q);
    const summary = { present:0, late:0, absent:0, halfDay:0, totalHours:0 };
    records.forEach(r => {
      if (r.status==='present') summary.present++;
      else if (r.status==='late') { summary.late++; summary.present++; }
      else if (r.status==='absent') summary.absent++;
      else if (r.status==='half-day') summary.halfDay++;
      summary.totalHours += r.totalHours||0;
    });
    res.json({ success:true, data: summary });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── WORK LOGS ─────────────────────────────────────────────────
const getWorkLogs = async (req, res) => {
  try {
    const q = req.user.role === 'employee' ? { user: req.user.id } : {};
    if (req.query.userId) q.user = req.query.userId;
    if (req.query.date)   q.date = req.query.date;
    const data = await WorkLog.find(q).populate('user','name').sort({ date:-1 }).limit(100);
    res.json({ success:true, data });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const createWorkLog = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const log   = await WorkLog.create({ ...req.body, user: req.user.id, date: req.body.date || today });
    res.status(201).json({ success:true, data: log });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── SALARY ────────────────────────────────────────────────────
const getSalaries = async (req, res) => {
  try {
    const q = req.user.role === 'employee' ? { user: req.user.id } : {};
    if (req.query.userId) q.user = req.query.userId;
    if (req.query.month)  q.month = req.query.month;
    const data = await Salary.find(q).populate('user','name email jobTitle').sort({ month:-1 });
    res.json({ success:true, data });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const createSalary = async (req, res) => {
  try {
    const sal = await Salary.create(req.body);
    await AuditLog.create({ user: req.user.id, action: 'CREATE_SALARY', target: req.body.user, details: req.body });
    await Notification.create({ user: req.body.user, title: 'Salary Update', message: `Your salary for ${req.body.month} has been recorded: ₹${req.body.amount} (${req.body.status})`, type: req.body.status==='paid'?'success':'warning' });
    res.status(201).json({ success:true, data: sal });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const updateSalary = async (req, res) => {
  try {
    const sal = await Salary.findByIdAndUpdate(req.params.id, req.body, { new:true });
    await AuditLog.create({ user: req.user.id, action: 'UPDATE_SALARY', target: req.params.id, details: req.body });
    if (req.body.status) await Notification.create({ user: sal.user, title: 'Salary Status Updated', message: `Your salary status is now: ${req.body.status}`, type: req.body.status==='paid'?'success':'warning' });
    res.json({ success:true, data: sal });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── COMPANY ───────────────────────────────────────────────────
const getCompany = async (req, res) => {
  try {
    const company = await Company.findOne() || await Company.create({ name: 'My Company' });
    res.json({ success:true, data: company });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const updateCompany = async (req, res) => {
  try {
    const company = await Company.findOneAndUpdate({}, req.body, { new:true, upsert:true });
    await AuditLog.create({ user: req.user.id, action: 'UPDATE_COMPANY', details: req.body });
    res.json({ success:true, data: company });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── BUYERS ────────────────────────────────────────────────────
const getBuyers = async (req, res) => {
  try {
    const q = { isActive: true };
    if (req.query.search) q.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { company: { $regex: req.query.search, $options: 'i' } }];
    const data = await Buyer.find(q).sort({ createdAt: -1 });
    res.json({ success:true, data });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};
const createBuyer = async (req, res) => {
  try { const b = await Buyer.create(req.body); res.status(201).json({ success:true, data: b }); }
  catch (err) { res.status(500).json({ success:false, message: err.message }); }
};
const updateBuyer = async (req, res) => {
  try { const b = await Buyer.findByIdAndUpdate(req.params.id, req.body, { new:true }); res.json({ success:true, data: b }); }
  catch (err) { res.status(500).json({ success:false, message: err.message }); }
};
const deleteBuyer = async (req, res) => {
  try { await Buyer.findByIdAndUpdate(req.params.id, { isActive: false }); res.json({ success:true }); }
  catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── ORDERS ────────────────────────────────────────────────────
const getOrders = async (req, res) => {
  try {
    const q = {};
    if (req.query.buyerId) q.buyer = req.query.buyerId;
    if (req.query.status)  q.status = req.query.status;
    const data = await Order.find(q).populate('buyer','name company country').sort({ createdAt: -1 }).limit(200);
    const total = await Order.countDocuments(q);
    const revenue = await Order.aggregate([{ $match: q }, { $group: { _id: null, total: { $sum: '$totalValue' } } }]);
    res.json({ success:true, data, total, revenue: revenue[0]?.total || 0 });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};
const createOrder = async (req, res) => {
  try {
    const count = await Order.countDocuments();
    const num   = `ORD-${String(count+1).padStart(4,'0')}`;
    const order = await Order.create({ ...req.body, orderNumber: num });
    await AuditLog.create({ user: req.user.id, action: 'CREATE_ORDER', target: order._id.toString(), details: req.body });
    res.status(201).json({ success:true, data: order });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};
const updateOrder = async (req, res) => {
  try { const o = await Order.findByIdAndUpdate(req.params.id, req.body, { new:true }); res.json({ success:true, data: o }); }
  catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── AUDIT LOGS ────────────────────────────────────────────────
const getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find().populate('user','name email').sort({ createdAt: -1 }).limit(200);
    res.json({ success:true, data: logs });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── NOTIFICATIONS ─────────────────────────────────────────────
const getNotifications = async (req, res) => {
  try {
    const notifs = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50);
    const unread = await Notification.countDocuments({ user: req.user.id, read: false });
    res.json({ success:true, data: notifs, unread });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};
const markNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id }, { read: true });
    res.json({ success:true });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── DASHBOARD SUMMARY ─────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0,7);
    const [users, presentToday, pendingSalaries, totalOrders, recentLogs, attendance7d] = await Promise.all([
      User.countDocuments({ isActive:true }),
      Attendance.countDocuments({ date:today, status:{ $in:['present','late'] } }),
      Salary.countDocuments({ status:{ $in:['pending','due'] } }),
      Order.countDocuments(),
      WorkLog.find().populate('user','name').sort({ createdAt:-1 }).limit(5),
      Attendance.find({ date:{ $gte: new Date(Date.now()-7*86400000).toISOString().split('T')[0] } }).populate('user','name'),
    ]);
    res.json({ success:true, data: { users, presentToday, pendingSalaries, totalOrders, recentLogs, attendance7d } });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── SERVER TIME ───────────────────────────────────────────────
const getServerTime = (req, res) => res.json({ success:true, time: new Date().toISOString(), timestamp: Date.now() });

module.exports = {
  getUsers, getUser, updateUser, deleteUser,
  getAttendance, checkOut, getAttendanceSummary,
  getWorkLogs, createWorkLog,
  getSalaries, createSalary, updateSalary,
  getCompany, updateCompany,
  getBuyers, createBuyer, updateBuyer, deleteBuyer,
  getOrders, createOrder, updateOrder,
  getAuditLogs,
  getNotifications, markNotificationsRead,
  getDashboard, getServerTime,
};
