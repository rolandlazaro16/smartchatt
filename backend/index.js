require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const port = process.env.PORT || 5000;

// Create HTTP Server for Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow frontend access
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Mongoose Schema & Model
const messageSchema = new mongoose.Schema({
  text: String,
  sender: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Successfully connected to MongoDB (smartchatt_db)'))
  .catch((err) => console.error('MongoDB connection error:', err));

// API Endpoint to get message history
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: 1 }).limit(100);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/', (req, res) => {
  res.send('SmartChatt API is running with Socket.IO!');
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('send_message', async (data) => {
    try {
      // Save message to database
      const newMessage = new Message({
        text: data.text,
        sender: data.sender || 'User'
      });
      await newMessage.save();

      // Broadcast message to all connected clients
      io.emit('receive_message', newMessage);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start the server (must be server.listen, not app.listen)
server.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
