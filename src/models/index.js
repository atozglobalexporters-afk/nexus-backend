// src/models/index.js
const mongoose = require('mongoose');

// ── Company ───────────────────────────────────────────────────
const companySchema = new mongoose.Schema({
  name: { type: String, required: true, default: 'My Company' },
  website: { type: String, default: '' },
  logoUrl: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  // Shift definition
  officeStartHour: { type: Number, default: 9 },
  officeStartMinute: { type: Number, default: 0 },
  officeEndHour: { type: Number, default: 18 },
  officeEndMinute: { type: Number, default: 0 },
  // Tolerance windows (minutes)
  gracePeriodMinutes: { type: Number, default: 15 },        // late tolerance after shift start
  earlyWindowMinutes: { type: Number, default: 60 },        // how early before shift can check in
  halfDayCutoffMinutes: { type: Number, default: 60 },      // mins after grace → half-day on check-in
  absentCutoffMinutes: { type: Number, default: 120 },      // mins after grace → absent on check-in
  // Hour thresholds (worked hours, used at checkout)
  minWorkingHours: { type: Number, default: 7 },
  halfDayHours: { type: Number, default: 4 },
  // Auto-end (relative to shift end)
  autoEndBufferMinutes: { type: Number, default: 120 },     // mins after shift end to auto-close
  // Legacy fallback (still respected if buffer = 0)
  autoEndHour: { type: Number, default: 23 },
  autoEndMinute: { type: Number, default: 59 },
  // Hard safety cap: admin-adjustable from 1–20 hours to prevent stuck 29h sessions.
  maxSessionHours: { type: Number, default: 8, min: 1, max: 20 },
}, { timestamps: true });

// ── User ──────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8 },
  role: { type: String, enum: ['super_admin', 'admin', 'employee'], default: 'employee' },
  jobTitle: { type: String, default: '' },
  department: { type: String, default: '' },
  team: { type: String, default: '' },
  phone: { type: String, default: '' },
  avatar: { type: String, default: '' },
  salary: { type: Number, default: 0 },
  salaryStatus: { type: String, enum: ['paid', 'pending', 'due'], default: 'pending' },
  isActive: { type: Boolean, default: true },
  lastSeen: { type: Date },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },
}, { timestamps: true });

userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ── Attendance (4-tier) ───────────────────────────────────────
const attendanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  checkIn: { type: Date },
  checkOut: { type: Date },
  totalHours: { type: Number, default: 0 },
  status: { type: String, enum: ['present', 'early', 'late', 'absent', 'half_day', 'half-day', 'on_leave', 'holiday'], default: 'absent' },
  isLate: { type: Boolean, default: false },
  isEarly: { type: Boolean, default: false },
  lateMinutes: { type: Number, default: 0 },
  earlyMinutes: { type: Number, default: 0 },
  flags: [{ type: String }],
  sessionActive: { type: Boolean, default: false },
  autoMarked: { type: Boolean, default: false },
  autoClosed: { type: Boolean, default: false },
  adminOverride: { type: Boolean, default: false },
  adminNote: { type: String, default: '' },
  overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  correctionRequest: {
    status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    reason: { type: String, default: '' },
    requestedCheckIn: { type: Date },
    requestedCheckOut: { type: Date },
    requestedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    adminNote: { type: String, default: '' },
  },
  ipAddress: { type: String },
  note: { type: String },

  // Snapshot prevents old attendance from changing when shift settings change later.
  shiftSource: { type: String, enum: ['employee', 'legacy_assigned_user', 'team', 'department', 'company', 'company_legacy'], default: 'company_legacy' },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  shiftSnapshot: {
    name: { type: String, default: '' },
    startTime: { type: String, default: '' },
    endTime: { type: String, default: '' },
    gracePeriodMinutes: { type: Number, default: 15 },
    earlyWindowMinutes: { type: Number, default: 30 },
    halfDayCutoffMinutes: { type: Number, default: 105 },
    absentCutoffMinutes: { type: Number, default: 165 },
    minWorkingHours: { type: Number, default: 4 },
    halfDayHours: { type: Number, default: 2 },
    autoEndBufferMinutes: { type: Number, default: 0 },
  },

  loginStatus: { type: String, enum: ['online', 'offline'], default: 'offline' },
  sessionStartedAt: { type: Date },
  sessionEndedAt: { type: Date },
  forceClosedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  forcedLogoutReason: { type: String, enum: ['', 'max_session_exceeded', 'shift_end_reached', 'admin_force_logout'], default: '' },
}, { timestamps: true });

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, sessionActive: 1 });
attendanceSchema.index({ 'correctionRequest.status': 1 });

