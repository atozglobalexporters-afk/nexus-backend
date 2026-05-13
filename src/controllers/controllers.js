// src/controllers/controllers.js
'use strict';

const {
  Company, User, Attendance, WorkLog, Salary, Buyer, Order,
  AuditLog, Notification, Holiday,
  Department, Shift, Task, Project, Timesheet,
  Payroll, Expense, Announcement, Leave, Organization,
} = require('../models');

const ok  = (res, data, status = 200) => res.status(status).json(data);
const err = (res, msg, status = 500) => res.status(status).json({ message: msg });

const logAudit = async (userId, action, target, details, ip) => {
  try { await AuditLog.create({ user: userId, action, target, details, ip }); } catch {}
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
    const present = todayAtt.filter(a => ['present','late'].includes(a.status)).length;
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
    const { password, ...rest } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, rest, { new: true }).select('-password');
    if (!user) return err(res, 'User not found', 404);
    await logAudit(req.user.id, 'UPDATE_USER', req.params.id, rest, req.ip);
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
    const isAdm = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const { month, year } = req.query;
    if (month && year) {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const end   = `${year}-${String(month).padStart(2,'0')}-31`;
      filter.date = { $gte: start, $lte: end };
    }
    const records = await Attendance.find(filter).populate('user','name department jobTitle').sort({ date: -1 }).limit(500);
    ok(res, { attendance: records });
  } catch (e) { err(res, e.message); }
};

exports.checkOut = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rec   = await Attendance.findOne({ user: req.user.id, date: today });
    if (!rec) return err(res, 'No check-in found for today', 400);
    if (rec.checkOut) return err(res, 'Already checked out', 400);
    const now      = new Date();
    rec.checkOut   = now;
    rec.totalHours = parseFloat(((now - rec.checkIn) / 3600000).toFixed(2));
    await rec.save();
    ok(res, { attendance: rec });
  } catch (e) { err(res, e.message); }
};

exports.getAttendanceSummary = async (req, res) => {
  try {
    const userId  = req.user.role === 'employee' ? req.user.id : (req.query.userId || req.user.id);
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
    const y = year  || new Date().getFullYear();
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const end   = `${y}-${String(m).padStart(2,'0')}-31`;
    const filter = { date: { $gte: start, $lte: end } };
    if (req.user.role === 'employee') filter.user = req.user.id;
    const records = await Attendance.find(filter).populate('user','name department');
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
    const isAdm  = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const logs   = await WorkLog.find(filter).populate('user','name department').sort({ createdAt: -1 });
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
    const log = await WorkLog.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
    const isAdm    = ['admin','super_admin'].includes(req.user.role);
    const filter   = isAdm ? {} : { user: req.user.id };
    const salaries = await Salary.find(filter).populate('user','name department jobTitle').sort({ createdAt: -1 });
    ok(res, { salaries });
  } catch (e) { err(res, e.message); }
};

exports.createSalary = async (req, res) => {
  try {
    const salary = await Salary.create(req.body);
    await salary.populate('user','name');
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
    const orders = await Order.find({}).populate('buyer','name company country').sort({ createdAt: -1 });
    ok(res, { orders });
  } catch (e) { err(res, e.message); }
};

exports.createOrder = async (req, res) => {
  try {
    const count = await Order.countDocuments();
    const body  = { ...req.body, orderNumber: req.body.orderNumber || `ORD-${String(count+1).padStart(4,'0')}` };
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
    const logs = await AuditLog.find({}).populate('user','name').sort({ createdAt: -1 }).limit(200);
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
    const departments = await Department.find({}).populate('head','name jobTitle').sort({ name: 1 });
    const users  = await User.find({ isActive: true }).select('department');
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
    const shifts = await Shift.find({}).populate('assignedTo','name department');
    ok(res, { shifts });
  } catch (e) { err(res, e.message); }
};

