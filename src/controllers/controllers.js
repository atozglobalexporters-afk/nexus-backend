// src/controllers/controllers.js
'use strict';

const {
  Company, User, Attendance, WorkLog, Salary, Buyer, Order,
  AuditLog, Notification, Holiday,
  Department, Shift, Task, Project, Timesheet,
  Payroll, Expense, Announcement, Leave, Organization, BreakLog,
} = require('../models');

const ok = (res, data, status = 200) => res.status(status).json(data);
const err = (res, msg, status = 500) => res.status(status).json({ message: msg });

const logAudit = async (userId, action, target, details, ip) => {
  try { await AuditLog.create({ user: userId, action, target, details, ip }); } catch { }
};

// ── Server Time ───────────────────────────────────────────────
exports.getServerTime = (req, res) => ok(res, { time: new Date().toISOString() });

// ── Dashboard ─────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [users, todayAtt, pendingSal, orders] = await Promise.all([
      User.countDocuments({ isActive: true }),
      Attendance.find({ date: today }),
      Salary.countDocuments({ status: 'pending' }),
      Order.countDocuments(),
    ]);
    const present = todayAtt.filter(a => ['present', 'late'].includes(a.status)).length;
    ok(res, { totalEmployees: users, presentToday: present, pendingSalaries: pendingSal, totalOrders: orders });
  } catch (e) { err(res, e.message); }
};

// ── Users ─────────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    ok(res, { users });
  } catch (e) { err(res, e.message); }
};

exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return err(res, 'User not found', 404);
    ok(res, { user });
  } catch (e) { err(res, e.message); }
};

exports.updateUser = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const isSelf = req.params.id === req.user.id;
    if (!isAdm && !isSelf) return err(res, 'Forbidden', 403);

    const blockedAlways = ['password', 'role', 'loginAttempts', 'lockUntil', 'resetPasswordToken', 'resetPasswordExpires'];
    const selfAllowed = ['name', 'phone', 'avatar'];
    const adminAllowed = ['name', 'email', 'jobTitle', 'department', 'team', 'phone', 'avatar', 'salary', 'salaryStatus', 'isActive'];
    const allowed = isAdm ? adminAllowed : selfAllowed;

    const update = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (blockedAlways.includes(key)) continue;
      if (allowed.includes(key)) update[key] = value;
    }

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!user) return err(res, 'User not found', 404);
    await logAudit(req.user.id, 'UPDATE_USER', req.params.id, update, req.ip);
    ok(res, { user });
  } catch (e) { err(res, e.message); }
};

exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await logAudit(req.user.id, 'DELETE_USER', req.params.id, {}, req.ip);
    ok(res, { message: 'User deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Attendance ────────────────────────────────────────────────
exports.getAttendance = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const { month, year } = req.query;
    if (month && year) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = `${year}-${String(month).padStart(2, '0')}-31`;
      filter.date = { $gte: start, $lte: end };
    }
    const records = await Attendance.find(filter).populate('user', 'name department jobTitle').sort({ date: -1 }).limit(500);
    ok(res, { attendance: records });
  } catch (e) { err(res, e.message); }
};

exports.checkOut = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rec = await Attendance.findOne({ user: req.user.id, date: today });
    if (!rec) return err(res, 'No check-in found for today', 400);
    if (rec.checkOut) return err(res, 'Already checked out', 400);
    const now = new Date();
    rec.checkOut = now;
    if (!rec.checkIn || isNaN(new Date(rec.checkIn).getTime())) {
      rec.totalHours = 0;
    } else {
      rec.totalHours = parseFloat(
        ((Date.now() - new Date(rec.checkIn).getTime()) / 3600000).toFixed(2)
      );

      if (rec.totalHours < 0 || rec.totalHours > 24) {
        rec.totalHours = 0;
      }
    }
    await rec.save();
    ok(res, { attendance: rec });
  } catch (e) { err(res, e.message); }
};

exports.getAttendanceSummary = async (req, res) => {
  try {
    const userId = req.user.role === 'employee' ? req.user.id : (req.query.userId || req.user.id);
    const records = await Attendance.find({ user: userId });
    const summary = { present: 0, late: 0, absent: 0, halfDay: 0, totalHours: 0 };
    records.forEach(r => {
      const key = r.status === 'half-day' ? 'halfDay' : r.status;
      summary[key] = (summary[key] || 0) + 1;
      summary.totalHours += r.totalHours || 0;
    });
    ok(res, { summary });
  } catch (e) { err(res, e.message); }
};

exports.getMonthlyAttendance = async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = `${y}-${String(m).padStart(2, '0')}-31`;
    const filter = { date: { $gte: start, $lte: end } };
    if (req.user.role === 'employee') filter.user = req.user.id;
    const records = await Attendance.find(filter).populate('user', 'name department');
    ok(res, { attendance: records });
  } catch (e) { err(res, e.message); }
};

// ── Holidays ──────────────────────────────────────────────────
exports.getHolidays = async (req, res) => {
  try {
    const holidays = await Holiday.find({}).sort({ date: 1 });
    ok(res, { holidays });
  } catch (e) { err(res, e.message); }
};

exports.createHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.create(req.body);
    await logAudit(req.user.id, 'CREATE_HOLIDAY', holiday._id, req.body, req.ip);
    ok(res, { holiday }, 201);
  } catch (e) { err(res, e.message); }
};

