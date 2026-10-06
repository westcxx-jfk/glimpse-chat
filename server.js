const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Track connected users per room: { roomId: { socket.id: username } }
const rooms = {};

function broadcastUserList(room) {
  const list = rooms[room] ? Object.values(rooms[room]) : [];
  io.to(room).emit('userList', list);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join', ({ room, username }) => {
    if (!room) return;
    currentRoom = room;
    socket.join(room);

    if (!rooms[room]) rooms[room] = {};
    rooms[room][socket.id] = username || 'Anonymous';

    console.log(`${rooms[room][socket.id]} joined room "${room}". Room size: ${Object.keys(rooms[room]).length}`);
    broadcastUserList(room);
  });

  // Live keystroke preview — fires on every keypress, before Send
  socket.on('typing', (text) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('partnerTyping', { username: rooms[currentRoom]?.[socket.id], text });
  });

  // Actual sent message
  socket.on('sendMessage', (text) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('newMessage', { username: rooms[currentRoom]?.[socket.id] || 'Anonymous', text });
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const name = rooms[currentRoom][socket.id];
    delete rooms[currentRoom][socket.id];
    console.log(`${name} left room "${currentRoom}". Room size: ${Object.keys(rooms[currentRoom]).length}`);

    if (Object.keys(rooms[currentRoom]).length === 0) {
      delete rooms[currentRoom]; // clean up empty rooms
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
