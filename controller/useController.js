const users = require("../models/userModels")
const bcrypt = require("bcrypt")
exports.registerUser = async(req,res)=>{
    try {
        if(!req.body){
            return res.status(400).json({message:"Please provide user data"})
        }
        const {name,email,password} = req.body
        if(!name || !email || !password){
            return res.status(400).json({message:"Please provide all required fields"})
        }
        const existingUser = await users.findOne({ email })
        if(existingUser){
            return res.status(400).json({message:"User already exists"})
        }
        const salt = await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password,salt);

        const newUser = new users({
            name,
            email,
            password: hashedPassword
        })
        await newUser.save()
        res.status(201).json({message:"User registered successfully"})  
        console.log(req.body)
    } catch (error) {
        console.error("Error registering user:", error.message);
        res.status(500).json({ message: "Error registering user" });
    }
}