exports.deleteHoliday = async (req, res) => {
  try {
    await Holiday.findByIdAndDelete(req.params.id);
    await logAudit(req.user.id, 'DELETE_HOLIDAY', req.params.id, {}, req.ip);
    ok(res, { message: 'Holiday deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Work Logs ─────────────────────────────────────────────────
exports.getWorkLogs = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const logs = await WorkLog.find(filter).populate('user', 'name department').sort({ createdAt: -1 });
    ok(res, { worklogs: logs });
  } catch (e) { err(res, e.message); }
};

exports.createWorkLog = async (req, res) => {
  try {
    const files = (req.files || []).map(f => ({
      filename: f.filename, originalName: f.originalname,
      size: f.size, mimetype: f.mimetype,
      url: `/uploads/worklogs/${f.filename}`,
    }));
    const log = await WorkLog.create({ ...req.body, user: req.user.id, files });
    ok(res, { worklog: log }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateWorkLog = async (req, res) => {
  try {
    const body = { ...req.body };
    // Keep status <-> approved in sync (frontend sends status, legacy code reads approved)
    if (body.status === 'approved') { body.approved = true; body.approvedBy = req.user.id; }
    if (body.status === 'rejected') { body.approved = false; body.approvedBy = req.user.id; }
    if (body.status === 'pending') { body.approved = false; body.approvedBy = undefined; }
    const log = await WorkLog.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!log) return err(res, 'Not found', 404);
    await logAudit(req.user.id, 'UPDATE_WORKLOG', req.params.id, req.body, req.ip);
    ok(res, { worklog: log });
  } catch (e) { err(res, e.message); }
};

exports.deleteWorkLog = async (req, res) => {
  try {
    await WorkLog.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Deleted' });
  } catch (e) { err(res, e.message); }
};

exports.downloadWorkLogFile = async (req, res) => {
  try {
    const filePath = require('path').join(__dirname, '../../uploads/worklogs', req.params.filename);
    res.download(filePath);
  } catch (e) { err(res, e.message); }
};

// ── Salary ────────────────────────────────────────────────────
exports.getSalaries = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const salaries = await Salary.find(filter).populate('user', 'name department jobTitle').sort({ createdAt: -1 });
    ok(res, { salaries });
  } catch (e) { err(res, e.message); }
};

exports.createSalary = async (req, res) => {
  try {
    const salary = await Salary.create(req.body);
    await salary.populate('user', 'name');
    await logAudit(req.user.id, 'CREATE_SALARY', salary._id, req.body, req.ip);
    ok(res, { salary }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateSalary = async (req, res) => {
  try {
    const salary = await Salary.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!salary) return err(res, 'Not found', 404);
    ok(res, { salary });
  } catch (e) { err(res, e.message); }
};

// ── Company ───────────────────────────────────────────────────
exports.getCompany = async (req, res) => {
  try {
    let company = await Company.findOne({});
    if (!company) company = await Company.create({ name: 'Nexus Enterprises' });
    ok(res, { company });
  } catch (e) { err(res, e.message); }
};

exports.updateCompany = async (req, res) => {
  try {
    let company = await Company.findOne({});
    if (!company) company = await Company.create({ name: 'Nexus Enterprises' });
    Object.assign(company, req.body);
    await company.save();
    await logAudit(req.user.id, 'UPDATE_COMPANY', company._id, req.body, req.ip);
    ok(res, { company });
  } catch (e) { err(res, e.message); }
};

// ── Buyers ────────────────────────────────────────────────────
exports.getBuyers = async (req, res) => {
  try {
    const buyers = await Buyer.find({}).sort({ createdAt: -1 });
    ok(res, { buyers });
  } catch (e) { err(res, e.message); }
};

exports.createBuyer = async (req, res) => {
  try {
    const buyer = await Buyer.create(req.body);
    await logAudit(req.user.id, 'CREATE_BUYER', buyer._id, req.body, req.ip);
    ok(res, { buyer }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateBuyer = async (req, res) => {
  try {
    const buyer = await Buyer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    ok(res, { buyer });
  } catch (e) { err(res, e.message); }
};

exports.deleteBuyer = async (req, res) => {
  try {
    await Buyer.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Buyer deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Orders ────────────────────────────────────────────────────
exports.getOrders = async (req, res) => {
  try {
    const orders = await Order.find({}).populate('buyer', 'name company country').sort({ createdAt: -1 });
    ok(res, { orders });
  } catch (e) { err(res, e.message); }
};

exports.createOrder = async (req, res) => {
  try {
    const count = await Order.countDocuments();
    const body = { ...req.body, orderNumber: req.body.orderNumber || `ORD-${String(count + 1).padStart(4, '0')}` };
    const order = await Order.create(body);
    await logAudit(req.user.id, 'CREATE_ORDER', order._id, body, req.ip);
    ok(res, { order }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    ok(res, { order });
  } catch (e) { err(res, e.message); }
};

// ── Audit ─────────────────────────────────────────────────────
exports.getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find({}).populate('user', 'name').sort({ createdAt: -1 }).limit(200);
    ok(res, { logs });
  } catch (e) { err(res, e.message); }
};

// ── Notifications ─────────────────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const notifs = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50);
    ok(res, { notifications: notifs });
  } catch (e) { err(res, e.message); }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id, read: false }, { read: true });
    ok(res, { message: 'Marked as read' });
  } catch (e) { err(res, e.message); }
};

// ── Departments ───────────────────────────────────────────────
exports.getDepartments = async (req, res) => {
  try {
    const departments = await Department.find({}).populate('head', 'name jobTitle').sort({ name: 1 });
    const users = await User.find({ isActive: true }).select('department');
    const result = departments.map(d => ({
      ...d.toObject(),
      employeeCount: users.filter(u => u.department === d.name).length,
    }));
    ok(res, { departments: result });
  } catch (e) { err(res, e.message); }
};

exports.createDepartment = async (req, res) => {
  try {
    const dept = await Department.create(req.body);
    await logAudit(req.user.id, 'CREATE_DEPARTMENT', dept._id, req.body, req.ip);
    ok(res, { department: dept }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateDepartment = async (req, res) => {
  try {
    const dept = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!dept) return err(res, 'Not found', 404);
    ok(res, { department: dept });
  } catch (e) { err(res, e.message); }
};

exports.deleteDepartment = async (req, res) => {
  try {
    await Department.findByIdAndDelete(req.params.id);
    await logAudit(req.user.id, 'DELETE_DEPARTMENT', req.params.id, {}, req.ip);
    ok(res, { message: 'Department deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Shifts ────────────────────────────────────────────────────
exports.getShifts = async (req, res) => {
  try {
    const shifts = await Shift.find({})
      .populate('assignedTo', 'name department team')
      .populate('employee', 'name department team')
      .sort({ updatedAt: -1 });
    ok(res, { shifts });
  } catch (e) { err(res, e.message); }
};

function normalizeShiftPayload(body) {
  const payload = { ...body };

  if (payload.scope === 'all' || payload.scope === 'all_employees') {
    payload.scope = 'company';
  }

  if (payload.scope === 'company') {
    payload.department = '';
    payload.team = '';
    payload.employee = null;
    payload.assignedTo = [];
  }

  if (payload.scope === 'department') {
    payload.team = '';
    payload.employee = null;
    payload.assignedTo = [];
  }

  if (payload.scope === 'team') {
    payload.employee = null;
    payload.assignedTo = [];
  }

  if (payload.scope === 'employee') {
    if (payload.employee && (!payload.assignedTo || !payload.assignedTo.length)) {
      payload.assignedTo = [payload.employee];
    }
  }

  return payload;
}

exports.createShift = async (req, res) => {
  try {
    const payload = normalizeShiftPayload(req.body);
    const shift = await Shift.create(payload);
    await logAudit(req.user.id, 'CREATE_SHIFT', shift._id, payload, req.ip);
    ok(res, { shift }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateShift = async (req, res) => {
  try {
    const payload = normalizeShiftPayload(req.body);
    const shift = await Shift.findByIdAndUpdate(req.params.id, payload, { new: true });
    if (!shift) return err(res, 'Not found', 404);
    await logAudit(req.user.id, 'UPDATE_SHIFT', shift._id, payload, req.ip);
    ok(res, { shift });
  } catch (e) { err(res, e.message); }
};

exports.deleteShift = async (req, res) => {
  try {
    await Shift.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Shift deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Tasks ─────────────────────────────────────────────────────
exports.getTasks = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { assignedTo: req.user.id };
    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name department')
      .populate('assignedBy', 'name')
      .populate('project', 'name')
      .sort({ createdAt: -1 });
    ok(res, { tasks });
  } catch (e) { err(res, e.message); }
};

exports.createTask = async (req, res) => {
  try {
    const task = await Task.create({ ...req.body, assignedBy: req.user.id });
    await task.populate('assignedTo', 'name');
    await logAudit(req.user.id, 'CREATE_TASK', task._id, req.body, req.ip);
    await Notification.create({
      user: task.assignedTo._id,
      title: 'New Task Assigned',
      message: `You have been assigned: ${task.title}`,
      type: 'info',
    });
    ok(res, { task }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('assignedTo', 'name')
      .populate('assignedBy', 'name');
    if (!task) return err(res, 'Not found', 404);
    await logAudit(req.user.id, 'UPDATE_TASK', req.params.id, req.body, req.ip);
    ok(res, { task });
  } catch (e) { err(res, e.message); }
};

exports.deleteTask = async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Task deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Projects ──────────────────────────────────────────────────
exports.getProjects = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { members: req.user.id };
    const projects = await Project.find(filter)
      .populate('members', 'name jobTitle')
      .populate('manager', 'name')
      .sort({ createdAt: -1 });
    ok(res, { projects });
  } catch (e) { err(res, e.message); }
};

exports.createProject = async (req, res) => {
  try {
    const project = await Project.create(req.body);
    await logAudit(req.user.id, 'CREATE_PROJECT', project._id, req.body, req.ip);
    ok(res, { project }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!project) return err(res, 'Not found', 404);
    ok(res, { project });
  } catch (e) { err(res, e.message); }
};

exports.deleteProject = async (req, res) => {
  try {
    await Project.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Project deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Timesheets ────────────────────────────────────────────────
exports.getTimesheets = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const sheets = await Timesheet.find(filter)
      .populate('user', 'name department')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });
    ok(res, { timesheets: sheets });
  } catch (e) { err(res, e.message); }
};

exports.createTimesheet = async (req, res) => {
  try {
    const entries = req.body.entries || [];
    const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const sheet = await Timesheet.create({ ...req.body, user: req.user.id, totalHours });
    ok(res, { timesheet: sheet }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateTimesheet = async (req, res) => {
  try {
    if (req.body.entries) {
      req.body.totalHours = req.body.entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    }
    if (req.body.status === 'approved') req.body.approvedBy = req.user.id;
    const sheet = await Timesheet.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!sheet) return err(res, 'Not found', 404);
    ok(res, { timesheet: sheet });
  } catch (e) { err(res, e.message); }
};

exports.deleteTimesheet = async (req, res) => {
  try {
    await Timesheet.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Timesheet deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Payroll ───────────────────────────────────────────────────
exports.getPayroll = async (req, res) => {
  try {
    const { month, year } = req.query;
    const filter = {};
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);
    const payroll = await Payroll.find(filter)
      .populate('user', 'name department jobTitle')
      .populate('generatedBy', 'name')
      .sort({ createdAt: -1 });
    ok(res, { payroll });
  } catch (e) { err(res, e.message); }
};

exports.createPayroll = async (req, res) => {
  try {
    const net = (Number(req.body.basicSalary) + Number(req.body.allowances || 0)) - (Number(req.body.deductions || 0) + Number(req.body.tax || 0));
    const rec = await Payroll.create({
      ...req.body,
      month: Number(req.body.month),
      year: Number(req.body.year),
      netSalary: net,
      generatedBy: req.user.id,
    });
    await rec.populate('user', 'name');
    await logAudit(req.user.id, 'CREATE_PAYROLL', rec._id, req.body, req.ip);
    ok(res, { payroll: rec }, 201);
  } catch (e) { err(res, e.message); }
};

exports.generatePayroll = async (req, res) => {
  try {
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!month || month < 1 || month > 12) return err(res, 'Valid month (1-12) required', 400);
    if (!year || year < 2000 || year > 2100) return err(res, 'Valid year required', 400);

    const users = await User.find({ isActive: true });
    const created = [];
    const skipped = [];

    // Build date range for attendance lookup (date field is stored as 'YYYY-MM-DD' string)
    const mm = String(month).padStart(2, '0');
    const start = `${year}-${mm}-01`;
    const end = `${year}-${mm}-31`;

    for (const u of users) {
      const existing = await Payroll.findOne({ user: u._id, month, year });
      if (existing) { skipped.push(u._id); continue; }

      const attRecs = await Attendance.find({ user: u._id, date: { $gte: start, $lte: end } });
      const daysWorked = attRecs.filter(a => ['present', 'late', 'half_day', 'early'].includes(a.status)).length;
      const daysAbsent = attRecs.filter(a => a.status === 'absent').length;
      const basic = Number(u.salary) || 0;

      const rec = await Payroll.create({
        user: u._id,
        month,
        year,
        basicSalary: basic,
        allowances: 0,
        deductions: 0,
        tax: 0,
        netSalary: basic,
        daysWorked,
        daysAbsent,
        status: 'draft',
        generatedBy: req.user.id,
      });
      created.push(rec);
    }

    await logAudit(req.user.id, 'GENERATE_PAYROLL', `${year}-${mm}`, { created: created.length, skipped: skipped.length }, req.ip);
    ok(res, {
      message: created.length
        ? `Generated payroll for ${created.length} employee${created.length === 1 ? '' : 's'}${skipped.length ? ` (${skipped.length} already existed, skipped)` : ''}`
        : `Payroll already exists for all ${skipped.length} active employee${skipped.length === 1 ? '' : 's'} for ${mm}/${year}`,
      payroll: created,
      skipped: skipped.length,
    });
  } catch (e) { err(res, e.message); }
};

exports.updatePayroll = async (req, res) => {
  try {
    if (req.body.status === 'paid') req.body.paidOn = new Date();
    const rec = await Payroll.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('user', 'name');
    if (!rec) return err(res, 'Not found', 404);
    ok(res, { payroll: rec });
  } catch (e) { err(res, e.message); }
};

exports.deletePayroll = async (req, res) => {
  try {
    await Payroll.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Payroll record deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Expenses ──────────────────────────────────────────────────
exports.getExpenses = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const expenses = await Expense.find(filter)
      .populate('user', 'name department')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });
    ok(res, { expenses });
  } catch (e) { err(res, e.message); }
};

exports.createExpense = async (req, res) => {
  try {
    const expense = await Expense.create({ ...req.body, user: req.user.id });
    ok(res, { expense }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateExpense = async (req, res) => {
  try {
    if (req.body.status === 'approved') {
      req.body.approvedBy = req.user.id;
      req.body.approvedOn = new Date();
    }
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!expense) return err(res, 'Not found', 404);
    await logAudit(req.user.id, 'UPDATE_EXPENSE', req.params.id, req.body, req.ip);
    ok(res, { expense });
  } catch (e) { err(res, e.message); }
};

exports.deleteExpense = async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Expense deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Announcements ─────────────────────────────────────────────
exports.getAnnouncements = async (req, res) => {
  try {
    const filter = {
      isActive: true,
      $or: [{ targetRole: 'all' }, { targetRole: req.user.role }],
    };
    const announcements = await Announcement.find(filter)
      .populate('postedBy', 'name jobTitle')
      .sort({ createdAt: -1 });
    ok(res, { announcements });
  } catch (e) { err(res, e.message); }
};

exports.createAnnouncement = async (req, res) => {
  try {
    const ann = await Announcement.create({ ...req.body, postedBy: req.user.id });
    await ann.populate('postedBy', 'name');
    await logAudit(req.user.id, 'CREATE_ANNOUNCEMENT', ann._id, req.body, req.ip);
    ok(res, { announcement: ann }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateAnnouncement = async (req, res) => {
  try {
    const ann = await Announcement.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!ann) return err(res, 'Not found', 404);
    ok(res, { announcement: ann });
  } catch (e) { err(res, e.message); }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Announcement deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Leaves ────────────────────────────────────────────────────
exports.getLeaves = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const leaves = await Leave.find(filter)
      .populate('user', 'name department jobTitle')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });
    ok(res, { leaves });
  } catch (e) { err(res, e.message); }
};

exports.createLeave = async (req, res) => {
  try {
    const from = new Date(req.body.from);
    const to = new Date(req.body.to);
    const days = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
    const leave = await Leave.create({ ...req.body, user: req.user.id, days });
    await leave.populate('user', 'name');
    await logAudit(req.user.id, 'CREATE_LEAVE', leave._id, req.body, req.ip);
    ok(res, { leave }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateLeave = async (req, res) => {
  try {
    if (req.body.status && ['approved', 'rejected'].includes(req.body.status)) {
      req.body.reviewedBy = req.user.id;
      req.body.reviewedOn = new Date();
    }
    const leave = await Leave.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('user', 'name')
      .populate('reviewedBy', 'name');
    if (!leave) return err(res, 'Not found', 404);
    if (req.body.status) {
      await Notification.create({
        user: leave.user._id,
        title: `Leave ${req.body.status}`,
        message: `Your leave request has been ${req.body.status}`,
        type: req.body.status === 'approved' ? 'success' : 'error',
      });
    }
    await logAudit(req.user.id, 'UPDATE_LEAVE', req.params.id, req.body, req.ip);
    ok(res, { leave });
  } catch (e) { err(res, e.message); }
};

exports.deleteLeave = async (req, res) => {
  try {
    await Leave.findByIdAndDelete(req.params.id);
    ok(res, { message: 'Leave request deleted' });
  } catch (e) { err(res, e.message); }
};

// ── Organization ──────────────────────────────────────────────
exports.getOrganization = async (req, res) => {
  try {
    let org = await Organization.findOne({});
    if (!org) org = await Organization.create({ companyName: 'Nexus Enterprises Exporters Private Limited' });
    ok(res, { organization: org });
  } catch (e) { err(res, e.message); }
};

exports.updateOrganization = async (req, res) => {
  try {
    let org = await Organization.findOne({});
    if (!org) org = await Organization.create({ companyName: 'Nexus Enterprises' });
    Object.assign(org, req.body);
    await org.save();
    await logAudit(req.user.id, 'UPDATE_ORGANIZATION', org._id, req.body, req.ip);
    ok(res, { organization: org });
  } catch (e) { err(res, e.message); }
};

// ── Roles & Permissions ───────────────────────────────────────
exports.getRoles = async (req, res) => {
  try {
    const users = await User.find({}).select('name email role department isActive jobTitle').sort({ role: 1 });
    ok(res, { users });
  } catch (e) { err(res, e.message); }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'employee', 'super_admin'].includes(role)) return err(res, 'Invalid role', 400);
    const user = await User.findByIdAndUpdate(req.params.userId, { role }, { new: true }).select('-password');
    if (!user) return err(res, 'User not found', 404);
    await logAudit(req.user.id, 'UPDATE_ROLE', req.params.userId, { role }, req.ip);
    ok(res, { user });
  } catch (e) { err(res, e.message); }
};

// ── Reports ───────────────────────────────────────────────────
exports.getReportsOverview = async (req, res) => {
  try {
    const [
      totalEmployees, activeEmployees,
      totalOrders, completedOrders,
      totalPayroll, pendingLeaves,
      totalTasks, completedTasks,
      totalExpenses, pendingExpenses,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      Order.countDocuments({}),
      Order.countDocuments({ status: 'delivered' }),
      Payroll.aggregate([{ $group: { _id: null, total: { $sum: '$netSalary' } } }]),
      Leave.countDocuments({ status: 'pending' }),
      Task.countDocuments({}),
      Task.countDocuments({ status: 'completed' }),
      Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      Expense.countDocuments({ status: 'pending' }),
    ]);
    ok(res, {
      totalEmployees, activeEmployees,
      totalOrders, completedOrders,
      totalPayroll: totalPayroll[0]?.total || 0,
      pendingLeaves, totalTasks, completedTasks,
      taskCompletionRate: totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0,
      totalExpenses: totalExpenses[0]?.total || 0,
      pendingExpenses,
    });
  } catch (e) { err(res, e.message); }
};

exports.getAttendanceReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = `${y}-${String(m).padStart(2, '0')}-31`;
    const records = await Attendance.find({ date: { $gte: start, $lte: end } }).populate('user', 'name department');
    const summary = {
      present: records.filter(r => r.status === 'present').length,
      late: records.filter(r => r.status === 'late').length,
      absent: records.filter(r => r.status === 'absent').length,
      halfDay: records.filter(r => r.status === 'half-day').length,
      totalHours: records.reduce((s, r) => s + (r.totalHours || 0), 0),
    };
    ok(res, { records, summary });
  } catch (e) { err(res, e.message); }
};

exports.getPayrollReport = async (req, res) => {
  try {
    const { month } = req.query;
    const filter = month ? { month } : {};
    const records = await Payroll.find(filter).populate('user', 'name department');
    const total = records.reduce((s, r) => s + r.netSalary, 0);
    const paid = records.filter(r => r.status === 'paid').reduce((s, r) => s + r.netSalary, 0);
    const pending = records.filter(r => r.status !== 'paid').reduce((s, r) => s + r.netSalary, 0);
    ok(res, { records, totalPayroll: total, paid, pending });
  } catch (e) { err(res, e.message); }
};

exports.getTasksReport = async (req, res) => {
  try {
    const tasks = await Task.find({}).populate('assignedTo', 'name department');
    const summary = {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      cancelled: tasks.filter(t => t.status === 'cancelled').length,
      highPriority: tasks.filter(t => t.priority === 'high').length,
    };
    ok(res, { tasks, summary });
  } catch (e) { err(res, e.message); }
};


// ── Session helpers ───────────────────────────────────────────
// STABLE ATTENDANCE ENGINE
// Rules:
// 1) Shift Management decides WHO works WHEN.
// 2) Company Settings decides global rules: early window, grace, full-day hours, auto checkout, max session, breaks.
// 3) All date keys and displayed windows are resolved in IST.
const ATT_TZ = 'Asia/Kolkata';

function pad2(n) { return String(n).padStart(2, '0'); }

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function istDateKey(date = new Date()) { return istParts(date).dateKey; }

function istWeekday(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: ATT_TZ, weekday: 'long' }).format(date);
}

function istDateToUtc(dateKey, hour = 0, minute = 0, second = 0) {
  const [y, m, d] = dateKey.split('-').map(Number);
  // IST is UTC+05:30. This returns the correct UTC instant for the IST wall-clock time.
  return new Date(Date.UTC(y, m - 1, d, Number(hour) || 0, Number(minute) || 0, Number(second) || 0) - (5.5 * 60 * 60 * 1000));
}

function parseHHMM(value, fallbackHour = 9, fallbackMinute = 0) {
  if (!value || typeof value !== 'string' || !value.includes(':')) {
    return { hour: fallbackHour, minute: fallbackMinute };
  }
  const [h, m] = value.split(':').map(Number);
  return {
    hour: Number.isFinite(h) ? h : fallbackHour,
    minute: Number.isFinite(m) ? m : fallbackMinute,
  };
}

function num(value, fallback, min = null, max = null) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  if (min !== null) n = Math.max(min, n);
  if (max !== null) n = Math.min(max, n);
  return n;
}

function fmtIST(date) {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-IN', { timeZone: ATT_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

async function getCompanyRules() {
  let company = await Company.findOne({});
  if (!company) company = await Company.create({ name: 'Nexus Enterprises' });
  return {
    company,
    earlyWindowMinutes: num(company.earlyWindowMinutes, 15, 0, 240),
    gracePeriodMinutes: num(company.gracePeriodMinutes, 15, 0, 240),
    halfDayCutoffMinutes: num(company.halfDayCutoffMinutes, 90, 0, 720),
    absentCutoffMinutes: num(company.absentCutoffMinutes, company.gracePeriodMinutes ?? 15, 0, 720),
    minWorkingHours: num(company.minWorkingHours, 3, 0, 24),
    halfDayHours: num(company.halfDayHours, 1.5, 0, 24),
    autoEndBufferMinutes: num(company.autoEndBufferMinutes, 15, 0, 720),
    maxSessionHours: num(company.maxSessionHours, 8, 1, 20),
    breakEnabled: company.breakEnabled !== false,
    breakAllowedMinutes: num(company.breakAllowedMinutes, 15, 1, 240),
    maxBreaksPerDay: num(company.maxBreaksPerDay, 2, 0, 20),
    fallbackStartHour: num(company.officeStartHour, 9, 0, 23),
    fallbackStartMinute: num(company.officeStartMinute, 0, 0, 59),
    fallbackEndHour: num(company.officeEndHour, 18, 0, 23),
    fallbackEndMinute: num(company.officeEndMinute, 0, 0, 59),
  };
}

function dayMatchForShift(date = new Date()) {
  const day = istWeekday(date);
  return {
    $or: [
      { days: { $exists: false } },
      { days: { $size: 0 } },
      { days: day },
      { workingDays: { $exists: false } },
      { workingDays: { $size: 0 } },
      { workingDays: day },
    ]
  };
}

async function resolveShiftForUser(userId, refDate = new Date()) {
  const rules = await getCompanyRules();
  const user = await User.findById(userId).select('department team').lean();
  const dayQuery = dayMatchForShift(refDate);

  let shift = null;
  let source = 'company_default';

  if (user) {
    shift = await Shift.findOne({ isActive: true, scope: 'employee', employee: userId, ...dayQuery }).sort({ updatedAt: -1 });
    source = shift ? 'employee' : source;

    if (!shift) {
      shift = await Shift.findOne({ isActive: true, assignedTo: userId, ...dayQuery }).sort({ updatedAt: -1 });
      source = shift ? 'assignedTo' : source;
    }

    if (!shift && user.team) {
      shift = await Shift.findOne({ isActive: true, scope: 'team', team: user.team, ...dayQuery }).sort({ updatedAt: -1 });
      source = shift ? 'team' : source;
    }

    if (!shift && user.department) {
      shift = await Shift.findOne({ isActive: true, scope: 'department', department: user.department, ...dayQuery }).sort({ updatedAt: -1 });
      source = shift ? 'department' : source;
    }
  }

  if (!shift) {
    shift = await Shift.findOne({ isActive: true, scope: { $in: ['company', 'all', 'all_employees'] }, ...dayQuery }).sort({ updatedAt: -1 });
    source = shift ? 'company_shift' : source;
  }

  let startHour = rules.fallbackStartHour;
  let startMinute = rules.fallbackStartMinute;
  let endHour = rules.fallbackEndHour;
  let endMinute = rules.fallbackEndMinute;
  let name = 'Company Default Shift';
  let shiftId = null;

  if (shift) {
    const st = parseHHMM(shift.startTime, startHour, startMinute);
    const en = parseHHMM(shift.endTime, endHour, endMinute);
    startHour = st.hour; startMinute = st.minute;
    endHour = en.hour; endMinute = en.minute;
    name = shift.name || name;
    shiftId = shift._id;
  }

  return {
    source, shiftId, name,
    startHour, startMinute, endHour, endMinute,
    earlyWindowMinutes: rules.earlyWindowMinutes,
    gracePeriodMinutes: rules.gracePeriodMinutes,
    halfDayCutoffMinutes: rules.halfDayCutoffMinutes,
    absentCutoffMinutes: rules.absentCutoffMinutes,
    minWorkingHours: rules.minWorkingHours,
    halfDayHours: rules.halfDayHours,
    autoEndBufferMinutes: rules.autoEndBufferMinutes,
    maxSessionHours: rules.maxSessionHours,
    breakEnabled: rules.breakEnabled,
    breakAllowedMinutes: rules.breakAllowedMinutes,
    maxBreaksPerDay: rules.maxBreaksPerDay,
  };
}

function snapshotFromSettings(settings) {
  return {
    name: settings.name || '',
    startTime: `${pad2(settings.startHour)}:${pad2(settings.startMinute)}`,
    endTime: `${pad2(settings.endHour)}:${pad2(settings.endMinute)}`,
    gracePeriodMinutes: settings.gracePeriodMinutes,
    earlyWindowMinutes: settings.earlyWindowMinutes,
    halfDayCutoffMinutes: settings.halfDayCutoffMinutes,
    absentCutoffMinutes: settings.absentCutoffMinutes,
    minWorkingHours: settings.minWorkingHours,
    halfDayHours: settings.halfDayHours,
    autoEndBufferMinutes: settings.autoEndBufferMinutes,
  };
}

function buildWindows(dateKey, settings) {
  const shiftStart = istDateToUtc(dateKey, settings.startHour, settings.startMinute);
  let shiftEnd = istDateToUtc(dateKey, settings.endHour, settings.endMinute);
  if (shiftEnd <= shiftStart) shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
  const earlyOpen = new Date(shiftStart.getTime() - settings.earlyWindowMinutes * 60000);
  const graceCutoff = new Date(shiftStart.getTime() + settings.gracePeriodMinutes * 60000);
  const absentCutoff = new Date(shiftStart.getTime() + settings.absentCutoffMinutes * 60000);
  const halfDayCutoff = new Date(graceCutoff.getTime() + settings.halfDayCutoffMinutes * 60000);
  const autoEnd = new Date(shiftEnd.getTime() + settings.autoEndBufferMinutes * 60000);
  return { shiftStart, shiftEnd, earlyOpen, graceCutoff, absentCutoff, halfDayCutoff, autoEnd };
}

function classifyCheckIn(now, settings, dateKey = istDateKey(now)) {
  const windows = buildWindows(dateKey, settings);
  const t = new Date(now);
  if (t < windows.earlyOpen) {
    return { allowed: false, status: null, reason: 'too_early', message: `Check-in opens at ${fmtIST(windows.earlyOpen)}.`, windows };
  }
  if (t < windows.shiftStart) {
    return {
      allowed: true, status: 'early', isEarly: true, isLate: false,
      earlyMinutes: Math.round((windows.shiftStart - t) / 60000), lateMinutes: 0,
      flags: ['early_checkin'], windows,
    };
  }
  if (t <= windows.graceCutoff) {
    return { allowed: true, status: 'present', isEarly: false, isLate: false, earlyMinutes: 0, lateMinutes: 0, flags: [], windows };
  }
  // User may still become ACTIVE for monitoring, but attendance credit is absent after grace.
  return {
    allowed: true, status: 'absent', isEarly: false, isLate: true,
    earlyMinutes: 0, lateMinutes: Math.max(0, Math.round((t - windows.shiftStart) / 60000)),
    flags: ['after_grace_absent'], windows,
  };
}

function safeHoursBetween(start, end) {
  if (!start || !end) return 0;
  const n = (new Date(end) - new Date(start)) / 3600000;
  if (!Number.isFinite(n) || n < 0 || n > 24) return 0;
  return Number(n.toFixed(2));
}

function finalizeStatus(rec, checkOut, settings, dateKey) {
  const windows = buildWindows(dateKey, settings);
  const totalHours = safeHoursBetween(rec.checkIn, checkOut);
  const flags = new Set(rec.flags || []);
  if (checkOut && new Date(checkOut) < windows.shiftEnd) flags.add('early_logout');

  let status = rec.status || 'present';
  // If employee came after grace, attendance stays absent even if active later.
  if (status !== 'absent') {
    if (totalHours < settings.halfDayHours) {
      status = 'absent';
      flags.add('insufficient_hours_absent');
    } else if (totalHours < settings.minWorkingHours || new Date(checkOut) < windows.shiftEnd) {
      status = 'half_day';
      flags.add('half_day_hours_or_early_logout');
    } else {
      status = 'present';
    }
  }
  return { status, totalHours, flags: Array.from(flags) };
}

exports.checkIn = async (req, res) => {
  try {
    const now = new Date();
    const today = istDateKey(now);
    const existing = await Attendance.findOne({ user: req.user.id, date: today });
    if (existing?.sessionActive) return res.status(400).json({ success: false, code: 'ALREADY_ACTIVE', message: 'You are already active.', attendance: existing });
    if (existing?.checkOut) return res.status(400).json({ success: false, code: 'ALREADY_COMPLETED', message: 'Attendance already completed today.', attendance: existing });

    const settings = await resolveShiftForUser(req.user.id, now);
    const cls = classifyCheckIn(now, settings, today);
    if (!cls.allowed) return res.status(400).json({ success: false, code: cls.reason, message: cls.message, settings, windows: cls.windows });

    const payload = {
      user: req.user.id,
      date: today,
      checkIn: now,
      checkOut: null,
      totalHours: 0,
      status: cls.status,
      isLate: !!cls.isLate,
      isEarly: !!cls.isEarly,
      lateMinutes: cls.lateMinutes || 0,
      earlyMinutes: cls.earlyMinutes || 0,
      flags: cls.flags || [],
      sessionActive: true,
      loginStatus: 'online',
      liveStatus: 'active',
      sessionStartedAt: now,
      sessionEndedAt: null,
      autoMarked: false,
      autoClosed: false,
      ipAddress: req.ip,
      shiftSource: settings.source,
      shiftId: settings.shiftId,
      shiftSnapshot: snapshotFromSettings(settings),
    };

    const rec = existing
      ? await Attendance.findByIdAndUpdate(existing._id, payload, { new: true })
      : await Attendance.create(payload);

    await logAudit(req.user.id, 'ATTENDANCE_CHECKIN', rec._id, { status: rec.status, time: now, shiftSource: settings.source }, req.ip);
    ok(res, { success: true, attendance: rec, settings, windows: cls.windows, message: `Checked in as ${rec.status}.` });
  } catch (e) { err(res, e.message); }
};

exports.checkOutFull = async (req, res) => {
  try {
    const now = new Date();
    const today = istDateKey(now);
    const rec = await Attendance.findOne({ user: req.user.id, date: today });
    if (!rec) return err(res, 'No check-in found for today', 400);
    if (!rec.sessionActive && rec.checkOut) return err(res, 'Session already ended', 400);

    const settings = await resolveShiftForUser(req.user.id, rec.checkIn || now);
    const dateKey = rec.date || istDateKey(rec.checkIn || now);
    const result = finalizeStatus(rec, now, settings, dateKey);

    rec.checkOut = now;
    rec.totalHours = result.totalHours;
    rec.status = result.status;
    rec.flags = result.flags;
    rec.sessionActive = false;
    rec.loginStatus = 'offline';
    rec.liveStatus = 'inactive';
    rec.sessionEndedAt = now;
    await rec.save();

    await BreakLog.updateMany({ user: req.user.id, date: today, status: 'active' }, { status: 'auto_closed', breakEnd: now });
    await logAudit(req.user.id, 'ATTENDANCE_CHECKOUT', rec._id, { totalHours: result.totalHours, status: result.status }, req.ip);
    ok(res, { success: true, attendance: rec, message: `Checked out. Status: ${result.status}. Hours: ${result.totalHours}h.` });
  } catch (e) { err(res, e.message); }
};

exports.undoCheckout = async (req, res) => {
  try {
    const today = istDateKey();
    const rec = await Attendance.findOne({ user: req.user.id, date: today });
    if (!rec || !rec.checkOut) return err(res, 'No completed checkout found to undo.', 400);
    const mins = (Date.now() - new Date(rec.checkOut).getTime()) / 60000;
    if (mins > 10) return err(res, 'Undo window expired.', 400);
    rec.checkOut = null;
    rec.totalHours = 0;
    rec.sessionActive = true;
    rec.loginStatus = 'online';
    rec.liveStatus = 'active';
    rec.sessionEndedAt = null;
    rec.flags = [...new Set([...(rec.flags || []), 'checkout_undone'])];
    await rec.save();
    ok(res, { success: true, attendance: rec, message: 'Checkout undone. Session resumed.' });
  } catch (e) { err(res, e.message); }
};

exports.getTodayStatus = async (req, res) => {
  try {
    const now = new Date();
    const today = istDateKey(now);
    const rec = await Attendance.findOne({ user: req.user.id, date: today });
    const settings = await resolveShiftForUser(req.user.id, now);
    const windows = buildWindows(today, settings);
    const wouldBe = classifyCheckIn(now, settings, today);
    const activeBreak = await BreakLog.findOne({ user: req.user.id, date: today, status: 'active' }).sort({ createdAt: -1 });

    let liveStatus = 'inactive';
    let liveHours = 0;
    if (rec?.sessionActive && rec?.checkIn) {
      liveStatus = activeBreak ? 'on_break' : 'active';
      liveHours = safeHoursBetween(rec.checkIn, now);
    } else if (rec?.checkOut) {
      liveStatus = 'completed';
      liveHours = num(rec.totalHours, 0, 0, 24);
    }

    ok(res, {
      success: true,
      serverNow: now,
      istDate: today,
      attendance: rec,
      activeBreak,
      liveStatus,
      liveHours,
      settings,
      windows,
      wouldBe: { allowed: wouldBe.allowed, status: wouldBe.status, reason: wouldBe.reason, message: wouldBe.message },
    });
  } catch (e) { err(res, e.message); }
};

exports.adminOverride = async (req, res) => {
  try {
    const { userId, date, status, checkIn, checkOut, note } = req.body;
    if (!userId || !date || !status) return err(res, 'userId, date and status required', 400);
    const settings = await resolveShiftForUser(userId, checkIn ? new Date(checkIn) : new Date());
    let totalHours = 0;
    let flags = ['admin_override'];
    if (checkIn && checkOut) totalHours = safeHoursBetween(checkIn, checkOut);
    const att = await Attendance.findOneAndUpdate(
      { user: userId, date },
      { user: userId, date, status, checkIn: checkIn || null, checkOut: checkOut || null, totalHours, flags, sessionActive: false, loginStatus: 'offline', liveStatus: 'inactive', sessionEndedAt: checkOut || new Date(), shiftSource: settings.source, shiftId: settings.shiftId, shiftSnapshot: snapshotFromSettings(settings), adminOverride: true, adminNote: note || '', overriddenBy: req.user.id },
      { upsert: true, new: true }
    );
    await logAudit(req.user.id, 'ADMIN_OVERRIDE', att._id, { userId, date, status }, req.ip);
    ok(res, { success: true, attendance: att });
  } catch (e) { err(res, e.message); }
};

exports.requestCorrection = async (req, res) => { try { const { date, reason, requestedCheckIn, requestedCheckOut } = req.body; if (!date || !reason) return err(res, 'date and reason required', 400); const att = await Attendance.findOne({ user: req.user.id, date }); if (!att) return err(res, 'No record found', 404); att.correctionRequest = { status: 'pending', reason, requestedCheckIn: requestedCheckIn || att.checkIn, requestedCheckOut: requestedCheckOut || att.checkOut, requestedAt: new Date() }; await att.save(); ok(res, { success: true, attendance: att }); } catch (e) { err(res, e.message); } };
exports.reviewCorrection = async (req, res) => { try { const { action, adminNote } = req.body; if (!['approved', 'rejected'].includes(action)) return err(res, 'action must be approved or rejected', 400); const att = await Attendance.findById(req.params.id).populate('user', 'name _id'); if (!att) return err(res, 'Not found', 404); att.correctionRequest.status = action; att.correctionRequest.reviewedBy = req.user.id; att.correctionRequest.reviewedAt = new Date(); att.correctionRequest.adminNote = adminNote || ''; await att.save(); await Notification.create({ user: att.user._id, title: `Correction ${action}`, message: `Your correction for ${att.date} was ${action}.`, type: action === 'approved' ? 'success' : 'error' }); ok(res, { success: true, attendance: att }); } catch (e) { err(res, e.message); } };
exports.getPendingCorrections = async (req, res) => { try { const recs = await Attendance.find({ 'correctionRequest.status': 'pending' }).populate('user', 'name department').sort({ 'correctionRequest.requestedAt': -1 }); ok(res, { success: true, corrections: recs }); } catch (e) { err(res, e.message); } };

exports.autoMarkAbsent = async (req, res) => {
  try {
    const now = new Date();
    const today = istDateKey(now);
    const users = await User.find({ isActive: true }).select('_id department team name');
    const existing = await Attendance.find({ date: today }).select('user');
    const done = new Set(existing.map(r => r.user.toString()));
    let count = 0;

    for (const u of users) {
      if (done.has(u._id.toString())) continue;
      const settings = await resolveShiftForUser(u._id, now);
      const windows = buildWindows(today, settings);
      if (now <= windows.graceCutoff) continue;
      const rec = await Attendance.create({
        user: u._id, date: today, status: 'absent', sessionActive: false, loginStatus: 'offline', liveStatus: 'inactive',
        autoMarked: true, flags: ['auto_absent_after_grace'], shiftSource: settings.source, shiftId: settings.shiftId, shiftSnapshot: snapshotFromSettings(settings),
      });
      await Notification.create({ user: u._id, title: 'Marked Absent', message: `You were marked absent for ${settings.name} because check-in was missed before ${fmtIST(windows.graceCutoff)}.`, type: 'error' });
      count++;
    }
    await logAudit(req.user?.id || 'system', 'AUTO_ABSENT', today, { count }, req.ip);
    ok(res, { success: true, count, date: today });
  } catch (e) { err(res, e.message); }
};

exports.autoEndSessions = async (req, res) => {
  try {
    const now = new Date();
    const active = await Attendance.find({ sessionActive: true });
    let count = 0, skipped = 0;
    for (const rec of active) {
      const settings = await resolveShiftForUser(rec.user, rec.checkIn || now);
      const dateKey = rec.date || istDateKey(rec.checkIn || now);
      const windows = buildWindows(dateKey, settings);
      const maxEnd = new Date(new Date(rec.checkIn || now).getTime() + settings.maxSessionHours * 3600000);
      let closeAt = null;
      let reason = '';
      if (now >= windows.autoEnd) { closeAt = windows.autoEnd; reason = 'shift_end_reached'; }
      if (now >= maxEnd && (!closeAt || maxEnd < closeAt)) { closeAt = maxEnd; reason = 'max_session_exceeded'; }
      if (req.body?.force && !closeAt) { closeAt = now; reason = 'admin_force_logout'; }
      if (!closeAt) { skipped++; continue; }

      const result = finalizeStatus(rec, closeAt, settings, dateKey);
      rec.checkOut = closeAt;
      rec.totalHours = result.totalHours;
      rec.status = result.status;
      rec.flags = [...new Set([...(result.flags || []), 'auto_ended', reason])];
      rec.sessionActive = false;
      rec.loginStatus = 'offline';
      rec.liveStatus = 'auto_logged_out';
      rec.sessionEndedAt = closeAt;
      rec.autoClosed = true;
      rec.forcedLogoutReason = reason;
      await rec.save();
      await BreakLog.updateMany({ user: rec.user, date: rec.date, status: 'active' }, { status: 'auto_closed', breakEnd: closeAt });
      await Notification.create({ user: rec.user, title: 'Session Auto-Ended', message: `Session auto-ended at ${fmtIST(closeAt)}. Reason: ${reason}.`, type: 'warning' });
      count++;
    }
    await logAudit(req.user?.id || 'system', 'AUTO_END_SESSIONS', istDateKey(now), { count, skipped }, req.ip);
    ok(res, { success: true, count, skipped, ranAt: now });
  } catch (e) { err(res, e.message); }
};

exports.startBreak = async (req, res) => {
  try {
    const now = new Date();
    const today = istDateKey(now);
    const settings = await resolveShiftForUser(req.user.id, now);
    if (!settings.breakEnabled) return err(res, 'Breaks are disabled by super admin.', 400);
    const att = await Attendance.findOne({ user: req.user.id, date: today });
    if (!att?.sessionActive) return err(res, 'You must be active before starting a break.', 400);
    const active = await BreakLog.findOne({ user: req.user.id, date: today, status: 'active' });
    if (active) return err(res, 'You already have an active break.', 400);
    const used = await BreakLog.countDocuments({ user: req.user.id, date: today, status: { $in: ['completed', 'late_return', 'reviewed'] } });
    if (used >= settings.maxBreaksPerDay) return err(res, `Break limit reached for today (${settings.maxBreaksPerDay}).`, 400);
    const br = await BreakLog.create({ user: req.user.id, date: today, breakStart: now, allowedMinutes: settings.breakAllowedMinutes, status: 'active' });
    att.liveStatus = 'on_break';
    await att.save();
    ok(res, { success: true, break: br, attendance: att, message: 'Break started.' });
  } catch (e) { err(res, e.message); }
};

exports.endBreak = async (req, res) => {
  try {
    const now = new Date();
    const today = istDateKey(now);
    const { employeeReason } = req.body || {};
    const br = await BreakLog.findOne({ user: req.user.id, date: today, status: 'active' }).sort({ createdAt: -1 });
    if (!br) return err(res, 'No active break found.', 400);
    const actualMinutes = Math.max(0, Math.ceil((now - new Date(br.breakStart)) / 60000));
    const lateMinutes = Math.max(0, actualMinutes - (br.allowedMinutes || 0));
    br.breakEnd = now;
    br.actualMinutes = actualMinutes;
    br.lateMinutes = lateMinutes;
    br.status = lateMinutes > 0 ? 'late_return' : 'completed';
    br.employeeReason = employeeReason || br.employeeReason || '';
    await br.save();
    const att = await Attendance.findOne({ user: req.user.id, date: today });
    if (att?.sessionActive) { att.liveStatus = 'active'; await att.save(); }
    ok(res, { success: true, break: br, attendance: att, message: lateMinutes ? `Returned ${lateMinutes} min late.` : 'Break completed.' });
  } catch (e) { err(res, e.message); }
};

exports.undoBreak = async (req, res) => {
  try {
    const now = new Date();
    const today = istDateKey(now);
    const br = await BreakLog.findOne({ user: req.user.id, date: today, status: 'active' }).sort({ createdAt: -1 });
    if (!br) return err(res, 'No active break to undo.', 400);
    br.status = 'cancelled';
    br.cancelledAt = now;
    br.cancelReason = 'employee_undo';
    br.breakEnd = now;
    await br.save();
    const att = await Attendance.findOne({ user: req.user.id, date: today });
    if (att?.sessionActive) { att.liveStatus = 'active'; await att.save(); }
    ok(res, { success: true, break: br, attendance: att, message: 'Break cancelled.' });
  } catch (e) { err(res, e.message); }
};

exports.getBreaks = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const breaks = await BreakLog.find(filter).populate('user', 'name department team').sort({ createdAt: -1 }).limit(500);
    ok(res, { success: true, breaks });
  } catch (e) { err(res, e.message); }
};

exports.reviewBreak = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') return err(res, 'Only super admin can review breaks.', 403);
    const br = await BreakLog.findById(req.params.id);
    if (!br) return err(res, 'Break not found.', 404);
    br.superAdminComment = req.body?.superAdminComment || '';
    br.reviewedBy = req.user.id;
    br.reviewedAt = new Date();
    br.status = br.status === 'late_return' ? 'reviewed' : br.status;
    await br.save();
    ok(res, { success: true, break: br });
  } catch (e) { err(res, e.message); }
};

// ═══════════════════════════════════════════════════════════════
// PAYSLIPS — full CRUD + PDF generation + employee query system
// ═══════════════════════════════════════════════════════════════
const { Payslip } = require('../models');

function computePayslipTotals(p) {
  const earnings = (Number(p.basic) || 0) + (Number(p.hra) || 0) + (Number(p.da) || 0) + (Number(p.specialAllowance) || 0) + (Number(p.bonus) || 0);
  const deductions = (Number(p.pf) || 0) + (Number(p.pt) || 0) + (Number(p.tds) || 0) + (Number(p.loan) || 0);
  return { totalEarnings: earnings, totalDeductions: deductions, netPay: earnings - deductions };
}

exports.getPayslips = async (req, res) => {
  try {
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    const { month, year, userId } = req.query;
    const filter = isAdm ? {} : { user: req.user.id };
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);
    if (userId && isAdm) filter.user = userId;
    const payslips = await Payslip.find(filter)
      .populate('user', 'name email department jobTitle employeeId salary')
      .populate('generatedBy', 'name')
      .sort({ year: -1, month: -1, createdAt: -1 });
    ok(res, { payslips });
  } catch (e) { err(res, e.message); }
};

