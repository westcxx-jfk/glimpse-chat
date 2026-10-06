const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Track connected users: { socket.id: username }
const users = {};

function broadcastUserList() {
  io.emit('userList', Object.values(users));
}

io.on('connection', (socket) => {
  socket.on('join', (username) => {
    users[socket.id] = username || 'Anonymous';
    console.log(`${users[socket.id]} connected. Total: ${Object.keys(users).length}`);
    broadcastUserList();
  });

  // Live keystroke preview — fires on every keypress, before Send
  socket.on('typing', (text) => {
    socket.broadcast.emit('partnerTyping', { username: users[socket.id], text });
  });

  // Actual sent message
  socket.on('sendMessage', (text) => {
    io.emit('newMessage', { username: users[socket.id] || 'Anonymous', text });
  });

  socket.on('disconnect', () => {
    const name = users[socket.id];
    delete users[socket.id];
    console.log(`${name} disconnected. Total: ${Object.keys(users).length}`);
    broadcastUserList();
    io.emit('partnerTyping', { username: name, text: '' }); // clear their preview if they vanish mid-type
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
