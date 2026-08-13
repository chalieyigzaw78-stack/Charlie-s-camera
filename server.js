require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// The PIN that both your camera phone and viewer phone must use to connect.
// Set this in Render's environment variables. Falls back to a default for local testing.
const ROOM_PIN = process.env.ROOM_PIN || '123456';

app.use(express.static(path.join(__dirname, 'public')));

// Simple endpoint the frontend can call to check if a PIN is correct
// without exposing the real PIN in the page source.
app.use(express.json());
app.post('/api/check-pin', (req, res) => {
  const { pin } = req.body;
  res.json({ valid: pin === ROOM_PIN });
});

// Fetches a fresh set of ICE servers (STUN + TURN) using your Metered.ca TURN credentials
// so phones on different networks (e.g. different WiFi, mobile data) can reliably connect.
// Falls back to public STUN + the shared Open Relay demo TURN if Metered isn't configured.
app.get('/api/ice-servers', (req, res) => {
  const username = process.env.METERED_TURN_USERNAME;
  const credential = process.env.METERED_TURN_PASSWORD;

  const fallback = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  };

  if (!username || !credential) {
    res.json(fallback);
    return;
  }

  // Free plan only has access to the "standard" relay region (not "global", which is paid).
  res.json({
    iceServers: [
      { urls: 'stun:stun.relay.metered.ca:80' },
      { urls: 'turn:standard.relay.metered.ca:80', username, credential },
      { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username, credential },
      { urls: 'turn:standard.relay.metered.ca:443', username, credential },
      { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username, credential },
    ],
  });
});

// Track who is in the room: one "camera" and one "viewer"
const room = {
  camera: null, // socket.id of the camera phone
  viewer: null, // socket.id of the viewer phone
};

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('join', ({ pin, role }) => {
    if (pin !== ROOM_PIN) {
      socket.emit('join-error', 'Incorrect PIN.');
      return;
    }

    if (role === 'camera') {
      room.camera = socket.id;
      socket.join('room');
      socket.emit('joined', { role: 'camera' });
      // Let the viewer know a camera is now available
      if (room.viewer) {
        io.to(room.viewer).emit('camera-ready');
        socket.emit('viewer-ready');
      }
    } else if (role === 'viewer') {
      room.viewer = socket.id;
      socket.join('room');
      socket.emit('joined', { role: 'viewer' });
      // If camera is already connected, tell viewer immediately
      if (room.camera) {
        socket.emit('camera-ready');
        io.to(room.camera).emit('viewer-ready');
      }
    }
  });

  // Relay WebRTC signaling messages (offer/answer/ICE candidates) between the two phones
  socket.on('signal', (data) => {
    const targetId = socket.id === room.camera ? room.viewer : room.camera;
    if (targetId) {
      io.to(targetId).emit('signal', data);
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === room.camera) {
      room.camera = null;
      if (room.viewer) io.to(room.viewer).emit('camera-disconnected');
    }
    if (socket.id === room.viewer) {
      room.viewer = null;
      if (room.camera) io.to(room.camera).emit('viewer-disconnected');
    }
    console.log('Disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
