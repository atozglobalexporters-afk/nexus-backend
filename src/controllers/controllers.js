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
    startHour:    company?.officeStartHour    ?? parseInt(process.env.OFFICE_START_HOUR    || '9'),
    startMinute:  company?.officeStartMinute  ?? parseInt(process.env.OFFICE_START_MINUTE  || '0'),
    endHour:      company?.officeEndHour      ?? parseInt(process.env.OFFICE_END_HOUR      || '18'),
    endMinute:    company?.officeEndMinute    ?? parseInt(process.env.OFFICE_END_MINUTE    || '0'),
    gracePeriod:  company?.gracePeriodMinutes ?? parseInt(process.env.GRACE_PERIOD_MINUTES || '15'),
    minHours:     company?.minWorkingHours    ?? parseFloat(process.env.MIN_WORKING_HOURS  || '7'),
    halfDayHours: company?.halfDayHours       ?? parseFloat(process.env.HALF_DAY_HOURS     || '4'),
    autoEndHour:  company?.autoEndHour        ?? parseInt(process.env.AUTO_END_HOUR        || '23'),
    autoEndMinute:company?.autoEndMinute      ?? parseInt(process.env.AUTO_END_MINUTE      || '59'),
  };
}

function computeStatus(checkIn, checkOut, settings) {
  const { startHour, startMinute, endHour, endMinute, gracePeriod, minHours, halfDayHours } = settings;
  const sessionStart = new Date(checkIn);
  sessionStart.setHours(startHour, startMinute, 0, 0);
  const sessionEnd = new Date(checkIn);
  sessionEnd.setHours(endHour, endMinute, 0, 0);
  const totalMins = startMinute + gracePeriod;
  const cutoff    = new Date(checkIn);
  cutoff.setHours(startHour + Math.floor(totalMins / 60), totalMins % 60, 0, 0);
  const flags = [];
  if (new Date(checkIn) > cutoff) flags.push('late');
  if (checkOut && new Date(checkOut) < sessionEnd) flags.push('early_logout');
  const totalHours = checkOut
    ? parseFloat(((new Date(checkOut) - new Date(checkIn)) / 3600000).toFixed(2))
    : 0;
  let status = 'present';
  if (totalHours < halfDayHours) { status = 'absent'; flags.push('insufficient_hours'); }
  else if (totalHours < minHours) { status = 'half_day'; flags.push('insufficient_hours'); }
  else if (flags.includes('late')) { status = 'late'; }
  return { flags, status, totalHours };
}

exports.checkIn = async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const existing = await Attendance.findOne({ user: req.user.id, date: today });
    if (existing) {
      if (existing.sessionActive) return res.status(400).json({ success: false, message: 'Already checked in.' });
      if (existing.checkOut)      return res.status(400).json({ success: false, message: 'Session already completed for today.' });
    }
    const settings   = await getSessionSettings();
    const now        = new Date();
    const totalMins  = settings.startMinute + settings.gracePeriod;
    const cutoff     = new Date(now);
    cutoff.setHours(settings.startHour + Math.floor(totalMins / 60), totalMins % 60, 0, 0);
    const isLate     = now > cutoff;
    const lateMinutes = isLate ? Math.floor((now - new Date(now).setHours(settings.startHour, settings.startMinute, 0, 0)) / 60000) : 0;
    const flags      = isLate ? ['late'] : [];
    const status     = isLate ? 'late' : 'present';
    let att;
    if (existing) {
      att = await Attendance.findByIdAndUpdate(existing._id, { checkIn: now, sessionActive: true, status, flags, isLate, lateMinutes, checkOut: null, totalHours: 0 }, { new: true });
    } else {
      att = await Attendance.create({ user: req.user.id, date: today, checkIn: now, sessionActive: true, status, flags, isLate, lateMinutes, ipAddress: req.ip });
    }
    await logAudit(req.user.id, 'ATTENDANCE_CHECKIN', att._id, { time: now, isLate }, req.ip);
    if (isLate) await Notification.create({ user: req.user.id, title: 'Late Check-in', message: `You checked in ${lateMinutes} minutes late.`, type: 'warning' });
    ok(res, { success: true, attendance: att, message: isLate ? `Checked in - ${lateMinutes} min late` : 'Checked in on time' }, 201);
  } catch (e) { err(res, e.message); }
};

exports.checkOutFull = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rec   = await Attendance.findOne({ user: req.user.id, date: today });
    if (!rec) return res.status(400).json({ success: false, message: 'No check-in found.' });
    if (!rec.sessionActive && rec.checkOut) return res.status(400).json({ success: false, message: 'Session already ended.' });
    const settings = await getSessionSettings();
    const now      = new Date();
    const { flags, status, totalHours } = computeStatus(rec.checkIn, now, settings);
    rec.checkOut = now; rec.totalHours = totalHours; rec.sessionActive = false; rec.status = status; rec.flags = flags;
    await rec.save();
    await logAudit(req.user.id, 'ATTENDANCE_CHECKOUT', rec._id, { time: now, totalHours, status }, req.ip);
    if (flags.includes('early_logout')) await Notification.create({ user: req.user.id, title: 'Early Logout', message: `You left early. Total: ${totalHours}h`, type: 'warning' });
    ok(res, { success: true, attendance: rec, message: `Checked out. Total: ${totalHours}h` });
  } catch (e) { err(res, e.message); }
};

