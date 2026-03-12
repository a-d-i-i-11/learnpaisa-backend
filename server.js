const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ✅ trust proxy fix for Render
app.set('trust proxy', 1);

const JWT_SECRET     = process.env.JWT_SECRET     || 'learnpaisa_secret_2025';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MONGODB_URI    = process.env.MONGODB_URI    || 'mongodb://localhost:27017/learnpaisa';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected!'))
  .catch(err => console.log('❌ DB Error:', err.message));

// ── OTP stored in MongoDB ──
const OtpSchema = new mongoose.Schema({
  phone:     { type: String, required: true, unique: true },
  otp:       { type: String, required: true },
  expiresAt: { type: Date, required: true }
});
const Otp = mongoose.model('Otp', OtpSchema);

const UserSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  phone:        { type: String, required: true, unique: true },
  username:     { type: String, unique: true, sparse: true },
  city:         { type: String, default: '' },
  wallet: {
    total:      { type: Number, default: 0 },
    winnings:   { type: Number, default: 0 },
    deposit:    { type: Number, default: 0 },
    bonus:      { type: Number, default: 0 }
  },
  stats: {
    matchesPlayed:  { type: Number, default: 0 },
    matchesWon:     { type: Number, default: 0 },
    totalEarned:    { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    currentStreak:  { type: Number, default: 0 },
    bestStreak:     { type: Number, default: 0 },
    level:          { type: Number, default: 1 },
    xp:             { type: Number, default: 0 }
  },
  kyc: {
    verified: { type: Boolean, default: false },
    status:   { type: String, enum: ['none','pending','verified','rejected'], default: 'none' }
  },
  isActive:     { type: Boolean, default: true },
  isBanned:     { type: Boolean, default: false },
  banReason:    { type: String, default: '' },
  referralCode: { type: String, unique: true },
  referredBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastLogin:    { type: Date },
  createdAt:    { type: Date, default: Date.now }
});
UserSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = 'LP' + Math.random().toString(36).substr(2, 6).toUpperCase();
  }
  next();
});
const User = mongoose.model('User', UserSchema);

const MatchSchema = new mongoose.Schema({
  game:      { type: String, enum: ['ludo','chess','carrom','livetask'], required: true },
  mode:      { type: String, default: '1v1' },
  status:    { type: String, enum: ['waiting','active','completed','cancelled'], default: 'waiting' },
  players:   [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, isWinner: { type: Boolean, default: false } }],
  entryFee:  { type: Number, required: true },
  prizePool: { type: Number },
  commission:{ type: Number },
  winner:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  startedAt: { type: Date },
  endedAt:   { type: Date },
  createdAt: { type: Date, default: Date.now }
});
MatchSchema.pre('save', function(next) {
  if (this.players.length > 0) {
    const total    = this.entryFee * this.players.length;
    this.prizePool = Math.round(total * 0.85);
    this.commission= Math.round(total * 0.15);
  }
  next();
});
const Match = mongoose.model('Match', MatchSchema);

const TransactionSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:       { type: String, enum: ['deposit','withdrawal','winning','loss','bonus','refund'], required: true },
  amount:     { type: Number, required: true },
  status:     { type: String, enum: ['pending','completed','failed','rejected'], default: 'pending' },
  method:     { type: String },
  razorpayId: { type: String },
  upiId:      { type: String },
  match:      { type: mongoose.Schema.Types.ObjectId, ref: 'Match' },
  note:       { type: String },
  processedAt:{ type: Date },
  createdAt:  { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Session expired. Login again.' });
  }
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Admin login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ success: false, message: 'Admin only!' });
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// ── SEND OTP ──
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.length !== 10) {
      return res.status(400).json({ success: false, message: 'Enter valid 10-digit phone number' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`OTP for ${phone}: ${otp}`);

    // Save in MongoDB
    await Otp.findOneAndUpdate(
      { phone },
      { otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      { upsert: true, new: true }
    );

    // Try SMS
    const TWOFACTOR_KEY = process.env.TWOFACTOR_KEY;
    if (TWOFACTOR_KEY) {
      try {
        const smsRes  = await fetch(`https://2factor.in/API/V1/${TWOFACTOR_KEY}/SMS/+91${phone}/${otp}`);
        const smsData = await smsRes.json();
        console.log('SMS:', JSON.stringify(smsData));
        if (smsData.Status === 'Success') {
          return res.json({ success: true, message: '📱 OTP sent to your phone!' });
        }
      } catch (e) { console.log('SMS error:', e.message); }
    }

    // Always return OTP so user can login even if SMS fails
    res.json({ success: true, message: 'OTP ready!', otp });

  } catch (err) {
    console.log('Send OTP error:', err.message);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// ── VERIFY OTP ──
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { phone, otp, name, referralCode } = req.body;
    const stored = await Otp.findOne({ phone });

    if (!stored) {
      return res.status(400).json({ success: false, message: 'OTP not found. Click Send OTP first.' });
    }
    if (new Date() > stored.expiresAt) {
      await Otp.deleteOne({ phone });
      return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
    }
    if (stored.otp !== otp.toString().trim()) {
      return res.status(400).json({ success: false, message: 'Wrong OTP! Check and try again.' });
    }

    await Otp.deleteOne({ phone });

    let user = await User.findOne({ phone });
    let isNewUser = false;
    if (!user) {
      if (!name) return res.status(400).json({ success: false, message: 'Name is required for signup' });
      let referredBy = null;
      if (referralCode) {
        const referrer = await User.findOne({ referralCode });
        if (referrer) {
          referredBy = referrer._id;
          referrer.wallet.bonus += 50;
          referrer.wallet.total += 50;
          await referrer.save();
        }
      }
      user = new User({ phone, name, referredBy, wallet: { total: 50, bonus: 50 } });
      await user.save();
      isNewUser = true;
    }
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign({ userId: user._id, phone: user.phone }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true,
      message: isNewUser ? `Welcome ${user.name}! 🎉 ₹50 bonus added!` : `Welcome back ${user.name}!`,
      token, isNewUser,
      user: { id: user._id, name: user.name, phone: user.phone, wallet: user.wallet, stats: user.stats, referralCode: user.referralCode }
    });
  } catch (err) {
    console.log('Verify OTP error:', err.message);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-__v');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/wallet/create-order', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 10) return res.status(400).json({ success: false, message: 'Minimum ₹10' });
    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_demo', key_secret: process.env.RAZORPAY_KEY_SECRET || 'demo' });
    const order = await razorpay.orders.create({ amount: amount * 100, currency: 'INR', receipt: `lp_${Date.now()}` });
    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Payment failed' });
  }
});

