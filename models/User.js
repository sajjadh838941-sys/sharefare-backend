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
      rcImage: { type: String, default: "" },
      // 🚨 NEW: Car Ownership Details
      isOwnedByUser: { type: Boolean, default: true },
      authorizationImage: { type: String, default: "" }
    }
  ],

  // ==========================================
  // 🚨 NEW: HYBRID RATING SYSTEM (FAST READS)
  // ==========================================
  rating: { type: Number, default: 0 }, 
  totalRatings: { type: Number, default: 0 }, 
  womenSafetyRating: { type: Number, default: 0 }, 
  womenSafetyCount: { type: Number, default: 0 } 

}, { 
  timestamps: true 
});

const User = mongoose.model('User', userSchema);
module.exports = User;