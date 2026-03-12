const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

// Store OTPs temporarily (in production use Redis)
const otpStore = {};

// ── SEND OTP ──
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.length !== 10) {
      return res.status(400).json({ success: false, message: 'Enter valid 10-digit phone number' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[phone] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 }; // 5 min expiry

    // TODO: In production, send via Fast2SMS:
    // await sendSMS(phone, `Your LearnPaisa OTP is ${otp}. Valid for 5 minutes.`);

    console.log(`OTP for ${phone}: ${otp}`); // Remove in production!

    res.json({ success: true, message: 'OTP sent successfully!',
      ...(process.env.NODE_ENV !== 'production' && { otp }) // Show OTP in dev mode
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ── VERIFY OTP + LOGIN/REGISTER ──
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp, name, referralCode } = req.body;

    // Validate OTP
    const stored = otpStore[phone];
    if (!stored) return res.status(400).json({ success: false, message: 'OTP expired. Request again.' });
    if (Date.now() > stored.expiresAt) {
      delete otpStore[phone];
      return res.status(400).json({ success: false, message: 'OTP expired. Request again.' });
    }
    if (stored.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Wrong OTP! Try again.' });
    }

    delete otpStore[phone]; // Clear OTP after use

    // Check if user exists
    let user = await User.findOne({ phone });
    let isNewUser = false;

    if (!user) {
      // New user — register
      if (!name) return res.status(400).json({ success: false, message: 'Name required for new users' });

      // Handle referral
      let referredBy = null;
      if (referralCode) {
        const referrer = await User.findOne({ referralCode });
        if (referrer) {
          referredBy = referrer._id;
          // Give referrer ₹50 bonus
          referrer.wallet.bonus += 50;
          referrer.wallet.total += 50;
          await referrer.save();
        }
      }

      user = new User({ phone, name, referredBy,
        wallet: { total: 50, bonus: 50 } // ₹50 signup bonus!
      });
      await user.save();
      isNewUser = true;
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, phone: user.phone },
      process.env.JWT_SECRET || 'learnpaisa_secret',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: isNewUser ? `Welcome to LearnPaisa ${user.name}! 🎉 ₹50 bonus added!` : `Welcome back ${user.name}!`,
      token,
      isNewUser,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        wallet: user.wallet,
        stats: user.stats,
        kyc: user.kyc,
        referralCode: user.referralCode
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET MY PROFILE (protected) ──
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-__v');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── AUTH MIDDLEWARE ──
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Login required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'learnpaisa_secret');
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Session expired. Login again.' });
  }
}

module.exports = router;
module.exports.authMiddleware = authMiddleware;
