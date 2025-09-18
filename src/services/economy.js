/**
 * @fileoverview Fixed economy service with proper column naming
 * @module services/economy
 */

const { Pool } = require('pg');
const CONFIG = require('../config/config');

// Enhanced connection pool with better configuration
const pool = new Pool({
    connectionString: process.env.POSTGRES_URI,
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    acquireTimeoutMillis: 60000,
    allowExitOnIdle: false,
    statement_timeout: 30000,
    query_timeout: 30000,
    application_name: 'discord-bot-economy',
});

// Connection pool event handlers
pool.on('connect', (client) => {
    console.log('New postgres client connected');
});

pool.on('error', (err) => {
    console.error('Postgres pool error:', err);
});

// Cache for frequently accessed data
const userCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Cache utilities
 */
function getCacheKey(userId, guildId) {
    return `${userId}:${guildId}`;
}

function getCachedUser(userId, guildId) {
    const key = getCacheKey(userId, guildId);
    const cached = userCache.get(key);
    
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL) {
        userCache.delete(key);
        return null;
    }
    
    return cached.data;
}

function setCachedUser(userId, guildId, data) {
    const key = getCacheKey(userId, guildId);
    userCache.set(key, {
        data,
        timestamp: Date.now()
    });
}

function invalidateCache(userId, guildId) {
    const key = getCacheKey(userId, guildId);
    userCache.delete(key);
}

/**
 * Enhanced error handling wrapper
 */
async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Transaction failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Safe query wrapper with retry logic
 */