exports.createShift = async (req, res) => {
  try {
    const shift = await Shift.create(req.body);
    await logAudit(req.user.id, 'CREATE_SHIFT', shift._id, req.body, req.ip);
    ok(res, { shift }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateShift = async (req, res) => {
  try {
    const shift = await Shift.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!shift) return err(res, 'Not found', 404);
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
    const isAdm  = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { assignedTo: req.user.id };
    const tasks  = await Task.find(filter)
      .populate('assignedTo','name department')
      .populate('assignedBy','name')
      .populate('project','name')
      .sort({ createdAt: -1 });
    ok(res, { tasks });
  } catch (e) { err(res, e.message); }
};

exports.createTask = async (req, res) => {
  try {
    const task = await Task.create({ ...req.body, assignedBy: req.user.id });
    await task.populate('assignedTo','name');
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
      .populate('assignedTo','name')
      .populate('assignedBy','name');
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
    const isAdm   = ['admin','super_admin'].includes(req.user.role);
    const filter  = isAdm ? {} : { members: req.user.id };
    const projects = await Project.find(filter)
      .populate('members','name jobTitle')
      .populate('manager','name')
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
    const isAdm  = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const sheets = await Timesheet.find(filter)
      .populate('user','name department')
      .populate('approvedBy','name')
      .sort({ createdAt: -1 });
    ok(res, { timesheets: sheets });
  } catch (e) { err(res, e.message); }
};

exports.createTimesheet = async (req, res) => {
  try {
    const entries    = req.body.entries || [];
    const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const sheet      = await Timesheet.create({ ...req.body, user: req.user.id, totalHours });
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
    const { month } = req.query;
    const filter    = month ? { month } : {};
    const payroll   = await Payroll.find(filter)
      .populate('user','name department jobTitle')
      .populate('generatedBy','name')
      .sort({ createdAt: -1 });
    ok(res, { payroll });
  } catch (e) { err(res, e.message); }
};

exports.createPayroll = async (req, res) => {
  try {
    const net = (Number(req.body.basicSalary) + Number(req.body.allowances||0)) - (Number(req.body.deductions||0) + Number(req.body.tax||0));
    const rec = await Payroll.create({ ...req.body, netSalary: net, generatedBy: req.user.id });
    await rec.populate('user','name');
    await logAudit(req.user.id, 'CREATE_PAYROLL', rec._id, req.body, req.ip);
    ok(res, { payroll: rec }, 201);
  } catch (e) { err(res, e.message); }
};

exports.generatePayroll = async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return err(res, 'Month required (format: 2025-05)', 400);
    const users   = await User.find({ isActive: true });
    const created = [];
    for (const u of users) {
      const existing = await Payroll.findOne({ user: u._id, month });
      if (existing) continue;
      const [y, m] = month.split('-');
      const start  = `${y}-${m}-01`;
      const end    = `${y}-${m}-31`;
      const attRecs    = await Attendance.find({ user: u._id, date: { $gte: start, $lte: end } });
      const daysWorked = attRecs.filter(a => ['present','late'].includes(a.status)).length;
      const daysAbsent = attRecs.filter(a => a.status === 'absent').length;
      const basic      = u.salary || 0;
      const rec = await Payroll.create({
        user: u._id, month, basicSalary: basic, allowances: 0,
        deductions: 0, tax: 0, netSalary: basic,
        daysWorked, daysAbsent, status: 'draft', generatedBy: req.user.id,
      });
      created.push(rec);
    }
    await logAudit(req.user.id, 'GENERATE_PAYROLL', month, { count: created.length }, req.ip);
    ok(res, { message: `Generated payroll for ${created.length} employees`, payroll: created });
  } catch (e) { err(res, e.message); }
};

exports.updatePayroll = async (req, res) => {
  try {
    if (req.body.status === 'paid') req.body.paidOn = new Date();
    const rec = await Payroll.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('user','name');
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
    const isAdm    = ['admin','super_admin'].includes(req.user.role);
    const filter   = isAdm ? {} : { user: req.user.id };
    const expenses = await Expense.find(filter)
      .populate('user','name department')
      .populate('approvedBy','name')
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
      .populate('postedBy','name jobTitle')
      .sort({ createdAt: -1 });
    ok(res, { announcements });
  } catch (e) { err(res, e.message); }
};

exports.createAnnouncement = async (req, res) => {
  try {
    const ann = await Announcement.create({ ...req.body, postedBy: req.user.id });
    await ann.populate('postedBy','name');
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
    const isAdm  = ['admin','super_admin'].includes(req.user.role);
    const filter = isAdm ? {} : { user: req.user.id };
    const leaves = await Leave.find(filter)
      .populate('user','name department jobTitle')
      .populate('reviewedBy','name')
      .sort({ createdAt: -1 });
    ok(res, { leaves });
  } catch (e) { err(res, e.message); }
};

