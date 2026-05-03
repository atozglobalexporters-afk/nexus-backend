// src/models/index.js
const mongoose = require('mongoose');

// ── Company ───────────────────────────────────────────────────
const companySchema = new mongoose.Schema({
  name:        { type: String, required: true, default: 'My Company' },
  website:     { type: String, default: '' },
  logoUrl:     { type: String, default: '' },
  email:       { type: String, default: '' },
  phone:       { type: String, default: '' },
  address:     { type: String, default: '' },
  officeStartHour:   { type: Number, default: 9 },
  officeStartMinute: { type: Number, default: 0 },
  gracePeriodMinutes:{ type: Number, default: 15 },
}, { timestamps: true });

// ── User ──────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String, required: true, minlength: 8 },
  role:         { type: String, enum: ['super_admin','admin','employee'], default: 'employee' },
  jobTitle:     { type: String, default: '' },
  department:   { type: String, default: '' },
  phone:        { type: String, default: '' },
  avatar:       { type: String, default: '' },
  salary:       { type: Number, default: 0 },
  salaryStatus: { type: String, enum: ['paid','pending','due'], default: 'pending' },
  isActive:     { type: Boolean, default: true },
  lastSeen:     { type: Date },
  resetPasswordToken:   { type: String },
  resetPasswordExpires: { type: Date },
  loginAttempts:  { type: Number, default: 0 },
  lockUntil:      { type: Date },
}, { timestamps: true });

userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ── Attendance ────────────────────────────────────────────────
const attendanceSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:        { type: String, required: true },
  checkIn:     { type: Date },
  checkOut:    { type: Date },
  totalHours:  { type: Number, default: 0 },
  status:      { type: String, enum: ['present','late','absent','half-day'], default: 'absent' },
  isLate:      { type: Boolean, default: false },
  ipAddress:   { type: String },
  note:        { type: String },
  autoClosed:  { type: Boolean, default: false },
}, { timestamps: true });

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

// ── Work Log ──────────────────────────────────────────────────
const workLogSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:        { type: String, required: true },
  description: { type: String, required: true },
  hoursWorked: { type: Number, default: 0 },
  tasks:       [{ title: String, status: { type: String, enum: ['done','in-progress','pending'], default: 'done' } }],
  files:       [{ filename: String, originalName: String, size: Number, mimetype: String, url: String }],
  approved:    { type: Boolean, default: false },
  approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ── Salary ────────────────────────────────────────────────────
const salarySchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month:       { type: String, required: true },
  amount:      { type: Number, required: true },
  status:      { type: String, enum: ['paid','pending','due'], default: 'pending' },
  paidOn:      { type: Date },
  note:        { type: String },
}, { timestamps: true });

// ── Buyer ─────────────────────────────────────────────────────
const buyerSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  company: { type: String },
  country: { type: String, default: 'UAE' },
  email:   { type: String },
  phone:   { type: String },
  address: { type: String },
  notes:   { type: String },
  isActive:{ type: Boolean, default: true },
}, { timestamps: true });

// ── Order ─────────────────────────────────────────────────────
const orderSchema = new mongoose.Schema({
  buyer:       { type: mongoose.Schema.Types.ObjectId, ref: 'Buyer', required: true },
  orderNumber: { type: String, required: true, unique: true },
  product:     { type: String, required: true },
  quantity:    { type: Number, required: true },
  unit:        { type: String, default: 'KG' },
  price:       { type: Number, required: true },
  totalValue:  { type: Number },
  status:      { type: String, enum: ['draft','confirmed','shipped','delivered','cancelled'], default: 'draft' },
  paymentStatus:{ type: String, enum: ['pending','partial','paid','overdue'], default: 'pending' },
  shipDate:    { type: Date },
  notes:       { type: String },
}, { timestamps: true });

orderSchema.pre('save', function(next) {
  if (this.quantity && this.price) this.totalValue = this.quantity * this.price;
  next();
});

// ── Audit Log ─────────────────────────────────────────────────
const auditSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action:  { type: String, required: true },
  target:  { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  ip:      { type: String },
}, { timestamps: true });

auditSchema.index({ createdAt: -1 });

// ── Notification ──────────────────────────────────────────────
const notificationSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:   { type: String, required: true },
  message: { type: String, required: true },
  type:    { type: String, enum: ['info','success','warning','error'], default: 'info' },
  read:    { type: Boolean, default: false },
  link:    { type: String },
}, { timestamps: true });

notificationSchema.index({ user: 1, read: 1 });

// ── Holiday ───────────────────────────────────────────────────
const holidaySchema = new mongoose.Schema({
  date:        { type: String, required: true, unique: true },
  name:        { type: String, required: true },
  type:        { type: String, enum: ['holiday','workday'], default: 'holiday' },
}, { timestamps: true });

