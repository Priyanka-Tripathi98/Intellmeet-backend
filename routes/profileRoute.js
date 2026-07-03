const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");

const uploadImages = require("../middleware/upload");
const User = require("../models/userModels");

// ✅ Import your correct profile controller
const { updateProfile } = require("../controller/profileController");
const { VerifyToken } = require("../middleware/VerifyTokenMiddleware");

// ℹ️ GET PROFILE DATA
router.get("/", VerifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// ✅ FIX: Add uploadImages middleware so Express can parse the form text fields and the image file
router.put("/update", VerifyToken, uploadImages.single("avatar"), async (req, res) => {
  try {
    console.log("BODY:", req.body); // Now this won't be empty!
    console.log("FILE:", req.file);

    // Safeguard check: support both token formats just in case
    const userId = req.user.id || req.user.userId; 

    if (!userId) {
      return res.status(401).json({ success: false, message: "User ID missing from token" });
    }

    const { name, email, username } = req.body;

    let updateData = {
      name,
      email,
      username
    };

    // If a new image was uploaded, append it to the update object
    if (req.file) {
      updateData.profilePic = `http://localhost:3001/uploads/${req.file.filename}`;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select("-password");

    return res.json({
      success: true,
      user: updatedUser,
    });

  } catch (error) {
    console.error("CRASH ERROR:", error); // Look at your node terminal to see the exact crash details!
    return res.status(500).json({
      success: false,
      message: "Profile update failed",
    });
  }
});
// 🔐 CHANGE PASSWORD
router.put("/change-password", VerifyToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id); // Fixed: req.user.id matches token schema

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/forgot-password", async (req, res) => {
  res.json({ message: "Reset link sent to email" });
});

module.exports = router;