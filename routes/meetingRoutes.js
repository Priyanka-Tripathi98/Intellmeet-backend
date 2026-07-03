const express = require("express");
const router = express.Router();
const multer = require("multer");
const mongoose = require("mongoose");

const Meeting = require("../models/meetingModel");
const { VerifyToken } = require("../middleware/VerifyTokenMiddleware");

// Configuration for Multer (Memory Storage)
const storage = multer.memoryStorage();
const upload = multer({ storage });
const { Readable } = require("stream");

/*
=====================================
1. CREATE MEETING
=====================================
*/
router.post("/create", VerifyToken, async (req, res) => {
  try {
    const { title, description, time, status, meetingCode } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Meeting title is required",
      });
    }

    const finalMeetingCode =
      meetingCode ||
      Math.random().toString(36).substring(2, 8).toUpperCase();

    const existingMeeting = await Meeting.findOne({
      meetingCode: finalMeetingCode,
    });

    if (existingMeeting) {
      return res.status(400).json({
        success: false,
        message: "Meeting code already exists",
      });
    }

    const creatorId = req.user._id || req.user.id;

    const meeting = new Meeting({
      title,
      description,
      meetingCode: finalMeetingCode,
      time: time || new Date(),
      status: status || "scheduled",
      creator: creatorId,
      participants: [creatorId],
      meetingLink: `https://meet.google.com/${finalMeetingCode}`,
    });

    await meeting.save();

    res.status(201).json({
      success: true,
      meeting,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

router.post("/upload-recording", upload.single("video"), async (req, res) => {
  try {
    const { meetingCode } = req.body; 
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No video file provided" });
    }

    // 1. Initialize GridFS Bucket
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "recordings",
    });

    // 2. Generate a unique file name for GridFS
    const filename = `${Date.now()}-${meetingCode}.mp4`;

    // 3. Convert the Multer memory buffer into a readable stream
    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null); // Signals end of stream

    // 4. Pipe the stream into GridFS
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: req.file.mimetype || "video/mp4"
    });

    await new Promise((resolve, reject) => {
      readableStream.pipe(uploadStream)
        .on("error", reject)
        .on("finish", resolve);
    });

    // uploadStream.id contains the brand new GridFS ObjectId!
    const fileId = uploadStream.id; 

    // 5. Save the actual streaming endpoint URL to the database
    const recordingUrl = `http://localhost:3001/meetings/video/${fileId}`;

    const updatedMeeting = await Meeting.findOneAndUpdate(
      { meetingCode: { $regex: new RegExp(`^${meetingCode}$`, "i") } }, 
      { 
        $set: { 
          recordingUrl: recordingUrl, // Store the working stream link
          status: "completed"
        } 
      },
      { new: true } 
    );

    if (!updatedMeeting) {
      return res.status(404).json({ success: false, message: "Meeting code not found" });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Recording uploaded to GridFS and linked successfully!",
      data: updatedMeeting 
    });

  } catch (error) {
    console.error("💥 Upload error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Stream Video via GridFS
router.get("/video/:fileId", async (req, res) => {
  try {
    const bucket = new mongoose.mongo.GridFSBucket(
      mongoose.connection.db,
      {
        bucketName: "recordings",
      }
    );

    const fileId = new mongoose.Types.ObjectId(req.params.fileId);
    const files = await bucket.find({ _id: fileId }).toArray();

    if (!files.length) {
      return res.status(404).json({
        message: "Video not found",
      });
    }

    res.set("Content-Type", files[0].contentType);
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Error streaming video",
    });
  }
});
router.get('/details/:meetingCode', async (req, res) => {
  try {
    const { meetingCode } = req.params;

    // 💡 CRITICAL: Make sure your database field matches! 
    // Is it 'meetingCode' or '_id'? Based on your frontend, it's 'meetingCode'.
    const meeting = await Meeting.findOne({ meetingCode: meetingCode });

    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    res.status(200).json({ success: true, meeting });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// Delete Recording
router.delete("/recording/:id", async (req, res) => {
  try {
    const meetingId = req.params.id;

    const updatedMeeting = await Meeting.findByIdAndUpdate(
      meetingId,
      { 
        $unset: { recordingUrl: "", recordingURL: "", videoUrl: "" } 
      },
      { new: true }
    );

    if (!updatedMeeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    return res.status(200).json({ message: "Recording deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

/*
=====================================
3. MEETING STATUS MANAGEMENT
=====================================
*/

// Complete Meeting via URL Parameter
router.put("/:meetingCode/complete", VerifyToken, async (req, res) => {
  try {
    const { meetingCode } = req.params;

    const meeting = await Meeting.findOne({ 
      meetingCode: meetingCode.trim().toUpperCase() 
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found",
      });
    }

    meeting.status = "completed";
    meeting.endTime = new Date();
    await meeting.save();

    res.status(200).json({
      success: true,
      message: "Meeting marked as completed",
      meeting,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Complete Meeting via Request Body (Fallback / Webhook handler)
router.post("/end", async (req, res) => {
  try {
    console.log("🔥 END ROUTE HIT");
    console.log("BODY:", req.body);

    const roomId = req.body.roomId || req.body.meetingCode;

    if (!roomId) {
      console.log("❌ No roomId received");
      return res.status(400).json({ message: "roomId required" });
    }

    const meeting = await Meeting.findOneAndUpdate(
      { meetingCode: roomId.trim().toUpperCase() },
      {
        $set: {
          status: "completed",
          endTime: new Date(),
        },
      },
      { new: true }
    );

    if (!meeting) {
      console.log("❌ Meeting not found");
      return res.status(404).json({ message: "Meeting not found" });
    }

    console.log("✅ Meeting updated");
    return res.status(200).json({
      success: true,
      message: "Meeting ended successfully",
    });

  } catch (err) {
    console.error("🔥 ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/*
=====================================
4. USER METRICS / HISTORY
=====================================
*/
router.get("/user-history", VerifyToken, async (req, res) => {
  try {
    // Aligned with the typical req.user setup populated by VerifyToken
    const userId = req.user._id || req.user.id || req.userId;

    const meetings = await Meeting.find({
      participants: userId,
    })
      .populate("participants", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      meetings: meetings
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error",
    });
  }
});

// Export Router Configuration
module.exports = router;