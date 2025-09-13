/**
 * @fileoverview Economy service configuration
 * @module config/economy/config
 */

module.exports = {
    // Database Settings
    DATABASE: {
        COLLECTION: 'userBalances',
        DEFAULT_BALANCE: 0
    },

    // Economy Settings
    ECONOMY: {
        GROW_INTERVAL: 12, // hours
        MIN_BALANCE: 0
    }
}; 