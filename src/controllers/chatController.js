// src/controllers/chatController.js
const { Message, Conversation } = require('../models/chat');
const { User } = require('../models');
const path = require('path');
const fs   = require('fs');

// GET /api/chat/conversations
const getConversations = async (req, res) => {
  try {
    const convs = await Conversation.find({ members: req.user.id })
      .populate('members', 'name email avatar lastSeen')
      .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name' } })
      .sort({ lastActivity: -1 });
    res.json({ success: true, data: convs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/chat/conversations
const createConversation = async (req, res) => {
  try {
    const { memberId, memberIds, type = 'direct', name } = req.body;
    if (type === 'direct') {
      const existing = await Conversation.findOne({
        type: 'direct',
        members: { $all: [req.user.id, memberId], $size: 2 }
      }).populate('members', 'name email avatar lastSeen');
      if (existing) return res.json({ success: true, data: existing });
      const conv = await Conversation.create({ type: 'direct', members: [req.user.id, memberId] });
      await conv.populate('members', 'name email avatar lastSeen');
      return res.status(201).json({ success: true, data: conv });
    }
    // Group
    const members = [req.user.id, ...(memberIds || [])];
    const conv = await Conversation.create({ type: 'group', name, members, admins: [req.user.id] });
    await conv.populate('members', 'name email avatar lastSeen');
    res.status(201).json({ success: true, data: conv });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/chat/conversations/:id/messages
const getMessages = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const msgs = await Message.find({
      conversation: req.params.id,
      deletedFor:   { $ne: req.user.id },
      deletedForAll: false
    })
      .populate('sender', 'name avatar')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    res.json({ success: true, data: msgs.reverse() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/chat/conversations/:id/messages
const sendMessage = async (req, res) => {
  try {
    const { content, type = 'text', fileUrl, fileName, fileSize } = req.body;
    const msg = await Message.create({
      conversation: req.params.id,
      sender: req.user.id,
      type, content, fileUrl, fileName, fileSize
    });
    await msg.populate('sender', 'name avatar');
    await Conversation.findByIdAndUpdate(req.params.id, {
      lastMessage: msg._id,
      lastActivity: new Date()
    });
    // Emit via socket
    const io = req.app.get('io');
    if (io) io.to(req.params.id).emit('message:new', msg);
    res.status(201).json({ success: true, data: msg });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT /api/chat/messages/:id
const editMessage = async (req, res) => {
  try {
    const msg = await Message.findOneAndUpdate(
      { _id: req.params.id, sender: req.user.id },
      { content: req.body.content, edited: true },
      { new: true }
    ).populate('sender', 'name avatar');
    if (!msg) return res.status(404).json({ success: false, message: 'Not found' });
    const io = req.app.get('io');
    if (io) io.to(msg.conversation.toString()).emit('message:edited', msg);
    res.json({ success: true, data: msg });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// DELETE /api/chat/messages/:id
const deleteMessage = async (req, res) => {
  try {
    const { forEveryone = false } = req.body;
    const msg = await Message.findOne({ _id: req.params.id, sender: req.user.id });
    if (!msg) return res.status(404).json({ success: false, message: 'Not found' });
    if (forEveryone) {
      msg.deletedForAll = true; msg.content = '';
    } else {
      msg.deletedFor.push(req.user.id);
    }
    await msg.save();
    const io = req.app.get('io');
    if (io) io.to(msg.conversation.toString()).emit('message:deleted', { msgId: msg._id, forEveryone });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/chat/messages/:id/seen
const markSeen = async (req, res) => {
  try {
    await Message.updateMany(
      { conversation: req.params.id, 'seenBy.user': { $ne: req.user.id }, sender: { $ne: req.user.id } },
      { $push: { seenBy: { user: req.user.id, seenAt: new Date() } } }
    );
    const io = req.app.get('io');
    if (io) io.to(req.params.id).emit('message:seen', { conversationId: req.params.id, userId: req.user.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/chat/upload
const uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const fileUrl = `/uploads/chat/${req.file.filename}`;
    res.json({ success: true, fileUrl, fileName: req.file.originalname, fileSize: req.file.size });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

module.exports = { getConversations, createConversation, getMessages, sendMessage, editMessage, deleteMessage, markSeen, uploadFile };