exports.createLeave = async (req, res) => {
  try {
    const from  = new Date(req.body.from);
    const to    = new Date(req.body.to);
    const days  = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
    const leave = await Leave.create({ ...req.body, user: req.user.id, days });
    await leave.populate('user','name');
    await logAudit(req.user.id, 'CREATE_LEAVE', leave._id, req.body, req.ip);
    ok(res, { leave }, 201);
  } catch (e) { err(res, e.message); }
};

exports.updateLeave = async (req, res) => {
  try {
    if (req.body.status && ['approved','rejected'].includes(req.body.status)) {
      req.body.reviewedBy = req.user.id;
      req.body.reviewedOn = new Date();
    }
    const leave = await Leave.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('user','name')
      .populate('reviewedBy','name');
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
    if (!['admin','employee','super_admin'].includes(role)) return err(res, 'Invalid role', 400);
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
    const y = year  || new Date().getFullYear();
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const end   = `${y}-${String(m).padStart(2,'0')}-31`;
    const records = await Attendance.find({ date: { $gte: start, $lte: end } }).populate('user','name department');
    const summary = {
      present:  records.filter(r => r.status === 'present').length,
      late:     records.filter(r => r.status === 'late').length,
      absent:   records.filter(r => r.status === 'absent').length,
      halfDay:  records.filter(r => r.status === 'half-day').length,
      totalHours: records.reduce((s, r) => s + (r.totalHours || 0), 0),
    };
    ok(res, { records, summary });
  } catch (e) { err(res, e.message); }
};

exports.getPayrollReport = async (req, res) => {
  try {
    const { month } = req.query;
    const filter    = month ? { month } : {};
    const records   = await Payroll.find(filter).populate('user','name department');
    const total     = records.reduce((s, r) => s + r.netSalary, 0);
    const paid      = records.filter(r => r.status === 'paid').reduce((s, r) => s + r.netSalary, 0);
    const pending   = records.filter(r => r.status !== 'paid').reduce((s, r) => s + r.netSalary, 0);
    ok(res, { records, totalPayroll: total, paid, pending });
  } catch (e) { err(res, e.message); }
};

exports.getTasksReport = async (req, res) => {
  try {
    const tasks = await Task.find({}).populate('assignedTo','name department');
    const summary = {
      total:       tasks.length,
      pending:     tasks.filter(t => t.status === 'pending').length,
      inProgress:  tasks.filter(t => t.status === 'in_progress').length,
      completed:   tasks.filter(t => t.status === 'completed').length,
      cancelled:   tasks.filter(t => t.status === 'cancelled').length,
      highPriority: tasks.filter(t => t.priority === 'high').length,
    };
    ok(res, { tasks, summary });
  } catch (e) { err(res, e.message); }
};

// ── Session helpers ───────────────────────────────────────────
async function getSessionSettings() {
  const company = await Company.findOne();
  return {
    startHour:           company?.officeStartHour      ?? parseInt(process.env.OFFICE_START_HOUR     || '9'),
    startMinute:         company?.officeStartMinute    ?? parseInt(process.env.OFFICE_START_MINUTE   || '0'),
    endHour:             company?.officeEndHour        ?? parseInt(process.env.OFFICE_END_HOUR       || '18'),
    endMinute:           company?.officeEndMinute      ?? parseInt(process.env.OFFICE_END_MINUTE     || '0'),
    gracePeriod:         company?.gracePeriodMinutes   ?? parseInt(process.env.GRACE_PERIOD_MINUTES  || '15'),
    earlyWindow:         company?.earlyWindowMinutes   ?? parseInt(process.env.EARLY_WINDOW_MINUTES  || '60'),
    halfDayCutoffMins:   company?.halfDayCutoffMinutes ?? parseInt(process.env.HALFDAY_CUTOFF_MINUTES|| '60'),
    absentCutoffMins:    company?.absentCutoffMinutes  ?? parseInt(process.env.ABSENT_CUTOFF_MINUTES || '120'),
    minHours:            company?.minWorkingHours      ?? parseFloat(process.env.MIN_WORKING_HOURS   || '7'),
    halfDayHours:        company?.halfDayHours         ?? parseFloat(process.env.HALF_DAY_HOURS      || '4'),
    autoEndBufferMins:   company?.autoEndBufferMinutes ?? parseInt(process.env.AUTO_END_BUFFER_MIN   || '120'),
    autoEndHour:         company?.autoEndHour          ?? parseInt(process.env.AUTO_END_HOUR         || '23'),
    autoEndMinute:       company?.autoEndMinute        ?? parseInt(process.env.AUTO_END_MINUTE       || '59'),
  };
}

