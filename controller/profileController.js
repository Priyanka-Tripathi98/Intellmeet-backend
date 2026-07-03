const User = require("../models/userModels");

exports.updateProfile = async (req, res) => {
  try {
    // 1. Debug logs to track down transmission issues instantly in terminal
    console.log("--- Profile Update Triggered ---");
    console.log("TEXT FIELDS (req.body):", req.body);
    console.log("FILE OBJECT (req.file):", req.file);

    const userId = req.user.id; // Extracted safely from your authentication token middleware
    const { name, email } = req.body;

    // 2. Build the basic data block for textual modifications
    let updateData = {
      name,
      email
    };

    // 3. File validation check
    // If the user attached a new file image, process and build an absolute web address string
    if (req.file) {
     updateData.profilePic = req.file.path;
     console.log("💾 Generated URL saved to MongoDB:", req.file.path);
    }

    // 4. Update the document in MongoDB
    // { new: true } makes sure mongoose returns the FRESH updated data payload instead of the old data payload
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select("-password"); // Security measure: Do not leak the hashed password string back to frontend

    console.log("🚀 Database state successfully saved. Returning payload to Client.");

    // 5. Send back the modern structural payload
    return res.json({ 
      success: true,
      user: updatedUser 
    });

  } catch (error) {
    console.error("❌ Critical breakdown in updateProfile controller:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server update pipeline failed. Check system console logs." 
    });
  }
};