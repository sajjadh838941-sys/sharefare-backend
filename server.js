require('dns').setDefaultResultOrder('ipv4first'); // 🚨 Keeps general network traffic stable
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Resend } = require('resend'); 
const mongoose = require('mongoose');
const http = require('http'); 
const { Server } = require('socket.io');
const crypto = require('crypto'); 

const resend = new Resend(process.env.RESEND_API_KEY); 

const User = require('./models/User');
const Message = require('./models/Messages');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Database Connected Successfully!'))
  .catch((err) => console.log('Database Connection Error:', err));

// ==========================================
// 🛡️ THE PING HACK
// ==========================================
app.get('/ping', (req, res) => {
  res.status(200).send('Server is awake and healthy! 🚗');
});

// ==========================================
// 0. OTP DATABASE 
// ==========================================
const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } 
});
const Otp = mongoose.model('Otp', otpSchema);

// ==========================================
// 0.5. SECURE SESSIONS DATABASE
// ==========================================
const sessionSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  sessionToken: { type: String, required: true, unique: true },
  deviceName: { type: String, default: 'Unknown Device' },
  os: { type: String, default: 'web' },
  location: { type: String, default: 'Assam, India' }, 
  lastActive: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});
const Session = mongoose.model('Session', sessionSchema);

// ==========================================
// 🚀 0.9. SECURITY MIDDLEWARE (THE BOUNCER)
// ==========================================
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Unauthorized: Missing token." });
    }

    const token = authHeader.split(' ')[1];
    const activeSession = await Session.findOne({ sessionToken: token });

    if (!activeSession) {
      return res.status(403).json({ error: "Session revoked. Please log in again." });
    }

    activeSession.lastActive = Date.now();
    await activeSession.save();

    req.user = { phone: activeSession.phone, token: token };
    next();
  } catch (error) {
    res.status(500).json({ error: "Authentication error." });
  }
};

// ==========================================
// 1. RIDE REQUEST DATABASE & MAIN RIDE SCHEMA
// ==========================================

const rideSchema = new mongoose.Schema({
  route: { type: [String], required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  seats: { type: Number, required: true },
  price: { type: Number, required: true },
  driverName: { type: String, required: true },
  driverPhone: { type: String, required: true },
  
  // 🚨 NEW: Stamping the avatar into the ride ticket for quick rendering!
  driverAvatar: { type: String, default: "" }, 

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
  routeDistanceKm: { type: String, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Ride = mongoose.models.Ride || mongoose.model('Ride', rideSchema);


const requestSchema = new mongoose.Schema({
  rideId: String,
  passengerPhone: String, 
  passengerName: String,
  driverPhone: String,    
  seatsRequested: { type: Number, default: 1 }, 

  // 🚨 NEW: Capture passenger's specific Micro-Transit route 
  subRouteStart: { type: String, default: null },
  subRouteEnd: { type: String, default: null },
  offeredPrice: { type: Number, default: null },

  status: { type: String, default: 'pending' }, 
  createdAt: { type: Date, default: Date.now } 
});
const RideRequest = mongoose.model('RideRequest', requestSchema);

// ==========================================
// 2. THE 1-HOUR REJECTION COOLDOWN DATABASE
// ==========================================
const cooldownSchema = new mongoose.Schema({
  passengerPhone: String, 
  driverPhone: String,    
  createdAt: { type: Date, default: Date.now, expires: 3600 } 
});
const Cooldown = mongoose.model('Cooldown', cooldownSchema);

// ==========================================
// 3. COLD STORAGE: EXPIRED RIDES DATABASE
// ==========================================
const expiredRideSchema = new mongoose.Schema({
  originalRideId: String, 
  status: { type: String, default: 'expired' },
  expiredAt: { type: Date, default: Date.now }
}, { strict: false });
const ExpiredRide = mongoose.model('ExpiredRide', expiredRideSchema);

// ==========================================
// 4. USER FETCHING & UPDATING ROUTES
// ==========================================
app.get('/users/email/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

app.get('/users/phone/:phone', async (req, res) => {
  try {
    const user = await User.findOne({ phone: req.params.phone });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user by phone" });
  }
});

app.post('/users/verify-driver', requireAuth, async (req, res) => {
  try {
    const { dlNumber, cars } = req.body; 
    const phone = req.user.phone; 

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: "User not found." });

    user.drivingLicense = dlNumber; 
    user.cars = cars; 
    user.isDriverVerified = true;

    await user.save();
    res.status(200).json({ success: true, user, message: "Driver verified successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Server error during verification." });
  }
});

app.put('/users/update-profile', requireAuth, async (req, res) => {
  try {
    const { name, email, isEmailVerified, altEmail, emgName1, emgPhone1, emgName2, emgPhone2 } = req.body;
    const phone = req.user.phone; 

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: "User not found." });

    user.name = name;
    user.email = email;
    user.isEmailVerified = isEmailVerified;
    user.altEmail = altEmail;
    user.emgName1 = emgName1;
    user.emgPhone1 = emgPhone1;
    user.emgName2 = emgName2;
    user.emgPhone2 = emgPhone2;

    await user.save();
    res.status(200).json({ success: true, user, message: "Profile updated successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Server error during profile update." });
  }
});

app.post('/users/update-avatar', requireAuth, async (req, res) => {
  try {
    const { profilePicture } = req.body;
    const phone = req.user.phone; 

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: "User not found." });

    user.profilePicture = profilePicture || "";
    await user.save();
    
    res.status(200).json({ 
      success: true, 
      user, 
      message: profilePicture ? "Profile picture updated!" : "Profile picture removed." 
    });
  } catch (error) {
    console.error("Avatar Upload Error:", error);
    res.status(500).json({ error: "Server error during avatar upload." });
  }
});

