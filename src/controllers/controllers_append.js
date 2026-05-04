// ══════════════════════════════════════════════════════════════
// NEW CONTROLLERS — append to bottom of controllers.js
// ══════════════════════════════════════════════════════════════

const {
  Department, Shift, Task, Project, Timesheet,
  Payroll, Expense, Announcement, Leave, Organization,
} = require('../models');

// ── Departments ───────────────────────────────────────────────
exports.getDepartments   = async (req, res) => { try { const data = await Department.find().populate('head','name email'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createDepartment = async (req, res) => { try { const data = await Department.create(req.body); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateDepartment = async (req, res) => { try { const data = await Department.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteDepartment = async (req, res) => { try { await Department.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Shifts ────────────────────────────────────────────────────
exports.getShifts   = async (req, res) => { try { const data = await Shift.find().populate('assignedTo','name email'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createShift = async (req, res) => { try { const data = await Shift.create(req.body); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateShift = async (req, res) => { try { const data = await Shift.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteShift = async (req, res) => { try { await Shift.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Tasks ─────────────────────────────────────────────────────
exports.getTasks   = async (req, res) => { try { const data = await Task.find().populate('assignedTo assignedBy','name email'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createTask = async (req, res) => { try { const data = await Task.create({...req.body, assignedBy: req.user.id}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateTask = async (req, res) => { try { const data = await Task.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteTask = async (req, res) => { try { await Task.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Projects ──────────────────────────────────────────────────
exports.getProjects   = async (req, res) => { try { const data = await Project.find().populate('members manager','name email'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createProject = async (req, res) => { try { const data = await Project.create(req.body); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateProject = async (req, res) => { try { const data = await Project.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteProject = async (req, res) => { try { await Project.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Timesheets ────────────────────────────────────────────────
exports.getTimesheets   = async (req, res) => { try { const data = await Timesheet.find().populate('user','name email'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createTimesheet = async (req, res) => { try { const data = await Timesheet.create({...req.body, user: req.user.id}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateTimesheet = async (req, res) => { try { const data = await Timesheet.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteTimesheet = async (req, res) => { try { await Timesheet.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Payroll ───────────────────────────────────────────────────
exports.getPayroll    = async (req, res) => { try { const data = await Payroll.find().populate('user','name email department'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createPayroll = async (req, res) => { try { const data = await Payroll.create({...req.body, generatedBy: req.user.id}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updatePayroll = async (req, res) => { try { const data = await Payroll.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deletePayroll = async (req, res) => { try { await Payroll.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };
exports.generatePayroll = async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return err(res, 'month is required', 400);
    const users = await User.find({ isActive: true });
    const records = await Promise.all(users.map(u =>
      Payroll.findOneAndUpdate(
        { user: u._id, month },
        { user: u._id, month, basicSalary: u.salary || 0, allowances: 0, deductions: 0, tax: 0, netSalary: u.salary || 0, generatedBy: req.user.id },
        { upsert: true, new: true }
      )
    ));
    ok(res, records);
  } catch(e) { err(res, e.message); }
};

// ── Expenses ──────────────────────────────────────────────────
exports.getExpenses   = async (req, res) => { try { const q = req.user.role === 'employee' ? { user: req.user.id } : {}; const data = await Expense.find(q).populate('user','name email').sort({createdAt:-1}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createExpense = async (req, res) => { try { const data = await Expense.create({...req.body, user: req.user.id}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateExpense = async (req, res) => { try { const data = await Expense.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteExpense = async (req, res) => { try { await Expense.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Announcements ─────────────────────────────────────────────
exports.getAnnouncements   = async (req, res) => { try { const data = await Announcement.find({isActive:true}).populate('postedBy','name email').sort({createdAt:-1}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createAnnouncement = async (req, res) => { try { const data = await Announcement.create({...req.body, postedBy: req.user.id}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateAnnouncement = async (req, res) => { try { const data = await Announcement.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteAnnouncement = async (req, res) => { try { await Announcement.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Leaves ────────────────────────────────────────────────────
exports.getLeaves   = async (req, res) => { try { const q = req.user.role === 'employee' ? { user: req.user.id } : {}; const data = await Leave.find(q).populate('user reviewedBy','name email').sort({createdAt:-1}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.createLeave = async (req, res) => { try { const data = await Leave.create({...req.body, user: req.user.id}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.updateLeave = async (req, res) => { try { const data = await Leave.findByIdAndUpdate(req.params.id, req.body, {new:true}); ok(res, data); } catch(e) { err(res, e.message); } };
exports.deleteLeave = async (req, res) => { try { await Leave.findByIdAndDelete(req.params.id); ok(res, {success:true}); } catch(e) { err(res, e.message); } };

// ── Organization ──────────────────────────────────────────────
exports.getOrganization    = async (req, res) => { try { const data = await Organization.findOne() || {}; ok(res, { organization: data }); } catch(e) { err(res, e.message); } };
exports.updateOrganization = async (req, res) => { try { const data = await Organization.findOneAndUpdate({}, req.body, {upsert:true, new:true}); ok(res, { organization: data }); } catch(e) { err(res, e.message); } };

// ── Roles ─────────────────────────────────────────────────────
exports.getRoles      = async (req, res) => { try { const data = await User.find().select('name email role department position isActive'); ok(res, { users: data }); } catch(e) { err(res, e.message); } };
exports.updateUserRole = async (req, res) => { try { const data = await User.findByIdAndUpdate(req.params.userId, { role: req.body.role }, {new:true}).select('name email role'); ok(res, { user: data }); } catch(e) { err(res, e.message); } };

// ── Reports ───────────────────────────────────────────────────
exports.getReportsOverview  = async (req, res) => { try { const [users, leaves, expenses, payroll] = await Promise.all([User.countDocuments({isActive:true}), Leave.countDocuments(), Expense.countDocuments(), Payroll.countDocuments()]); ok(res, {users, leaves, expenses, payroll}); } catch(e) { err(res, e.message); } };
exports.getAttendanceReport = async (req, res) => { try { const data = await Attendance.find().populate('user','name email department'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.getPayrollReport    = async (req, res) => { try { const data = await Payroll.find().populate('user','name email department'); ok(res, data); } catch(e) { err(res, e.message); } };
exports.getTasksReport      = async (req, res) => { try { const data = await Task.find().populate('assignedTo assignedBy','name email'); ok(res, data); } catch(e) { err(res, e.message); } };
