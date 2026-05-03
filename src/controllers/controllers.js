// src/controllers/controllers.js
const bcrypt = require('bcryptjs');
const { User, Attendance, WorkLog, Salary, Company, Buyer, Order, AuditLog, Notification, Holiday } = require('../models');
const path = require('path');
const fs   = require('fs');

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
    const files = (req.files||[]).map(f=>({
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
      url: `/uploads/worklogs/${f.filename}`,
    }));
    const log = await WorkLog.create({
      ...req.body,
      user: req.user.id,
      date: req.body.date || today,
      files,
    });
    res.status(201).json({ success:true, data: log });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const updateWorkLog = async (req, res) => {
  try {
    const log = await WorkLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success:false, message:'Not found' });
    if (log.user.toString() !== req.user.id && !['admin','super_admin'].includes(req.user.role))
      return res.status(403).json({ success:false, message:'Forbidden' });
    Object.assign(log, req.body);
    await log.save();
    res.json({ success:true, data: log });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const deleteWorkLog = async (req, res) => {
  try {
    const log = await WorkLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success:false, message:'Not found' });
    // Delete files
    (log.files||[]).forEach(f=>{
      const fp = path.join(__dirname,'../../uploads/worklogs',f.filename);
      if(fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    await log.deleteOne();
    res.json({ success:true });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const downloadWorkLogFile = async (req, res) => {
  try {
    const fp = path.join(__dirname,'../../uploads/worklogs',req.params.filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ success:false, message:'File not found' });
    res.download(fp);
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

// ── HOLIDAYS ──────────────────────────────────────────────────
const getHolidays = async (req, res) => {
  try {
    const { month } = req.query;
    const q = month ? { date: { $regex: `^${month}` } } : {};
    const data = await Holiday.find(q).sort({ date: 1 });
    res.json({ success:true, data });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const createHoliday = async (req, res) => {
  try {
    const { date, name, type } = req.body;
    const existing = await Holiday.findOne({ date });
    if (existing) {
      existing.name = name; existing.type = type;
      await existing.save();
      return res.json({ success:true, data: existing });
    }
    const h = await Holiday.create({ date, name, type: type || 'holiday' });
    res.status(201).json({ success:true, data: h });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

const deleteHoliday = async (req, res) => {
  try {
    await Holiday.findByIdAndDelete(req.params.id);
    res.json({ success:true });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// ── MONTHLY ATTENDANCE ────────────────────────────────────────
const getMonthlyAttendance = async (req, res) => {
  try {
    const { month, userId } = req.query;
    const targetMonth = month || new Date().toISOString().slice(0,7);
    const [year, m] = targetMonth.split('-');
    const start = `${year}-${m}-01`;
    const end = `${year}-${m}-31`;

    const targetUser = userId || req.user.id;
    const isAdmin = ['admin','super_admin'].includes(req.user.role);

    let users = [];
    if (isAdmin && !userId) {
      users = await User.find({ isActive: true }).select('name email jobTitle');
    } else {
      const u = await User.findById(targetUser).select('name email jobTitle');
      users = [u];
    }

    const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
    const holidayDates = new Set(holidays.map(h => h.date));

    const result = await Promise.all(users.map(async (u) => {
      const records = await Attendance.find({
        user: u._id,
        date: { $gte: start, $lte: end }
      }).sort({ date: 1 });

      const recordMap = {};
      records.forEach(r => { recordMap[r.date] = r; });

      // Build daily data
      const daysInMonth = new Date(parseInt(year), parseInt(m), 0).getDate();
      const days = [];
      let presentCount = 0, absentCount = 0, lateCount = 0, holidayCount = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${m}-${String(d).padStart(2,'0')}`;
        const dayOfWeek = new Date(dateStr).getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = holidayDates.has(dateStr);
        const record = recordMap[dateStr];
        const isFuture = dateStr > new Date().toISOString().split('T')[0];

        let status = 'absent';
        if (isHoliday) { status = 'holiday'; holidayCount++; }
        else if (isWeekend) { status = 'weekend'; }
        else if (isFuture) { status = 'future'; }
        else if (record) {
          status = record.status;
          if (status === 'present') presentCount++;
          else if (status === 'late') { lateCount++; presentCount++; }
          else if (status === 'absent') absentCount++;
        } else if (!isFuture && !isWeekend && !isHoliday) {
          absentCount++;
        }

        days.push({
          date: dateStr,
          day: d,
          dayName: new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short' }),
          status,
          checkIn: record?.checkIn,
          checkOut: record?.checkOut,
          totalHours: record?.totalHours,
          note: record?.note,
          isWeekend,
          isHoliday,
        });
      }

      return {
        user: { _id: u._id, name: u.name, email: u.email, jobTitle: u.jobTitle },
        days,
        summary: { present: presentCount, absent: absentCount, late: lateCount, holiday: holidayCount, total: daysInMonth }
      };
    }));

    res.json({ success:true, data: result, holidays });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
}; 

module.exports = {
  getUsers, getUser, updateUser, deleteUser,
  getAttendance, checkOut, getAttendanceSummary,
  getMonthlyAttendance,
  getHolidays, createHoliday, deleteHoliday,
  getWorkLogs, createWorkLog, updateWorkLog, deleteWorkLog, downloadWorkLogFile,
  getSalaries, createSalary, updateSalary,
  getCompany, updateCompany,
  getBuyers, createBuyer, updateBuyer, deleteBuyer,
  getOrders, createOrder, updateOrder,
  getAuditLogs,
  getNotifications, markNotificationsRead,
  getDashboard, getServerTime,
};

const { Department, Shift, Task, Project, Timesheet, Payroll, Expense, Announcement, Leave, Organization } = require('../models');

exports.getDepartments = async (req, res) => {
  try {
    const departments = await Department.find({}).populate('head','name jobTitle').sort({ name: 1 });
    const users = await User.find({ isActive: true }).select('department');
    const result = departments.map(d => ({ ...d.toObject(), employeeCount: users.filter(u => u.department === d.name).length }));
    res.json({ departments: result });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createDepartment = async (req, res) => {
  try { const d = await Department.create(req.body); res.status(201).json({ department: d }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateDepartment = async (req, res) => {
  try { const d = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json({ department: d }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteDepartment = async (req, res) => {
  try { await Department.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getShifts = async (req, res) => {
  try { const shifts = await Shift.find({}).populate('assignedTo','name department'); res.json({ shifts }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createShift = async (req, res) => {
  try { const s = await Shift.create(req.body); res.status(201).json({ shift: s }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateShift = async (req, res) => {
  try { const s = await Shift.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json({ shift: s }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteShift = async (req, res) => {
  try { await Shift.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getTasks = async (req, res) => {
  try {
    const isAdmin = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdmin ? {} : { assignedTo: req.user.id };
    const tasks = await Task.find(filter).populate('assignedTo','name department').populate('assignedBy','name').sort({ createdAt: -1 });
    res.json({ tasks });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createTask = async (req, res) => {
  try {
    const task = await Task.create({ ...req.body, assignedBy: req.user.id });
    await task.populate('assignedTo','name');
    res.status(201).json({ task });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateTask = async (req, res) => {
  try { const t = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('assignedTo','name'); res.json({ task: t }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteTask = async (req, res) => {
  try { await Task.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getProjects = async (req, res) => {
  try {
    const isAdmin = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdmin ? {} : { members: req.user.id };
    const projects = await Project.find(filter).populate('members','name jobTitle').populate('manager','name').sort({ createdAt: -1 });
    res.json({ projects });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createProject = async (req, res) => {
  try { const p = await Project.create(req.body); res.status(201).json({ project: p }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateProject = async (req, res) => {
  try { const p = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json({ project: p }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteProject = async (req, res) => {
  try { await Project.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getTimesheets = async (req, res) => {
  try {
    const isAdmin = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdmin ? {} : { user: req.user.id };
    const sheets = await Timesheet.find(filter).populate('user','name department').sort({ createdAt: -1 });
    res.json({ timesheets: sheets });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createTimesheet = async (req, res) => {
  try {
    const entries = req.body.entries || [];
    const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const sheet = await Timesheet.create({ ...req.body, user: req.user.id, totalHours });
    res.status(201).json({ timesheet: sheet });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateTimesheet = async (req, res) => {
  try {
    if (req.body.entries) req.body.totalHours = req.body.entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    if (req.body.status === 'approved') req.body.approvedBy = req.user.id;
    const sheet = await Timesheet.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ timesheet: sheet });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteTimesheet = async (req, res) => {
  try { await Timesheet.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getPayroll = async (req, res) => {
  try {
    const filter = req.query.month ? { month: req.query.month } : {};
    const payroll = await Payroll.find(filter).populate('user','name department jobTitle').sort({ createdAt: -1 });
    res.json({ payroll });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createPayroll = async (req, res) => {
  try {
    const net = (Number(req.body.basicSalary) + Number(req.body.allowances||0)) - (Number(req.body.deductions||0) + Number(req.body.tax||0));
    const rec = await Payroll.create({ ...req.body, netSalary: net, generatedBy: req.user.id });
    res.status(201).json({ payroll: rec });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.generatePayroll = async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return res.status(400).json({ message: 'Month required' });
    const users = await User.find({ isActive: true });
    const created = [];
    for (const u of users) {
      const existing = await Payroll.findOne({ user: u._id, month });
      if (existing) continue;
      const rec = await Payroll.create({ user: u._id, month, basicSalary: u.salary||0, allowances: 0, deductions: 0, tax: 0, netSalary: u.salary||0, status: 'draft', generatedBy: req.user.id });
      created.push(rec);
    }
    res.json({ message: `Generated for ${created.length} employees`, payroll: created });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updatePayroll = async (req, res) => {
  try {
    if (req.body.status === 'paid') req.body.paidOn = new Date();
    const rec = await Payroll.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('user','name');
    res.json({ payroll: rec });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deletePayroll = async (req, res) => {
  try { await Payroll.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getExpenses = async (req, res) => {
  try {
    const isAdmin = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdmin ? {} : { user: req.user.id };
    const expenses = await Expense.find(filter).populate('user','name department').sort({ createdAt: -1 });
    res.json({ expenses });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createExpense = async (req, res) => {
  try { const e = await Expense.create({ ...req.body, user: req.user.id }); res.status(201).json({ expense: e }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateExpense = async (req, res) => {
  try {
    if (req.body.status === 'approved') { req.body.approvedBy = req.user.id; req.body.approvedOn = new Date(); }
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ expense });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteExpense = async (req, res) => {
  try { await Expense.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find({ isActive: true, $or: [{ targetRole: 'all' }, { targetRole: req.user.role }] }).populate('postedBy','name jobTitle').sort({ createdAt: -1 });
    res.json({ announcements });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createAnnouncement = async (req, res) => {
  try { const a = await Announcement.create({ ...req.body, postedBy: req.user.id }); res.status(201).json({ announcement: a }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateAnnouncement = async (req, res) => {
  try { const a = await Announcement.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json({ announcement: a }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteAnnouncement = async (req, res) => {
  try { await Announcement.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getLeaves = async (req, res) => {
  try {
    const isAdmin = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdmin ? {} : { user: req.user.id };
    const leaves = await Leave.find(filter).populate('user','name department jobTitle').populate('reviewedBy','name').sort({ createdAt: -1 });
    res.json({ leaves });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.createLeave = async (req, res) => {
  try {
    const from = new Date(req.body.from);
    const to = new Date(req.body.to);
    const days = Math.ceil((to - from) / (1000*60*60*24)) + 1;
    const leave = await Leave.create({ ...req.body, user: req.user.id, days });
    res.status(201).json({ leave });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateLeave = async (req, res) => {
  try {
    if (['approved','rejected'].includes(req.body.status)) { req.body.reviewedBy = req.user.id; req.body.reviewedOn = new Date(); }
    const leave = await Leave.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('user','name');
    res.json({ leave });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.deleteLeave = async (req, res) => {
  try { await Leave.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getOrganization = async (req, res) => {
  try {
    let org = await Organization.findOne({});
    if (!org) org = await Organization.create({ companyName: 'Nexus Enterprises Exporters Private Limited' });
    res.json({ organization: org });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateOrganization = async (req, res) => {
  try {
    let org = await Organization.findOne({});
    if (!org) org = await Organization.create({ companyName: 'Nexus Enterprises' });
    Object.assign(org, req.body);
    await org.save();
    res.json({ organization: org });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getRoles = async (req, res) => {
  try {
    const users = await User.find({}).select('name email role department isActive jobTitle').sort({ role: 1 });
    const roleSummary = { super_admin: users.filter(u => u.role==='super_admin').length, admin: users.filter(u => u.role==='admin').length, employee: users.filter(u => u.role==='employee').length };
    res.json({ users, roleSummary });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.updateUserRole = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { role: req.body.role }, { new: true }).select('-password');
    res.json({ user });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getReportsOverview = async (req, res) => {
  try {
    const [totalEmployees, totalOrders, pendingLeaves, totalTasks, completedTasks] = await Promise.all([
      User.countDocuments({}), Order.countDocuments({}),
      Leave.countDocuments({ status: 'pending' }),
      Task.countDocuments({}), Task.countDocuments({ status: 'completed' }),
    ]);
    const payrollAgg = await Payroll.aggregate([{ $group: { _id: null, total: { $sum: '$netSalary' } } }]);
    res.json({ totalEmployees, totalOrders, pendingLeaves, totalTasks, completedTasks, taskCompletionRate: totalTasks ? Math.round(completedTasks/totalTasks*100) : 0, totalPayroll: payrollAgg[0]?.total || 0 });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.getAttendanceReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth()+1;
    const y = year  || new Date().getFullYear();
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const end   = `${y}-${String(m).padStart(2,'0')}-31`;
    const records = await Attendance.find({ date: { $gte: start, $lte: end } }).populate('user','name department');
    const summary = { present: records.filter(r=>r.status==='present').length, late: records.filter(r=>r.status==='late').length, absent: records.filter(r=>r.status==='absent').length };
    res.json({ records, summary });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.getPayrollReport = async (req, res) => {
  try {
    const filter = req.query.month ? { month: req.query.month } : {};
    const records = await Payroll.find(filter).populate('user','name department');
    const total = records.reduce((s,r) => s+r.netSalary, 0);
    res.json({ records, totalPayroll: total });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
exports.getTasksReport = async (req, res) => {
  try {
    const tasks = await Task.find({}).populate('assignedTo','name department');
    const summary = { total: tasks.length, pending: tasks.filter(t=>t.status==='pending').length, inProgress: tasks.filter(t=>t.status==='in_progress').length, completed: tasks.filter(t=>t.status==='completed').length };
    res.json({ tasks, summary });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