// ── Work Log ──────────────────────────────────────────────────
const workLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  description: { type: String, required: true },
  hoursWorked: { type: Number, default: 0 },
  tasks: [{ title: String, status: { type: String, enum: ['done', 'in-progress', 'pending'], default: 'done' } }],
  files: [{ filename: String, originalName: String, size: Number, mimetype: String, url: String }],
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approved: { type: Boolean, default: false },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ── Salary ────────────────────────────────────────────────────
const salarySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'pending', 'due'], default: 'pending' },
  paidOn: { type: Date },
  note: { type: String },
}, { timestamps: true });

// ── Buyer ─────────────────────────────────────────────────────
const buyerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  company: { type: String },
  country: { type: String, default: 'UAE' },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  notes: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// ── Order ─────────────────────────────────────────────────────
const orderSchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Buyer', required: true },
  orderNumber: { type: String, required: true, unique: true },
  product: { type: String, required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, default: 'KG' },
  price: { type: Number, required: true },
  totalValue: { type: Number },
  status: { type: String, enum: ['draft', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'draft' },
  paymentStatus: { type: String, enum: ['pending', 'partial', 'paid', 'overdue'], default: 'pending' },
  shipDate: { type: Date },
  notes: { type: String },
}, { timestamps: true });

orderSchema.pre('save', function (next) {
  if (this.quantity && this.price) this.totalValue = this.quantity * this.price;
  next();
});

// ── Audit Log ─────────────────────────────────────────────────
const auditSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  target: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
}, { timestamps: true });

auditSchema.index({ createdAt: -1 });

// ── Notification ──────────────────────────────────────────────
const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
  read: { type: Boolean, default: false },
  link: { type: String },
}, { timestamps: true });

notificationSchema.index({ user: 1, read: 1 });

// ── Holiday ───────────────────────────────────────────────────
const holidaySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['holiday', 'workday'], default: 'holiday' },
}, { timestamps: true });

// -- Department ------------------------------------------------
const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  description: { type: String, default: '' },
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const shiftSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startTime: { type: String, required: true }, // HH:mm
  endTime: { type: String, required: true },   // HH:mm
  days: [{ type: String }],

  // Backward-compatible direct user assignment. Kept so old UI/data does not break.
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // New 4-tier assignment engine. Priority is employee > team > department > company.
  scope: { type: String, enum: ['company', 'department', 'team', 'employee'], default: 'employee' },
  department: { type: String, default: '' },
  team: { type: String, default: '' },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  gracePeriodMinutes: { type: Number, default: 15 },
  earlyWindowMinutes: { type: Number, default: 30 },
  halfDayCutoffMinutes: { type: Number, default: 105 }, // 9:00 + 15 grace + 105 = 11:00
  absentCutoffMinutes: { type: Number, default: 165 },  // 9:00 + 15 grace + 165 = 12:00
  minWorkingHours: { type: Number, default: 4 },
  halfDayHours: { type: Number, default: 2 },
  autoEndBufferMinutes: { type: Number, default: 0 },

  isActive: { type: Boolean, default: true },
}, { timestamps: true });

shiftSchema.index({ scope: 1, isActive: 1 });
shiftSchema.index({ employee: 1, isActive: 1 });
shiftSchema.index({ department: 1, isActive: 1 });
shiftSchema.index({ team: 1, isActive: 1 });

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deadline: { type: Date },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'cancelled'], default: 'pending' },
  column: { type: String, enum: ['backlog', 'in_progress', 'review', 'done'], default: 'backlog' },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  subtasks: [{
    title: { type: String, required: true },
    done: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String, default: '' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], default: 'planning' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  startDate: { type: Date },
  endDate: { type: Date },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  budget: { type: Number, default: 0 },
  progress: { type: Number, default: 0, min: 0, max: 100 },
}, { timestamps: true });

const timesheetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekStart: { type: String, required: true },
  entries: [{ date: String, project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }, task: String, hours: { type: Number, default: 0 }, description: String }],
  totalHours: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'submitted', 'approved', 'rejected'], default: 'draft' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String, default: '' },
}, { timestamps: true });

const payrollSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true },
  basicSalary: { type: Number, required: true },
  allowances: { type: Number, default: 0 },
  deductions: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  netSalary: { type: Number, required: true },
  daysWorked: { type: Number, default: 0 },
  daysAbsent: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'processed', 'paid'], default: 'draft' },
  paidOn: { type: Date },
  notes: { type: String, default: '' },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const expenseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, enum: ['travel', 'food', 'accommodation', 'equipment', 'software', 'other'], default: 'other' },
  date: { type: String, required: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedOn: { type: Date },
}, { timestamps: true });

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetRole: { type: String, enum: ['all', 'admin', 'employee'], default: 'all' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const leaveSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['casual', 'sick', 'earned', 'personal', 'unpaid'], default: 'casual' },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  days: { type: Number, default: 1 },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedOn: { type: Date },
  note: { type: String, default: '' },
}, { timestamps: true });

