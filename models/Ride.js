const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  route: { type: [String], required: true }, 
  date: { type: String, required: true },
  time: { type: String, required: true },
  seats: { type: Number, required: true },
  price: { type: Number, required: true },
  driverName: { type: String, required: true },
  driverPhone: { type: String, required: true },
  
  // 🚨 ADDED: This guarantees the specific car data is synced to this exact ride!
  carUsed: {
    carModel: { type: String },
    carRegistration: { type: String },
    mileage: { type: String }
  },

  passengers: { type: [String], default: [] },
  cancelledPassengers: { type: [String], default: [] },
  paidPassengers: { type: [String], default: [] },
  completedPassengers: { type: [String], default: [] },
  
  status: { type: String, default: 'active' },

  osrmPolyline: { type: mongoose.Schema.Types.Mixed, default: null }, 
  routeDistanceKm: { type: String, default: null }

}, { 
  timestamps: true 
});

const Ride = mongoose.model('Ride', rideSchema);
module.exports = Ride;