app.delete('/users/delete-account', requireAuth, async (req, res) => {
  try {
    const phone = req.user.phone; 
    await User.findOneAndDelete({ phone });
    await Session.deleteMany({ phone });
    const Otp = mongoose.model('Otp'); 
    await Otp.deleteMany({ phone });

    const Ride = mongoose.models.Ride;
    if (Ride) {
      await Ride.deleteMany({ driverPhone: phone });
    }

    res.status(200).json({ message: "Account permanently deleted." });
  } catch (error) {
    console.error("Error deleting account:", error);
    res.status(500).json({ error: "Failed to delete account from server." });
  }
});

// ==========================================
// 5. AUTHENTICATION & OTP
// ==========================================
app.post('/auth/request-email-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.findOneAndUpdate(
      { phone: email }, 
      { otp: generatedOtp, createdAt: Date.now() },
      { upsert: true, returnDocument: 'after' } 
    );

    res.status(200).json({ success: true, message: "OTP processed." });

    if (process.env.RESEND_API_KEY) {
      resend.emails.send({
        from: 'ShareFare Axom <noreply@sharefareaxom.in>', 
        to: email, 
        subject: 'Your ShareFare Axom Verification Code',
        template: { id: 'email-verification', variables: { OTP_CODE: generatedOtp } }
      }).then(() => console.log(`✅ HTTP Template Email Sent Successfully via Resend!`))
        .catch(err => console.log("❌ Resend API Error:", err));
    } else {
      console.log(`⚠️ RESEND_API_KEY Missing! Fallback OTP for ${email}: ${generatedOtp}`);
    }
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: "Server error during OTP generation." });
  }
});

app.post('/auth/verify-email-otp', async (req, res) => {
  try {
    const { email, otp, name, phone, deviceName, os } = req.body; 

    const validOtp = await Otp.findOne({ phone: email, otp });
    if (!validOtp) return res.status(400).json({ error: "Invalid or expired OTP." });

    await Otp.deleteOne({ _id: validOtp._id });

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user && !name) {
      return res.status(404).json({ error: "Account not found! Please go to the Sign Up page." });
    }

    if (!user) {
      user = new User({ email, phone, name: name.trim(), isEmailVerified: true }); 
      await user.save();
      isNewUser = true;
    }
    
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const newSession = new Session({ phone: user.phone, sessionToken: sessionToken, deviceName: deviceName || 'Unknown Device', os: os || 'web' });
    await newSession.save();
    
    res.status(200).json({ success: true, user, sessionToken, isNewUser, message: "Authentication successful." });
  } catch (error) {
    res.status(500).json({ error: "Server error during verification." });
  }
});

// ==========================================
// 5.5. ACTIVE SESSIONS MANAGEMENT
// ==========================================
app.get('/sessions/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const sessions = await Session.find({ phone }).sort({ lastActive: -1 });
    res.status(200).json({ sessions });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch sessions." });
  }
});