exports.createPayslip = async (req, res) => {
  try {
    const totals = computePayslipTotals(req.body);
    const payslip = await Payslip.create({
      ...req.body,
      user: req.body.userId || req.body.user,
      ...totals,
      generatedBy: req.user.id,
    });
    await payslip.populate('user', 'name email department jobTitle employeeId salary');
    await logAudit(req.user.id, 'CREATE_PAYSLIP', payslip._id, { month: payslip.month, year: payslip.year }, req.ip);
    await Notification.create({ user: payslip.user._id, title: 'New Payslip', message: `Payslip for ${payslip.month}/${payslip.year} is now available.`, type: 'info' });
    ok(res, { payslip }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updatePayslip = async (req, res) => {
  try {
    const existing = await Payslip.findById(req.params.id);
    if (!existing) return err(res, 'Payslip not found', 404);
    const merged = { ...existing.toObject(), ...req.body };
    const totals = computePayslipTotals(merged);
    const payslip = await Payslip.findByIdAndUpdate(
      req.params.id,
      { ...req.body, ...totals },
      { new: true }
    ).populate('user', 'name email department jobTitle employeeId salary');
    await logAudit(req.user.id, 'UPDATE_PAYSLIP', payslip._id, req.body, req.ip);
    ok(res, { payslip });
  } catch (e) { err(res, e.message); }
};

exports.deletePayslip = async (req, res) => {
  try {
    await Payslip.findByIdAndDelete(req.params.id);
    await logAudit(req.user.id, 'DELETE_PAYSLIP', req.params.id, {}, req.ip);
    ok(res, { message: 'Payslip deleted' });
  } catch (e) { err(res, e.message); }
};

exports.queryPayslip = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) return err(res, 'Query text required', 400);
    const payslip = await Payslip.findById(req.params.id).populate('user', 'name');
    if (!payslip) return err(res, 'Payslip not found', 404);
    payslip.query = { text: query.trim(), askedBy: req.user.id, askedAt: new Date(), status: 'pending' };
    payslip.status = 'queried';
    await payslip.save();
    // notify all admins
    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] }, isActive: true }).select('_id');
    for (const adm of admins) {
      await Notification.create({
        user: adm._id,
        title: 'Payslip Query',
        message: `${payslip.user?.name || 'Employee'} has a query on payslip ${payslip.month}/${payslip.year}.`,
        type: 'warning',
      });
    }
    ok(res, { payslip });
  } catch (e) { err(res, e.message); }
};

