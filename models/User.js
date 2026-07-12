const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // CORE AUTH (OTP Ready)
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true }, 
  
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
  
  // 🚨 NEW: DL Image Base64 Strings
  dlImageFront: { type: String, default: "" },
  dlImageBack: { type: String, default: "" },
  
  // THE NEW MULTI-CAR ARRAY
  cars: [
    {
      carModel: { type: String },
      carRegistration: { type: String },
      mileage: { type: String },
      // 🚨 NEW: RC Image Base64 String for each specific car
      rcImage: { type: String, default: "" }
    }
  ]
}, { 
  timestamps: true 
});

const User = mongoose.model('User', userSchema);
module.exports = User;