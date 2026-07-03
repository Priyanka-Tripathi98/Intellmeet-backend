const Meeting = require("../models/meetingModel");

// 1. CREATE MEETING
exports.createMeeting = async (req, res) => {
    try {
        const { title, description, time, status, meetingCode: frontendCode } = req.body;
        
        if (!title || !time) {
            return res.status(400).json({ message: "Please provide a title and date/time." });
        }

        const finalMeetingCode = frontendCode || Math.random().toString(36).substring(2, 8).toUpperCase(); 

        const newMeeting = new Meeting({
            title,
            description: description || "", 
            time,
            status: status || "scheduled", 
            meetingLink: `https://meet.google.com/${finalMeetingCode}`,
            creator: req.user.id,
            meetingCode: finalMeetingCode, 
            participants: [req.user.id]
        }); 

        await newMeeting.save();
        
        res.status(201).json({ 
            success: true, 
            message: "Meeting created successfully", 
            meeting: newMeeting 
        });
    } catch (error) {
        console.error("Error creating meeting:", error.message);
        res.status(500).json({ success: false, message: "Error creating meeting" });
    }
};

// 2. GET USER MEETINGS
exports.getMeetings = async (req, res) => {
  try {
    const now = new Date();

    await Meeting.updateMany(
      {
        time: { $lt: now },
        status: "scheduled"
      },
      {
        $set: {
          status: "completed"
        }
      }
    );

    const meetings = await Meeting.find({
      creator: req.user.id
    });

    res.json(meetings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. JOIN EXISTING MEETING
exports.joinMeeting = async (req, res) => {
    try {
        let { meetingCode } = req.body;

        if (!meetingCode) {
            return res.status(400).json({ message: "Meeting code required" });
        }

        meetingCode = meetingCode.trim().toUpperCase();

        const meetingToJoin = await Meeting.findOne({ meetingCode });

        if (!meetingToJoin) {
            return res.status(404).json({ message: "Meeting not found" });
        }

        if (meetingToJoin.participants.includes(req.user.id)) {
            return res.status(400).json({ message: "Already joined this meeting" });
        }

        meetingToJoin.participants.push(req.user.id);
        await meetingToJoin.save();

        res.status(200).json({ message: "Joined meeting successfully" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error joining meeting" });
    }
};
exports.completeMeeting = async (req, res) => {
  try {
    const { meetingCode } = req.params;

    const meeting = await Meeting.findOneAndUpdate(
      { meetingCode: meetingCode.trim().toUpperCase() },
      {
        status: "completed",
        endTime: new Date()
      },
      { new: true }
    );

    if (!meeting) {
      return res.status(404).json({
        message: "Meeting not found"
      });
    }

    res.status(200).json({
      success: true,
      meeting
    });
  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};
// 4. DELETE MEETING
exports.deleteMeeting = async (req, res) => {
    try {
        const { id } = req.params;

        const meetingToDelete = await Meeting.findById(id);

        if (!meetingToDelete) {
            return res.status(404).json({ message: "Meeting not found" });
        }

        if (meetingToDelete.creator.toString() !== req.user.id) {
            return res.status(403).json({ message: "Unauthorized to delete this meeting" });
        }

        await Meeting.findByIdAndDelete(id);

        res.status(200).json({ message: "Meeting deleted successfully" });

    } catch (error) {
        console.error("Error deleting meeting:", error);
        res.status(500).json({ message: "Error deleting meeting" });
    }
};

// 5. UPDATE AI NOTES & TRANSCRIPT
exports.updateMeetingNotes = async (req, res) => {
    try {
        const { roomId } = req.params;
        const { transcript, summary, keyPoints, actionItems } = req.body;

        const meeting = await Meeting.findOne({ meetingCode: roomId });

        if (!meeting) {
            return res.status(404).json({ message: "Meeting not found" });
        }

        meeting.transcript = transcript;
        meeting.aiNotes.summary = summary;
        meeting.aiNotes.keyPoints = keyPoints;
        meeting.aiNotes.actionItems = actionItems;
        meeting.endTime = new Date();
        meeting.status = "completed";

        await meeting.save();

        res.status(200).json({ message: "Meeting notes saved" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// 6. SAVE RECORDING TO DATABASE (Fixed Path & Integrated Export)
exports.saveRecordingToDB = async (req, res) => {
  try {
    const { meetingCode } = req.body;

    // If req.file exists from GridFS, it will contain an id property!
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file received by server" });
    }

    // Save the GridFS video stream path reference into the database model
    const updatedMeeting = await Meeting.findOneAndUpdate(
      { meetingCode: meetingCode.trim().toUpperCase() },
      { 
        $set: { 
          recordingUrl: `/meetings/video/${req.file.id}` // Points directly to GridFS route
        } 
      },
      { new: true }
    );

    return res.status(200).json({ 
      success: true, 
      message: "Recording successfully saved directly inside MongoDB GridFS!",
      meeting: updatedMeeting 
    });

  } catch (error) {
    console.error("Controller Error saving recording:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};