const organizationSchema = new mongoose.Schema({
  // Primary identity — frontend uses `name`; keep `companyName` as legacy alias
  name:         { type: String, default: 'Nexus Enterprises' },
  companyName:  { type: String, default: '' },
  industry:     { type: String, default: '' },
  // Frontend sends `foundedYear`; keep `founded` for legacy
  foundedYear:  { type: String, default: '' },
  founded:      { type: String, default: '' },
  // Frontend sends `address`; keep `headquarters` for legacy
  address:      { type: String, default: '' },
  headquarters: { type: String, default: '' },
  phone:        { type: String, default: '' },
  email:        { type: String, default: '' },
  website:      { type: String, default: '' },
  description:  { type: String, default: '' },
  vision:       { type: String, default: '' },
  mission:      { type: String, default: '' },
}, { timestamps: true });

// ── Payslip ───────────────────────────────────────────────────
const payslipSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true },
  // Earnings
  basic: { type: Number, default: 0 },
  hra: { type: Number, default: 0 },
  da: { type: Number, default: 0 },
  specialAllowance: { type: Number, default: 0 },
  bonus: { type: Number, default: 0 },
  // Deductions
  pf: { type: Number, default: 0 },
  pt: { type: Number, default: 200 },
  tds: { type: Number, default: 0 },
  loan: { type: Number, default: 0 },
  // Attendance
  workingDays: { type: Number, default: 22 },
  leaveDays: { type: Number, default: 0 },
  overtimeHours: { type: Number, default: 0 },
  // Computed totals
  totalEarnings: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  netPay: { type: Number, default: 0 },
  // Lifecycle
  status: { type: String, enum: ['draft', 'queried', 'paid'], default: 'draft' },
  paidOn: { type: Date },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  query: {
    text: { type: String, default: '' },
    askedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    askedAt: { type: Date },
    reply: { type: String, default: '' },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    repliedAt: { type: Date },
    status: { type: String, enum: ['pending', 'replied'], default: 'pending' },
  },
}, { timestamps: true });

payslipSchema.index({ user: 1, month: 1, year: 1 }, { unique: true });

// ── Bank Account ──────────────────────────────────────────────
const bankAccountSchema = new mongoose.Schema({
  nickname: { type: String, required: true, trim: true },
  bankName: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  ifsc: { type: String, default: '', trim: true, uppercase: true },
  currency: { type: String, default: 'INR' },
  balance: { type: Number, default: 0 },
  openingBalance: { type: Number, default: 0 },
  openingDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  notes: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

bankAccountSchema.index({ status: 1, deletedAt: 1 });

// ── Bank Transaction ──────────────────────────────────────────
const bankTransactionSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount', required: true, index: true },
  date: { type: Date, required: true, default: Date.now },
  description: { type: String, required: true, trim: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true, min: 0 },
  category: { type: String, enum: ['Income', 'Expense', 'Transfer', 'Salary', 'Other'], default: 'Other' },
  runningBalance: { type: Number, default: 0 },
  reference: { type: String, default: '' },
  notes: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

bankTransactionSchema.index({ account: 1, date: -1 });

module.exports = {
  Company: mongoose.model('Company', companySchema),
  User: mongoose.model('User', userSchema),
  Attendance: mongoose.model('Attendance', attendanceSchema),
  WorkLog: mongoose.model('WorkLog', workLogSchema),
  Salary: mongoose.model('Salary', salarySchema),
  Buyer: mongoose.model('Buyer', buyerSchema),
  Order: mongoose.model('Order', orderSchema),
  AuditLog: mongoose.model('AuditLog', auditSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  Holiday: mongoose.model('Holiday', holidaySchema),
  Department: mongoose.model('Department', departmentSchema),
  Shift: mongoose.model('Shift', shiftSchema),
  Task: mongoose.model('Task', taskSchema),
  Project: mongoose.model('Project', projectSchema),
  Timesheet: mongoose.model('Timesheet', timesheetSchema),
  Payroll: mongoose.model('Payroll', payrollSchema),
  Expense: mongoose.model('Expense', expenseSchema),
  Announcement: mongoose.model('Announcement', announcementSchema),
  Leave: mongoose.model('Leave', leaveSchema),
  Organization: mongoose.model('Organization', organizationSchema),
  Payslip: mongoose.model('Payslip', payslipSchema),
  BankAccount: mongoose.model('BankAccount', bankAccountSchema),
  BankTransaction: mongoose.model('BankTransaction', bankTransactionSchema),
};
