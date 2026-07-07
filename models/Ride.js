const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  // The new Master Route Array!
  route: { type: [String], required: true }, 
  date: { type: String, required: true },
  time: { type: String, required: true },
  seats: { type: Number, required: true },
  price: { type: Number, required: true },
  driverName: { type: String, required: true },
  driverPhone: { type: String, required: true },
  
  // The array to hold passenger phone numbers/emails!
  passengers: { type: [String], default: [] },
  
  // Tracks users who were cancelled so it stays in their history!
  cancelledPassengers: { type: [String], default: [] },
  
  // 👇 BRAND NEW: Arrays for the double-handshake completion! 👇
  paidPassengers: { type: [String], default: [] },
  completedPassengers: { type: [String], default: [] },
  
  status: { type: String, default: 'active' },

  // 🚨 THE FIX: Tell Mongoose to allow the Map Brain data! 🚨
  osrmPolyline: { type: mongoose.Schema.Types.Mixed, default: null }, // 'Mixed' allows the massive geometry object
  routeDistanceKm: { type: String, default: null }

}, { 
  timestamps: true 
});

const Ride = mongoose.model('Ride', rideSchema);
module.exports = Ride;