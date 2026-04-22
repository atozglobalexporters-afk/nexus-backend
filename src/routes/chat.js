// src/routes/chat.js
const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { authenticate } = require('../middleware/auth');
const chat = require('../controllers/chatController');

// Ensure upload dir exists
const uploadDir = path.join(__dirname, '../../uploads/chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

router.get ('/conversations',                   authenticate, chat.getConversations);
router.post('/conversations',                   authenticate, chat.createConversation);
router.get ('/conversations/:id/messages',      authenticate, chat.getMessages);
router.post('/conversations/:id/messages',      authenticate, chat.sendMessage);
router.post('/conversations/:id/seen',          authenticate, chat.markSeen);
router.put ('/messages/:id',                    authenticate, chat.editMessage);
router.delete('/messages/:id',                  authenticate, chat.deleteMessage);
router.post('/upload', authenticate, upload.single('file'), chat.uploadFile);

module.exports = router;