app.delete('/sessions/revoke/:sessionToken', async (req, res) => {
  try {
    const { sessionToken } = req.params;
    const session = await Session.findOneAndDelete({ sessionToken });
    if (session) io.to(session.phone).emit('session_killed', { revokedToken: sessionToken });
    res.status(200).json({ message: "Device successfully logged out." });
  } catch (error) {
    res.status(500).json({ error: "Failed to revoke session." });
  }
});

app.post('/sessions/revoke-others', requireAuth, async (req, res) => {
  try {
    const phone = req.user.phone;
    const currentSessionToken = req.user.token;
    await Session.deleteMany({ phone: phone, sessionToken: { $ne: currentSessionToken } });
    io.to(phone).emit('all_others_killed', { survivorToken: currentSessionToken });
    res.status(200).json({ message: "All other devices logged out." });
  } catch (error) {
    res.status(500).json({ error: "Failed to revoke other sessions." });
  }
});

// ==========================================
// 6. RIDE CREATION & SEARCH
// ==========================================
app.post('/rides', requireAuth, async (req, res) => {
  try {
    const { route, date, time, seats, price, driverName, osrmPolyline, routeDistanceKm, carUsed } = req.body;
    const driverPhone = req.user.phone; 

    // 🚨 THE AVATAR INJECTION: Fetch the driver's full profile to pull their Avatar
    const driverProfile = await User.findOne({ phone: driverPhone });
    const driverAvatar = driverProfile?.profilePicture || "";

    const newRide = new Ride({ 
      route, date, time, seats, price, driverName, driverPhone,
      driverAvatar, // Automatically stamped here
      osrmPolyline, routeDistanceKm, carUsed 
    });
    
    await newRide.save();
    res.status(201).json({ message: "Ride posted successfully!", ride: newRide });
  } catch (error) {
    console.error("Post Ride Error:", error);
    res.status(400).json({ error: "Failed to post ride" });
  }
});

app.get('/rides/search', async (req, res) => {
  try {
    const { date, seats } = req.query; 
    const ridesOnDate = await Ride.find({ date: date, seats: { $gte: parseInt(seats) || 1 } });
    res.status(200).json({ rides: ridesOnDate });
  } catch (error) {
    res.status(500).json({ error: "Failed to search for rides." });
  }
});

app.get('/rides/:id', async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }
    res.json(ride);
  } catch (error) {
    console.error("Error fetching single ride:", error);
    res.status(500).json({ error: 'Failed to fetch ride details' });
  }
});

// ==========================================
// 7. RIDE REQUESTS
// ==========================================
// ==========================================
app.post('/requests/send', requireAuth, async (req, res) => {
  try {
    // 🚨 UPDATED: Destructure the new sub-route fields from req.body
    const { rideId, passengerName, driverPhone, seatsRequested, subRouteStart, subRouteEnd, offeredPrice } = req.body;
    const passengerPhone = req.user.phone; 

    const isBlocked = await Cooldown.findOne({ passengerPhone, driverPhone });
    if (isBlocked) return res.status(403).json({ error: "This driver recently declined your request. Please wait 1 hour." });

    const existing = await RideRequest.findOne({ rideId, passengerPhone, status: 'pending' });
    if (existing) return res.status(400).json({ error: "You already requested this ride!" });

    // 🚨 UPDATED: Save the Micro-Transit context to the database
    const newRequest = new RideRequest({ 
      rideId, 
      passengerPhone, 
      passengerName, 
      driverPhone, 
      seatsRequested: seatsRequested || 1,
      subRouteStart, 
      subRouteEnd, 
      offeredPrice 
    });
    
    await newRequest.save();

    io.to(driverPhone).emit('new_request_inbox');
    res.status(200).json({ message: "Request sent to driver!" });
  } catch (error) {
    console.error("Failed to send request:", error);
    res.status(500).json({ error: "Failed to send request." });
  }
});

app.get('/requests/inbox/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const requests = await RideRequest.find({ driverPhone: phone, status: 'pending' }).sort({ createdAt: -1 });
    res.status(200).json({ requests });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch requests." });
  }
});

