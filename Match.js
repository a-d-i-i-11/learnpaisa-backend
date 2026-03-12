const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema({
  game:        { type: String, enum: ['ludo','chess','carrom','livetask'], required: true },
  mode:        { type: String, enum: ['1v1','4player','group'], default: '1v1' },
  status:      { type: String, enum: ['waiting','active','completed','cancelled'], default: 'waiting' },

  players: [{
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt:  { type: Date, default: Date.now },
    isWinner:  { type: Boolean, default: false },
    score:     { type: Number, default: 0 }
  }],

  entryFee:    { type: Number, required: true },
  prizePool:   { type: Number },        // entryFee * players * 0.85
  commission:  { type: Number },        // entryFee * players * 0.15
  winner:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  roomCode:    { type: String },        // for private rooms
  startedAt:   { type: Date },
  endedAt:     { type: Date },
  createdAt:   { type: Date, default: Date.now }
});

// Auto-calculate prize pool before save
MatchSchema.pre('save', function(next) {
  if (this.players.length > 0) {
    const total = this.entryFee * this.players.length;
    this.prizePool   = Math.round(total * 0.85);
    this.commission  = Math.round(total * 0.15);
  }
  next();
});

module.exports = mongoose.model('Match', MatchSchema);
