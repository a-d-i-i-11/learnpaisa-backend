const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  phone:       { type: String, required: true, unique: true },
  username:    { type: String, unique: true, sparse: true },
  avatar:      { type: String, default: '' },
  city:        { type: String, default: '' },

  // Wallet
  wallet: {
    total:     { type: Number, default: 0 },
    winnings:  { type: Number, default: 0 },
    deposit:   { type: Number, default: 0 },
    bonus:     { type: Number, default: 0 }
  },

  // Stats
  stats: {
    matchesPlayed: { type: Number, default: 0 },
    matchesWon:    { type: Number, default: 0 },
    totalEarned:   { type: Number, default: 0 },
    totalWithdrawn:{ type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    bestStreak:    { type: Number, default: 0 },
    level:         { type: Number, default: 1 },
    xp:            { type: Number, default: 0 }
  },

  // KYC
  kyc: {
    verified:   { type: Boolean, default: false },
    aadhaar:    { type: String, default: '' },
    pan:        { type: String, default: '' },
    status:     { type: String, enum: ['none','pending','verified','rejected'], default: 'none' }
  },

  // Status
  isActive:    { type: Boolean, default: true },
  isBanned:    { type: Boolean, default: false },
  banReason:   { type: String, default: '' },
  referredBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referralCode:{ type: String, unique: true },

  lastLogin:   { type: Date },
  createdAt:   { type: Date, default: Date.now }
});

// Auto-generate referral code
UserSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = 'LP' + Math.random().toString(36).substr(2, 6).toUpperCase();
  }
  next();
});

// Get win rate
UserSchema.virtual('winRate').get(function() {
  if (this.stats.matchesPlayed === 0) return 0;
  return Math.round((this.stats.matchesWon / this.stats.matchesPlayed) * 100);
});

module.exports = mongoose.model('User', UserSchema);
