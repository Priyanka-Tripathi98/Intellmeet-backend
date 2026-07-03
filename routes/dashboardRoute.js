// routes/dashboardRoute.js
const express = require("express");
const router = express.Router();
const Meeting = require("../models/meetingModel");
const { VerifyToken } = require("../middleware/VerifyTokenMiddleware");

// Ensure VerifyToken middleware runs before your handler
router.get("/", VerifyToken, async (req, res) => {
    try {
        // req.user.id (or req.user._id) comes directly from your VerifyToken middleware decode step
        const userId = req.user.id; 

        // Find meetings where this user is either the host OR a participant
        const userMeetings = await Meeting.find({
            $or: [
                { hostId: userId }, 
                { participants: userId }
            ]
        }).sort({ createdAt: -1 }); // Show newest meetings first

        res.status(200).json(userMeetings);
    } catch (error) {
        console.error("Dashboard data fetch error:", error);
        res.status(500).json({ error: "Failed to load dashboard metrics" });
    }
});

module.exports = router;