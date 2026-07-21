const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // CORE AUTH (OTP Ready)
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true }, 
  
  // 🚨 NEW: Instagram-style Profile Picture (Base64 String)
  profilePicture: { type: String, default: "" },
  
  // EMAIL DETAILS (Optional & Updatable)
  email: { type: String, default: "" }, 
  isEmailVerified: { type: Boolean, default: false },
  altEmail: { type: String, default: "" }, 
  
  // EMERGENCY CONTACTS
  emgName1: { type: String, default: "" }, 
  emgPhone1: { type: String, default: "" },
  emgName2: { type: String, default: "" }, 
  emgPhone2: { type: String, default: "" },

  // LEGACY/SOCIAL AUTH (Disabled but safe)
  password: { type: String, required: false }, 
  authProvider: { type: String, default: "local" }, 
  
  // DRIVER VERIFICATION
  isDriverVerified: { type: Boolean, default: false },   
  drivingLicense: { type: String, default: "" },
  
  // 🚨 THE FIX: Replaced Front & Back with a single unified image
  dlImage: { type: String, default: "" },
  
  // THE NEW MULTI-CAR ARRAY
  cars: [
    {
      carModel: { type: String },
      carRegistration: { type: String },
      mileage: { type: String },
      rcImage: { type: String, default: "" }
    }
  ],

  // ==========================================
  // 🚨 NEW: HYBRID RATING SYSTEM (FAST READS)
  // ==========================================
  rating: { type: Number, default: 0 }, // Overall Average
  totalRatings: { type: Number, default: 0 }, // Total people who rated
  womenSafetyRating: { type: Number, default: 0 }, // Women's Safety Average
  womenSafetyCount: { type: Number, default: 0 } // Total people who gave a safety rating

}, { 
  timestamps: true 
});

const User = mongoose.model('User', userSchema);
module.exports = User;