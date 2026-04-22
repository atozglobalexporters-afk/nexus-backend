// src/models/chat.js
const mongoose = require('mongoose');

// ── Message ───────────────────────────────────────────────────
const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:         { type: String, enum: ['text','image','video','file'], default: 'text' },
  content:      { type: String, default: '' },
  fileUrl:      { type: String },
  fileName:     { type: String },
  fileSize:     { type: Number },
  edited:       { type: Boolean, default: false },
  deletedFor:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedForAll:{ type: Boolean, default: false },
  seenBy:       [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, seenAt: Date }],
}, { timestamps: true });

// ── Conversation ──────────────────────────────────────────────
const conversationSchema = new mongoose.Schema({
  type:         { type: String, enum: ['direct','group'], default: 'direct' },
  name:         { type: String },
  avatar:       { type: String },
  members:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  admins:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastMessage:  { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  lastActivity: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = {
  Message:      mongoose.model('Message',      messageSchema),
  Conversation: mongoose.model('Conversation', conversationSchema),
};
