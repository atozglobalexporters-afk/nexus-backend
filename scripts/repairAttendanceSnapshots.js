// Run from backend root after deploy or locally:
// node scripts/repairAttendanceSnapshots.js
require('dotenv').config();
const mongoose = require('mongoose');
const { Attendance, User } = require('../src/models');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('Missing MongoDB connection string env: MONGODB_URI / MONGO_URI / DATABASE_URL');
  await mongoose.connect(uri);
  const cursor = Attendance.find({}).cursor();
  let scanned = 0, fixed = 0, missingUser = 0;
  for await (const rec of cursor) {
    scanned++;
    if (!rec.user) { missingUser++; continue; }
    const u = await User.findById(rec.user).select('name department jobTitle').lean();
    if (!u) { missingUser++; continue; }
    const next = {
      employeeNameSnapshot: rec.employeeNameSnapshot || u.name || '',
      employeeDepartmentSnapshot: rec.employeeDepartmentSnapshot || u.department || '',
      employeeJobTitleSnapshot: rec.employeeJobTitleSnapshot || u.jobTitle || '',
    };
    if (next.employeeNameSnapshot !== rec.employeeNameSnapshot || next.employeeDepartmentSnapshot !== rec.employeeDepartmentSnapshot || next.employeeJobTitleSnapshot !== rec.employeeJobTitleSnapshot) {
      await Attendance.updateOne({ _id: rec._id }, { $set: next });
      fixed++;
    }
  }
  console.log({ scanned, fixed, missingUser });
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
