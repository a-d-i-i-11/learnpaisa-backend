const express = require('express');
const router  = express.Router();
const Razorpay = require('razorpay');
const crypto  = require('crypto');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const { authMiddleware } = require('./auth');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || 'rzp_test_demo',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'demo_secret'
});

// ── CREATE PAYMENT ORDER (Add Money) ──
router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body; // amount in rupees
    if (!amount || amount < 10) {
      return res.status(400).json({ success: false, message: 'Minimum deposit is ₹10' });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // Razorpay uses paise
      currency: 'INR',
      receipt: `lp_${Date.now()}`
    });

    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Payment initiation failed' });
  }
});

// ── VERIFY PAYMENT + ADD TO WALLET ──
router.post('/verify-payment', authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'demo')
      .update(body).digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed!' });
    }

    // Add money to wallet
    const user = await User.findById(req.userId);
    const depositAmt = parseInt(amount);

    // Bonus logic
    let bonus = 0;
    if (depositAmt >= 2000) bonus = Math.round(depositAmt * 0.30);
    else if (depositAmt >= 1000) bonus = Math.round(depositAmt * 0.25);
    else if (depositAmt >= 500)  bonus = Math.round(depositAmt * 0.20);
    else if (depositAmt >= 200)  bonus = 50;

    user.wallet.deposit += depositAmt;
    user.wallet.bonus   += bonus;
    user.wallet.total   += depositAmt + bonus;
    await user.save();

    // Save transaction
    await Transaction.create({
      user: req.userId, type: 'deposit',
      amount: depositAmt, status: 'completed',
      razorpayId: razorpay_payment_id,
      note: bonus > 0 ? `₹${bonus} bonus added!` : ''
    });

    res.json({
      success: true,
      message: `₹${depositAmt} added!${bonus > 0 ? ` + ₹${bonus} bonus! 🎉` : ''}`,
      newBalance: user.wallet.total,
      bonus
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── REQUEST WITHDRAWAL ──
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, method, upiId, bankAccount } = req.body;
    const user = await User.findById(req.userId);

    if (amount < 100) return res.status(400).json({ success: false, message: 'Minimum withdrawal is ₹100' });
    if (amount > user.wallet.winnings) {
      return res.status(400).json({ success: false, message: `Only winnings (₹${user.wallet.winnings}) can be withdrawn` });
    }
    if (!user.kyc.verified) {
      return res.status(400).json({ success: false, message: 'Complete KYC first to withdraw!' });
    }

    // Hold the amount (pending approval)
    user.wallet.winnings -= amount;
    user.wallet.total    -= amount;
    await user.save();

    const txn = await Transaction.create({
      user: req.userId, type: 'withdrawal',
      amount, status: 'pending',
      method, upiId, bankAccount,
      note: 'Pending admin approval'
    });

    res.json({
      success: true,
      message: 'Withdrawal request submitted! Admin will process in 30 min - 24hrs.',
      txnId: txn._id
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET TRANSACTIONS ──
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const txns = await Transaction.find({ user: req.userId })
      .sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, transactions: txns });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