// Returns { shiftStart, shiftEnd, graceCutoff, halfDayCutoff, absentCutoff, earlyOpen, autoEnd } as Date objects for the supplied reference day.
function buildShiftWindows(refDate, settings) {
  const d = new Date(refDate);
  const shiftStart = new Date(d); shiftStart.setHours(settings.startHour, settings.startMinute, 0, 0);
  const shiftEnd   = new Date(d); shiftEnd.setHours(settings.endHour, settings.endMinute, 0, 0);
  // if shift end <= start, it wraps overnight — push to next day
  if (shiftEnd <= shiftStart) shiftEnd.setDate(shiftEnd.getDate() + 1);
  const graceCutoff   = new Date(shiftStart.getTime() + settings.gracePeriod * 60000);
  const halfDayCutoff = new Date(graceCutoff.getTime() + settings.halfDayCutoffMins * 60000);
  const absentCutoff  = new Date(graceCutoff.getTime() + settings.absentCutoffMins * 60000);
  const earlyOpen     = new Date(shiftStart.getTime() - settings.earlyWindow * 60000);
  // Auto-end = shift end + buffer (preferred). If buffer = 0, fallback to autoEndHour:autoEndMinute.
  let autoEnd;
  if (settings.autoEndBufferMins > 0) {
    autoEnd = new Date(shiftEnd.getTime() + settings.autoEndBufferMins * 60000);
  } else {
    autoEnd = new Date(d); autoEnd.setHours(settings.autoEndHour, settings.autoEndMinute, 0, 0);
    if (autoEnd < shiftStart) autoEnd.setDate(autoEnd.getDate() + 1);
  }
  return { shiftStart, shiftEnd, graceCutoff, halfDayCutoff, absentCutoff, earlyOpen, autoEnd };
}

// Determine initial status from CHECK-IN time alone (no hours-worked downgrade yet).
// Used at the moment of check-in to decide if the click is even allowed and what status to seed.
function classifyCheckIn(checkInTime, settings) {
  const t = new Date(checkInTime);
  const w = buildShiftWindows(t, settings);
  const flags = [];
  let status, isEarly = false, isLate = false, earlyMinutes = 0, lateMinutes = 0;

  if (t < w.earlyOpen) {
    return { allowed: false, reason: 'too_early', flags: ['too_early'], status: null, message: `Too early — check-in window opens at ${fmtTime(w.earlyOpen)}.` };
  }
  if (t < w.shiftStart) {
    isEarly = true;
    earlyMinutes = Math.round((w.shiftStart - t) / 60000);
    status = 'early';
    flags.push('early_checkin');
  } else if (t <= w.graceCutoff) {
    status = 'present';
  } else if (t <= w.halfDayCutoff) {
    isLate = true;
    lateMinutes = Math.round((t - w.shiftStart) / 60000);
    status = 'late';
    flags.push('late');
  } else if (t <= w.absentCutoff) {
    isLate = true;
    lateMinutes = Math.round((t - w.shiftStart) / 60000);
    status = 'half_day';
    flags.push('late', 'late_arrival_half_day');
  } else {
    // Past absent cutoff — block. Admin must use override.
    return { allowed: false, reason: 'past_absent_cutoff', flags: ['too_late'], status: 'absent', message: `Too late — you are past the absent cutoff (${fmtTime(w.absentCutoff)}). Contact admin for an override.` };
  }
  return { allowed: true, status, flags, isEarly, isLate, earlyMinutes, lateMinutes, windows: w };
}

