import { PrismaClient } from "@prisma/client";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();
const app = express();

// Allow vercel origin
app.use(
  cors({ origin: [process.env.LOCALHOST_URL, process.env.FRONTEND_URL] })
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: [process.env.LOCALHOST_URL, process.env.FRONTEND_URL] },
});

app.get("/healthz", (req, res) => res.send("OK"));

io.on("connection", (socket) => {
  console.log("New socket connection:", socket.id);

  socket.on("join", async ({ chatId }) => {
    const room = `chat_${chatId}`;
    socket.join(room);
    console.log(`${socket.id} joined ${room}`);
    // WIP: active status
  });

  socket.io("text", async ({ chatId, userId, text }) => {
    // Persist to db
    const newMessage = await prisma.message.create({
      data: {
        chat: { chat: { connect: { id: chatId } } },
        sender: { connect: { id: userId } },
        type: "TEXT",
        content: text,
      },
      select: {
        id: true,
        senderId: true,
        type: true,
        content: true,
      },
    });

    //Broadcast to room
    io.to(`chat_${chatId}`).emit("text", newMessage);
  });

  socket.io(
    "file",
    async ({
      chatId,
      userId,
      fileName,
      filePath,
      fileType,
      fileUrl,
      createdAt,
    }) => {
      const newMessage = await prisma.message.create({
        data: {
          chat: { chat: { connect: { id: chatId } } },
          sender: { connect: { id: userId } },
          type: "FILE",
          fileUrl,
          fileName,
          filePath,
          fileType,
          createdAt,
        },
        select: {
          id: true,
          senderId: true,
          type: true,
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

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Chat server running on ${PORT}`));
