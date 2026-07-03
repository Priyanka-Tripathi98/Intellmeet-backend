const mongoose= require ("mongoose");

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log("Database connection successful");
    } catch (error) {
        console.error("Database connection failed:", error.message);
        // Exit process with failure
        process.exit(1);
    }
}

module.exports = connectDB;