app.post('/api/wallet/verify-payment', authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
    const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'demo').update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');
    if (expectedSig !== razorpay_signature) return res.status(400).json({ success: false, message: 'Payment verification failed!' });
    const user = await User.findById(req.userId);
    const depositAmt = parseInt(amount);
    let bonus = 0;
    if (depositAmt >= 2000) bonus = Math.round(depositAmt * 0.30);
    else if (depositAmt >= 1000) bonus = Math.round(depositAmt * 0.25);
    else if (depositAmt >= 500)  bonus = Math.round(depositAmt * 0.20);
    else if (depositAmt >= 200)  bonus = 50;
    user.wallet.deposit += depositAmt;
    user.wallet.bonus   += bonus;
    user.wallet.total   += depositAmt + bonus;
    await user.save();
    await Transaction.create({ user: req.userId, type: 'deposit', amount: depositAmt, status: 'completed', razorpayId: razorpay_payment_id });
    res.json({ success: true, message: `₹${depositAmt} added!${bonus > 0 ? ` + ₹${bonus} bonus! 🎉` : ''}`, newBalance: user.wallet.total });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/wallet/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, method, upiId } = req.body;
    const user = await User.findById(req.userId);
    if (amount < 100) return res.status(400).json({ success: false, message: 'Minimum withdrawal ₹100' });
    if (amount > user.wallet.winnings) return res.status(400).json({ success: false, message: 'Only winnings can be withdrawn' });
    if (!user.kyc.verified) return res.status(400).json({ success: false, message: 'Complete KYC first!' });
    user.wallet.winnings -= amount;
    user.wallet.total    -= amount;
    await user.save();
    await Transaction.create({ user: req.userId, type: 'withdrawal', amount, status: 'pending', method, upiId });
    res.json({ success: true, message: 'Withdrawal request submitted! Processing in 30min - 24hrs.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/wallet/transactions', authMiddleware, async (req, res) => {
  try {
    const txns = await Transaction.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, transactions: txns });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/match/find', authMiddleware, async (req, res) => {
  try {
    const { game, entryFee } = req.body;
    const user = await User.findById(req.userId);
    if (user.wallet.total < entryFee) return res.status(400).json({ success: false, message: `Need ₹${entryFee} to play!` });
    let match = await Match.findOne({ game, entryFee, status: 'waiting', 'players.user': { $ne: req.userId } });
    if (match) {
      match.players.push({ user: req.userId });
      match.status = 'active';
      match.startedAt = new Date();
      await match.save();
      for (const p of match.players) {
        await User.findByIdAndUpdate(p.user, { $inc: { 'wallet.total': -entryFee } });
        await Transaction.create({ user: p.user, type: 'loss', amount: entryFee, status: 'completed', match: match._id, note: 'Entry fee' });
      }
      return res.json({ success: true, message: '🎮 Opponent found! Match starting!', match: { id: match._id, status: 'active', prizePool: match.prizePool } });
    } else {
      match = await Match.create({ game, entryFee, players: [{ user: req.userId }], status: 'waiting' });
      res.json({ success: true, message: '🔍 Finding opponent...', match: { id: match._id, status: 'waiting' } });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/match/result', authMiddleware, async (req, res) => {
  try {
    const { matchId, winnerId } = req.body;
    const match = await Match.findById(matchId);
    if (!match || match.status !== 'active') return res.status(400).json({ success: false, message: 'Match not found' });
    match.status = 'completed'; match.winner = winnerId; match.endedAt = new Date();
    await match.save();
    const winner = await User.findById(winnerId);
    winner.wallet.winnings += match.prizePool;
    winner.wallet.total    += match.prizePool;
    winner.stats.matchesWon++;
    winner.stats.matchesPlayed++;
    winner.stats.totalEarned += match.prizePool;
    winner.stats.currentStreak++;
    winner.stats.xp    += match.entryFee * 2;
    winner.stats.level  = Math.floor(winner.stats.xp / 500) + 1;
    await winner.save();
    await Transaction.create({ user: winnerId, type: 'winning', amount: match.prizePool, status: 'completed', match: matchId });
    res.json({ success: true, message: `🏆 ₹${match.prizePool} credited to winner!` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/match/history', authMiddleware, async (req, res) => {
  try {
    const matches = await Match.find({ 'players.user': req.userId, status: 'completed' })
      .populate('players.user', 'name').populate('winner', 'name')
      .sort({ endedAt: -1 }).limit(20);
    res.json({ success: true, matches });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Wrong password!' });
  const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, message: 'Welcome Boss! 👑' });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const [totalUsers, activeMatches, pendingWithdrawals, todayUsers, todayRevenue] = await Promise.all([
      User.countDocuments(),
      Match.countDocuments({ status: 'active' }),
      Transaction.countDocuments({ type: 'withdrawal', status: 'pending' }),
      User.countDocuments({ createdAt: { $gte: todayStart } }),
      Match.aggregate([{ $match: { status: 'completed', endedAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$commission' } } }])
    ]);
    res.json({ success: true, stats: { totalUsers, activeMatches, pendingWithdrawals, todayUsers, todayRevenue: todayRevenue[0]?.total || 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const { search } = req.query;
    const query = search ? { $or: [{ name: new RegExp(search,'i') }, { phone: new RegExp(search,'i') }] } : {};
    const users = await User.find(query).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/users/:id/ban', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isBanned  = !user.isBanned;
    user.banReason = user.isBanned ? (req.body.reason || 'Banned by admin') : '';
    await user.save();
    res.json({ success: true, message: user.isBanned ? '🚫 User banned!' : '✅ User unbanned!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/withdrawals', adminAuth, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ type: 'withdrawal', status: 'pending' }).populate('user', 'name phone').sort({ createdAt: 1 });
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/withdrawals/:id/approve', adminAuth, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('user');
    if (!txn) return res.status(404).json({ success: false, message: 'Not found' });
    txn.status = 'completed'; txn.processedAt = new Date();
    await txn.save();
    await User.findByIdAndUpdate(txn.user._id, { $inc: { 'stats.totalWithdrawn': txn.amount } });
    res.json({ success: true, message: `✅ ₹${txn.amount} approved for ${txn.user.name}!` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/withdrawals/:id/reject', adminAuth, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('user');
    if (!txn) return res.status(404).json({ success: false, message: 'Not found' });
    await User.findByIdAndUpdate(txn.user._id, { $inc: { 'wallet.winnings': txn.amount, 'wallet.total': txn.amount } });
    txn.status = 'rejected'; txn.processedAt = new Date(); txn.note = req.body.reason || 'Rejected';
    await txn.save();
    res.json({ success: true, message: `❌ Rejected. ₹${txn.amount} refunded to ${txn.user.name}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/', (req, res) => {
  res.json({ app: '🎮 LearnPaisa Backend', status: '✅ Running!', version: '1.0.0' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`🚀 LearnPaisa Backend running on port ${PORT}`); });

// ── TRIVIA RESULT (bot match prize credit) ──
app.post('/api/game/trivia-result', authMiddleware, async (req, res) => {
  try {
    const { entryFee, won, myScore, botScore } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const fee = parseInt(entryFee) || 0;
    user.stats.matchesPlayed = (user.stats.matchesPlayed || 0) + 1;

    if (won) {
      const prize = Math.round(fee * 2 * 0.85);
      user.wallet.winnings = (user.wallet.winnings || 0) + prize;
      user.wallet.total    = (user.wallet.total    || 0) + prize;
      user.stats.matchesWon   = (user.stats.matchesWon   || 0) + 1;
      user.stats.totalEarned  = (user.stats.totalEarned  || 0) + prize;
      user.stats.currentStreak= (user.stats.currentStreak|| 0) + 1;
      user.stats.xp           = (user.stats.xp           || 0) + fee * 2;
      user.stats.level        = Math.floor(user.stats.xp / 500) + 1;
      // Deduct entry fee (player paid to play)
      user.wallet.total    -= fee;
      await user.save();
      await Transaction.create({ user: req.userId, type: 'winning', amount: prize, status: 'completed', note: `Trivia win vs bot. Score: ${myScore}-${botScore}` });
      return res.json({ success: true, message: `🏆 ₹${prize} credited!`, newBalance: user.wallet.total });
    } else {
      // Lost — deduct entry fee
      if (user.wallet.total < fee) return res.status(400).json({ success: false, message: 'Insufficient balance' });
      user.wallet.total -= fee;
      user.stats.currentStreak = 0;
      await user.save();
      await Transaction.create({ user: req.userId, type: 'loss', amount: fee, status: 'completed', note: `Trivia loss vs bot. Score: ${myScore}-${botScore}` });
      return res.json({ success: true, message: 'Match recorded.', newBalance: user.wallet.total });
    }
  } catch(err) {
    console.log('Trivia result error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
