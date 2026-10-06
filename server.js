const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- Database connection ---
// The connection string lives in an environment variable, never in this file,
// since this code is on a public GitHub repo.
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));
} else {
  console.warn('No MONGODB_URI set — chat history will not be saved.');
}

// --- Message schema ---
// "expires: 86400" tells MongoDB to automatically delete each message
// 86400 seconds (24 hours) after its createdAt time. No cleanup code needed.
const messageSchema = new mongoose.Schema({
  room: { type: String, required: true, index: true },
  username: String,
  text: String,
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});
const Message = mongoose.model('Message', messageSchema);

// Track connected users per room: { roomId: { socket.id: username } }
const rooms = {};
// Track when each room first started, so clients can show a 24h countdown
const roomStartTimes = {};
const MAX_ROOM_SIZE = 5;

function broadcastUserList(room) {
  const list = rooms[room] ? Object.values(rooms[room]) : [];
  io.to(room).emit('userList', list);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join', async ({ room, username }) => {
    if (!room) return;

    const existingCount = rooms[room] ? Object.keys(rooms[room]).length : 0;
    if (existingCount >= MAX_ROOM_SIZE) {
      socket.emit('roomFull', MAX_ROOM_SIZE);
      return;
    }

    currentRoom = room;
    socket.join(room);

    if (!rooms[room]) rooms[room] = {};
    rooms[room][socket.id] = username || 'Anonymous';

    // Record the room's start time the first time anyone joins it
    if (!roomStartTimes[room]) roomStartTimes[room] = Date.now();
    socket.emit('roomStartTime', roomStartTimes[room]);

    console.log(`${rooms[room][socket.id]} joined room "${room}". Room size: ${Object.keys(rooms[room]).length}`);
    broadcastUserList(room);

    // Load the last 24 hours of messages for this room and send them
    // to just this person, so they see the existing conversation.
    if (MONGODB_URI) {
      try {
        const history = await Message.find({ room }).sort({ createdAt: 1 }).limit(200);
        socket.emit('chatHistory', history.map(m => ({ username: m.username, text: m.text })));
      } catch (err) {
        console.error('Failed to load chat history:', err);
      }
    }
  });

  socket.on('typing', (text) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('partnerTyping', { username: rooms[currentRoom]?.[socket.id], text });
  });

  socket.on('sendMessage', async (text) => {
    if (!currentRoom) return;
    const username = rooms[currentRoom]?.[socket.id] || 'Anonymous';

    io.to(currentRoom).emit('newMessage', { username, text });

    if (MONGODB_URI) {
      try {
        await Message.create({ room: currentRoom, username, text });
      } catch (err) {
        console.error('Failed to save message:', err);
      }
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const name = rooms[currentRoom][socket.id];
    delete rooms[currentRoom][socket.id];
    console.log(`${name} left room "${currentRoom}". Room size: ${Object.keys(rooms[currentRoom]).length}`);

    if (Object.keys(rooms[currentRoom]).length === 0) {
      delete rooms[currentRoom];
      delete roomStartTimes[currentRoom];
    } else {
      broadcastUserList(currentRoom);
      io.to(currentRoom).emit('partnerTyping', { username: name, text: '' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
