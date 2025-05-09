/**
 * @fileoverview Configuration for blackjack command
 * @module config/commands/blackjack
 */

const { Colors } = require('discord.js');

module.exports = {
    // Card values for blackjack
    CARD_VALUES: {
        'A': 11,
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
        'J': 10, 'Q': 10, 'K': 10
    },

    // Card suits
    SUITS: ['♠️', '♥️', '♦️', '♣️'],

    // Card ranks
    RANKS: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],

    // Game settings
    GAME: {
        DEALER_STAND_VALUE: 17,
        BLACKJACK_PAYOUT: 1.5,
        TIMEOUT: 30000
    },

    // Embed colors
    COLORS: {
        IN_PROGRESS: Colors.Blue,
        WIN: Colors.Green,
        LOSE: Colors.Red,
        PUSH: Colors.Yellow
    },

    // Emojis
    EMOJIS: {
        TITLE: '🎲',
        BET: '💰',
        PLAYER: '👤',
        DEALER: '🎭',
        HIDDEN: '❓',
        INSTRUCTIONS: '🎮',
        HIT: '🎯',
        STAND: '✋',
        WIN: '🎉',
        LOSE: '💔',
        PUSH: '⚖️',
        BUST: '💥',
        TIMEOUT: '⏰'
    }
}; 