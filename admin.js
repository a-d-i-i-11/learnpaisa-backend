const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Match   = require('../models/Match');
const Transaction = require('../models/Transaction');
const jwt     = require('jsonwebtoken');

// Admin auth middleware
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Admin login required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'learnpaisa_secret');
    if (!decoded.isAdmin) return res.status(403).json({ success: false, message: 'Admin access only!' });
    req.adminId = decoded.adminId;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// Admin login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'learnpaisa_admin_2025';
  if (password !== ADMIN_PASS) {
    return res.status(401).json({ success: false, message: 'Wrong password!' });
  }
  const token = jwt.sign(
    { isAdmin: true, adminId: 'owner' },
    process.env.JWT_SECRET || 'learnpaisa_secret',
    { expiresIn: '7d' }
  );
  res.json({ success: true, token, message: 'Welcome back Boss! 👑' });
});

// Dashboard stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [totalUsers, activeMatches, pendingWithdrawals] = await Promise.all([
      User.countDocuments(),
      Match.countDocuments({ status: 'active' }),
      Transaction.countDocuments({ type: 'withdrawal', status: 'pending' })
    ]);

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const [todayUsers, todayMatches, todayRevenue] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: todayStart } }),
      Match.countDocuments({ createdAt: { $gte: todayStart } }),
      Match.aggregate([
        { $match: { status: 'completed', endedAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: '$commission' } } }
      ])
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers, activeMatches, pendingWithdrawals,
        todayUsers, todayMatches,
        todayRevenue: todayRevenue[0]?.total || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const query = {};
    if (search) query.$or = [{ name: new RegExp(search,'i') }, { phone: new RegExp(search,'i') }];
    if (status === 'banned') query.isBanned = true;
    if (status === 'kyc_pending') query['kyc.status'] = 'pending';

    const users = await User.find(query)
      .select('-__v').sort({ createdAt: -1 })
      .limit(limit).skip((page-1)*limit);
    const total = await User.countDocuments(query);

    res.json({ success: true, users, total, pages: Math.ceil(total/limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Ban/Unban user
router.post('/users/:id/ban', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isBanned = !user.isBanned;
    user.banReason = user.isBanned ? (reason || 'Banned by admin') : '';
    await user.save();
    res.json({ success: true, message: user.isBanned ? '🚫 User banned!' : '✅ User unbanned!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get pending withdrawals
router.get('/withdrawals', adminAuth, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ type: 'withdrawal', status: 'pending' })
      .populate('user', 'name phone wallet').sort({ createdAt: 1 });
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Approve/Reject withdrawal
router.post('/withdrawals/:id/approve', adminAuth, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('user');
    if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found' });

    txn.status = 'completed';
    txn.processedAt = new Date();
    txn.note = 'Approved by admin';
    await txn.save();

    // Update user's withdrawn amount
    await User.findByIdAndUpdate(txn.user._id, {
      $inc: { 'stats.totalWithdrawn': txn.amount }
    });

    res.json({ success: true, message: `✅ ₹${txn.amount} approved for ${txn.user.name}!` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/withdrawals/:id/reject', adminAuth, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id).populate('user');
    if (!txn) return res.status(404).json({ success: false, message: 'Not found' });

    // Refund the money back
    await User.findByIdAndUpdate(txn.user._id, {
      $inc: { 'wallet.winnings': txn.amount, 'wallet.total': txn.amount }
    });

    txn.status = 'rejected';
    txn.processedAt = new Date();
    txn.note = req.body.reason || 'Rejected by admin';
    await txn.save();

    res.json({ success: true, message: `❌ Rejected. ₹${txn.amount} refunded to ${txn.user.name}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
