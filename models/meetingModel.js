const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String
    },
    meetingLink: {
      type: String
    },
    meetingCode: {
      type: String,
      required: true,
      unique: true,
    },
    // FIX 1 & 2: Changed from 'ScheduledTime: data' to 'time: Date' to match your frontend payload
    time: {
      type: Date,
      required: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // FIX 4: Updated enum values to cleanly match your default 'scheduled' value
    status: { 
      type: String, 
      default: 'scheduled', 
      enum: ['scheduled', 'active', 'completed'] 
    },
    messages: [
      {
        sender: String,
        text: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    transcript: {
      type: String,
      default: "",
    },
    aiNotes: {
      summary: {
        type: String,
        default:""
      },
      keyPoints:[{
        type: String
      }],
      actionItems:[
        {
          assigneeName:{
            type: String
          },
          taskDetail:{
            type: String
          },
          dateBadge:{
            type: String
          },
        },
      ],
    },
    // FIX 3: Removed default: Date.now from startTime so it won't override future entries
    startTime: {
      type: Date,
    },
    endTime: {
      type: Date,
    },
    recordingUrl: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meeting", meetingSchema);