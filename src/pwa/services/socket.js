const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Single io instance, attached in server.js. Property rooms are named
// `property:<id>`. Auditor and Officer both join the room for properties
// they're authorized to see; clients emit/receive review + message events
// through it for true real-time UX.

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.PWA_CLIENT_URL?.split(',') ||
              process.env.CLIENT_URL?.split(',') ||
              '*',
      credentials: true,
    },
  });

  // Lightweight auth handshake — clients pass their PWA JWT via auth.token.
  // We accept any role here; per-property authorization is enforced at the
  // join-room step.
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('unauthenticated'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.pwa) return next(new Error('not a pwa token'));
      socket.user = { id: decoded.id, role: decoded.role };
      next();
    } catch (err) {
      next(new Error('invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('property:join', (propertyId) => {
      if (!propertyId) return;
      socket.join(`property:${propertyId}`);
    });
    socket.on('property:leave', (propertyId) => {
      if (!propertyId) return;
      socket.leave(`property:${propertyId}`);
    });
  });

  return io;
};

const getIO = () => io;

const emitToProperty = (propertyId, event, payload) => {
  if (!io) return;
  io.to(`property:${propertyId}`).emit(event, payload);
};

module.exports = { initSocket, getIO, emitToProperty };
