// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ success:false, message:'No token' });
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.isActive) return res.status(401).json({ success:false, message:'Unauthorized' });
    req.user = { id: user._id.toString(), role: user.role, name: user.name };
    next();
  } catch { res.status(401).json({ success:false, message:'Invalid token' }); }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ success:false, message:'Forbidden' });
  next();
};

module.exports = { authenticate, authorize };
