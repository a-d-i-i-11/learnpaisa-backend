const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:       { type: String, enum: ['deposit','withdrawal','winning','loss','bonus','refund'], required: true },
  amount:     { type: Number, required: true },
  status:     { type: String, enum: ['pending','completed','failed','rejected'], default: 'pending' },

  // Payment details
  method:     { type: String, enum: ['upi','bank','paytm','phonepay','gpay','razorpay'] },
  razorpayId: { type: String },
  upiId:      { type: String },
  bankAccount:{ type: String },

  // Match reference (for winnings/losses)
  match:      { type: mongoose.Schema.Types.ObjectId, ref: 'Match' },

  note:       { type: String },
  processedAt:{ type: Date },
  createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