exports.replyPayslipQuery = async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || !reply.trim()) return err(res, 'Reply text required', 400);
    const payslip = await Payslip.findById(req.params.id);
    if (!payslip) return err(res, 'Payslip not found', 404);
    if (!payslip.query) payslip.query = {};
    payslip.query.reply = reply.trim();
    payslip.query.repliedBy = req.user.id;
    payslip.query.repliedAt = new Date();
    payslip.query.status = 'replied';
    payslip.status = 'draft';
    await payslip.save();
    await Notification.create({ user: payslip.user, title: 'Payslip Query Replied', message: `Your query on payslip ${payslip.month}/${payslip.year} has a reply.`, type: 'success' });
    ok(res, { payslip });
  } catch (e) { err(res, e.message); }
};

exports.downloadPayslipPDF = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const payslip = await Payslip.findById(req.params.id).populate('user', 'name email department jobTitle employeeId');
    if (!payslip) return err(res, 'Payslip not found', 404);
    // permission: own payslip or admin
    const isAdm = ['admin', 'super_admin'].includes(req.user.role);
    if (!isAdm && payslip.user._id.toString() !== req.user.id) return err(res, 'Not authorized', 403);

    const company = await Company.findOne({}) || { name: 'Nexus Enterprises Exporters Pvt. Ltd.' };
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthLabel = `${monthNames[(payslip.month || 1) - 1]} ${payslip.year}`;
    const emp = payslip.user || {};
    const totals = computePayslipTotals(payslip);
    const earnings = payslip.totalEarnings ?? totals.totalEarnings;
    const deductions = payslip.totalDeductions ?? totals.totalDeductions;
    const netPay = payslip.netPay ?? totals.netPay;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${emp.name?.replace(/\s/g, '_') || 'emp'}-${payslip.month}-${payslip.year}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    // Header
    doc.fillColor('#0b0d14').fontSize(20).font('Helvetica-Bold').text(company.name || 'Nexus Enterprises', { align: 'left' });
    doc.fontSize(9).font('Helvetica').fillColor('#555').text('Enterprise Management System', { align: 'left' });
    if (company.address) doc.text(company.address);
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(2).strokeColor('#6366f1').stroke();
    doc.moveDown(0.8);

    // Title
    doc.fillColor('#0b0d14').fontSize(16).font('Helvetica-Bold').text(`Payslip — ${monthLabel}`, { align: 'center' });
    doc.moveDown(0.8);

    // Employee details box
    const boxY = doc.y;
    doc.rect(40, boxY, 515, 70).fillAndStroke('#f5f6fa', '#e5e7eb');
    doc.fillColor('#0b0d14').fontSize(10).font('Helvetica-Bold').text('Employee Name:', 50, boxY + 10);
    doc.font('Helvetica').text(emp.name || '—', 150, boxY + 10);
    doc.font('Helvetica-Bold').text('Employee ID:', 50, boxY + 28);
    doc.font('Helvetica').text(emp.employeeId || emp._id?.toString().slice(-6).toUpperCase() || '—', 150, boxY + 28);
    doc.font('Helvetica-Bold').text('Department:', 50, boxY + 46);
    doc.font('Helvetica').text(emp.department || '—', 150, boxY + 46);
    doc.font('Helvetica-Bold').text('Designation:', 320, boxY + 10);
    doc.font('Helvetica').text(emp.jobTitle || '—', 420, boxY + 10);
    doc.font('Helvetica-Bold').text('Pay Period:', 320, boxY + 28);
    doc.font('Helvetica').text(monthLabel, 420, boxY + 28);
    doc.font('Helvetica-Bold').text('Working Days:', 320, boxY + 46);
    doc.font('Helvetica').text(`${payslip.workingDays || 0} (Leave: ${payslip.leaveDays || 0})`, 420, boxY + 46);

    doc.y = boxY + 85;

    // Earnings / Deductions table
    const tableY = doc.y;
    const colW = 257;

    // Headers
    doc.rect(40, tableY, colW, 24).fillAndStroke('#6366f1', '#6366f1');
    doc.rect(40 + colW, tableY, colW, 24).fillAndStroke('#ef4444', '#ef4444');
    doc.fillColor('#fff').fontSize(11).font('Helvetica-Bold');
    doc.text('EARNINGS', 50, tableY + 7);
    doc.text('DEDUCTIONS', 50 + colW, tableY + 7);

    // Rows
    const earningRows = [
      ['Basic', payslip.basic || 0],
      ['HRA', payslip.hra || 0],
      ['DA', payslip.da || 0],
      ['Special Allowance', payslip.specialAllowance || 0],
      ['Bonus', payslip.bonus || 0],
    ];
    const deductionRows = [
      ['PF', payslip.pf || 0],
      ['Professional Tax', payslip.pt || 0],
      ['TDS', payslip.tds || 0],
      ['Loan/Advance', payslip.loan || 0],
      ['', ''],
    ];

    let rowY = tableY + 24;
    for (let i = 0; i < earningRows.length; i++) {
      const bg = i % 2 === 0 ? '#fafafa' : '#fff';
      doc.rect(40, rowY, colW, 22).fillAndStroke(bg, '#e5e7eb');
      doc.rect(40 + colW, rowY, colW, 22).fillAndStroke(bg, '#e5e7eb');
      doc.fillColor('#0b0d14').fontSize(10).font('Helvetica');
      doc.text(earningRows[i][0], 50, rowY + 6);
      doc.font('Helvetica-Bold').text(`Rs. ${Number(earningRows[i][1]).toLocaleString('en-IN')}`, 40 + colW - 110, rowY + 6, { width: 100, align: 'right' });
      doc.font('Helvetica').text(deductionRows[i][0], 50 + colW, rowY + 6);
      if (deductionRows[i][1] !== '') {
        doc.font('Helvetica-Bold').text(`Rs. ${Number(deductionRows[i][1]).toLocaleString('en-IN')}`, 40 + 2 * colW - 110, rowY + 6, { width: 100, align: 'right' });
      }
      rowY += 22;
    }

    // Totals row
    doc.rect(40, rowY, colW, 28).fillAndStroke('#dcfce7', '#16a34a');
    doc.rect(40 + colW, rowY, colW, 28).fillAndStroke('#fee2e2', '#ef4444');
    doc.fillColor('#15803d').fontSize(11).font('Helvetica-Bold');
    doc.text('Total Earnings', 50, rowY + 9);
    doc.text(`Rs. ${Number(earnings).toLocaleString('en-IN')}`, 40 + colW - 110, rowY + 9, { width: 100, align: 'right' });
    doc.fillColor('#dc2626');
    doc.text('Total Deductions', 50 + colW, rowY + 9);
    doc.text(`Rs. ${Number(deductions).toLocaleString('en-IN')}`, 40 + 2 * colW - 110, rowY + 9, { width: 100, align: 'right' });

    rowY += 40;

    // Net Pay
    doc.rect(40, rowY, 515, 50).fillAndStroke('#6366f1', '#6366f1');
    doc.fillColor('#fff').fontSize(13).font('Helvetica-Bold').text('NET PAY', 60, rowY + 12);
    doc.fontSize(22).text(`Rs. ${Number(netPay).toLocaleString('en-IN')}`, 60, rowY + 12, { width: 480, align: 'right' });
    doc.fontSize(8).font('Helvetica').text(`(Rupees ${numberToWords(Number(netPay))} only)`, 60, rowY + 38);

    rowY += 65;

    // Footer
    doc.fillColor('#666').fontSize(8).font('Helvetica');
    doc.text(`Generated on ${new Date().toLocaleDateString('en-IN')} | Status: ${(payslip.status || 'draft').toUpperCase()}`, 40, rowY);
    doc.text('This is a system-generated payslip and does not require signature.', 40, rowY + 12);
    doc.fillColor('#6366f1').fontSize(9).font('Helvetica-Bold').text('Powered by Nexus TZ', 40, rowY + 30, { align: 'center', width: 515 });

    doc.end();
  } catch (e) {
    console.error('PDF gen failed:', e);
    if (!res.headersSent) err(res, e.message);
  }
};