app.post('/requests/respond', requireAuth, async (req, res) => {
  try {
    const { requestId, status } = req.body; 
    const driverPhone = req.user.phone; 

    const request = await RideRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (request.driverPhone !== driverPhone) return res.status(403).json({ error: "Unauthorized." });

    if (status === 'denied') {
      request.status = 'denied';
      await request.save();
      const newCooldown = new Cooldown({ passengerPhone: request.passengerPhone, driverPhone: request.driverPhone });
      await newCooldown.save();
      io.to(request.passengerPhone).emit('ride_request_result', { status: 'denied', rideId: request.rideId });
      return res.status(200).json({ message: "Request denied." });
    }

    if (status === 'accepted') {
      const ride = await Ride.findById(request.rideId);
      if (!ride || ride.seats < request.seatsRequested) return res.status(400).json({ error: "Not enough seats available." });

      ride.seats -= request.seatsRequested;
      for(let i = 0; i < request.seatsRequested; i++) {
        ride.passengers.push(request.passengerPhone);
      }
      await ride.save();
      await RideRequest.findByIdAndDelete(requestId);

      const driver = await User.findOne({ phone: request.driverPhone });
      const autoMessage = new Message({ senderId: request.driverPhone, receiverId: request.passengerPhone, text: "Ride confirmed! You can now chat here to coordinate pickup." });
      await autoMessage.save();

      io.to(request.passengerPhone).emit('ride_request_result', {
        status: 'accepted', 
        rideId: request.rideId, 
        driverPhone: request.driverPhone, 
        driverName: driver.name, 
        carModel: ride.carUsed?.carModel || 'Unknown', 
        carRegistration: ride.carUsed?.carRegistration || 'Unknown'
      });
      return res.status(200).json({ message: "Ride accepted and request deleted!" });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to respond." });
  }
});

// ==========================================
// 8. PAYMENT & HANDSHAKES
// ==========================================
app.post('/rides/request-payment-confirmation', async (req, res) => {
  try {
    const { rideId, requesterPhone, targetPhone, amount, method, role } = req.body;
    io.to(targetPhone).emit('payment_request_received', { rideId, requesterPhone, amount, method, role });
    res.status(200).json({ message: "Confirmation request sent to partner!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to send confirmation request." });
  }
});

app.post('/rides/request-ride-completion', async (req, res) => {
  try {
    const { rideId, requesterPhone, targetPhone, role } = req.body;
    io.to(targetPhone).emit('ride_completion_requested', { rideId, requesterPhone, role });
    res.status(200).json({ message: "Handshake sent to partner!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to send completion request." });
  }
});

app.post('/rides/reject-ride-completion', async (req, res) => {
  try {
    const { rideId, targetPhone } = req.body;
    io.to(targetPhone).emit('ride_completion_rejected', { rideId });
    res.status(200).json({ message: "Rejection notification sent." });
  } catch (error) {
    res.status(500).json({ error: "Failed to send rejection." });
  }
});

app.post('/rides/complete-passenger', async (req, res) => {
  try {
    const { rideId, passengerPhone } = req.body;
    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    if (!ride.paidPassengers) ride.paidPassengers = [];
    if (!ride.paidPassengers.includes(passengerPhone)) ride.paidPassengers.push(passengerPhone);

    if (!ride.completedPassengers) ride.completedPassengers = [];
    if (!ride.completedPassengers.includes(passengerPhone)) ride.completedPassengers.push(passengerPhone);

    const allDone = ride.passengers.length > 0 && ride.passengers.every(p => ride.completedPassengers.includes(p));
    if (allDone) { ride.status = 'completed'; }
    await ride.save();

    const driver = await User.findOne({ phone: ride.driverPhone });
    const passenger = await User.findOne({ phone: passengerPhone });

    const msgToPassenger = new Message({ senderId: ride.driverPhone, receiverId: passengerPhone, text: `Ride Complete! You paid INR ${ride.price} to ${driver?.name || 'your driver'}.` });
    await msgToPassenger.save();

    const msgToDriver = new Message({ senderId: passengerPhone, receiverId: ride.driverPhone, text: `Payment Confirmed! You received payment from ${passenger?.name || 'your passenger'}.` });
    await msgToDriver.save();

    io.to(passengerPhone).emit('payment_completed_success', { rideId, passengerPhone });
    io.to(ride.driverPhone).emit('payment_completed_success', { rideId, passengerPhone });
    io.to(passengerPhone).emit('receive_message', msgToPassenger);
    io.to(ride.driverPhone).emit('receive_message', msgToDriver);

    if (allDone) io.to(ride.driverPhone).emit('ride_fully_completed', { rideId });
    res.status(200).json({ message: "Passenger marked as complete!", allDone });
  } catch (error) {
    res.status(500).json({ error: "Failed to update status." });
  }
});

app.get('/rides/check-payment/:rideId/:passengerPhone', async (req, res) => {
  try {
    const { rideId, passengerPhone } = req.params;
    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ error: "Ride not found" });
    const isPaid = ride.paidPassengers && ride.paidPassengers.includes(passengerPhone);
    res.status(200).json({ isPaid });
  } catch (error) {
    res.status(500).json({ error: "Failed to check payment." });
  }
});