function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Re-evaluate at CHECK-OUT: hours worked may downgrade status (e.g. half_day if < 4 hrs even if Present at check-in).
function computeStatus(checkIn, checkOut, settings, checkInClass) {
  const w = buildShiftWindows(checkIn, settings);
  const flags = [...(checkInClass?.flags || [])];
  if (checkOut && new Date(checkOut) < w.shiftEnd) flags.push('early_logout');
  const totalHours = checkOut
    ? parseFloat(((new Date(checkOut) - new Date(checkIn)) / 3600000).toFixed(2))
    : 0;

  let status = checkInClass?.status || 'present';

  // Hours-worked downgrade (only ever moves the status WORSE, never better)
  if (totalHours < settings.halfDayHours) {
    status = 'absent';
    if (!flags.includes('insufficient_hours')) flags.push('insufficient_hours');
  } else if (totalHours < settings.minHours) {
    // half_day unless already absent
    if (status !== 'absent') status = 'half_day';
    if (!flags.includes('insufficient_hours')) flags.push('insufficient_hours');
  }
  // If check-in put us at half_day or worse, never upgrade back to present/early/late
  return { flags: [...new Set(flags)], status, totalHours };
}

exports.checkIn = async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const existing = await Attendance.findOne({ user: req.user.id, date: today });
    if (existing) {
      // Re-login UX: if session already completed, surface the record so frontend shows "Already done today"
      if (existing.sessionActive) {
        return res.status(400).json({ success: false, code: 'ALREADY_ACTIVE', message: 'You are already checked in.', attendance: existing });
      }
      if (existing.checkOut) {
        return res.status(400).json({ success: false, code: 'ALREADY_COMPLETED', message: 'Session already completed for today.', attendance: existing });
      }
      // existing record with no checkIn (e.g. auto-marked absent) — allow new check-in to overwrite
    }
    const settings = await getSessionSettings();
    const now      = new Date();
    const cls      = classifyCheckIn(now, settings);
    if (!cls.allowed) {
      return res.status(400).json({ success: false, code: cls.reason.toUpperCase(), message: cls.message, suggestedStatus: cls.status });
    }
    const payload = {
      checkIn: now,
      sessionActive: true,
      status: cls.status,
      flags: cls.flags,
      isLate: cls.isLate,
      isEarly: cls.isEarly,
      lateMinutes: cls.lateMinutes,
      earlyMinutes: cls.earlyMinutes,
      checkOut: null,
      totalHours: 0,
      autoMarked: false,
    };
    let att;
    if (existing) {
      att = await Attendance.findByIdAndUpdate(existing._id, payload, { new: true });
    } else {
      att = await Attendance.create({ user: req.user.id, date: today, ipAddress: req.ip, ...payload });
    }
    await logAudit(req.user.id, 'ATTENDANCE_CHECKIN', att._id, { time: now, status: cls.status, isLate: cls.isLate, isEarly: cls.isEarly, lateMinutes: cls.lateMinutes }, req.ip);
    if (cls.isLate) await Notification.create({ user: req.user.id, title: 'Late Check-in', message: `You checked in ${cls.lateMinutes} minutes late. Status: ${cls.status}.`, type: 'warning' });
    else if (cls.isEarly) await Notification.create({ user: req.user.id, title: 'Early Check-in', message: `You checked in ${cls.earlyMinutes} minutes early.`, type: 'info' });
    const msg = cls.isLate ? `Checked in - ${cls.lateMinutes} min late (${cls.status})` : cls.isEarly ? `Checked in ${cls.earlyMinutes} min early` : 'Checked in on time';
    ok(res, { success: true, attendance: att, message: msg }, 201);
  } catch (e) { err(res, e.message); }
};

