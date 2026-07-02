require('dns').setDefaultResultOrder('ipv4first'); // 🚨 Keeps general network traffic stable
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Resend } = require('resend'); // ✅ NEW API HIRED
const mongoose = require('mongoose');
const http = require('http'); 
const { Server } = require('socket.io');

const resend = new Resend(process.env.RESEND_API_KEY); // ✅ API KEY LOADED

const User = require('./models/User');
const Ride = require('./models/Ride'); 
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
// 0. OTP DATABASE (NEW DEV MODE SCHEMA)
// ==========================================
const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // Auto-deletes after 5 minutes
});
const Otp = mongoose.model('Otp', otpSchema);

// ==========================================
// 1. RIDE REQUEST DATABASE
// ==========================================
const requestSchema = new mongoose.Schema({
  rideId: String,
  passengerPhone: String, 
  passengerName: String,
  driverPhone: String,    
  seatsRequested: { type: Number, default: 1 }, 
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

// Route for the unified Phone Login flow
app.get('/users/phone/:phone', async (req, res) => {
  try {
    const user = await User.findOne({ phone: req.params.phone });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user by phone" });
  }
});

// 🚨 THE FIX: NEW DRIVER VERIFICATION ROUTE! 🚨
app.post('/users/verify-driver', async (req, res) => {
  try {
    const { phone, carModel, carRegistration, dlNumber } = req.body;

    if (!phone) return res.status(400).json({ error: "Phone number is required." });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: "User not found." });

    // Update the user profile with driver details
    user.carModel = carModel;
    user.carRegistration = carRegistration;
    user.drivingLicense = dlNumber; 
    user.isDriverVerified = true;

    await user.save();

    res.status(200).json({ success: true, user, message: "Driver verified successfully!" });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ error: "Server error during verification." });
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

    // 1. Save to Database instantly
    await Otp.findOneAndUpdate(
      { phone: email }, 
      { otp: generatedOtp, createdAt: Date.now() },
      { upsert: true, returnDocument: 'after' } 
    );

    res.status(200).json({ success: true, message: "OTP processed." });

    // 2. Fire the real email via HTTP
    if (process.env.RESEND_API_KEY) {
      resend.emails.send({
        from: 'ShareFare <onboarding@resend.dev>', 
        to: email, 
        subject: 'Your ShareFare Axom Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Welcome to ShareFare Axom! 🚗</h2>
            <p>Your one-time login code is:</p>
            <h1 style="color: #4F46E5; letter-spacing: 5px;">${generatedOtp}</h1>
            <p>This code will securely expire in 5 minutes.</p>
          </div>
        `
      }).then((data) => {
        console.log(`✅ HTTP Email Sent Successfully via Resend!`);
      }).catch((error) => {
        console.log("❌ Resend API Error:", error);
      });
    } else {
      console.log(`⚠️ RESEND_API_KEY Missing! Fallback OTP for ${email}: ${generatedOtp}`);
    }

  } catch (error) {
    console.log("Server error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error during OTP generation." });
    }
  }
});

app.post('/auth/verify-email-otp', async (req, res) => {
  try {
    const { email, otp, name, phone } = req.body; 

    const validOtp = await Otp.findOne({ phone: email, otp });
    if (!validOtp) return res.status(400).json({ error: "Invalid or expired OTP." });

    await Otp.deleteOne({ _id: validOtp._id });

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user && !name) {
      return res.status(404).json({ error: "Account not found! Please go to the Sign Up page." });
    }

    if (!user) {
      user = new User({ 
        email: email,
        phone: phone, 
        name: name.trim(),
        isEmailVerified: true
      }); 
      await user.save();
      isNewUser = true;
    }
    
    res.status(200).json({ 
        success: true, 
        user, 
        isNewUser, 
        message: "Authentication successful." 
    });

  } catch (error) {
    res.status(500).json({ error: "Server error during verification." });
  }
});

// ==========================================
// 6. RIDE CREATION & SEARCH
// ==========================================
app.post('/rides', async (req, res) => {
  try {
    const { route, date, time, seats, price, driverName, driverPhone } = req.body;
    const newRide = new Ride({ route, date, time, seats, price, driverName, driverPhone });
    await newRide.save();
    res.status(201).json({ message: "Ride posted successfully!", ride: newRide });
  } catch (error) {
    res.status(400).json({ error: "Failed to post ride" });
  }
});

app.get('/rides/search', async (req, res) => {
  try {
    const { departure, destination, date } = req.query;
    const ridesOnDate = await Ride.find({ date: date, seats: { $gt: 0 } });
    
    const validRides = ridesOnDate.filter(ride => {
      const cleanRoute = ride.route.map(city => city.toLowerCase().trim());
      const cleanDep = departure.toLowerCase().trim();
      const cleanDest = destination.toLowerCase().trim();
      const startIndex = cleanRoute.indexOf(cleanDep);
      const destIndex = cleanRoute.indexOf(cleanDest);
      return startIndex !== -1 && destIndex !== -1 && startIndex < destIndex;
    });
    res.status(200).json({ rides: validRides });
  } catch (error) {
    res.status(500).json({ error: "Failed to search for rides." });
  }
});

// ==========================================
// 7. RIDE REQUESTS
// ==========================================
app.post('/requests/send', async (req, res) => {
  try {
    const { rideId, passengerPhone, passengerName, driverPhone, seatsRequested } = req.body;
    const isBlocked = await Cooldown.findOne({ passengerPhone, driverPhone });
    if (isBlocked) return res.status(403).json({ error: "This driver recently declined your request. Please wait 1 hour." });

    const existing = await RideRequest.findOne({ rideId, passengerPhone, status: 'pending' });
    if (existing) return res.status(400).json({ error: "You already requested this ride!" });

    const newRequest = new RideRequest({ rideId, passengerPhone, passengerName, driverPhone, seatsRequested: seatsRequested || 1 });
    await newRequest.save();

    io.to(driverPhone).emit('new_request_inbox');
    res.status(200).json({ message: "Request sent to driver!" });
  } catch (error) {
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

app.post('/requests/respond', async (req, res) => {
  try {
    const { requestId, status } = req.body; 
    const request = await RideRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: "Request not found." });

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
        status: 'accepted', rideId: request.rideId, driverPhone: request.driverPhone, driverName: driver.name, carModel: driver.carModel, carRegistration: driver.carRegistration
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

    const msgToPassenger = new Message({
      senderId: ride.driverPhone,
      receiverId: passengerPhone,
      text: `Ride Complete! You paid INR ${ride.price} to ${driver?.name || 'your driver'}.`
    });
    await msgToPassenger.save();

    const msgToDriver = new Message({
      senderId: passengerPhone,
      receiverId: ride.driverPhone,
      text: `Payment Confirmed! You received payment from ${passenger?.name || 'your passenger'}.`
    });
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
  socket.on('join_private_room', (phone) => { 
    socket.join(phone);
  });
  socket.on('send_private_message', (data) => {
    io.to(data.receiverId).emit('receive_message', data);
  });
});

app.post('/messages', async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;
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
    await Message.updateMany(
      { senderId, receiverId, isRead: false },
      { $set: { isRead: true } }
    );
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
app.post('/rides/cancel-active', async (req, res) => {
  try {
    const { rideId, cancellerPhone, passengerPhone, role, compensationMsg } = req.body;
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
      const carInfo = canceller.carModel ? `${canceller.carModel} (${canceller.carRegistration})` : 'Driver';
      notifText = `SYSTEM MESSAGE: Your ride has been cancelled by ${canceller.name} [${carInfo}].\nMessage from driver: "${compensationMsg}"`;
    } else {
      notifText = `SYSTEM MESSAGE: Passenger ${canceller.name} has cancelled their confirmed seat.\nReason: "${compensationMsg}"`;
    }

    const sysMessage = new Message({ senderId: cancellerPhone, receiverId: receiverPhone, text: notifText, isRead: false });
    await sysMessage.save();

    io.to(receiverPhone).emit('ride_cancelled_alert', { cancellerName: canceller.name, role, message: compensationMsg, carDetails: canceller.carModel ? `${canceller.carModel} (${canceller.carRegistration})` : '' });
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

        if (hoursPassed >= 24) {
          const expiredDoc = new ExpiredRide({ ...r, status: 'expired', originalRideId: r._id });
          await expiredDoc.save();
          await Ride.findByIdAndDelete(r._id);
          newlyExpired.push(expiredDoc.toObject());
        } else {
          if (!r.status) r.status = 'active'; 
          active.push(r);
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
      if (ride.passengers.length === 0 && ride.cancelledPassengers?.length > 0) return { ...ride, status: 'cancelled' };
      return ride;
    });

    res.status(200).json({ 
      driving: finalDriving, 
      riding: [...ridingClean.active, ...ridingClean.newlyExpired, ...pastExpiredRiding, ...cancelledClean], 
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