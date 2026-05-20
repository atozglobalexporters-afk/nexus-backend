// src/routes/index.js
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uploadDir = path.join(__dirname, '../../uploads/worklogs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({ destination: (req,file,cb)=>cb(null,uploadDir), filename: (req,file,cb)=>cb(null,`${Date.now()}-${file.originalname.replace(/\s/g,'_')}`) });
const upload = multer({ storage, limits:{ fileSize: 20*1024*1024 } });
const { authenticate, authorize } = require('../middleware/auth');
const auth = require('../controllers/authController');
const c    = require('../controllers/controllers');

// ── Background job: auto-end sessions every 10 minutes ───────
// Self-registering (no external cron lib). Safe: idempotent, only acts after the auto-end threshold.
if (!global.__nexusAutoEndStarted) {
  global.__nexusAutoEndStarted = true;
  const runAutoEnd = async () => {
    try {
      // Fake req/res so we can reuse the existing handler logic
      const fakeReq = { user: { id: 'system', role: 'system' }, body: {}, ip: 'cron' };
      const fakeRes = { status: () => fakeRes, json: () => fakeRes };
      await c.autoEndSessions(fakeReq, fakeRes);
    } catch (e) { console.error('[cron auto-end]', e.message); }
  };
  // Run after a short startup delay, then every 10 minutes
  setTimeout(runAutoEnd, 30 * 1000);
  setInterval(runAutoEnd, 10 * 60 * 1000);
  console.log('[nexus] Auto-end cron registered (runs every 10 min)');
}

// ── Auth ──────────────────────────────────────────────────────
router.post('/auth/register',           auth.register);
router.post('/auth/login',              auth.login);
router.post('/auth/logout',             authenticate, auth.logout);
router.get ('/auth/me',                 authenticate, auth.me);
router.post('/auth/forgot-password',    auth.forgotPassword);
router.post('/auth/reset-password/:token', auth.resetPassword);
router.post('/auth/admin/create-employee', authenticate, authorize('admin','super_admin'), auth.createEmployee);

// ── Server time ───────────────────────────────────────────────
router.get('/time', c.getServerTime);

// ── Dashboard ─────────────────────────────────────────────────
router.get('/dashboard', authenticate, authorize('admin','super_admin'), c.getDashboard);

// ── Users ─────────────────────────────────────────────────────
router.get   ('/users',     authenticate, authorize('admin','super_admin'), c.getUsers);
router.get   ('/users/:id', authenticate, c.getUser);
router.put   ('/users/:id', authenticate, c.updateUser);
router.delete('/users/:id', authenticate, authorize('admin','super_admin'), c.deleteUser);

// ── Attendance (4-tier system) ────────────────────────────────
router.get  ('/attendance',                  authenticate, c.getAttendance);
router.post ('/attendance/login',            authenticate, c.checkIn);          // check-in with late detection
router.post ('/attendance/checkout',         authenticate, c.checkOutFull);     // check-out with status recompute
router.post ('/attendance/undo-checkout',    authenticate, c.undoCheckout);     // undo checkout within 10 min
router.get  ('/attendance/today',            authenticate, c.getTodayStatus);   // live working status + hours
router.get  ('/attendance/summary',          authenticate, c.getAttendanceSummary);
router.get  ('/attendance/monthly',          authenticate, c.getMonthlyAttendance);
router.post ('/attendance/admin-override',   authenticate, authorize('admin','super_admin'), c.adminOverride);
router.post ('/attendance/correction',       authenticate, c.requestCorrection);
router.put  ('/attendance/correction/:id',   authenticate, authorize('admin','super_admin'), c.reviewCorrection);
router.get  ('/attendance/corrections',      authenticate, authorize('admin','super_admin'), c.getPendingCorrections);
router.post ('/attendance/auto-mark-absent', authenticate, authorize('admin','super_admin'), c.autoMarkAbsent);
router.post ('/attendance/auto-end',         authenticate, authorize('admin','super_admin'), c.autoEndSessions);
router.post ('/attendance/wipe-today',        authenticate, authorize('admin','super_admin'), c.wipeTodayAttendance);

router.post ('/attendance/break/start',    authenticate, c.startBreak);
router.post ('/attendance/break/end',      authenticate, c.endBreak);
router.post ('/attendance/break/undo',     authenticate, c.undoBreak);
router.get  ('/attendance/breaks',         authenticate, c.getBreaks);
router.put  ('/attendance/breaks/:id/review', authenticate, authorize('super_admin'), c.reviewBreak);
router.get  ('/holidays',                    authenticate, c.getHolidays);
router.post ('/holidays',                    authenticate, authorize('admin','super_admin'), c.createHoliday);
router.delete('/holidays/:id',               authenticate, authorize('admin','super_admin'), c.deleteHoliday);

// ── Work Logs ─────────────────────────────────────────────────
router.get   ('/worklogs',          authenticate, c.getWorkLogs);
router.post  ('/worklogs',          authenticate, upload.array('files', 5), c.createWorkLog);
router.delete('/worklogs/:id',      authenticate, c.deleteWorkLog);
router.put   ('/worklogs/:id',      authenticate, c.updateWorkLog);
router.get   ('/worklogs/download/:filename', authenticate, c.downloadWorkLogFile);

// ── Salary ────────────────────────────────────────────────────
router.get ('/salaries',     authenticate, c.getSalaries);
router.post('/salaries',     authenticate, authorize('admin','super_admin'), c.createSalary);
router.put ('/salaries/:id', authenticate, authorize('admin','super_admin'), c.updateSalary);

// ── Payslips ──────────────────────────────────────────────────
router.get   ('/payslips',                authenticate, c.getPayslips);
router.post  ('/payslips',                authenticate, authorize('admin','super_admin'), c.createPayslip);
router.put   ('/payslips/:id',            authenticate, authorize('admin','super_admin'), c.updatePayslip);
router.delete('/payslips/:id',            authenticate, authorize('admin','super_admin'), c.deletePayslip);
router.post  ('/payslips/:id/query',      authenticate, c.queryPayslip);
router.post  ('/payslips/:id/reply',      authenticate, authorize('admin','super_admin'), c.replyPayslipQuery);
router.get   ('/payslips/:id/pdf',        authenticate, c.downloadPayslipPDF);

// ── Quote of the Day ──────────────────────────────────────────
router.get   ('/quote',           authenticate, c.getQuoteOfDay);
router.post  ('/quote/shuffle',   authenticate, authorize('admin','super_admin'), c.shuffleQuote);
router.get   ('/quotes',          authenticate, c.getQuotes);
router.post  ('/quotes',          authenticate, authorize('admin','super_admin'), c.createQuote);
router.put   ('/quotes/:id',      authenticate, authorize('admin','super_admin'), c.updateQuote);
router.delete('/quotes/:id',      authenticate, authorize('admin','super_admin'), c.deleteQuote);

// ── Company ───────────────────────────────────────────────────
router.get('/company',    authenticate, c.getCompany);
router.put('/company',    authenticate, authorize('admin','super_admin'), c.updateCompany);

// ── Buyers ────────────────────────────────────────────────────
router.get   ('/buyers',     authenticate, c.getBuyers);
router.post  ('/buyers',     authenticate, authorize('admin','super_admin'), c.createBuyer);
router.put   ('/buyers/:id', authenticate, authorize('admin','super_admin'), c.updateBuyer);
router.delete('/buyers/:id', authenticate, authorize('admin','super_admin'), c.deleteBuyer);

// ── Orders ────────────────────────────────────────────────────
router.get ('/orders',     authenticate, c.getOrders);
router.post('/orders',     authenticate, authorize('admin','super_admin'), c.createOrder);
router.put ('/orders/:id', authenticate, authorize('admin','super_admin'), c.updateOrder);

// ── Audit ─────────────────────────────────────────────────────
router.get('/audit', authenticate, authorize('admin','super_admin'), c.getAuditLogs);

// ── Notifications ─────────────────────────────────────────────
router.get ('/notifications',           authenticate, c.getNotifications);
router.post('/notifications/mark-read', authenticate, c.markNotificationsRead);

// -- Departments -----------------------------------------------
router.get   ('/departments',     authenticate, c.getDepartments);
router.post  ('/departments',     authenticate, authorize('admin','super_admin'), c.createDepartment);
router.put   ('/departments/:id', authenticate, authorize('admin','super_admin'), c.updateDepartment);
router.delete('/departments/:id', authenticate, authorize('admin','super_admin'), c.deleteDepartment);

// -- Shifts ----------------------------------------------------
router.get   ('/shifts',     authenticate, c.getShifts);
router.post  ('/shifts',     authenticate, authorize('admin','super_admin'), c.createShift);
router.put   ('/shifts/:id', authenticate, authorize('admin','super_admin'), c.updateShift);
router.delete('/shifts/:id', authenticate, authorize('admin','super_admin'), c.deleteShift);

// -- Tasks -----------------------------------------------------
router.get   ('/tasks',     authenticate, c.getTasks);
router.post  ('/tasks',     authenticate, authorize('admin','super_admin'), c.createTask);
router.put   ('/tasks/:id', authenticate, c.updateTask);
router.delete('/tasks/:id', authenticate, authorize('admin','super_admin'), c.deleteTask);

// -- Projects --------------------------------------------------
router.get   ('/projects',     authenticate, c.getProjects);
router.post  ('/projects',     authenticate, authorize('admin','super_admin'), c.createProject);
router.put   ('/projects/:id', authenticate, c.updateProject);
router.delete('/projects/:id', authenticate, authorize('admin','super_admin'), c.deleteProject);

// -- Timesheets ------------------------------------------------
router.get   ('/timesheets',     authenticate, c.getTimesheets);
router.post  ('/timesheets',     authenticate, c.createTimesheet);
router.put   ('/timesheets/:id', authenticate, c.updateTimesheet);
router.delete('/timesheets/:id', authenticate, authorize('admin','super_admin'), c.deleteTimesheet);

// -- Payroll ---------------------------------------------------
router.get   ('/payroll',          authenticate, authorize('admin','super_admin'), c.getPayroll);
router.post  ('/payroll',          authenticate, authorize('admin','super_admin'), c.createPayroll);
router.post  ('/payroll/generate', authenticate, authorize('admin','super_admin'), c.generatePayroll);
router.put   ('/payroll/:id',      authenticate, authorize('admin','super_admin'), c.updatePayroll);
router.delete('/payroll/:id',      authenticate, authorize('admin','super_admin'), c.deletePayroll);

// -- Expenses --------------------------------------------------
router.get   ('/expenses',     authenticate, c.getExpenses);
router.post  ('/expenses',     authenticate, c.createExpense);
router.put   ('/expenses/:id', authenticate, c.updateExpense);
router.delete('/expenses/:id', authenticate, c.deleteExpense);

// -- Announcements ---------------------------------------------
router.get   ('/announcements',     authenticate, c.getAnnouncements);
router.post  ('/announcements',     authenticate, authorize('admin','super_admin'), c.createAnnouncement);
router.put   ('/announcements/:id', authenticate, authorize('admin','super_admin'), c.updateAnnouncement);
router.delete('/announcements/:id', authenticate, authorize('admin','super_admin'), c.deleteAnnouncement);

// -- Leaves ----------------------------------------------------
router.get   ('/leaves',     authenticate, c.getLeaves);
router.post  ('/leaves',     authenticate, c.createLeave);
router.put   ('/leaves/:id', authenticate, c.updateLeave);
router.delete('/leaves/:id', authenticate, c.deleteLeave);

// -- Organization ----------------------------------------------
router.get('/organization', authenticate, c.getOrganization);
router.put('/organization', authenticate, authorize('admin','super_admin'), c.updateOrganization);

// -- Roles & Permissions ---------------------------------------
router.get('/roles',         authenticate, authorize('admin','super_admin'), c.getRoles);
router.put('/roles/:userId', authenticate, authorize('admin','super_admin'), c.updateUserRole);

// -- Reports ---------------------------------------------------
router.get('/reports/overview',   authenticate, authorize('admin','super_admin'), c.getReportsOverview);
router.get('/reports/attendance', authenticate, authorize('admin','super_admin'), c.getAttendanceReport);
router.get('/reports/payroll',    authenticate, authorize('admin','super_admin'), c.getPayrollReport);
router.get('/reports/tasks',      authenticate, authorize('admin','super_admin'), c.getTasksReport);

// -- Kanban: column moves, subtasks, comments -----------------
router.patch('/tasks/:id/column', authenticate, async (req, res) => {
  try {
    const { Task } = require('../models');
    const { column } = req.body;
    if (!['backlog', 'in_progress', 'review', 'done'].includes(column)) {
      return res.status(400).json({ success: false, message: 'Invalid column' });
    }
    const statusMap = { backlog: 'pending', in_progress: 'in_progress', review: 'in_progress', done: 'completed' };
    const task = await Task.findByIdAndUpdate(
      req.params.id, { column, status: statusMap[column] }, { new: true }
    ).populate('assignedTo assignedBy', 'name email role');
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/tasks/:id/subtasks', authenticate, async (req, res) => {
  try {
    const { Task } = require('../models');
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Title required' });
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    task.subtasks.push({ title: title.trim(), done: false });
    await task.save();
    await task.populate('assignedTo assignedBy', 'name email role');
    res.json({ success: true, data: task });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/tasks/:id/subtasks/:subId', authenticate, async (req, res) => {
  try {
    const { Task } = require('../models');
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const sub = task.subtasks.id(req.params.subId);
    if (!sub) return res.status(404).json({ success: false, message: 'Subtask not found' });
    if ('done' in req.body) sub.done = !!req.body.done;
    if ('title' in req.body && req.body.title) sub.title = req.body.title;
    await task.save();
    await task.populate('assignedTo assignedBy', 'name email role');
    res.json({ success: true, data: task });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/tasks/:id/subtasks/:subId', authenticate, async (req, res) => {
  try {
    const { Task } = require('../models');
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    task.subtasks.pull({ _id: req.params.subId });
    await task.save();
    await task.populate('assignedTo assignedBy', 'name email role');
    res.json({ success: true, data: task });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/tasks/:id/comments', authenticate, async (req, res) => {
  try {
    const { Task } = require('../models');
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'Text required' });
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    task.comments.push({ user: req.user._id, userName: req.user.name || '', text: text.trim() });
    await task.save();
    await task.populate('assignedTo assignedBy', 'name email role');
    res.json({ success: true, data: task });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/tasks/:id/comments/:commentId', authenticate, async (req, res) => {
  try {
    const { Task } = require('../models');
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const comment = task.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });
    const isOwner = comment.user && comment.user.toString() === req.user._id.toString();
    const isAdminRole = ['admin', 'super_admin'].includes(req.user.role);
    if (!isOwner && !isAdminRole) return res.status(403).json({ success: false, message: 'Not authorized' });
    task.comments.pull({ _id: req.params.commentId });
    await task.save();
    await task.populate('assignedTo assignedBy', 'name email role');
    res.json({ success: true, data: task });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
