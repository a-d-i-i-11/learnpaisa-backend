const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const User    = require('../models/User');
const Transaction = require('../models/Transaction');
const { authMiddleware } = require('./auth');

// ── FIND / CREATE MATCH (Matchmaking) ──
router.post('/find', authMiddleware, async (req, res) => {
  try {
    const { game, entryFee, mode = '1v1' } = req.body;
    const user = await User.findById(req.userId);

    // Check balance
    if (user.wallet.total < entryFee) {
      return res.status(400).json({ success: false, message: `Not enough balance! Need ₹${entryFee}` });
    }

    // Check KYC for amounts > ₹100
    if (entryFee > 100 && !user.kyc.verified) {
      return res.status(400).json({ success: false, message: 'Complete KYC to play matches above ₹100' });
    }

    // Look for an existing waiting match
    let match = await Match.findOne({
      game, entryFee, mode, status: 'waiting',
      'players.user': { $ne: req.userId } // Don't match with self
    });

    if (match) {
      // JOIN existing match
      match.players.push({ user: req.userId });
      match.status = 'active';
      match.startedAt = new Date();
      await match.save();

      // Deduct entry fees from both players
      await deductEntryFee(match.players[0].user, entryFee);
      await deductEntryFee(req.userId, entryFee);

      return res.json({
        success: true,
        message: '🎮 Opponent found! Match starting!',
        match: { id: match._id, status: 'active', prizePool: match.prizePool }
      });

    } else {
      // CREATE new waiting match
      match = await Match.create({
        game, entryFee, mode,
        players: [{ user: req.userId }],
        status: 'waiting'
      });

      res.json({
        success: true,
        message: '🔍 Looking for opponent...',
        match: { id: match._id, status: 'waiting' }
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── DECLARE WINNER ──
router.post('/result', authMiddleware, async (req, res) => {
  try {
    const { matchId, winnerId } = req.body;
    const match = await Match.findById(matchId);

    if (!match || match.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Match not found or already ended' });
    }

    // Verify winner is a player
    const isPlayer = match.players.some(p => p.user.toString() === winnerId);
    if (!isPlayer) return res.status(400).json({ success: false, message: 'Invalid winner' });

    // Update match
    match.status  = 'completed';
    match.winner  = winnerId;
    match.endedAt = new Date();
    match.players.forEach(p => { if (p.user.toString() === winnerId) p.isWinner = true; });
    await match.save();

    // Credit winner
    const winner = await User.findById(winnerId);
    winner.wallet.winnings += match.prizePool;
    winner.wallet.total    += match.prizePool;
    winner.stats.matchesWon++;
    winner.stats.matchesPlayed++;
    winner.stats.totalEarned += match.prizePool;
    winner.stats.currentStreak++;
    if (winner.stats.currentStreak > winner.stats.bestStreak) {
      winner.stats.bestStreak = winner.stats.currentStreak;
    }
    // XP reward
    winner.stats.xp += Math.round(match.entryFee * 2);
    winner.stats.level = Math.floor(winner.stats.xp / 500) + 1;
    await winner.save();

    // Update loser stats
    const loserId = match.players.find(p => p.user.toString() !== winnerId)?.user;
    if (loserId) {
      const loser = await User.findById(loserId);
      loser.stats.matchesPlayed++;
      loser.stats.currentStreak = 0;
      loser.stats.xp += Math.round(match.entryFee * 0.5); // Small XP for playing
      await loser.save();
    }

    // Save winning transaction
    await Transaction.create({
      user: winnerId, type: 'winning',
      amount: match.prizePool, status: 'completed',
      match: matchId
    });

    res.json({
      success: true,
      message: `🏆 Winner declared! ₹${match.prizePool} credited!`,
      prizePool: match.prizePool
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET MATCH HISTORY ──
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const matches = await Match.find({ 'players.user': req.userId, status: 'completed' })
      .populate('players.user', 'name')
      .populate('winner', 'name')
      .sort({ endedAt: -1 }).limit(20);
    res.json({ success: true, matches });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── HELPER: Deduct entry fee ──
async function deductEntryFee(userId, amount) {
  await User.findByIdAndUpdate(userId, {
    $inc: { 'wallet.total': -amount, 'wallet.deposit': -Math.min(amount, 0) }
  });
  await Transaction.create({
    user: userId, type: 'loss',
    amount, status: 'completed',
    note: 'Match entry fee'
  });
}

module.exports = router;
