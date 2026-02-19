/**
 * @fileoverview Fixed economy service with proper column naming
 * @module services/economy
 */

import pg from 'pg';
import './pgTypeParsers.js';
const { Pool } = pg;
import { createPoolConfig, isTransientDatabaseError } from './dbConfig.js';
import historyService from './historyService.js';
import jsonbService from './jsonbService.js';
import logger from './loggerService.js';
import CONFIG from '../config/config.js';
import { ensurePgBigIntRange, toBigInt } from '../utils/moneyUtils.js';

// Enhanced connection pool with better configuration
const pool = new Pool(
  createPoolConfig({
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    acquireTimeoutMillis: 60000,
    allowExitOnIdle: false,
    statement_timeout: 30000,
    query_timeout: 30000,
    application_name: 'discord-bot-economy',
  })
);

// Connection pool event handlers
pool.on('connect', () => {
  logger.discord.db('New postgres client connected');
});

pool.on('error', (err) => {
  if (isTransientDatabaseError(err)) {
    logger.warn('Postgres connection dropped; pool will reconnect automatically.', {
      module: 'database',
      error: err,
    });
    return;
  }

  logger.discord.dbError('Postgres pool error:', err);
});

// Cache for frequently accessed data
const userCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache
const DEFAULT_BALANCE = toBigInt(CONFIG.DATABASE.DEFAULT_BALANCE ?? 0, 'Default balance');
const MIN_BALANCE = toBigInt(CONFIG.ECONOMY.MIN_BALANCE ?? 0, 'Minimum balance');
const RICH_THRESHOLD = toBigInt(CONFIG.ECONOMY.RICH_THRESHOLD ?? 10000, 'Rich threshold');

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
    timestamp: Date.now(),
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
    logger.discord.dbError('Transaction failed:', error);
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
      const transient = isTransientDatabaseError(error);
      const logMeta = {
        attempt,
        retries,
        transient,
        code: error?.code,
        message: error?.message,
      };

      if (transient) {
        logger.warn(`Transient query attempt ${attempt} failed`, {
          module: 'database',
          ...logMeta,
        });
      } else {
        logger.discord.dbError(`Query attempt ${attempt} failed`, logMeta);
      }

      if (attempt === retries) throw error;

      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

/**
 * Initialize database and check column structure
 */