async function safeQuery(query, params = [], retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const client = await pool.connect();
            try {
                const result = await client.query(query, params);
                return result;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error(`Query attempt ${attempt} failed:`, error.message);
            
            if (attempt === retries) throw error;
            
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
}

/**
 * Initialize database and check column structure
 */
async function initializeDatabase() {
    try {
        console.log('🔍 Checking database structure...');
        
        // Check if table exists and get column information
        const tableInfo = await safeQuery(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'economy'
            ORDER BY ordinal_position;
        `);
        
        if (tableInfo.rowCount === 0) {
            console.log('📋 Creating economy table...');
            try {
                await safeQuery(`
                    CREATE TABLE economy (
                        userid TEXT NOT NULL CHECK (userid != ''),
                        guildid TEXT NOT NULL CHECK (guildid != ''),
                        balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
                        lastgrow TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00',
                        PRIMARY KEY (userid, guildid)
                    );
                    
                    CREATE INDEX IF NOT EXISTS idx_economy_guild ON economy(guildid);
                    CREATE INDEX IF NOT EXISTS idx_economy_balance ON economy(guildid, balance DESC);
                    CREATE INDEX IF NOT EXISTS idx_economy_lastgrow ON economy(lastgrow) WHERE lastgrow > '1970-01-01 00:00:00+00';
                `);
                console.log('✅ Economy table created successfully with balance constraints');
            } catch (createError) {
                if (createError.code === '42501') { // Permission denied
                    console.error('❌ Permission denied creating table. Please run this SQL as a superuser:');
                    console.error(`
CREATE TABLE economy (
    userid TEXT NOT NULL CHECK (userid != ''),
    guildid TEXT NOT NULL CHECK (guildid != ''),
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    lastgrow TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00',
    PRIMARY KEY (userid, guildid)
);

CREATE INDEX IF NOT EXISTS idx_economy_guild ON economy(guildid);
CREATE INDEX IF NOT EXISTS idx_economy_balance ON economy(guildid, balance DESC);
CREATE INDEX IF NOT EXISTS idx_economy_lastgrow ON economy(lastgrow) WHERE lastgrow > '1970-01-01 00:00:00+00';

-- Grant permissions to your bot user
GRANT ALL PRIVILEGES ON TABLE economy TO your_bot_user;
                    `);
                    
                    // Don't throw error, just warn and continue
                    console.warn('⚠️  Continuing without table creation. Please create the table manually.');
                    return false;
                }
                throw createError;
            }
        } else {
            console.log('✅ Economy table exists with columns:');
            tableInfo.rows.forEach(row => {
                console.log(`  - ${row.column_name}: ${row.data_type}`);
            });
            
            // Check if balance constraint exists
            try {
                const constraintCheck = await safeQuery(`
                    SELECT conname, pg_get_constraintdef(oid) as definition
                    FROM pg_constraint 
                    WHERE conrelid = 'economy'::regclass 
                    AND contype = 'c'
                    AND pg_get_constraintdef(oid) LIKE '%balance%';
                `);
                
                if (constraintCheck.rowCount === 0) {
                    console.log('🔧 Adding balance constraint...');
                    await safeQuery(`
                        ALTER TABLE economy 
                        ADD CONSTRAINT chk_balance_non_negative 
                        CHECK (balance >= 0);
                    `);
                    console.log('✅ Balance constraint added');
                } else {
                    console.log('✅ Balance constraints exist:');
                    constraintCheck.rows.forEach(row => {
                        console.log(`  - ${row.conname}: ${row.definition}`);
                    });
                }
            } catch (constraintError) {
                console.warn('⚠️  Could not add/check balance constraint:', constraintError.message);
            }
        }
        
        return true;
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        
        // If it's a permissions error, provide helpful guidance
        if (error.code === '42501') {
            console.error('🔧 Fix: Run as database superuser or create table manually');
        }
        
        // Don't throw error to prevent bot from crashing
        console.warn('⚠️  Bot will continue, but database operations may fail');
        return false;
    }
}

/**
 * Get user's complete economy data with caching
 */
async function getUserData(userId, guildId) {
    // Check cache first
    const cached = getCachedUser(userId, guildId);
    if (cached) return cached;

    try {
        // Using lowercase column names (PostgreSQL standard)
        const res = await safeQuery(
            `SELECT userid, guildid, balance, lastgrow 
             FROM economy 
             WHERE userid = $1 AND guildid = $2`,
            [userId, guildId]
        );

        let userData;
        if (res.rowCount === 0) {
            // Create new user with atomic operation
            userData = await createUser(userId, guildId);
        } else {
            // Map database column names to camelCase for consistency
            userData = {
                userId: res.rows[0].userid,
                guildId: res.rows[0].guildid,
                balance: res.rows[0].balance,
                lastGrow: res.rows[0].lastgrow
            };
        }

        // Cache the result
        setCachedUser(userId, guildId, userData);
        return userData;
        
    } catch (error) {
        console.error('Error getting user data:', error);
        throw new Error(`Failed to retrieve user data: ${error.message}`);
    }
}

/**
 * Create new user atomically
 */
async function createUser(userId, guildId) {
    const defaultData = {
        userId,
        guildId,
        balance: CONFIG.DATABASE.DEFAULT_BALANCE,
        lastGrow: new Date(0)
    };

    try {
        const res = await safeQuery(
            `INSERT INTO economy (userid, guildid, balance, lastgrow)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (userid, guildid) DO NOTHING
             RETURNING userid, guildid, balance, lastgrow`,
            [userId, guildId, defaultData.balance, defaultData.lastGrow]
        );

        // If conflict occurred, fetch existing data
        if (res.rowCount === 0) {
            const existing = await safeQuery(
                `SELECT userid, guildid, balance, lastgrow 
                 FROM economy 
                 WHERE userid = $1 AND guildid = $2`,
                [userId, guildId]
            );
            return {
                userId: existing.rows[0].userid,
                guildId: existing.rows[0].guildid,
                balance: existing.rows[0].balance,
                lastGrow: existing.rows[0].lastgrow
            };
        }

        return {
            userId: res.rows[0].userid,
            guildId: res.rows[0].guildid,
            balance: res.rows[0].balance,
            lastGrow: res.rows[0].lastgrow
        };
    } catch (error) {
        console.error('Error creating user:', error);
        throw new Error(`Failed to create user: ${error.message}`);
    }
}

/**
 * Get user's balance (backward compatible)
 */
async function getBalance(userId, guildId) {
    try {
        const userData = await getUserData(userId, guildId);
        return userData.balance;
    } catch (error) {
        console.error(`Error getting balance for ${userId}:${guildId}:`, error);
        throw error;
    }
}

/**
 * Update user's balance with enhanced validation and atomic operations
 */
async function updateBalance(userId, guildId, amount, reason = 'update') {
    if (typeof amount !== 'number' || isNaN(amount)) {
        throw new Error('Amount must be a valid number');
    }

    return withTransaction(async (client) => {
        try {
            // Lock and fetch current data (using lowercase column names)
            const res = await client.query(
                `SELECT balance FROM economy 
                 WHERE userid = $1 AND guildid = $2 
                 FOR UPDATE`,
                [userId, guildId]
            );

            let newBalance;
            let isNewUser = false;
            const minBalance = CONFIG.ECONOMY.MIN_BALANCE || 0;

            if (res.rowCount === 0) {
                // Create new user - ensure non-negative balance
                const defaultBalance = CONFIG.DATABASE.DEFAULT_BALANCE || 0;
                newBalance = Math.max(minBalance, defaultBalance + amount);
                
                await client.query(
                    `INSERT INTO economy (userid, guildid, balance, lastgrow)
                     VALUES ($1, $2, $3, $4)`,
                    [userId, guildId, newBalance, new Date(0)]
                );
                isNewUser = true;
            } else {
                // Update existing user - ensure balance doesn't go negative
                const currentBalance = res.rows[0].balance;
                const proposedBalance = currentBalance + amount;
                
                // Check if the operation would violate minimum balance
                if (proposedBalance < minBalance) {
                    throw new Error(
                        `Transaction would violate minimum balance. ` +
                        `Current: ${currentBalance}, Change: ${amount}, ` +
                        `Resulting: ${proposedBalance}, Minimum: ${minBalance}`
                    );
                }
                
                newBalance = proposedBalance;
                
                await client.query(
                    `UPDATE economy 
                     SET balance = $3, lastgrow = COALESCE(lastgrow, $4)
                     WHERE userid = $1 AND guildid = $2`,
                    [userId, guildId, newBalance, new Date(0)]
                );
            }

            // Log transaction for audit trail
            console.log(`Balance update: ${userId}:${guildId} ${amount > 0 ? '+' : ''}${amount} = ${newBalance} (${reason})`);

            // Invalidate cache
            invalidateCache(userId, guildId);

            return { 
                userId, 
                guildId, 
                balance: newBalance, 
                previousBalance: isNewUser ? CONFIG.DATABASE.DEFAULT_BALANCE : res.rows[0]?.balance,
                amount,
                reason
            };
            
        } catch (error) {
            // Handle database constraint violations
            if (error.code === '23514') { // Check constraint violation
                throw new Error(`Balance constraint violation: ${error.detail || 'Balance cannot be negative'}`);
            }
            throw error;
        }
    });
}

/**
 * Enhanced grow check with better time handling
 */
async function canGrow(userId, guildId) {
    try {
        const userData = await getUserData(userId, guildId);
        
        const now = new Date();
        const lastGrow = new Date(userData.lastGrow);
        const hoursSinceLastGrow = (now - lastGrow) / (1000 * 60 * 60);

        return {
            canGrow: hoursSinceLastGrow >= CONFIG.ECONOMY.GROW_INTERVAL,
            lastGrow,
            hoursSinceLastGrow,
            hoursUntilNext: Math.max(0, CONFIG.ECONOMY.GROW_INTERVAL - hoursSinceLastGrow)
        };
    } catch (error) {
        console.error(`Error checking grow status for ${userId}:${guildId}:`, error);
        throw error;
    }
}

/**
 * Get last grow timestamp (backward compatible)
 */
async function getLastGrow(userId, guildId) {
    try {
        const userData = await getUserData(userId, guildId);
        return new Date(userData.lastGrow);
    } catch (error) {
        console.error(`Error getting last grow for ${userId}:${guildId}:`, error);
        return new Date(0); // Fallback for compatibility
    }
}

/**
 * Update last grow timestamp with better conflict handling
 */
async function updateLastGrow(userId, guildId, customDate = null) {
    const newDate = customDate || new Date();

    try {
        const res = await safeQuery(
            `INSERT INTO economy (userid, guildid, balance, lastgrow)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (userid, guildid)
             DO UPDATE SET lastgrow = EXCLUDED.lastgrow
             RETURNING *`,
            [userId, guildId, CONFIG.DATABASE.DEFAULT_BALANCE, newDate]
        );

        // Invalidate cache
        invalidateCache(userId, guildId);

        console.log(`Updated grow time for ${userId}:${guildId} to ${newDate.toISOString()}`);
        
        return {
            userId: res.rows[0].userid,
            guildId: res.rows[0].guildid,
            balance: res.rows[0].balance,
            lastGrow: res.rows[0].lastgrow
        };
        
    } catch (error) {
        console.error(`Error updating last grow for ${userId}:${guildId}:`, error);
        throw error;
    }
}

/**
 * Set balance directly with validation
 */
async function setBalance(userId, guildId, amount) {
    if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
        throw new Error('Amount must be a non-negative number');
    }

    const finalAmount = Math.max(CONFIG.ECONOMY.MIN_BALANCE, amount);

    try {
        const res = await safeQuery(
            `INSERT INTO economy (userid, guildid, balance, lastgrow)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (userid, guildid)
             DO UPDATE SET balance = EXCLUDED.balance
             RETURNING balance`,
            [userId, guildId, finalAmount, new Date(0)]
        );

        // Invalidate cache
        invalidateCache(userId, guildId);

        console.log(`Set balance for ${userId}:${guildId} to ${finalAmount}`);
        return res.rows[0].balance;
        
    } catch (error) {
        console.error(`Error setting balance for ${userId}:${guildId}:`, error);
        throw error;
    }
}

/**
 * Get top users with enhanced features
 */
async function getTopUsers(guildId, limit = 10, offset = 0) {
    if (limit > 100) limit = 100; // Prevent excessive queries
    if (offset < 0) offset = 0;

    try {
        const res = await safeQuery(
            `SELECT userid, balance, lastgrow
             FROM economy 
             WHERE guildid = $1
             ORDER BY balance DESC, lastgrow DESC
             LIMIT $2 OFFSET $3`,
            [guildId, limit, offset]
        );

        return res.rows.map((row, index) => ({
            userId: row.userid,
            balance: row.balance,
            lastGrow: new Date(row.lastgrow),
            rank: offset + index + 1
        }));
        
    } catch (error) {
        console.error(`Error getting top users for guild ${guildId}:`, error);
        throw error;
    }
}

/**
 * Get user's rank in guild
 */
async function getUserRank(userId, guildId) {
    try {
        const res = await safeQuery(
            `SELECT COUNT(*) + 1 as rank
             FROM economy e1
             WHERE e1.guildid = $2 
             AND e1.balance > (
                 SELECT COALESCE(e2.balance, 0)
                 FROM economy e2
                 WHERE e2.userid = $1 AND e2.guildid = $2
             )`,
            [userId, guildId]
        );

        return parseInt(res.rows[0].rank);
        
    } catch (error) {
        console.error(`Error getting rank for ${userId}:${guildId}:`, error);
        throw error;
    }
}

/**
 * Transfer money between users
 */
async function transferBalance(fromUserId, toUserId, guildId, amount, reason = 'transfer') {
    if (typeof amount !== 'number' || amount <= 0 || isNaN(amount)) {
        throw new Error('Transfer amount must be a positive number');
    }

    return withTransaction(async (client) => {
        // Lock both users
        const fromRes = await client.query(
            `SELECT balance FROM economy 
             WHERE userid = $1 AND guildid = $2 
             FOR UPDATE`,
            [fromUserId, guildId]
        );

        if (fromRes.rowCount === 0) {
            throw new Error('Sender not found');
        }

        const fromBalance = fromRes.rows[0].balance;
        if (fromBalance < amount) {
            throw new Error(`Insufficient balance: ${fromBalance} < ${amount}`);
        }

        // Ensure recipient exists
        await client.query(
            `INSERT INTO economy (userid, guildid, balance, lastgrow)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (userid, guildid) DO NOTHING`,
            [toUserId, guildId, CONFIG.DATABASE.DEFAULT_BALANCE, new Date(0)]
        );

        // Lock recipient
        const toRes = await client.query(
            `SELECT balance FROM economy 
             WHERE userid = $1 AND guildid = $2 
             FOR UPDATE`,
            [toUserId, guildId]
        );

        const toBalance = toRes.rows[0].balance;

        // Update balances
        await client.query(
            `UPDATE economy SET balance = $3 WHERE userid = $1 AND guildid = $2`,
            [fromUserId, guildId, fromBalance - amount]
        );

        await client.query(
            `UPDATE economy SET balance = $3 WHERE userid = $1 AND guildid = $2`,
            [toUserId, guildId, toBalance + amount]
        );

        // Invalidate caches
        invalidateCache(fromUserId, guildId);
        invalidateCache(toUserId, guildId);

        console.log(`Transfer: ${fromUserId} -> ${toUserId} (${guildId}): ${amount} (${reason})`);

        return {
            from: { userId: fromUserId, previousBalance: fromBalance, newBalance: fromBalance - amount },
            to: { userId: toUserId, previousBalance: toBalance, newBalance: toBalance + amount },
            amount,
            reason
        };
    });
}

/**
 * Get economy statistics for a guild
 */
async function getGuildStats(guildId) {
    try {
        const res = await safeQuery(
            `SELECT 
                COUNT(*) as total_users,
                SUM(balance) as total_balance,
                AVG(balance) as avg_balance,
                MAX(balance) as max_balance,
                MIN(balance) as min_balance,
                COUNT(CASE WHEN balance > $2 THEN 1 END) as rich_users
             FROM economy 
             WHERE guildid = $1`,
            [guildId, CONFIG.ECONOMY.RICH_THRESHOLD || 10000]
        );

        const stats = res.rows[0];
        return {
            totalUsers: parseInt(stats.total_users),
            totalBalance: parseInt(stats.total_balance) || 0,
            avgBalance: parseFloat(stats.avg_balance) || 0,
            maxBalance: parseInt(stats.max_balance) || 0,
            minBalance: parseInt(stats.min_balance) || 0,
            richUsers: parseInt(stats.rich_users)
        };
        
    } catch (error) {
        console.error(`Error getting guild stats for ${guildId}:`, error);
        throw error;
    }
}

/**
 * Periodic cache cleanup
 */
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of userCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            userCache.delete(key);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired cache entries`);
    }
}, 300000); // Clean every 5 minutes