exports.getTodayStatus = async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const rec      = await Attendance.findOne({ user: req.user.id, date: today });
    const settings = await getSessionSettings();
    let liveStatus = 'not_started', liveHours = 0;
    if (rec) {
      if (rec.sessionActive && rec.checkIn) { liveStatus = 'working'; liveHours = parseFloat(((new Date() - new Date(rec.checkIn)) / 3600000).toFixed(2)); }
      else if (rec.checkOut) { liveStatus = 'completed'; liveHours = rec.totalHours; }
    }
    ok(res, { success: true, attendance: rec, liveStatus, liveHours, settings });
  } catch (e) { err(res, e.message); }
};

exports.adminOverride      = async (req, res) => { try { const { userId, date, status, checkIn, checkOut, note } = req.body; if (!userId || !date || !status) return err(res, 'userId, date and status required', 400); const settings = await getSessionSettings(); let totalHours = 0, flags = []; if (checkIn && checkOut) { const r = computeStatus(new Date(checkIn), new Date(checkOut), settings); totalHours = r.totalHours; flags = r.flags; } const att = await Attendance.findOneAndUpdate({ user: userId, date }, { user: userId, date, status, checkIn: checkIn||null, checkOut: checkOut||null, totalHours, flags, sessionActive: false, adminOverride: true, adminNote: note||'', overriddenBy: req.user.id }, { upsert: true, new: true }); await logAudit(req.user.id, 'ADMIN_OVERRIDE', att._id, { userId, date, status }, req.ip); ok(res, { success: true, attendance: att }); } catch(e) { err(res, e.message); } };
exports.requestCorrection  = async (req, res) => { try { const { date, reason, requestedCheckIn, requestedCheckOut } = req.body; if (!date || !reason) return err(res, 'date and reason required', 400); const att = await Attendance.findOne({ user: req.user.id, date }); if (!att) return err(res, 'No record found', 404); att.correctionRequest = { status: 'pending', reason, requestedCheckIn: requestedCheckIn||att.checkIn, requestedCheckOut: requestedCheckOut||att.checkOut, requestedAt: new Date() }; await att.save(); ok(res, { success: true, attendance: att }); } catch(e) { err(res, e.message); } };
exports.reviewCorrection   = async (req, res) => { try { const { action, adminNote } = req.body; if (!['approved','rejected'].includes(action)) return err(res, 'action must be approved or rejected', 400); const att = await Attendance.findById(req.params.id).populate('user','name _id'); if (!att) return err(res, 'Not found', 404); att.correctionRequest.status = action; att.correctionRequest.reviewedBy = req.user.id; att.correctionRequest.reviewedAt = new Date(); att.correctionRequest.adminNote = adminNote||''; if (action === 'approved') { const s = await getSessionSettings(); const ci = att.correctionRequest.requestedCheckIn; const co = att.correctionRequest.requestedCheckOut; att.checkIn = ci; att.checkOut = co; if (ci && co) { const r = computeStatus(ci, co, s); att.flags = r.flags; att.status = r.status; att.totalHours = r.totalHours; } att.sessionActive = false; } await att.save(); await Notification.create({ user: att.user._id, title: `Correction ${action}`, message: `Your correction for ${att.date} was ${action}.`, type: action === 'approved' ? 'success' : 'error' }); ok(res, { success: true, attendance: att }); } catch(e) { err(res, e.message); } };
exports.getPendingCorrections = async (req, res) => { try { const recs = await Attendance.find({ 'correctionRequest.status': 'pending' }).populate('user','name department').sort({ 'correctionRequest.requestedAt': -1 }); ok(res, { success: true, corrections: recs }); } catch(e) { err(res, e.message); } };
exports.autoMarkAbsent     = async (req, res) => { try { const today = new Date().toISOString().split('T')[0]; const allUsers = await User.find({ isActive: true }).select('_id'); const todayRecs = await Attendance.find({ date: today }).select('user'); const checkedIn = new Set(todayRecs.map(r => r.user.toString())); const toMark = allUsers.filter(u => !checkedIn.has(u._id.toString())); const created = []; for (const u of toMark) { const att = await Attendance.create({ user: u._id, date: today, status: 'absent', sessionActive: false, autoMarked: true }); created.push(att); await Notification.create({ user: u._id, title: 'Marked Absent', message: `You were automatically marked absent for ${today}.`, type: 'error' }); } await logAudit(req.user?.id||'system', 'AUTO_ABSENT', today, { count: created.length }, req.ip); ok(res, { success: true, count: created.length }); } catch(e) { err(res, e.message); } };
exports.autoEndSessions    = async (req, res) => { try { const today = new Date().toISOString().split('T')[0]; const settings = await getSessionSettings(); const autoEnd = new Date(); autoEnd.setHours(settings.autoEndHour, settings.autoEndMinute, 0, 0); const active = await Attendance.find({ date: today, sessionActive: true }); let count = 0; for (const rec of active) { const { flags, status, totalHours } = computeStatus(rec.checkIn, autoEnd, settings); rec.checkOut = autoEnd; rec.totalHours = totalHours; rec.sessionActive = false; rec.status = status; rec.flags = [...new Set([...(rec.flags||[]), ...flags, 'auto_ended'])]; await rec.save(); await Notification.create({ user: rec.user, title: 'Session Auto-Ended', message: `Session ended at ${settings.autoEndHour}:${String(settings.autoEndMinute).padStart(2,'0')}. Total: ${totalHours}h`, type: 'warning' }); count++; } await logAudit(req.user?.id||'system', 'AUTO_END_SESSIONS', today, { count }, req.ip); ok(res, { success: true, count }); } catch(e) { err(res, e.message); } };