async function initializeDatabase() {
  try {
    logger.discord.db('🔍 Checking database structure...');

    // Use a transaction for all schema changes
    await withTransaction(async (client) => {
      // Check and create/update economy table
      const economyTableInfo = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'economy'
                ORDER BY ordinal_position;
            `);

      if (economyTableInfo.rowCount === 0) {
        logger.discord.db('📋 Creating economy table...');
        await client.query(`
                    CREATE TABLE economy (
                        userid TEXT NOT NULL,
                        guildid TEXT NOT NULL,
                        balance BIGINT NOT NULL DEFAULT 0,
                        lastgrow TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 07:00:00+07',
                        data JSONB DEFAULT '{}'::jsonb,
                        PRIMARY KEY (userid, guildid)
                    );
                `);
        logger.discord.db('✅ Economy table created.');
      } else {
        logger.discord.db('✅ Economy table exists. Checking columns...');
        const balanceColumn = economyTableInfo.rows.find((row) => row.column_name === 'balance');
        if (balanceColumn && balanceColumn.data_type !== 'bigint') {
          logger.discord.db('🔧 Migrating economy.balance to BIGINT...');
          await client.query(
            'ALTER TABLE economy ALTER COLUMN balance TYPE BIGINT USING balance::bigint;'
          );
          logger.discord.db('✅ economy.balance migrated to BIGINT.');
        }

        // Add 'data' column if it doesn't exist
        const hasDataColumn = economyTableInfo.rows.some((row) => row.column_name === 'data');
        if (!hasDataColumn) {
          logger.discord.db('🔧 Adding "data" column to economy table...');
          await client.query("ALTER TABLE economy ADD COLUMN data JSONB DEFAULT '{}'::jsonb;");
          logger.discord.db('✅ "data" column added.');
        }
      }

      // Create indexes for economy table
      logger.discord.db('📋 Creating indexes for economy table...');
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_economy_balance ON economy(guildid, balance DESC);'
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_economy_data_gin ON economy USING gin (data);'
      );
      await client.query('CREATE INDEX IF NOT EXISTS idx_economy_guild ON economy(guildid);');
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_economy_lastgrow ON economy(lastgrow) WHERE lastgrow > '1970-01-01 07:00:00+07'::timestamp with time zone;"
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_economy_user_guild ON economy(userid, guildid);'
      );
      const constraintCheck = await client.query(`
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'chk_balance_non_negative' AND conrelid = 'economy'::regclass
            `);

      if (constraintCheck.rowCount === 0) {
        await client.query(
          'ALTER TABLE economy ADD CONSTRAINT chk_balance_non_negative CHECK (balance >= 0);'
        );
      }
      logger.discord.db('✅ Indexes for economy table created.');

      // Check and create items table
      logger.discord.db('📋 Creating items table...');
      await client.query(`
                CREATE TABLE IF NOT EXISTS items (
                    id BIGSERIAL PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    title TEXT,
                    type TEXT NOT NULL,
                    price BIGINT,
                    data JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            `);
      const itemsTableInfo = await client.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'items' AND table_schema = 'public';
            `);
      const priceColumn = itemsTableInfo.rows.find((row) => row.column_name === 'price');
      if (priceColumn && priceColumn.data_type !== 'bigint') {
        logger.discord.db('🔧 Migrating items.price to BIGINT...');
        await client.query('ALTER TABLE items ALTER COLUMN price TYPE BIGINT USING price::bigint;');
        logger.discord.db('✅ items.price migrated to BIGINT.');
      }
      await client.query('CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);');
      logger.discord.db('✅ Items table and index created.');

      // Check and create inventory table
      logger.discord.db('📋 Creating inventory table...');
      await client.query(`
                CREATE TABLE IF NOT EXISTS inventory (
                    userid TEXT NOT NULL,
                    guildid TEXT NOT NULL,
                    itemid BIGINT NOT NULL,
                    quantity BIGINT NOT NULL DEFAULT 1,
                    meta JSONB DEFAULT '{}'::jsonb,
                    PRIMARY KEY (userid, guildid, itemid),
                    CONSTRAINT inventory_userid_guildid_fkey FOREIGN KEY (userid, guildid) REFERENCES economy(userid, guildid) ON DELETE CASCADE,
                    CONSTRAINT inventory_itemid_fkey FOREIGN KEY (itemid) REFERENCES items(id) ON DELETE RESTRICT
                );
            `);
      const inventoryTableInfo = await client.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'inventory' AND table_schema = 'public';
            `);
      const quantityColumn = inventoryTableInfo.rows.find((row) => row.column_name === 'quantity');
      if (quantityColumn && quantityColumn.data_type !== 'bigint') {
        logger.discord.db('🔧 Migrating inventory.quantity to BIGINT...');
        await client.query(
          'ALTER TABLE inventory ALTER COLUMN quantity TYPE BIGINT USING quantity::bigint;'
        );
        logger.discord.db('✅ inventory.quantity migrated to BIGINT.');
      }
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_inventory_user_items ON inventory(userid, guildid);'
      );
      logger.discord.db('✅ Inventory table and index created.');

      // Check and create history table (non-partitioned)
      logger.discord.db('📋 Checking history table...');
      const historyTableInfo = await client.query(`
                SELECT c.relkind
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = 'history'
                LIMIT 1;
            `);

      if (historyTableInfo.rowCount === 0) {
        await client.query(`
                    CREATE TABLE history (
                        id BIGSERIAL,
                        userid TEXT NOT NULL,
                        guildid TEXT NOT NULL,
                        type TEXT NOT NULL,
                        itemid BIGINT,
                        amount BIGINT NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (id, created_at)
                    );
                `);
        logger.discord.db('✅ History table created.');
      } else if (historyTableInfo.rows[0].relkind === 'p') {
        logger.warn('⚠️  History table is partitioned. Migrating to a regular table...');

        await client.query('DROP TABLE IF EXISTS history_unpartitioned_new;');
        await client.query(`
                    CREATE TABLE history_unpartitioned_new (
                        id BIGSERIAL,
                        userid TEXT NOT NULL,
                        guildid TEXT NOT NULL,
                        type TEXT NOT NULL,
                        itemid BIGINT,
                        amount BIGINT NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (id, created_at)
                    );
                `);

        await client.query(`
                    INSERT INTO history_unpartitioned_new (id, userid, guildid, type, itemid, amount, created_at)
                    SELECT id, userid, guildid, type, itemid, amount, created_at
                    FROM history;
                `);

        await client.query('DROP TABLE history CASCADE;');
        await client.query('ALTER TABLE history_unpartitioned_new RENAME TO history;');

        await client.query(`
                    SELECT setval(
                        pg_get_serial_sequence('history', 'id'),
                        COALESCE((SELECT MAX(id) FROM history), 1),
                        (SELECT COUNT(*) > 0 FROM history)
                    );
                `);

        logger.discord.db('✅ History table migrated to non-partitioned schema.');
      } else {
        logger.discord.db('✅ History table already uses non-partitioned schema.');
      }

      const historyTableColumns = await client.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'history' AND table_schema = 'public';
            `);
      const amountColumn = historyTableColumns.rows.find((row) => row.column_name === 'amount');
      if (amountColumn && amountColumn.data_type !== 'bigint') {
        logger.discord.db('🔧 Migrating history.amount to BIGINT...');
        await client.query(
          'ALTER TABLE history ALTER COLUMN amount TYPE BIGINT USING amount::bigint;'
        );
        logger.discord.db('✅ history.amount migrated to BIGINT.');
      }

      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_history_user_recent ON history(userid, guildid, created_at DESC);'
      );
      await client.query('CREATE INDEX IF NOT EXISTS history_id_idx ON history (id);');
      // Note: Foreign key to a partitioned table is not directly supported in all PostgreSQL versions.
      // This might need adjustment based on the specific PostgreSQL version and partitioning strategy.
      // await client.query('ALTER TABLE history ADD CONSTRAINT history_itemid_fkey FOREIGN KEY (itemid) REFERENCES items(id);');
      logger.discord.db('✅ History table and indexes created.');
    });

    logger.discord.db('✅ Database structure is up to date.');
    return true;
  } catch (error) {
    logger.discord.dbError('❌ Database initialization failed:', error);
    if (error.code === '42P07') {
      // relation "..." already exists
      logger.warn('⚠️  One or more tables or indexes already exist. This is likely not an issue.');
    } else if (error.code === '42501') {
      logger.discord.dbError(
        '🔧 Fix: Ensure the bot has sufficient permissions (CREATE, ALTER, INDEX) on the database.'
      );
    }
    logger.warn('⚠️  Bot will continue, but database operations may fail.');
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
        lastGrow: res.rows[0].lastgrow,
      };
    }

    // Cache the result
    setCachedUser(userId, guildId, userData);
    return userData;
  } catch (error) {
    logger.discord.dbError('Error getting user data:', error);
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
    balance: DEFAULT_BALANCE,
    lastGrow: new Date(0),
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
        lastGrow: existing.rows[0].lastgrow,
      };
    }

    return {
      userId: res.rows[0].userid,
      guildId: res.rows[0].guildid,
      balance: res.rows[0].balance,
      lastGrow: res.rows[0].lastgrow,
    };
  } catch (error) {
    logger.discord.dbError('Error creating user:', error);
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
    logger.discord.dbError(`Error getting balance for ${userId}:${guildId}:`, error);
    throw error;
  }
}

