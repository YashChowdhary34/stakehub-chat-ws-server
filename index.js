import { PrismaClient } from "@prisma/client";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
dotenv.config();

const onlineUsers = new Set();
let onlineAdmin = false;

const prisma = new PrismaClient();
const app = express();

// Allow vercel origin
app.use(cors({ origin: "http://localhost:3000" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000" },
});

app.get("/healthz", (req, res) => res.send("OK"));

io.on("connection", (socket) => {
  let currentUserId = null;
  let currentIsAdmin = false;
  console.log("New socket connection:", socket.id);

  socket.on("join", async ({ chatId, userId, isAdmin }) => {
    currentUserId = userId;
    currentIsAdmin = isAdmin;
    const room = `chat_${chatId}`;
    socket.join(room);
    if (!isAdmin) {
      onlineUsers.add(userId);
    } else {
      onlineAdmin = true;
    }
    console.log(`${socket.id} joined ${room}`);
    // Notify presence status
    io.emit("presence", {
      userId,
      isAdmin,
      status: "online",
    });
  });

  socket.on("text", async ({ chatId, senderId, text }) => {
    // Persist to db
    const newMessage = await prisma.message.create({
      data: {
        chat: { connect: { id: chatId } },
        sender: { connect: { id: senderId } },
        type: "TEXT",
        content: text,
        fileUrl: null,
        fileName: null,
        filePath: null,
        fileType: null,
      },
      select: {
        id: true,
        senderId: true,
        type: true,
        content: true,
        fileUrl: true,
        fileName: true,
        filePath: true,
        fileType: true,
        createdAt: true,
      },
    });

    //Broadcast to room
    io.to(`chat_${chatId}`).emit("text", newMessage);
  });

  socket.on(
    "file",
    async ({ chatId, senderId, fileName, filePath, fileType, fileUrl }) => {
      // Persist to db
      const newMessage = await prisma.message.create({
        data: {
          chat: { connect: { id: chatId } },
          sender: { connect: { id: senderId } },
          type: "FILE",
          content: null,
          fileUrl,
          fileName,
          filePath,
          fileType,
        },
        select: {
          id: true,
          senderId: true,
          type: true,
          content: true,
          fileUrl: true,
          fileName: true,
          filePath: true,
          fileType: true,
          createdAt: true,
        },
      });

      //Broadcast to room
      io.to(`chat_${chatId}`).emit("file", newMessage);
    }
  );

  socket.on("get-active-users", () => {
    socket.emit("active-users", Array.from(onlineUsers));
  });

  socket.on("disconnect", () => {
    if (!currentUserId) return;
    if (!onlineAdmin) {
      onlineUsers.delete(currentUserId);
    } else {
      onlineAdmin = false;
    }

    io.emit("presence", {
      userId: currentUserId,
      isAdmin: currentIsAdmin,
      status: "offline",
    });
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Chat server running on ${PORT}`));