// Track shutdown state to prevent multiple calls
let isShuttingDown = false;

/**
 * Enhanced cleanup with graceful shutdown
 */
async function cleanup() {
    if (isShuttingDown) {
        console.log('Shutdown already in progress...');
        return;
    }
    
    isShuttingDown = true;
    console.log('Shutting down economy service...');
    
    try {
        // Clear cache
        userCache.clear();
        
        // Close pool gracefully only if it's not already ended
        if (!pool.ended) {
            await pool.end();
            console.log('✅ Economy service shutdown complete');
        } else {
            console.log('✅ Economy service already shutdown');
        }
    } catch (error) {
        // Only log if it's not the "called end more than once" error
        if (!error.message.includes('Called end on pool more than once')) {
            console.error('❌ Error during economy service shutdown:', error);
        } else {
            console.log('✅ Economy service shutdown complete (pool already closed)');
        }
    }
}

/**
 * Health check for monitoring
 */
async function healthCheck() {
    try {
        if (pool.ended) {
            return { status: 'unhealthy', error: 'Connection pool is closed' };
        }
        
        await safeQuery('SELECT 1');
        return { status: 'healthy', cache_size: userCache.size };
    } catch (error) {
        return { status: 'unhealthy', error: error.message };
    }
}

// Initialize database on startup
initializeDatabase().catch(console.error);