/**
 * Update user's balance with enhanced validation and atomic operations
 */
async function updateBalance(userId, guildId, amount, reason = 'update') {
  const parsedAmount = toBigInt(amount, 'Amount');

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
      const minBalance = MIN_BALANCE;

      if (res.rowCount === 0) {
        // Create new user and apply change
        newBalance = DEFAULT_BALANCE + parsedAmount;
        ensurePgBigIntRange(newBalance, 'Resulting balance');
        if (newBalance < minBalance) {
          throw new Error(
            'Transaction would violate minimum balance. ' +
              `Current: ${DEFAULT_BALANCE}, Change: ${parsedAmount}, ` +
              `Resulting: ${newBalance}, Minimum: ${minBalance}`
          );
        }

        await client.query(
          `INSERT INTO economy (userid, guildid, balance, lastgrow)
                     VALUES ($1, $2, $3, $4)`,
          [userId, guildId, newBalance, new Date(0)]
        );
        isNewUser = true;
      } else {
        // Update existing user - ensure balance doesn't go negative
        const currentBalance = toBigInt(res.rows[0].balance, 'Current balance');
        const proposedBalance = currentBalance + parsedAmount;
        ensurePgBigIntRange(proposedBalance, 'Resulting balance');

        // Check if the operation would violate minimum balance
        if (proposedBalance < minBalance) {
          throw new Error(
            'Transaction would violate minimum balance. ' +
              `Current: ${currentBalance}, Change: ${parsedAmount}, ` +
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
      logger.discord.db(
        `Balance update: ${userId}:${guildId} ${parsedAmount > 0n ? '+' : ''}${parsedAmount} = ${newBalance} (${reason})`
      );

      // Add to history
      await historyService.addHistory(
        {
          userid: userId,
          guildid: guildId,
          type: reason,
          amount: parsedAmount,
        },
        client
      );

      // Invalidate cache
      invalidateCache(userId, guildId);

      return {
        userId,
        guildId,
        balance: newBalance,
        previousBalance: isNewUser ? DEFAULT_BALANCE : toBigInt(res.rows[0]?.balance ?? 0n),
        amount: parsedAmount,
        reason,
      };
    } catch (error) {
      // Handle database constraint violations
      if (error.code === '23514') {
        // Check constraint violation
        throw new Error(
          `Balance constraint violation: ${error.detail || 'Balance cannot be negative'}`
        );
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
      hoursUntilNext: Math.max(0, CONFIG.ECONOMY.GROW_INTERVAL - hoursSinceLastGrow),
    };
  } catch (error) {
    logger.discord.dbError(`Error checking grow status for ${userId}:${guildId}:`, error);
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
    logger.discord.dbError(`Error getting last grow for ${userId}:${guildId}:`, error);
    return new Date(0); // Fallback for compatibility
  }
}

/**
 * Update last grow timestamp with better conflict handling
 */
async function updateLastGrow(userId, guildId, customDate = null) {
  const newDate = customDate || new Date();

  try {
    const result = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO economy (userid, guildid, balance, lastgrow)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (userid, guildid)
               DO UPDATE SET lastgrow = EXCLUDED.lastgrow
               RETURNING *`,
        [userId, guildId, DEFAULT_BALANCE, newDate]
      );

      await historyService.addHistory(
        {
          userid: userId,
          guildid: guildId,
          type: 'grow',
        },
        client
      );

      return res.rows[0];
    });

    invalidateCache(userId, guildId);
    logger.discord.db(`Updated grow time for ${userId}:${guildId} to ${newDate.toISOString()}`);

    return {
      userId: result.userid,
      guildId: result.guildid,
      balance: result.balance,
      lastGrow: result.lastgrow,
    };
  } catch (error) {
    logger.discord.dbError(`Error updating last grow for ${userId}:${guildId}:`, error);
    throw error;
  }
}

/**
 * Set balance directly with validation
 */
async function setBalance(userId, guildId, amount) {
  const parsedAmount = toBigInt(amount, 'Amount');
  if (parsedAmount < 0n) {
    throw new Error('Amount must be a non-negative integer');
  }
  const finalAmount = parsedAmount < MIN_BALANCE ? MIN_BALANCE : parsedAmount;
  ensurePgBigIntRange(finalAmount, 'Final amount');

  try {
    const res = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO economy (userid, guildid, balance, lastgrow)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (userid, guildid)
               DO UPDATE SET balance = EXCLUDED.balance
               RETURNING balance`,
        [userId, guildId, finalAmount, new Date(0)]
      );

      await historyService.addHistory(
        {
          userid: userId,
          guildid: guildId,
          type: 'set-balance',
          amount: finalAmount,
        },
        client
      );

      return result.rows[0];
    });

    invalidateCache(userId, guildId);
    logger.discord.db(`Set balance for ${userId}:${guildId} to ${finalAmount}`);
    return res.balance;
  } catch (error) {
    logger.discord.dbError(`Error setting balance for ${userId}:${guildId}:`, error);
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
      rank: offset + index + 1,
    }));
  } catch (error) {
    logger.discord.dbError(`Error getting top users for guild ${guildId}:`, error);
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
    logger.discord.dbError(`Error getting rank for ${userId}:${guildId}:`, error);
    throw error;
  }
}