// ==========================================
// 9. MESSAGING & NOTIFICATIONS
// ==========================================
io.on('connection', (socket) => {
  socket.on('join_private_room', (phone) => { socket.join(phone); });
  socket.on('send_private_message', (data) => { io.to(data.receiverId).emit('receive_message', data); });
});

app.post('/messages', requireAuth, async (req, res) => {
  try {
    const { receiverId, text } = req.body;
    const senderId = req.user.phone; 

    const newMessage = new Message({ senderId, receiverId, text });
    await newMessage.save();
    res.status(201).json({ message: "Message sent!", data: newMessage });
  } catch (error) {
    res.status(500).json({ error: "Failed to send message." });
  }
});

app.get('/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const conversation = await Message.find({ $or: [ { senderId: user1, receiverId: user2 }, { senderId: user2, receiverId: user1 } ] }).sort({ createdAt: 1 }); 
    res.status(200).json({ messages: conversation });
  } catch (error) {
    res.status(500).json({ error: "Failed to load conversation." });
  }
});

app.get('/inbox/:userId', async (req, res) => {
  try {
    const { userId } = req.params; 
    const allMessages = await Message.find({ $or: [{ senderId: userId }, { receiverId: userId }] }).sort({ createdAt: -1 }); 
    const chatPartners = new Set();
    const inbox = [];
    
    for (let msg of allMessages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (!chatPartners.has(partnerId)) {
        chatPartners.add(partnerId);
        const partnerUser = await User.findOne({ phone: partnerId }); 
        const partnerName = partnerUser ? partnerUser.name : partnerId; 
        const unreadCount = await Message.countDocuments({ senderId: partnerId, receiverId: userId, isRead: false });
        inbox.push({ partnerId, partnerName, latestMessage: msg.text, time: msg.createdAt, unreadCount });
      }
    }
    res.status(200).json({ inbox });
  } catch (error) {
    res.status(500).json({ error: "Failed to load inbox." });
  }
});

app.post('/messages/mark-read', async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;
    await Message.updateMany({ senderId, receiverId, isRead: false }, { $set: { isRead: true } });
    io.to(receiverId).emit('messages_read');
    res.status(200).json({ message: "Messages marked as read!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to clear notifications." });
  }
});

app.get('/notifications/counts/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const unreadMessages = await Message.countDocuments({ receiverId: phone, isRead: false });
    const pendingRequests = await RideRequest.countDocuments({ driverPhone: phone, status: 'pending' }); 
    res.status(200).json({ totalUnread: unreadMessages + pendingRequests, messages: unreadMessages, requests: pendingRequests });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch notification counts." });
  }
});

// ==========================================
// 10. RIDE CANCELLATION
// ==========================================
app.post('/rides/cancel-active', requireAuth, async (req, res) => {
  try {
    const { rideId, passengerPhone, role, compensationMsg } = req.body;
    const cancellerPhone = req.user.phone; 

    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ error: "Ride not found." });

    const seatsToRestore = ride.passengers.filter(p => p === passengerPhone).length;
    ride.passengers = ride.passengers.filter(p => p !== passengerPhone);
    if (!ride.cancelledPassengers) ride.cancelledPassengers = [];
    if (!ride.cancelledPassengers.includes(passengerPhone)) ride.cancelledPassengers.push(passengerPhone);
    ride.seats += seatsToRestore; 
    await ride.save();

    const canceller = await User.findOne({ phone: cancellerPhone });
    let notifText = "";
    let receiverPhone = role === 'driver' ? passengerPhone : ride.driverPhone;

    if (role === 'driver') {
      const carInfo = ride.carUsed ? `${ride.carUsed.carModel} (${ride.carUsed.carRegistration})` : 'Driver';
      notifText = `SYSTEM MESSAGE: Your ride has been cancelled by ${canceller.name} [${carInfo}].\nMessage from driver: "${compensationMsg}"`;
    } else {
      notifText = `SYSTEM MESSAGE: Passenger ${canceller.name} has cancelled their confirmed seat.\nReason: "${compensationMsg}"`;
    }

    const sysMessage = new Message({ senderId: cancellerPhone, receiverId: receiverPhone, text: notifText, isRead: false });
    await sysMessage.save();

    io.to(receiverPhone).emit('ride_cancelled_alert', { 
      cancellerName: canceller.name, 
      role, 
      message: compensationMsg, 
      carDetails: ride.carUsed ? `${ride.carUsed.carModel} (${ride.carUsed.carRegistration})` : '' 
    });
    io.to(receiverPhone).emit('receive_message', sysMessage);

    res.status(200).json({ message: "Cancellation processed!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to cancel ride." });
  }
});