// Enhanced graceful shutdown handlers with single cleanup call
const gracefulShutdown = (signal) => {
    console.log(`Received ${signal}, starting graceful shutdown...`);
    cleanup().finally(() => {
        console.log(`Exiting on ${signal}`);
        process.exit(0);
    });
};

// Register shutdown handlers
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

const jsonbService = require('./jsonbService');

/**
 * Get last daily timestamp from JSONB
 */
async function getLastDaily(userId, guildId) {
    const lastDaily = await jsonbService.getKey(userId, guildId, 'lastDaily');
    return lastDaily ? new Date(lastDaily) : new Date(0);
}

/**
 * Update last daily timestamp in JSONB
 */
async function updateLastDaily(userId, guildId) {
    return await jsonbService.setKey(userId, guildId, 'lastDaily', new Date().toISOString());
}

module.exports = {
    // Backward compatible exports
    getBalance,
    updateBalance,
    canGrow,
    getLastGrow,
    updateLastGrow,
    setBalance,
    getTopUsers,
    cleanup,
    getLastDaily,
    updateLastDaily,
    
    // New enhanced features
    getUserData,
    getUserRank,
    transferBalance,
    getGuildStats,
    healthCheck,
    initializeDatabase,
    
    // Utility functions
    invalidateCache: (userId, guildId) => invalidateCache(userId, guildId),
    getCacheStats: () => ({ size: userCache.size, ttl: CACHE_TTL })
};