/**
 * Transfer money between users
 */
async function transferBalance(fromUserId, toUserId, guildId, amount, reason = 'transfer') {
  const parsedAmount = toBigInt(amount, 'Transfer amount');
  if (parsedAmount <= 0n) {
    throw new Error('Transfer amount must be a positive integer');
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

    const fromBalance = toBigInt(fromRes.rows[0].balance, 'Sender balance');
    if (fromBalance < parsedAmount) {
      throw new Error(`Insufficient balance: ${fromBalance} < ${parsedAmount}`);
    }

    // Ensure recipient exists
    await client.query(
      `INSERT INTO economy (userid, guildid, balance, lastgrow)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (userid, guildid) DO NOTHING`,
      [toUserId, guildId, DEFAULT_BALANCE, new Date(0)]
    );

    // Lock recipient
    const toRes = await client.query(
      `SELECT balance FROM economy 
             WHERE userid = $1 AND guildid = $2 
             FOR UPDATE`,
      [toUserId, guildId]
    );

    const toBalance = toBigInt(toRes.rows[0].balance, 'Recipient balance');
    const fromNewBalance = fromBalance - parsedAmount;
    const toNewBalance = toBalance + parsedAmount;
    ensurePgBigIntRange(fromNewBalance, 'Sender resulting balance');
    ensurePgBigIntRange(toNewBalance, 'Recipient resulting balance');

    // Update balances
    await client.query('UPDATE economy SET balance = $3 WHERE userid = $1 AND guildid = $2', [
      fromUserId,
      guildId,
      fromNewBalance,
    ]);

    await client.query('UPDATE economy SET balance = $3 WHERE userid = $1 AND guildid = $2', [
      toUserId,
      guildId,
      toNewBalance,
    ]);

    // Invalidate caches
    invalidateCache(fromUserId, guildId);
    invalidateCache(toUserId, guildId);

    // Add to history
    await historyService.addHistory(
      {
        userid: fromUserId,
        guildid: guildId,
        type: 'transfer-out',
        amount: -parsedAmount,
      },
      client
    );
    await historyService.addHistory(
      {
        userid: toUserId,
        guildid: guildId,
        type: 'transfer-in',
        amount: parsedAmount,
      },
      client
    );

    logger.discord.db(
      `Transfer: ${fromUserId} -> ${toUserId} (${guildId}): ${parsedAmount} (${reason})`
    );

    return {
      from: { userId: fromUserId, previousBalance: fromBalance, newBalance: fromNewBalance },
      to: { userId: toUserId, previousBalance: toBalance, newBalance: toNewBalance },
      amount: parsedAmount,
      reason,
    };
  });
}

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
      [guildId, RICH_THRESHOLD]
    );

    const stats = res.rows[0];
    return {
      totalUsers: Number(stats.total_users ?? 0n),
      totalBalance: stats.total_balance ?? 0n,
      avgBalance: stats.avg_balance === null ? 0 : Number(stats.avg_balance),
      maxBalance: stats.max_balance ?? 0n,
      minBalance: stats.min_balance ?? 0n,
      richUsers: Number(stats.rich_users ?? 0n),
    };
  } catch (error) {
    logger.discord.dbError(`Error getting guild stats for ${guildId}:`, error);
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
    logger.debug(`Cleaned ${cleaned} expired cache entries`);
  }
}, 300000); // Clean every 5 minutes

// Track shutdown state to prevent multiple calls
let isShuttingDown = false;

/**
 * Enhanced cleanup with graceful shutdown
 */
async function cleanup() {
  if (isShuttingDown) {
    logger.info('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  logger.info('Shutting down economy service...');

  try {
    // Clear cache
    userCache.clear();

    // Close pool gracefully only if it's not already ended
    if (!pool.ended) {
      await pool.end();
      logger.info('✅ Economy service shutdown complete');
    } else {
      logger.info('✅ Economy service already shutdown');
    }
  } catch (error) {
    // Only log if it's not the "called end more than once" error
    if (!error.message.includes('Called end on pool more than once')) {
      logger.error('❌ Error during economy service shutdown:', error);
    } else {
      logger.info('✅ Economy service shutdown complete (pool already closed)');
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

// Enhanced graceful shutdown handlers with single cleanup call
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  cleanup().finally(() => {
    logger.info(`Exiting on ${signal}`);
    process.exit(0);
  });
};

function getCacheStats() {
  return { size: userCache.size, ttl: CACHE_TTL };
}

// Register shutdown handlers
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

export default {
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
  invalidateCache,
  getCacheStats,
};