module.exports = {
  Company:      mongoose.model('Company',      companySchema),
  User:         mongoose.model('User',         userSchema),
  Attendance:   mongoose.model('Attendance',   attendanceSchema),
  WorkLog:      mongoose.model('WorkLog',      workLogSchema),
  Salary:       mongoose.model('Salary',       salarySchema),
  Buyer:        mongoose.model('Buyer',        buyerSchema),
  Order:        mongoose.model('Order',        orderSchema),
  AuditLog:     mongoose.model('AuditLog',     auditSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  Holiday:      mongoose.model('Holiday',      holidaySchema),
};

// -- Department ------------------------------------------------
const departmentSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true, unique: true },
  description: { type: String, default: '' },
  head:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

const shiftSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  startTime:  { type: String, required: true },
  endTime:    { type: String, required: true },
  days:       [{ type: String }],
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive:   { type: Boolean, default: true },
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  assignedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deadline:    { type: Date },
  priority:    { type: String, enum: ['low','medium','high'], default: 'medium' },
  status:      { type: String, enum: ['pending','in_progress','completed','cancelled'], default: 'pending' },
  project:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
}, { timestamps: true });

const projectSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  status:      { type: String, enum: ['planning','active','on_hold','completed','cancelled'], default: 'planning' },
  priority:    { type: String, enum: ['low','medium','high'], default: 'medium' },
  startDate:   { type: Date },
  endDate:     { type: Date },
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  manager:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  budget:      { type: Number, default: 0 },
  progress:    { type: Number, default: 0, min: 0, max: 100 },
}, { timestamps: true });

const timesheetSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekStart:  { type: String, required: true },
  entries:    [{ date: String, project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }, task: String, hours: { type: Number, default: 0 }, description: String }],
  totalHours: { type: Number, default: 0 },
  status:     { type: String, enum: ['draft','submitted','approved','rejected'], default: 'draft' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const payrollSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month:       { type: String, required: true },
  basicSalary: { type: Number, required: true },
  allowances:  { type: Number, default: 0 },
  deductions:  { type: Number, default: 0 },
  tax:         { type: Number, default: 0 },
  netSalary:   { type: Number, required: true },
  daysWorked:  { type: Number, default: 0 },
  daysAbsent:  { type: Number, default: 0 },
  status:      { type: String, enum: ['draft','processed','paid'], default: 'draft' },
  paidOn:      { type: Date },
  notes:       { type: String, default: '' },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const expenseSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true },
  amount:      { type: Number, required: true },
  category:    { type: String, enum: ['travel','food','accommodation','equipment','software','other'], default: 'other' },
  date:        { type: String, required: true },
  description: { type: String, default: '' },
  status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedOn:  { type: Date },
}, { timestamps: true });

const announcementSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  content:    { type: String, required: true },
  priority:   { type: String, enum: ['low','normal','high','urgent'], default: 'normal' },
  postedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetRole: { type: String, enum: ['all','admin','employee'], default: 'all' },
  isActive:   { type: Boolean, default: true },
}, { timestamps: true });

const leaveSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:       { type: String, enum: ['casual','sick','earned','personal','unpaid'], default: 'casual' },
  from:       { type: Date, required: true },
  to:         { type: Date, required: true },
  days:       { type: Number, default: 1 },
  reason:     { type: String, required: true },
  status:     { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedOn: { type: Date },
  note:       { type: String, default: '' },
}, { timestamps: true });

const organizationSchema = new mongoose.Schema({
  companyName:  { type: String, required: true },
  industry:     { type: String, default: '' },
  founded:      { type: String, default: '' },
  headquarters: { type: String, default: '' },
  description:  { type: String, default: '' },
  vision:       { type: String, default: '' },
  mission:      { type: String, default: '' },
}, { timestamps: true });

module.exports.Department   = mongoose.model('Department',   departmentSchema);
module.exports.Shift        = mongoose.model('Shift',        shiftSchema);
module.exports.Task         = mongoose.model('Task',         taskSchema);
module.exports.Project      = mongoose.model('Project',      projectSchema);
module.exports.Timesheet    = mongoose.model('Timesheet',    timesheetSchema);
module.exports.Payroll      = mongoose.model('Payroll',      payrollSchema);
module.exports.Expense      = mongoose.model('Expense',      expenseSchema);
module.exports.Announcement = mongoose.model('Announcement', announcementSchema);
module.exports.Leave        = mongoose.model('Leave',        leaveSchema);
module.exports.Organization = mongoose.model('Organization', organizationSchema);
