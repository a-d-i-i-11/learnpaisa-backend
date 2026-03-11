const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// ── MIDDLEWARE ──
app.use(cors({ origin: '*' })); // In production: restrict to your domain
app.use(express.json());

// Rate limiting — prevent abuse
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// ── DATABASE ──
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/learnpaisa')
  .then(() => console.log('✅ MongoDB connected!'))
  .catch(err => console.log('❌ DB Error:', err.message));

// ── ROUTES ──
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/wallet',  require('./routes/wallet'));
app.use('/api/match',   require('./routes/match'));
app.use('/api/admin',   require('./routes/admin'));

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({
    success: true,
    app: '🎮 LearnPaisa Backend',
    version: '1.0.0',
    status: '✅ Running!',
    endpoints: {
      auth:   '/api/auth/send-otp  |  /api/auth/verify-otp  |  /api/auth/me',
      wallet: '/api/wallet/create-order  |  /api/wallet/withdraw  |  /api/wallet/transactions',
      match:  '/api/match/find  |  /api/match/result  |  /api/match/history',
      admin:  '/api/admin/login  |  /api/admin/stats  |  /api/admin/users  |  /api/admin/withdrawals'
    }
  });
});

// ── START SERVER ──
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 LearnPaisa Backend running on port ${PORT}`);
  console.log(`🌐 Open: http://localhost:${PORT}`);
});