// ==========================================
// 11. HISTORY ROUTE 
// ==========================================
app.get('/rides/history/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const now = new Date();

    const processAndMoveRides = async (ridesArray) => {
      const active = [];
      const newlyExpired = [];

      for (let ride of ridesArray) {
        let r = ride.toObject ? ride.toObject() : ride;
        const rideTime = new Date(`${r.date} ${r.time}`);
        const hoursPassed = (now - rideTime) / (1000 * 60 * 60);

        const hasPassengers = r.passengers && r.passengers.length > 0;

        if (r.status === 'completed') {
          if (hoursPassed >= 24) {
            const expiredDoc = new ExpiredRide({ ...r, status: 'completed', originalRideId: r._id });
            await expiredDoc.save();
            await Ride.findByIdAndDelete(r._id);
            newlyExpired.push(expiredDoc.toObject());
          } else {
            active.push(r);
          }
        } else {
          let isExpired = false;
          
          if (hasPassengers && hoursPassed >= 24) {
            isExpired = true; 
          } else if (!hasPassengers && hoursPassed >= 48) {
            isExpired = true; 
          }

          if (isExpired) {
            const expiredDoc = new ExpiredRide({ ...r, status: 'expired', originalRideId: r._id });
            await expiredDoc.save();
            await Ride.findByIdAndDelete(r._id);
            newlyExpired.push(expiredDoc.toObject());
          } else {
            if (!r.status) r.status = 'active';
            active.push(r);
          }
        }
      }
      return { active, newlyExpired };
    };

    const rawDriving = await Ride.find({ driverPhone: phone });
    const rawRiding = await Ride.find({ passengers: phone });
    const rawCancelledRiding = await Ride.find({ cancelledPassengers: phone });

    const pendingRequests = await RideRequest.find({ passengerPhone: phone, status: 'pending' }); 
    const pendingRideIds = pendingRequests.map(req => req.rideId);
    const rawPending = await Ride.find({ _id: { $in: pendingRideIds } });

    const drivingClean = await processAndMoveRides(rawDriving);
    const ridingClean = await processAndMoveRides(rawRiding);
    const pendingClean = await processAndMoveRides(rawPending);

    const cancelledClean = rawCancelledRiding.map(r => ({ ...(r.toObject ? r.toObject() : r), status: 'cancelled' }));
    const pastExpiredDriving = await ExpiredRide.find({ driverPhone: phone });
    const pastExpiredRiding = await ExpiredRide.find({ passengers: phone });
    const pastExpiredPending = await ExpiredRide.find({ originalRideId: { $in: pendingRideIds } });

    const finalDriving = [...drivingClean.active, ...drivingClean.newlyExpired, ...pastExpiredDriving].map(ride => {
      let r = ride.toObject ? ride.toObject() : ride;
      const hasPassengers = r.passengers && r.passengers.length > 0;
      const allDone = hasPassengers && r.completedPassengers && r.passengers.every(p => r.completedPassengers.includes(p));
      if (r.status === 'expired' && allDone) { r.status = 'completed'; }
      if (r.passengers.length === 0 && r.cancelledPassengers?.length > 0) return { ...r, status: 'cancelled' };
      return r;
    });

    const finalRiding = [...ridingClean.active, ...ridingClean.newlyExpired, ...pastExpiredRiding, ...cancelledClean].map(ride => {
      let r = ride.toObject ? ride.toObject() : ride;
      const hasPassengers = r.passengers && r.passengers.length > 0;
      const allDone = hasPassengers && r.completedPassengers && r.passengers.every(p => r.completedPassengers.includes(p));
      if (r.status === 'expired' && allDone) { r.status = 'completed'; }
      return r;
    });

    res.status(200).json({ 
      driving: finalDriving, 
      riding: finalRiding, 
      pending: [...pendingClean.active, ...pendingClean.newlyExpired, ...pastExpiredPending] 
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch history." });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Master Server is running beautifully on port ${PORT}`);
});