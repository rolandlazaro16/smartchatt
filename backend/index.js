require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer setup for profile pictures
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Mongoose Models ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  profilePicture: { type: String, default: '' },
  hiddenContacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  text: String,
  mediaUrl: String,
  mediaType: String,
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});
const Message = mongoose.model('Message', messageSchema);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Successfully connected to MongoDB (smartchatt_db)'))
  .catch((err) => console.error('MongoDB connection error:', err));

// --- Auth Middleware ---
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- API Routes ---
// Register
app.post('/api/auth/register', upload.single('profilePicture'), async (req, res) => {
  try {
    const { username, password, name, phoneNumber } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : '';

    const user = new User({ username, password: hashedPassword, name, phoneNumber, profilePicture });
    await user.save();

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);

    // Notify all connected clients about the new user
    io.emit("new_user_registered", { _id: user._id, username, name, phoneNumber, profilePicture });

    res.json({ token, user: { _id: user._id, username, name, phoneNumber, profilePicture } });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
    res.json({ token, user: { _id: user._id, username, name: user.name, phoneNumber: user.phoneNumber, profilePicture: user.profilePicture } });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get Contacts (All other users not hidden)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.userId);
    if (!currentUser) return res.status(401).json({ error: 'User not found' });
    
    const hidden = currentUser.hiddenContacts || [];
    const users = await User.find({ 
      _id: { $ne: req.user.userId, $nin: hidden } 
    }).select('-password');
    res.json(users);
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Delete a contact (Hide them)
app.delete('/api/users/contacts/:contactId', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    await User.findByIdAndUpdate(req.user.userId, {
      $addToSet: { hiddenContacts: contactId }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// Delete User Account
app.delete('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    await User.findByIdAndDelete(currentUserId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Get Messages between two users
app.get('/api/messages/:contactId', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    const currentUserId = req.user.userId;

    const messages = await Message.find({
      $or: [
        { senderId: currentUserId, receiverId: contactId },
        { senderId: contactId, receiverId: currentUserId }
      ],
      deletedFor: { $ne: currentUserId }
    }).sort({ createdAt: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Delete Conversation
app.delete('/api/messages/:contactId', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    const currentUserId = req.user.userId;

    // To properly "delete for me", we shouldn't hard-delete.
    // Instead we can add deletedFor to all messages between these users.
    await Message.updateMany({
      $or: [
        { senderId: currentUserId, receiverId: contactId },
        { senderId: contactId, receiverId: currentUserId }
      ]
    }, {
      $addToSet: { deletedFor: currentUserId }
    });
    
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Delete Single Message
app.delete('/api/messages/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUserId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    if (message.senderId.toString() !== currentUserId && message.receiverId.toString() !== currentUserId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!message.deletedFor.includes(currentUserId)) {
      message.deletedFor.push(currentUserId);
      await message.save();
    }

    res.json({ message: 'Message deleted for you' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Upload Media Message
app.post('/api/messages/upload', authenticateToken, upload.single('media'), async (req, res) => {
  try {
    const { receiverId, text, mediaType } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No media uploaded' });

    const mediaUrl = `/uploads/${req.file.filename}`;
    const message = new Message({
      text: text || '',
      mediaUrl,
      mediaType,
      senderId: req.user.userId,
      receiverId
    });
    await message.save();

    // Broadcast this message in real-time to the receiver
    const receiverSockets = Object.keys(users).filter(key => users[key] === receiverId);
    receiverSockets.forEach(id => {
      io.to(id).emit("receive_message", message);
    });

    res.json(message);
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/', (req, res) => res.send('SmartChatt API is running!'));

// --- Socket.IO ---
const users = {};
io.on('connection', (socket) => {
  socket.on('register_socket', (userId) => {
    users[socket.id] = userId;
    console.log(`User ${userId} connected with socket ${socket.id}`);
  });

  socket.on('send_message', async (data) => {
    try {
      const { senderId, receiverId, text } = data;
      const newMessage = new Message({ text, senderId, receiverId });
      await newMessage.save();

      // Send to receiver if online
      const receiverSockets = Object.keys(users).filter(key => users[key] === receiverId);
      receiverSockets.forEach(id => {
        io.to(id).emit('receive_message', newMessage);
      });
      
      // Also send back to sender so their UI updates
      socket.emit('receive_message', newMessage);
    } catch (error) {
      console.error('Error saving private message:', error);
    }
  });

  // --- WebRTC Signaling ---
  socket.on('call_user', (data) => {
    const receiverSockets = Object.keys(users).filter(key => users[key] === data.userToCall);
    receiverSockets.forEach(id => {
      io.to(id).emit('incoming_call', {
        signal: data.signalData,
        from: data.from,
        callerName: data.callerName,
        callerProfilePic: data.callerProfilePic,
        callType: data.callType
      });
    });
  });

  socket.on('answer_call', (data) => {
    const callerSockets = Object.keys(users).filter(key => users[key] === data.to);
    callerSockets.forEach(id => {
      io.to(id).emit('call_answered', data.signal);
    });
  });

  socket.on('reject_call', (data) => {
    const callerSockets = Object.keys(users).filter(key => users[key] === data.to);
    callerSockets.forEach(id => {
      io.to(id).emit('call_rejected');
    });
  });

  socket.on('end_call', (data) => {
    const otherSockets = Object.keys(users).filter(key => users[key] === data.to);
    otherSockets.forEach(id => {
      io.to(id).emit('call_ended');
    });
  });

  socket.on('ice_candidate', (data) => {
    const otherSockets = Object.keys(users).filter(key => users[key] === data.to);
    otherSockets.forEach(id => {
      io.to(id).emit('ice_candidate', { candidate: data.candidate, from: data.from });
    });
  });

  socket.on('disconnect', () => {
    console.log("User disconnected:", socket.id);
    delete users[socket.id];
  });
});

server.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
