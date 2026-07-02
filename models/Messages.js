const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: String,
  receiverId: String,
  text: String,
  // 👇 BRAND NEW: Tracks if the message has been seen! 👇
  isRead: { type: Boolean, default: false }, 
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);
const Message = mongoose.model('Message', messageSchema);
module.exports = Message;