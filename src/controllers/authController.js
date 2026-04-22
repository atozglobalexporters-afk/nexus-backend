// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Company, Attendance, AuditLog, Notification } = require('../models');

const MAX_ADMINS = 3;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 30 * 60 * 1000; // 30 min

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function safeUser(user, company) {
  return {
    id:          user._id,
    name:        user.name,
    email:       user.email,
    role:        user.role,
    jobTitle:    user.jobTitle,
    department:  user.department,
    avatar:      user.avatar,
    salary:      user.salary,
    salaryStatus:user.salaryStatus,
    companyName: company?.name || '',
    companyLogo: company?.logoUrl || '',
    companyWebsite: company?.website || '',
  };
}

async function markAttendance(userId, ip) {
  const now  = new Date();
  const date = now.toISOString().split('T')[0];
  const exists = await Attendance.findOne({ user: userId, date });
  if (exists) return;
  const company = await Company.findOne();
  const startH  = company?.officeStartHour   ?? parseInt(process.env.OFFICE_START_HOUR   || '9');
  const startM  = company?.officeStartMinute ?? parseInt(process.env.OFFICE_START_MINUTE || '0');
  const grace   = company?.gracePeriodMinutes?? parseInt(process.env.GRACE_PERIOD_MINUTES|| '15');
  const cutoff  = new Date(now); cutoff.setHours(startH, startM + grace, 0, 0);
  const isLate  = now > cutoff;
  await Attendance.create({ user: userId, date, checkIn: now, status: isLate ? 'late' : 'present', isLate, ipAddress: ip });
}

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, email, password, role = 'employee', jobTitle, department } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success:false, message:'Name, email and password required' });
    if (password.length < 8) return res.status(400).json({ success:false, message:'Password must be at least 8 characters' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ success:false, message:'Email already registered' });

    const userCount = await User.countDocuments();
    let assignedRole = userCount === 0 ? 'super_admin' : (role || 'employee');
    if (['admin','super_admin'].includes(assignedRole)) {
      const adminCount = await User.countDocuments({ role: { $in: ['admin','super_admin'] } });
      if (adminCount >= MAX_ADMINS) return res.status(400).json({ success:false, message:`Maximum ${MAX_ADMINS} admins allowed` });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({ name, email: email.toLowerCase(), password: hashed, role: assignedRole, jobTitle, department });

    // First user creates company
    let company = await Company.findOne();
    if (!company) company = await Company.create({ name: 'My Company' });

    if (userCount === 0) {
      await AuditLog.create({ user: user._id, action: 'SYSTEM_SETUP', target: 'Company', details: { message: 'First admin registered' } });
    }

    await markAttendance(user._id, req.ip);
    const token = signToken(user);
    res.status(201).json({ success:true, token, user: safeUser(user, company) });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success:false, message:'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.isActive) return res.status(401).json({ success:false, message:'Invalid credentials' });

    if (user.isLocked) return res.status(423).json({ success:false, message:'Account locked. Try again in 30 minutes.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) user.lockUntil = new Date(Date.now() + LOCK_TIME);
      await user.save();
      return res.status(401).json({ success:false, message:'Invalid credentials' });
    }

    user.loginAttempts = 0; user.lockUntil = undefined; user.lastSeen = new Date();
    await user.save();

    const company = await Company.findOne();
    await markAttendance(user._id, req.ip);
    await AuditLog.create({ user: user._id, action: 'LOGIN', ip: req.ip });

    const token = signToken(user);
    res.json({ success:true, token, user: safeUser(user, company) });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const att   = await Attendance.findOne({ user: req.user.id, date: today, checkOut: null });
    if (att) {
      att.checkOut   = new Date();
      att.totalHours = parseFloat(((att.checkOut - att.checkIn) / 3600000).toFixed(2));
      await att.save();
    }
    await AuditLog.create({ user: req.user.id, action: 'LOGOUT', ip: req.ip });
    await User.findByIdAndUpdate(req.user.id, { lastSeen: new Date() });
    res.json({ success:true, message:'Logged out' });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// GET /api/auth/me
const me = async (req, res) => {
  try {
    const user    = await User.findById(req.user.id).select('-password');
    const company = await Company.findOne();
    res.json({ success:true, user: safeUser(user, company) });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// POST /api/auth/admin/create-employee (admin only)
const createEmployee = async (req, res) => {
  try {
    const { name, email, password, role = 'employee', jobTitle, department, salary } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success:false, message:'Name, email and password required' });
    if (password.length < 8) return res.status(400).json({ success:false, message:'Password min 8 chars' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ success:false, message:'Email already registered' });

    if (['admin','super_admin'].includes(role)) {
      const adminCount = await User.countDocuments({ role: { $in: ['admin','super_admin'] } });
      if (adminCount >= MAX_ADMINS) return res.status(400).json({ success:false, message:`Max ${MAX_ADMINS} admins allowed` });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({ name, email: email.toLowerCase(), password: hashed, role, jobTitle, department, salary: salary || 0 });

    await AuditLog.create({ user: req.user.id, action: 'CREATE_EMPLOYEE', target: user._id.toString(), details: { name, email, role } });

    // Notify new employee
    await Notification.create({ user: user._id, title: 'Welcome!', message: `Your account has been created. Welcome to the team, ${name}!`, type: 'success' });

    res.status(201).json({ success:true, data: { id: user._id, name: user.name, email: user.email, role: user.role, jobTitle: user.jobTitle, department: user.department } });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email?.toLowerCase() });
    if (!user) return res.json({ success:true, message:'If that email exists, a reset link was sent.' });
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken   = token;
    user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1h
    await user.save();
    // Send email (fire-and-forget)
    try {
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      await t.sendMail({ from: process.env.SMTP_USER, to: user.email, subject: 'Password Reset', text: `Reset your password: ${process.env.CLIENT_URL}/reset-password/${token}\n\nExpires in 1 hour.` });
    } catch {}
    res.json({ success:true, message:'If that email exists, a reset link was sent.' });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

// POST /api/auth/reset-password/:token
const resetPassword = async (req, res) => {
  try {
    const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ success:false, message:'Invalid or expired reset token' });
    if (!req.body.password || req.body.password.length < 8) return res.status(400).json({ success:false, message:'Password min 8 chars' });
    user.password = await bcrypt.hash(req.body.password, 12);
    user.resetPasswordToken = undefined; user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ success:true, message:'Password reset successful' });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
};

module.exports = { register, login, logout, me, createEmployee, forgotPassword, resetPassword };