exports.checkOutFull = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rec   = await Attendance.findOne({ user: req.user.id, date: today });
    if (!rec) return res.status(400).json({ success: false, message: 'No check-in found.' });
    if (!rec.sessionActive && rec.checkOut) return res.status(400).json({ success: false, message: 'Session already ended.', attendance: rec });
    const settings = await getSessionSettings();
    const now      = new Date();
    // Rebuild the check-in classification from the stored fields so downgrade logic respects original status
    const checkInClass = {
      status: rec.status,
      flags: rec.flags || [],
      isLate: rec.isLate,
      isEarly: rec.isEarly,
    };
    const { flags, status, totalHours } = computeStatus(rec.checkIn, now, settings, checkInClass);
    rec.checkOut = now;
    rec.totalHours = totalHours;
    rec.sessionActive = false;
    rec.status = status;
    rec.flags = flags;
    await rec.save();
    await logAudit(req.user.id, 'ATTENDANCE_CHECKOUT', rec._id, { time: now, totalHours, status }, req.ip);
    if (flags.includes('early_logout')) await Notification.create({ user: req.user.id, title: 'Early Logout', message: `You left before shift end. Total: ${totalHours}h.`, type: 'warning' });
    if (flags.includes('insufficient_hours')) await Notification.create({ user: req.user.id, title: 'Insufficient Hours', message: `You worked ${totalHours}h. Status downgraded to ${status}.`, type: 'warning' });
    ok(res, { success: true, attendance: rec, message: `Checked out. Total: ${totalHours}h · ${status}` });
  } catch (e) { err(res, e.message); }
};

exports.getTodayStatus = async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const rec      = await Attendance.findOne({ user: req.user.id, date: today });
    const settings = await getSessionSettings();
    const now      = new Date();
    const windows  = buildShiftWindows(now, settings);
    let liveStatus = 'not_started', liveHours = 0;
    // Inform the client what the status WOULD BE if they checked in right now
    const wouldBe  = classifyCheckIn(now, settings);
    if (rec) {
      if (rec.sessionActive && rec.checkIn) {
        liveStatus = 'working';
        liveHours = parseFloat(((now - new Date(rec.checkIn)) / 3600000).toFixed(2));
      } else if (rec.checkOut) {
        liveStatus = 'completed';
        liveHours = rec.totalHours;
      }
    }
    ok(res, {
      success: true,
      attendance: rec,
      liveStatus,
      liveHours,
      settings,
      windows: {
        shiftStart: windows.shiftStart,
        shiftEnd: windows.shiftEnd,
        graceCutoff: windows.graceCutoff,
        halfDayCutoff: windows.halfDayCutoff,
        absentCutoff: windows.absentCutoff,
        earlyOpen: windows.earlyOpen,
        autoEnd: windows.autoEnd,
      },
      wouldBe: { allowed: wouldBe.allowed, status: wouldBe.status, reason: wouldBe.reason, message: wouldBe.message },
    });
  } catch (e) { err(res, e.message); }
};


