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

// ── Attendance ────────────────────────────────────────────────
router.get ('/attendance',         authenticate, c.getAttendance);
router.post('/attendance/checkout',authenticate, c.checkOut);
router.get ('/attendance/summary', authenticate, c.getAttendanceSummary);
router.get ('/attendance/monthly', authenticate, c.getMonthlyAttendance);
router.get ('/holidays',           authenticate, c.getHolidays);
router.post('/holidays',           authenticate, authorize('admin','super_admin'), c.createHoliday);
router.delete('/holidays/:id',     authenticate, authorize('admin','super_admin'), c.deleteHoliday);

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

module.exports = router;
