const users = require("../models/userModels")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken");

exports.loginUser = async(req, res)=>{
    try{
        const {email, password} = req.body;
        console.log(req.body)

        const user = await users.findOne({email});

        if(!user){
            return res.status(400).json({message:"User not found"})
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch){
            return res.status(400).json({message:"Invalid email or password"})
        }
         const token = jwt.sign(
          { id: user._id,
            email: user.email},
            process.env.JWT_SECRET,
            {expiresIn:"1h"}
        );
        res.status(200).json({message:"Login successful", token: token, email: user.email});
    }catch(error){
        console.log("Error logging in user:", error.message);
        res.status(500).json({message:"Error logging in user"})
    }
}