// Simple number-to-words for INR (handles up to crores)
function numberToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { if (n < 20) return ones[n]; return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''); }
  function three(n) { return (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred ' : '') + two(n % 100); }
  num = Math.floor(Math.abs(num));
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thou = Math.floor(num / 1000); num %= 1000;
  const rest = num;
  return [crore && three(crore) + ' Crore', lakh && three(lakh) + ' Lakh', thou && three(thou) + ' Thousand', rest && three(rest)].filter(Boolean).join(' ').trim();
}

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE — undo checkout (10s window)
// ═══════════════════════════════════════════════════════════════
exports.undoCheckout = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rec = await Attendance.findOne({ user: req.user.id, date: today });
    if (!rec) return err(res, 'No attendance record found for today', 404);
    if (!rec.checkOut) return err(res, 'Session is still active — nothing to undo', 400);
    // 10-minute grace window for undo
    const checkoutAge = Date.now() - new Date(rec.checkOut).getTime();
    if (checkoutAge > 10 * 60 * 1000) return err(res, 'Undo window has expired (10 min)', 400);
    rec.checkOut = null;
    rec.totalHours = 0;
    rec.sessionActive = true;
    // restore status based on original check-in classification
    if (rec.isLate) rec.status = 'late';
    else if (rec.isEarly) rec.status = 'early';
    else rec.status = 'present';
    rec.flags = (rec.flags || []).filter(f => f !== 'early_logout' && f !== 'insufficient_hours' && f !== 'auto_ended');
    rec.autoClosed = false;
    await rec.save();
    await logAudit(req.user.id, 'UNDO_CHECKOUT', rec._id, {}, req.ip);
    ok(res, { success: true, attendance: rec, message: 'Session resumed' });
  } catch (e) { err(res, e.message); }
};

