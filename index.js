require("dotenv").config({ quiet: true });
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");
const { GoogleGenAI } = require("@google/genai");

// Setup AI Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();

const useRoutes = require("./routes/useRoutes.js");
const loginRoutes = require("./routes/loginRoutes.js");
const dashboardRoutes = require("./routes/dashboardRoute.js");
const profileRoutes = require("./routes/profileRoute.js");
const meetingRoutes = require("./routes/meetingRoutes.js");
const connectDB = require("./config/db.js");
const Meeting = require("./models/meetingModel"); 

const PORT = 8001;

// CORS Middleware Configuration
app.use(cors({
  origin: [
    "https://intellmeet-frontend-phi.vercel.app",
    "https://intellmeet-frontend-hupsiw1ra-priyanka-tripathis-projects.vercel.app"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());
connectDB();
mongoose.set('debug', true);

// Express Routes
app.use("/users", useRoutes);
app.use("/login", loginRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/profile", profileRoutes);
app.use("/meetings", meetingRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// ============================================================================
// REUSABLE GEMINI INSIGHTS SCHEMA & CONFIG
// ============================================================================
const getAiConfig = (participantNames) => ({
  systemInstruction: `You are an expert AI scribe. Analyze the transcript text and build structured information. Critical rule: assignment names MUST accurately match an entity from this array: ${JSON.stringify(participantNames)}.`,
  responseMimeType: "application/json",
  responseSchema: {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING", description: "An overview paragraph wrapping up the updates." },
      keyPoints: { type: "ARRAY", items: { type: "STRING" }, description: "List of key takeaway bullet points." },
      actionItems: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            assigneeName: { type: "STRING", description: "Name from the permitted participant list." },
            taskDetail: { type: "STRING", description: "Description of what they need to deliver." },
            dateBadge: { type: "STRING", description: "Format: MMM DD (e.g., Jun 15)" }
          },
          required: ["assigneeName", "taskDetail", "dateBadge"]
        }
      }
    },
    required: ["summary", "keyPoints", "actionItems"]
  }
});

// Fetch active participant list safely
async function getParticipantNames(roomId) {
  const meetingData = await Meeting.findOne({ meetingCode: roomId }).populate("participants", "name");
  if (meetingData?.participants?.length > 0) {
    return meetingData.participants.map(p => p.name).filter(Boolean);
  }
  return ["Priyanka", "Team"];
}

// ============================================================================
// AI API RETRY HELPER
// ============================================================================
const executeWithRetry = async (apiCallFn, retries = 3, delayMs = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await apiCallFn();
    } catch (error) {
      const is503 = error.status === 503;
      const is429 = error.status === 429 || error.message?.includes("quota");
      
      if ((is503 || is429) && i < retries - 1) {
        console.warn(`⚠️ Gemini API error (${error.status || 'Quota'}). Retrying in ${delayMs}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2;
      } else {
        throw error;
      }
    }
  }
};

// ============================================================================
// AUTOMATED ROLLING SUMMARY PIPELINE
// ============================================================================
// Note: In an enterprise multicluster setup, manage locks via Redis (e.g., Redlock)
const isProcessingSummary = {}; 

async function updateLiveSummaryAndEmit(roomId, currentFullTranscript) {
  if (isProcessingSummary[roomId]) return; 
  isProcessingSummary[roomId] = true;

  try {
    console.log(`🌀 Running rolling AI Insights engine for room: ${roomId}...`);

    const realParticipantNames = await getParticipantNames(roomId);
    const aiConfig = getAiConfig(realParticipantNames);

    const prompt = `Analyze this live session transcript text and construct a structured JSON dataset:\n\n${currentFullTranscript}`;

    const response = await executeWithRetry(() => 
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: aiConfig
      })
    );

    if (response?.text) {
      const parsedData = JSON.parse(response.text.trim());

      await Meeting.findOneAndUpdate(
        { meetingCode: roomId },
        {
          $set: {
            aiNotes: {
              summary: parsedData.summary || "",
              keyPoints: parsedData.keyPoints || [],
              actionItems: parsedData.actionItems || []
            }
          }
        }
      );

      socketio.to(roomId).emit("meeting-notes-update", parsedData);
      console.log(`✅ Success: Broadcasted refreshed AI insights live to room ${roomId}`);
    }
  } catch (error) {
    console.error("❌ Background summary algorithm failure:", error.message);
  } finally {
    isProcessingSummary[roomId] = false;
  }
}

// ============================================================================
// AI NOTES MANUAL FETCH API ENDPOINT
// ============================================================================
app.post("/api/ai-summary", async (req, res) => {
  try {
    const { text, roomId } = req.body; 
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";

    if (!text || text.trim() === "") {
      return res.json({
        summary: "No transcription text available yet to summarize.",
        keyPoints: [],
        actionItems: []
      });
    }

    const realParticipantNames = await getParticipantNames(formattedRoomId);
    const aiConfig = getAiConfig(realParticipantNames);
    const prompt = `Analyze the following meeting transcript and return only valid JSON:\n\nTranscript:\n${text}`;

    const response = await executeWithRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: aiConfig
      })
    );

    if (!response?.text) throw new Error("No text returned from Gemini");
    const parsedResponse = JSON.parse(response.text.trim());

    await Meeting.findOneAndUpdate(
      { meetingCode: formattedRoomId },
      {
        $set: {
          status: "completed",
          endTime: new Date(),
          transcript: text,
          aiNotes: {
            summary: parsedResponse.summary || "",
            keyPoints: parsedResponse.keyPoints || [],
            actionItems: parsedResponse.actionItems || []
          }
        }
      }
    );

    res.json(parsedResponse);
  } catch (err) {
    console.error("AI Generation error", err);
    if (err.status === 503 || err.status === 429) {
      return res.status(err.status).json({
        error: "Gemini servers are busy. Please try again in a moment."
      });
    }
    res.status(500).json({ error: "Failed to generate meeting summary" });
  }
});

app.get("/api/meeting-notes/:roomId", async (req, res) => {
  try {
    const formattedRoomId = req.params.roomId ? req.params.roomId.trim().toUpperCase() : "";
    const meeting = await Meeting.findOne({ meetingCode: formattedRoomId });
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });
    res.json(meeting.aiNotes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

// Server Initialization
const server = http.createServer(app);
const socketio = new Server(server, {
  cors: {
    origin: [
      "https://intellmeet-frontend-phi.vercel.app",
      "https://intellmeet-frontend-hupsiw1ra-priyanka-tripathis-projects.vercel.app"
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});
// REDIS SETUP
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const pubClient = createClient({ url: redisUrl });
const subClient = pubClient.duplicate();

(async () => {
  try {
    await pubClient.connect();
    await subClient.connect();
    console.log("Redis Connected Successfully");
    socketio.adapter(createAdapter(pubClient, subClient));
  } catch (err) {
    console.error("❌ Redis Connection Error:", err.message);
  }
})();

const roomAudioBuffers = {};

// ============================================================================
// CORE WEBSOCKET HOOK MANAGEMENT INTERFACES
// ============================================================================
socketio.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinRoom", async ({ roomId, userName, userId }) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    
    socket.roomId = formattedRoomId;
    socket.userDataString = JSON.stringify({ socketId: socket.id, userName });

    socket.join(formattedRoomId);
    await pubClient.sAdd(`room:${formattedRoomId}:users`, socket.userDataString);

    try {
      if (userId) {
        await Meeting.findOneAndUpdate(
          { meetingCode: formattedRoomId },
          { $addToSet: { participants: userId } } 
        );
        console.log("Participant successfully verified/added in MongoDB records");
      }
    } catch (err) {
      console.log("Error saving participant on join:", err.message);
    }
    
    const redisUsers = await pubClient.sMembers(`room:${formattedRoomId}:users`);
    const parsedUsers = redisUsers.map(user => JSON.parse(user));
    const otherUsers = parsedUsers.filter((user) => user.socketId !== socket.id);

    socket.emit("all users", otherUsers);
    socketio.to(formattedRoomId).emit("users-count-update");
  });

  socket.on("toggle-recording-state", ({ roomId, status, userName }) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    socket.to(formattedRoomId).emit("recording-status-changed", status);
    socket.to(formattedRoomId).emit("recording-notification", {
      message: status ? `🔴 ${userName} started recording` : `⏹️ ${userName} stopped recording`,
    });
  });

  // AUDIO PIPELINE HANDLER
  socket.on("audio-chunk", async ({ roomId, audioBuffer }) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    try {
      if (!audioBuffer) return;

      if (!roomAudioBuffers[formattedRoomId]) {
        roomAudioBuffers[formattedRoomId] = [];
      }
      roomAudioBuffers[formattedRoomId].push(Buffer.from(audioBuffer));

      socketio.to(formattedRoomId).emit("ai-status", {
        status: "listening",
        message: "AI is listening & collecting audio streams..."
      });

      if (roomAudioBuffers[formattedRoomId].length >= 180) {
        // Atomic extract to avoid async timing buffer leaks
        const chunksToProcess = roomAudioBuffers[formattedRoomId];
        roomAudioBuffers[formattedRoomId] = [];

        const combinedBuffer = Buffer.concat(chunksToProcess);

        socketio.to(formattedRoomId).emit("ai-status", { status: "processing", message: "Gemini is processing speech to text..." });

        const response = await executeWithRetry(() => 
          ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: "audio/webm", data: combinedBuffer.toString("base64") } },
                  { text: "Transcribe the spoken language in this audio chunk directly into written text sentences. Output only the transcript text." }
                ]
              }
            ]
          })
        );

        if (response?.text?.trim()) {
          const finishedSegment = response.text.trim();

          socketio.to(formattedRoomId).emit("live-transcript-update", { text: finishedSegment });

          // Fetch the freshest transcript from DB to preserve sync across scaling clusters
          const activeMeeting = await Meeting.findOne({ meetingCode: formattedRoomId });
          const baseTranscript = activeMeeting?.transcript || "";
          const updatedTranscript = baseTranscript + " " + finishedSegment;

          await Meeting.findOneAndUpdate(
            { meetingCode: formattedRoomId },
            {
              $push: { messages: { sender: "AI", text: finishedSegment } },
              $set: { transcript: updatedTranscript }
            }
          );
          
          socketio.to(formattedRoomId).emit("receive-ai-message", {
            sender: "AI",
            text: finishedSegment,
            createdAt: new Date()
          });

          // Trigger continuous insights pipeline safely
          updateLiveSummaryAndEmit(formattedRoomId, updatedTranscript);
        }

        socketio.to(formattedRoomId).emit("ai-status", { status: "listening", message: "AI is listening..." });
      }
    } catch (err) {
      console.error("❌ Core Audio Pipeline error:", err.message);
      socketio.to(formattedRoomId).emit("ai-status", { status: "error", message: "AI Processing error occurred." });
    }
  });

  socket.on("start-presentation", ({ roomId }) => {
    socket.to(roomId).emit("presentation-started", { presenterId: socket.id });
  });

  socket.on("stop-presentation", ({ roomId }) => {
    socket.to(roomId).emit("presentation-stopped");
  });

  socket.on("draw", (data) => {
    socket.to(data.roomId).emit("draw-coordinates", data);
  });

  socket.on("clear-drawing", ({ roomId }) => {
    socketio.to(roomId).emit("clear-annotations");
  });

  // WEBRTC SIGNALING HANDLERS
  socket.on("sending signal", (payload) => {
    socketio.to(payload.userToSignal).emit("user joined", {
      signal: payload.signal,
      callerId: payload.callerId,
      userName: payload.userName,
    });
  });

  socket.on("returning signal", (payload) => {
    socketio.to(payload.callerId).emit("receiving returned signal", {
      signal: payload.signal,
      id: socket.id,
    });
  });

  socket.on("toggle-video-track", ({ roomId, isVideoActive }) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    socket.to(formattedRoomId).emit("toggle-video-track", {
      socketId: socket.id,
      isVideoActive: isVideoActive
    });
  });

  // CHAT EVENTS
  socket.on("send-message", async ({ roomId, message, sender }) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    try {
      await Meeting.findOneAndUpdate(
        { meetingCode: formattedRoomId },
        { $push: { messages: { sender, text: message } } }
      );
      socketio.to(formattedRoomId).emit("receive-message", { sender, message });
    } catch (err) {
      console.error("Database save crash during message emit:", err.message);
    }
  });

  socket.on("typing", ({ roomId, userName }) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    socket.to(formattedRoomId).emit("show-typing", { userName });
  });

  // DISCONNECT CLEANUP LOGIC
  const cleanUpUserSession = async (targetSocket, roomId, userDataString) => {
    if (!roomId || !userDataString) return;
    try {
      const redisKey = `room:${roomId}:users`;
      await pubClient.sRem(redisKey, userDataString);
      
      const remainingUsers = await pubClient.sMembers(redisKey);
      console.log(`👥 Room ${roomId} active count: ${remainingUsers.length} strings left.`);

      if (remainingUsers.length === 0) {
        console.log(`🗄️ Room ${roomId} completely unpopulated. Cleaning records.`);
        delete roomAudioBuffers[roomId];
        
        await Meeting.findOneAndUpdate(
          { meetingCode: roomId },
          { $set: { status: "completed", endTime: new Date() } }
        );
      }

      targetSocket.to(roomId).emit("user-disconnected", targetSocket.id);
      socketio.to(roomId).emit("users-count-update"); 
    } catch (error) {
      console.error("❌ ROOM SESSION CLEANUP ERROR:", error);
    }
  };

  socket.on("leaveRoom", async (roomId) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    socket.leave(formattedRoomId);
    await cleanUpUserSession(socket, formattedRoomId, socket.userDataString);
  });

  socket.on("disconnect", async () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
    await cleanUpUserSession(socket, socket.roomId, socket.userDataString);
  });

  socket.on("getParticipantCount", (roomId) => {
    const formattedRoomId = roomId ? roomId.trim().toUpperCase() : "";
    const room = socketio.sockets.adapter.rooms.get(formattedRoomId);
    socket.emit("participant-Count-updated", room ? room.size : 0);
  });
});

// Start Express Server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});