import { Server } from "socket.io";
import { User } from "../models/index.js";
import { verifyToken } from "../services/jwtService.js";

let io;

const initializeSocket = (httpServer, allowedOrigins) => {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        socket.data.user = null;
        return next();
      }
      const verification = verifyToken(token);
      if (!verification.isValid) return next(new Error("Invalid or expired access token."));
      const user = await User.findByPk(verification.decoded.id, {
        attributes: ["id", "role", "is_active"],
      });
      if (!user || !user.is_active) return next(new Error("Account is unavailable."));
      socket.data.user = user.get({ plain: true });
      return next();
    } catch (error) {
      return next(new Error("Socket authentication failed."));
    }
  });

  io.on("connection", (socket) => {
    socket.join("public:menu");
    const user = socket.data.user;
    if (!user) return;
    socket.join(`user:${user.id}`);
    socket.join(`role:${user.role}`);
    if (["staff", "admin"].includes(user.role)) socket.join("kitchen");
  });

  return io;
};

const emitToUser = (userId, eventName, payload) => {
  if (io && userId) io.to(`user:${userId}`).emit(eventName, payload);
};

const emitToOperations = (eventName, payload) => {
  if (!io) return;
  io.to("role:staff").to("role:admin").emit(eventName, payload);
};

const emitToKitchen = (eventName, payload) => {
  if (io) io.to("kitchen").emit(eventName, payload);
};

const emitProductAvailability = (payload) => {
  if (io) io.to("public:menu").emit("product:availability_changed", payload);
};

export {
  emitProductAvailability,
  emitToKitchen,
  emitToOperations,
  emitToUser,
  initializeSocket,
};
