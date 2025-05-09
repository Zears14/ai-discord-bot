/**
 * @fileoverview Economy service for managing user balances and cooldowns
 * @module services/economy
 */

const { MongoClient } = require('mongodb');
const CONFIG = require('../config/config');

// Connection management
let client = null;
let db = null;
let isConnecting = false;
let connectionPromise = null;

/**
 * Connect to MongoDB with retry logic and connection pooling
 * @returns {Promise<Db>} MongoDB database instance
 */
async function connectDB() {
    if (db) return db;
    if (isConnecting) return connectionPromise;

    isConnecting = true;
    connectionPromise = new Promise(async (resolve, reject) => {
        try {
            if (!client) {
                client = new MongoClient(process.env.MONGODB_URI, {
                    maxPoolSize: 10,
                    minPoolSize: 5,
                    maxIdleTimeMS: 30000,
                    connectTimeoutMS: 10000,
                    socketTimeoutMS: 45000,
                });
            }

            await client.connect();
            db = client.db();
            console.log('Successfully connected to MongoDB');
            resolve(db);
        } catch (error) {
            console.error('Failed to connect to MongoDB:', error);
            client = null;
            db = null;
            reject(error);
        } finally {
            isConnecting = false;
        }
    });

    return connectionPromise;
}

/**
 * Get user's balance
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @returns {Promise<number>} User's balance
 */
async function getBalance(userId, guildId) {
    try {
        const db = await connectDB();
        const collection = db.collection(CONFIG.DATABASE.COLLECTION);
        
        let user = await collection.findOne({ userId, guildId });
        if (!user) {
            user = { 
                userId, 
                guildId, 
                balance: CONFIG.DATABASE.DEFAULT_BALANCE, 
                lastGrow: new Date(0) 
            };
            await collection.insertOne(user);
        }
        return user.balance;
    } catch (error) {
        console.error('Error getting balance:', error);
        throw new Error('Failed to get balance. Please try again later.');
    }
}

/**
 * Update user's balance
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} amount - Amount to add/subtract
 * @returns {Promise<Object>} Updated user object
 */
async function updateBalance(userId, guildId, amount) {
    try {
        const db = await connectDB();
        const collection = db.collection(CONFIG.DATABASE.COLLECTION);
        
        let user = await collection.findOne({ userId, guildId });
        if (!user) {
            user = { 
                userId, 
                guildId, 
                balance: amount, 
                lastGrow: new Date(0) 
            };
            await collection.insertOne(user);
            return user;
        }
        
        // Ensure balance doesn't go negative
        const newBalance = Math.max(CONFIG.ECONOMY.MIN_BALANCE, user.balance + amount);
        await collection.updateOne(
            { userId, guildId },
            { $set: { balance: newBalance } }
        );
        
        return { ...user, balance: newBalance };
    } catch (error) {
        console.error('Error updating balance:', error);
        throw new Error('Failed to update balance. Please try again later.');
    }
}

/**
 * Check if user can grow
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @returns {Promise<boolean>} Whether user can grow
 */
async function canGrow(userId, guildId) {
    try {
        const db = await connectDB();
        const collection = db.collection(CONFIG.DATABASE.COLLECTION);
        
        const user = await collection.findOne({ userId, guildId });
        if (!user) return true;
        
        const now = new Date();
        const lastGrow = user.lastGrow;
        const hoursSinceLastGrow = (now - lastGrow) / (1000 * 60 * 60);
        
        return hoursSinceLastGrow >= CONFIG.ECONOMY.GROW_INTERVAL;
    } catch (error) {
        console.error('Error checking grow status:', error);
        throw new Error('Failed to check grow status. Please try again later.');
    }
}

/**
 * Get user's last grow timestamp
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @returns {Promise<Date>} Last grow timestamp
 */
async function getLastGrow(userId, guildId) {
    try {
        const db = await connectDB();
        const collection = db.collection(CONFIG.DATABASE.COLLECTION);
        
        const user = await collection.findOne({ userId, guildId });
        if (!user) {
            return new Date(0);
        }
        
        return user.lastGrow;
    } catch (error) {
        console.error('Error getting last grow:', error);
        throw new Error('Failed to get last grow time. Please try again later.');
    }
}

/**
 * Update user's last grow timestamp
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {Date} [customDate] - Optional custom date to set
 * @returns {Promise<Object>} Updated user object
 */
async function updateLastGrow(userId, guildId, customDate = null) {
    try {
        const db = await connectDB();
        const collection = db.collection(CONFIG.DATABASE.COLLECTION);
        
        const user = await collection.findOne({ userId, guildId });
        if (!user) {
            const newUser = { 
                userId, 
                guildId, 
                balance: CONFIG.DATABASE.DEFAULT_BALANCE,
                lastGrow: customDate || new Date()
            };
            await collection.insertOne(newUser);
            return newUser;
        }
        
        const newDate = customDate || new Date();
        await collection.updateOne(
            { userId, guildId },
            { $set: { lastGrow: newDate } }
        );
        
        return { ...user, lastGrow: newDate };
    } catch (error) {
        console.error('Error updating last grow:', error);
        throw new Error('Failed to update last grow time. Please try again later.');
    }
}

/**
 * Set user's balance to a specific amount
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} amount - New balance amount
 * @returns {Promise<number>} New balance
 */
async function setBalance(userId, guildId, amount) {
    try {
        const db = await connectDB();
        const collection = db.collection(CONFIG.DATABASE.COLLECTION);
        
        let user = await collection.findOne({ userId, guildId });
        if (!user) {
            const newUser = { 
                userId, 
                guildId, 
                balance: amount,
                lastGrow: new Date(0)
            };
            await collection.insertOne(newUser);
            return amount;
        }

        await collection.updateOne(
            { userId, guildId },
            { $set: { balance: amount } }
        );
        
        return amount;
    } catch (error) {
        console.error('Error setting balance:', error);
        throw new Error('Failed to set balance. Please try again later.');
    }
}

// Graceful shutdown handling
async function cleanup() {
    try {
        if (client) {
            await client.close();
            console.log('MongoDB connection closed');
        }
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Handle various shutdown signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGQUIT', cleanup);

module.exports = {
    getBalance,
    updateBalance,
    canGrow,
    getLastGrow,
    updateLastGrow,
    setBalance
}; 