// ═══════════════════════════════════════════════════════════════
// ADMIN UTIL — wipe today's attendance (testing only)
// ═══════════════════════════════════════════════════════════════
exports.wipeTodayAttendance = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { userId } = req.body || {};
    const filter = userId ? { date: today, user: userId } : { date: today };
    const result = await Attendance.deleteMany(filter);
    await logAudit(req.user.id, 'WIPE_TODAY_ATTENDANCE', today, { count: result.deletedCount, userId: userId || 'all' }, req.ip);
    ok(res, { success: true, deleted: result.deletedCount, message: `Wiped ${result.deletedCount} record(s) for ${today}` });
  } catch (e) { err(res, e.message); }
};

// ═══════════════════════════════════════════════════════════════
// QUOTES — 3,200 file-based pool + admin custom additions + CRUD
// ═══════════════════════════════════════════════════════════════
let QUOTES_FILE = [];
try {
  QUOTES_FILE = require('../data/quotes');
  console.log(`[quotes] Loaded ${QUOTES_FILE.length} file-based quotes`);
} catch (e) {
  console.error('[quotes] Could not load quotes file:', e.message);
  QUOTES_FILE = [];
}

// Custom user-added quote model
let CustomQuote;
try {
  CustomQuote = require('../models').Quote;
} catch { }
if (!CustomQuote) {
  const mongoose = require('mongoose');
  const quoteSchema = new mongoose.Schema({
    text: { type: String, required: true, trim: true },
    author: { type: String, default: 'Anonymous', trim: true },
    category: { type: String, default: 'custom' },
    isActive: { type: Boolean, default: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }, { timestamps: true });
  CustomQuote = mongoose.models.Quote || mongoose.model('Quote', quoteSchema);
}

// Override quote for the day (admin shuffle / pick)
let DailyOverride;
{
  const mongoose = require('mongoose');
  const overrideSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true },
    text: { type: String, required: true },
    author: { type: String, default: 'Anonymous' },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }, { timestamps: true });
  DailyOverride = mongoose.models.DailyQuoteOverride || mongoose.model('DailyQuoteOverride', overrideSchema);
}

