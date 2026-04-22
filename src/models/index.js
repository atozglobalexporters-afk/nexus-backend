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
};
