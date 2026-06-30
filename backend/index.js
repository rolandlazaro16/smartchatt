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
  profilePicture: { type: String, default: '' },
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  text: String,
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
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
    const { username, password } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : '';

    const user = new User({ username, password: hashedPassword, profilePicture });
    await user.save();

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
    res.json({ token, user: { _id: user._id, username, profilePicture } });
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
    res.json({ token, user: { _id: user._id, username, profilePicture: user.profilePicture } });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get Contacts (All other users)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } }).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
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
      ]
    }).sort({ createdAt: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/', (req, res) => res.send('SmartChatt API is running!'));

// --- Socket.IO ---
const userSockets = {}; // Map userId to socketId

io.on('connection', (socket) => {
  socket.on('register_socket', (userId) => {
    userSockets[userId] = socket.id;
    console.log(`User ${userId} connected with socket ${socket.id}`);
  });

  socket.on('send_message', async (data) => {
    try {
      const { senderId, receiverId, text } = data;
      const newMessage = new Message({ text, senderId, receiverId });
      await newMessage.save();

      // Send to receiver if online
      const receiverSocketId = userSockets[receiverId];
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', newMessage);
      }
      
      // Also send back to sender so their UI updates
      socket.emit('receive_message', newMessage);
    } catch (error) {
      console.error('Error saving private message:', error);
    }
  });

  socket.on('disconnect', () => {
    // Remove disconnected socket
    for (const [userId, socketId] of Object.entries(userSockets)) {
      if (socketId === socket.id) {
        delete userSockets[userId];
        break;
      }
    }
  });
});

server.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