function getCombinedPool(customs) {
  return [...QUOTES_FILE, ...customs.map(c => ({ t: c.text, a: c.author }))];
}

exports.getQuoteOfDay = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    // Check if today has an override
    const override = await DailyOverride.findOne({ date: today });
    if (override) {
      return ok(res, { quote: override.text, author: override.author, day: today, overridden: true });
    }
    // Fall back to combined pool, deterministic per day
    const customs = await CustomQuote.find({ isActive: true }).select('text author -_id').lean();
    const pool = getCombinedPool(customs);
    if (!pool.length) return ok(res, { quote: 'Bismillah — let your day begin with His name.', author: 'Reminder', day: today });
    const td = new Date();
    const dayNum = Math.floor((td - new Date(td.getFullYear(), 0, 0)) / 86400000);
    const idx = (dayNum + td.getFullYear() * 7) % pool.length;
    const q = pool[idx];
    ok(res, { quote: q.t, author: q.a, day: today, poolSize: pool.length });
  } catch (e) { err(res, e.message); }
};

// Admin: shuffle to random / set specific / clear override
exports.shuffleQuote = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { quoteText, quoteAuthor, clear } = req.body || {};
    if (clear) {
      await DailyOverride.deleteOne({ date: today });
      return ok(res, { success: true, cleared: true });
    }
    let text, author;
    if (quoteText) {
      // Admin chose a specific one
      text = quoteText; author = quoteAuthor || 'Anonymous';
    } else {
      // Pick random from active pool
      const customs = await CustomQuote.find({ isActive: true }).select('text author -_id').lean();
      const pool = getCombinedPool(customs);
      if (!pool.length) return err(res, 'No quotes in pool', 400);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      text = pick.t; author = pick.a;
    }
    const override = await DailyOverride.findOneAndUpdate(
      { date: today },
      { text, author, setBy: req.user.id },
      { upsert: true, new: true }
    );
    await logAudit(req.user.id, 'SHUFFLE_QUOTE', today, { text, author }, req.ip);
    ok(res, { success: true, quote: override.text, author: override.author, day: today });
  } catch (e) { err(res, e.message); }
};