exports.adminOverride      = async (req, res) => { try { const { userId, date, status, checkIn, checkOut, note } = req.body; if (!userId || !date || !status) return err(res, 'userId, date and status required', 400); const settings = await getSessionSettings(); let totalHours = 0, flags = []; if (checkIn && checkOut) { const r = computeStatus(new Date(checkIn), new Date(checkOut), settings, { status, flags: [], isLate: false, isEarly: false }); totalHours = r.totalHours; flags = r.flags; } const att = await Attendance.findOneAndUpdate({ user: userId, date }, { user: userId, date, status, checkIn: checkIn||null, checkOut: checkOut||null, totalHours, flags, sessionActive: false, adminOverride: true, adminNote: note||'', overriddenBy: req.user.id }, { upsert: true, new: true }); await logAudit(req.user.id, 'ADMIN_OVERRIDE', att._id, { userId, date, status }, req.ip); ok(res, { success: true, attendance: att }); } catch(e) { err(res, e.message); } };
exports.requestCorrection  = async (req, res) => { try { const { date, reason, requestedCheckIn, requestedCheckOut } = req.body; if (!date || !reason) return err(res, 'date and reason required', 400); const att = await Attendance.findOne({ user: req.user.id, date }); if (!att) return err(res, 'No record found', 404); att.correctionRequest = { status: 'pending', reason, requestedCheckIn: requestedCheckIn||att.checkIn, requestedCheckOut: requestedCheckOut||att.checkOut, requestedAt: new Date() }; await att.save(); ok(res, { success: true, attendance: att }); } catch(e) { err(res, e.message); } };
exports.reviewCorrection   = async (req, res) => { try { const { action, adminNote } = req.body; if (!['approved','rejected'].includes(action)) return err(res, 'action must be approved or rejected', 400); const att = await Attendance.findById(req.params.id).populate('user','name _id'); if (!att) return err(res, 'Not found', 404); att.correctionRequest.status = action; att.correctionRequest.reviewedBy = req.user.id; att.correctionRequest.reviewedAt = new Date(); att.correctionRequest.adminNote = adminNote||''; if (action === 'approved') { const s = await getSessionSettings(); const ci = att.correctionRequest.requestedCheckIn; const co = att.correctionRequest.requestedCheckOut; att.checkIn = ci; att.checkOut = co; if (ci && co) { const cls = classifyCheckIn(ci, s); const r = computeStatus(ci, co, s, { status: cls.status || 'present', flags: cls.flags || [], isLate: !!cls.isLate, isEarly: !!cls.isEarly }); att.flags = r.flags; att.status = r.status; att.totalHours = r.totalHours; att.isLate = !!cls.isLate; att.isEarly = !!cls.isEarly; att.lateMinutes = cls.lateMinutes || 0; att.earlyMinutes = cls.earlyMinutes || 0; } att.sessionActive = false; } await att.save(); await Notification.create({ user: att.user._id, title: `Correction ${action}`, message: `Your correction for ${att.date} was ${action}.`, type: action === 'approved' ? 'success' : 'error' }); ok(res, { success: true, attendance: att }); } catch(e) { err(res, e.message); } };
exports.getPendingCorrections = async (req, res) => { try { const recs = await Attendance.find({ 'correctionRequest.status': 'pending' }).populate('user','name department').sort({ 'correctionRequest.requestedAt': -1 }); ok(res, { success: true, corrections: recs }); } catch(e) { err(res, e.message); } };
exports.autoMarkAbsent     = async (req, res) => { try { const today = new Date().toISOString().split('T')[0]; const allUsers = await User.find({ isActive: true }).select('_id'); const todayRecs = await Attendance.find({ date: today }).select('user'); const checkedIn = new Set(todayRecs.map(r => r.user.toString())); const toMark = allUsers.filter(u => !checkedIn.has(u._id.toString())); const created = []; for (const u of toMark) { const att = await Attendance.create({ user: u._id, date: today, status: 'absent', sessionActive: false, autoMarked: true }); created.push(att); await Notification.create({ user: u._id, title: 'Marked Absent', message: `You were automatically marked absent for ${today}.`, type: 'error' }); } await logAudit(req.user?.id||'system', 'AUTO_ABSENT', today, { count: created.length }, req.ip); ok(res, { success: true, count: created.length }); } catch(e) { err(res, e.message); } };
exports.autoEndSessions    = async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const settings = await getSessionSettings();
    const now      = new Date();
    const windows  = buildShiftWindows(now, settings);
    // Only auto-end if we're past the auto-end threshold
    if (now < windows.autoEnd && !req.body?.force) {
      return ok(res, { success: true, count: 0, skipped: true, reason: 'before_auto_end', nextRunAt: windows.autoEnd });
    }
    const active = await Attendance.find({ date: today, sessionActive: true });
    let count = 0;
    for (const rec of active) {
      const closeAt = windows.autoEnd;
      const checkInClass = { status: rec.status, flags: rec.flags || [], isLate: rec.isLate, isEarly: rec.isEarly };
      const { flags, status, totalHours } = computeStatus(rec.checkIn, closeAt, settings, checkInClass);
      rec.checkOut = closeAt;
      rec.totalHours = totalHours;
      rec.sessionActive = false;
      rec.status = status;
      rec.autoClosed = true;
      rec.flags = [...new Set([...(rec.flags||[]), ...flags, 'auto_ended'])];
      await rec.save();
      await Notification.create({ user: rec.user, title: 'Session Auto-Ended', message: `Session auto-closed at ${fmtTime(closeAt)}. Total: ${totalHours}h · ${status}`, type: 'warning' });
      count++;
    }
    await logAudit(req.user?.id||'system', 'AUTO_END_SESSIONS', today, { count }, req.ip);
    ok(res, { success: true, count, ranAt: now });
  } catch(e) { err(res, e.message); }
};

// ═══════════════════════════════════════════════════════════════
// PAYSLIPS — full CRUD + PDF generation + employee query system
// ═══════════════════════════════════════════════════════════════
const { Payslip } = require('../models');

