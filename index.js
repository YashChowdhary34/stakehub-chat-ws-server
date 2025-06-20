import express from "express";
import { createServer, Server } from "http";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { createAdapter } from "@socket.io/redis-adapter";
import client from "@/lib/prisma";
import dotenv from "dotenv";
dotenv.config;

const app = express();
const server = createServer(app);

// redis client for adapter
const pubClient = new Redis(process.env.UPSTASH_REDIS_REST_URL);
const subClient = pubClient.duplicate();

pubClient.on("error", (e) => console.error("Redis pub error", e));
subClient.on("error", (e) => console.error("Redis sub error", e));

const io = new Server(server, {
  cors: {
    origin: [process.env.CLIENT_URL, process.env.LOCALHOST_URL] || "*",
    methods: ["GET", "POST"],
  },
});

// redis adapter
io.adapter(createAdapter(pubClient, subClient));

// middleware - auth socket via jwt
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("Authentication error: token missing"));
  }
  try {
    const payload = jwt.verify(token, process.env.UPSTASH_REDIS_REST_TOKEN);
    socket.data.userId = payload.userId;
    socket.data.isAdmin = payload.isAdmin || false;
    next();
  } catch (error) {
    console.error("Socket auth failed:", error);
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  console.log(`User connected ${userId}, socket id: ${socket.id}`);

  // join a chat
  socket.on("join_chat", async ({ chatId }) => {
    try {
      const chat = await client.chat.findUnique({ where: { id: chatId } });
      if (!chat) {
        socket.emit("join_error", { error: "Chat not found" });
        return;
      }
      if (!socket.data.isAdmin && chat.userId !== userId) {
        socket.emit("join_error", { error: "Not allowed to join this chat" });
        return;
      }
      socket.join(chatId);

      socket.emit("joined_chat", { chatId });
      console.log(`${userId} joined chat ${chatId}`);
    } catch (error) {
      console.log("join_chat error:", error);
      socket.emit("join_error", { error: "Server error" });
    }
  });
});

// handling sending message
socket.on("send_message", async (payload) => {
  const { chatId, tempId, type, content, fileUrl, fileName, fileType } =
    payload;
  const senderId = socket.data.userId;

  if (!socket.rooms.has(chatId)) {
    socket.emit("message_error", { tempId, error: "Not joined to chat" });
    return;
  }
  try {
    const message = await client.message.create({
      data: {
        chat: { connect: { id: chatId } },
        senderId,
        type,
        content: content || null,
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        fileType: fileType || null,
      },
    });
    const out = {
      id: message.id,
      chatId,
      senderId: message.senderId,
      type: message.type,
      content: message.content,
      fileUrl: message.fileUrl,
      fileName: message.fileName,
      fileType: message.fileType,
      createdAt: message.createdAt.toISOString(),
      tempId, // echo back
    };

    io.to(chatId).emit("new message", out);
  } catch (error) {
    console.log("send message error:", error);
    socket.emit("message_error", { tempId, error: error.message });
  }
});

socket.on("disconnect", (reason) => {
  console.log(`User disconnected: ${userId}, reason ${reason}`);

  //wip: presense handling
});

app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
});