exports.getQuotes = async (req, res) => {
  try {
    const { search = '', source = 'all', page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page) || 1;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const customs = await CustomQuote.find({}).sort({ createdAt: -1 }).lean();
    let list = [];
    if (source === 'all' || source === 'custom') {
      list = list.concat(customs.map(c => ({ _id: c._id, text: c.text, author: c.author, source: 'custom', isActive: c.isActive, createdAt: c.createdAt })));
    }
    if (source === 'all' || source === 'file') {
      list = list.concat(QUOTES_FILE.map((q, i) => ({ _id: `file-${i}`, text: q.t, author: q.a, source: 'file', isActive: true, fileIndex: i })));
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(q => q.text.toLowerCase().includes(s) || (q.author || '').toLowerCase().includes(s));
    }
    const total = list.length;
    const start = (pageNum - 1) * lim;
    const paged = list.slice(start, start + lim);
    ok(res, { quotes: paged, total, page: pageNum, limit: lim, totalPages: Math.ceil(total / lim), fileCount: QUOTES_FILE.length, customCount: customs.length });
  } catch (e) { err(res, e.message); }
};

exports.createQuote = async (req, res) => {
  try {
    const { text, author } = req.body;
    if (!text || !text.trim()) return err(res, 'Text required', 400);
    const q = await CustomQuote.create({ text: text.trim(), author: (author || 'Anonymous').trim(), addedBy: req.user.id });
    await logAudit(req.user.id, 'CREATE_QUOTE', q._id, { text }, req.ip);
    ok(res, { quote: q }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateQuote = async (req, res) => {
  try {
    const { text, author, isActive } = req.body;
    const q = await CustomQuote.findByIdAndUpdate(req.params.id,
      { ...(text && { text: text.trim() }), ...(author !== undefined && { author: (author || 'Anonymous').trim() }), ...(isActive !== undefined && { isActive }) },
      { new: true });
    if (!q) return err(res, 'Quote not found', 404);
    await logAudit(req.user.id, 'UPDATE_QUOTE', q._id, {}, req.ip);
    ok(res, { quote: q });
  } catch (e) { err(res, e.message); }
};

exports.deleteQuote = async (req, res) => {
  try {
    const q = await CustomQuote.findByIdAndDelete(req.params.id);
    if (!q) return err(res, 'Quote not found', 404);
    await logAudit(req.user.id, 'DELETE_QUOTE', req.params.id, {}, req.ip);
    ok(res, { success: true });
  } catch (e) { err(res, e.message); }
};