function computePayslipTotals(p) {
  const earnings = (Number(p.basic)||0) + (Number(p.hra)||0) + (Number(p.da)||0) + (Number(p.specialAllowance)||0) + (Number(p.bonus)||0);
  const deductions = (Number(p.pf)||0) + (Number(p.pt)||0) + (Number(p.tds)||0) + (Number(p.loan)||0);
  return { totalEarnings: earnings, totalDeductions: deductions, netPay: earnings - deductions };
}

exports.getPayslips = async (req, res) => {
  try {
    const isAdm = ['admin','super_admin'].includes(req.user.role);
    const { month, year, userId } = req.query;
    const filter = isAdm ? {} : { user: req.user.id };
    if (month) filter.month = Number(month);
    if (year)  filter.year  = Number(year);
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
    const isAdm = ['admin','super_admin'].includes(req.user.role);
    if (!isAdm && payslip.user._id.toString() !== req.user.id) return err(res, 'Not authorized', 403);

    const company = await Company.findOne({}) || { name: 'Nexus Enterprises Exporters Pvt. Ltd.' };
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthLabel = `${monthNames[(payslip.month||1)-1]} ${payslip.year}`;
    const emp = payslip.user || {};
    const totals = computePayslipTotals(payslip);
    const earnings = payslip.totalEarnings ?? totals.totalEarnings;
    const deductions = payslip.totalDeductions ?? totals.totalDeductions;
    const netPay = payslip.netPay ?? totals.netPay;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${emp.name?.replace(/\s/g,'_') || 'emp'}-${payslip.month}-${payslip.year}.pdf"`);

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
        doc.font('Helvetica-Bold').text(`Rs. ${Number(deductionRows[i][1]).toLocaleString('en-IN')}`, 40 + 2*colW - 110, rowY + 6, { width: 100, align: 'right' });
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
    doc.text(`Rs. ${Number(deductions).toLocaleString('en-IN')}`, 40 + 2*colW - 110, rowY + 9, { width: 100, align: 'right' });

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
  function two(n) { if (n < 20) return ones[n]; return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : ''); }
  function three(n) { return (n >= 100 ? ones[Math.floor(n/100)] + ' Hundred ' : '') + two(n%100); }
  num = Math.floor(Math.abs(num));
  const crore = Math.floor(num/10000000); num %= 10000000;
  const lakh  = Math.floor(num/100000);   num %= 100000;
  const thou  = Math.floor(num/1000);     num %= 1000;
  const rest  = num;
  return [crore && three(crore)+' Crore', lakh && three(lakh)+' Lakh', thou && three(thou)+' Thousand', rest && three(rest)].filter(Boolean).join(' ').trim();
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
} catch {}
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

exports.getQuoteOfDay = async (req, res) => {
  try {
    // Build combined active pool: file + custom (active)
    const customs = await CustomQuote.find({ isActive: true }).select('text author -_id').lean();
    const customMapped = customs.map(c => ({ t: c.text, a: c.author }));
    const pool = [...QUOTES_FILE, ...customMapped];
    if (!pool.length) return ok(res, { quote: 'Bismillah — let your day begin with His name.', author: 'Reminder', day: new Date().toISOString().split('T')[0] });
    // Deterministic per-day rotation
    const today = new Date();
    const dayNum = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    const idx = (dayNum + today.getFullYear() * 7) % pool.length;
    const q = pool[idx];
    ok(res, { quote: q.t, author: q.a, day: today.toISOString().split('T')[0], poolSize: pool.length });
  } catch (e) { err(res, e.message); }
};

exports.getQuotes = async (req, res) => {
  try {
    const { search = '', source = 'all', page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page) || 1;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const customs = await CustomQuote.find({}).sort({ createdAt: -1 }).lean();
    // Build unified list with source flag
    let list = [];
    if (source === 'all' || source === 'custom') {
      list = list.concat(customs.map(c => ({ _id: c._id, text: c.text, author: c.author, source: 'custom', isActive: c.isActive, createdAt: c.createdAt })));
    }
    if (source === 'all' || source === 'file') {
      list = list.concat(QUOTES_FILE.map((q, i) => ({ _id: `file-${i}`, text: q.t, author: q.a, source: 'file', isActive: true, fileIndex: i })));
    }
    // Search filter
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
