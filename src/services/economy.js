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
import { ensurePgBigIntRange, parsePositiveAmount, toBigInt } from '../utils/moneyUtils.js';

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
const BANK_BALANCE_KEY = CONFIG.ECONOMY.BANK?.BALANCE_KEY ?? 'bankBalance';
const BANK_MAX_KEY = CONFIG.ECONOMY.BANK?.MAX_KEY ?? 'bankMax';
const BANK_DEFAULT_MAX = toBigInt(CONFIG.ECONOMY.BANK?.DEFAULT_MAX ?? 100, 'Default bank max');
const BANK_NOTE_MIN_INCREASE = toBigInt(
  CONFIG.ECONOMY.BANK?.BANK_NOTE?.MIN_INCREASE ?? 10,
  'Bank note minimum increase'
);
const BANK_NOTE_CURRENT_MAX_BPS = Math.max(
  0,
  Math.floor(Number(CONFIG.ECONOMY.BANK?.BANK_NOTE?.CURRENT_MAX_BPS ?? 1200))
);
const BANK_NOTE_LEVEL_BONUS_PER_LEVEL = toBigInt(
  CONFIG.ECONOMY.BANK?.BANK_NOTE?.LEVEL_BONUS_PER_LEVEL ?? 4,
  'Bank note level bonus'
);
const LOAN_STATE_KEY = CONFIG.ECONOMY.LOANS?.STATE_KEY ?? 'loanState';
const LOAN_OVERDUE_PENALTY_BPS = Math.max(
  0,
  Math.floor(Number(CONFIG.ECONOMY.LOANS?.OVERDUE_PENALTY_BPS ?? 1200))
);
const LOAN_REMINDER_WINDOW_HOURS = Math.max(
  1,
  Math.floor(Number(CONFIG.ECONOMY.LOANS?.REMINDER_WINDOW_HOURS ?? 24))
);
const LOAN_REMINDER_WINDOW_MS = LOAN_REMINDER_WINDOW_HOURS * 60 * 60 * 1000;
const LOAN_OPTIONS = Array.isArray(CONFIG.ECONOMY.LOANS?.OPTIONS)
  ? CONFIG.ECONOMY.LOANS.OPTIONS.map((option, index) => {
      const id = typeof option?.id === 'string' ? option.id.trim().toLowerCase() : '';
      if (!id) return null;
      const amount = toBigInt(option.amount ?? 0, `Loan option ${id} amount`);
      const durationDays = Math.max(1, Math.floor(Number(option.durationDays ?? 7)));
      const interestBps = Math.max(0, Math.floor(Number(option.interestBps ?? 0)));
      return {
        id,
        amount,
        durationDays,
        interestBps,
        label:
          typeof option?.label === 'string' && option.label.trim().length > 0
            ? option.label.trim()
            : `${amount.toString()} cm for ${durationDays}d`,
        order: index,
      };
    }).filter(Boolean)
  : [];
const LOAN_OPTIONS_BY_ID = new Map(LOAN_OPTIONS.map((option) => [option.id, option]));

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

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getLoanOptionById(optionId) {
  if (typeof optionId !== 'string') return null;
  return LOAN_OPTIONS_BY_ID.get(optionId.trim().toLowerCase()) || null;
}

function getLoanOptions() {
  return LOAN_OPTIONS.map((option) => ({ ...option }));
}

async function getLoanReminderCandidates(limit = 500) {
  const parsedLimit = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 500)));
  const result = await safeQuery(
    `SELECT userid, guildid
       FROM economy
       WHERE data ? $1
       ORDER BY guildid, userid
       LIMIT $2`,
    [LOAN_STATE_KEY, parsedLimit]
  );

  return result.rows.map((row) => ({
    userId: row.userid,
    guildId: row.guildid,
  }));
}

function parseLoanState(rawLoanState) {
  const raw = asPlainObject(rawLoanState);
  if (!Object.keys(raw).length) {
    return null;
  }

  const status =
    raw.status === 'active' || raw.status === 'delinquent'
      ? raw.status
      : raw.delinquent
        ? 'delinquent'
        : null;
  if (!status) {
    return null;
  }

  const debt = toBigInt(raw.debt ?? raw.totalDue ?? 0, 'Loan debt');
  if (debt <= 0n) {
    return null;
  }

  const principal = toBigInt(raw.principal ?? 0, 'Loan principal');
  const dueAt = Math.max(0, Math.floor(Number(raw.dueAt ?? 0)));
  const interestBps = Math.max(0, Math.floor(Number(raw.interestBps ?? 0)));
  const overduePenaltyBps = Math.max(
    0,
    Math.floor(Number(raw.overduePenaltyBps ?? LOAN_OVERDUE_PENALTY_BPS))
  );
  const takenAt = Math.max(0, Math.floor(Number(raw.takenAt ?? 0)));
  const defaultedAt = Math.max(0, Math.floor(Number(raw.defaultedAt ?? 0)));
  const nearDueNotifiedAt = Math.max(0, Math.floor(Number(raw.nearDueNotifiedAt ?? 0)));
  const overdueNotifiedAt = Math.max(0, Math.floor(Number(raw.overdueNotifiedAt ?? 0)));
  const optionId =
    typeof raw.optionId === 'string' && raw.optionId.trim().length > 0
      ? raw.optionId.trim().toLowerCase()
      : null;

  return {
    status,
    debt,
    principal,
    dueAt,
    interestBps,
    overduePenaltyBps,
    takenAt,
    defaultedAt: defaultedAt > 0 ? defaultedAt : null,
    nearDueNotifiedAt: nearDueNotifiedAt > 0 ? nearDueNotifiedAt : null,
    overdueNotifiedAt: overdueNotifiedAt > 0 ? overdueNotifiedAt : null,
    optionId,
  };
}

function serializeLoanState(loanState) {
  if (!loanState) {
    return null;
  }

  return {
    status: loanState.status,
    debt: toBigInt(loanState.debt, 'Loan debt').toString(),
    principal: toBigInt(loanState.principal ?? 0, 'Loan principal').toString(),
    dueAt: loanState.dueAt ?? 0,
    interestBps: loanState.interestBps ?? 0,
    overduePenaltyBps: loanState.overduePenaltyBps ?? LOAN_OVERDUE_PENALTY_BPS,
    takenAt: loanState.takenAt ?? 0,
    defaultedAt: loanState.defaultedAt ?? null,
    nearDueNotifiedAt: loanState.nearDueNotifiedAt ?? null,
    overdueNotifiedAt: loanState.overdueNotifiedAt ?? null,
    optionId: loanState.optionId ?? null,
  };
}

function applyFundsToDebt(walletBalance, bankBalance, debt) {
  let wallet = toBigInt(walletBalance, 'Wallet balance');
  let bank = toBigInt(bankBalance, 'Bank balance');
  let remainingDebt = toBigInt(debt, 'Debt');
  let paid = 0n;

  if (remainingDebt <= 0n) {
    return { wallet, bank, paid: 0n, remainingDebt: 0n };
  }

  if (wallet > 0n) {
    const fromWallet = wallet < remainingDebt ? wallet : remainingDebt;
    wallet -= fromWallet;
    remainingDebt -= fromWallet;
    paid += fromWallet;
  }

  if (remainingDebt > 0n && bank > 0n) {
    const fromBank = bank < remainingDebt ? bank : remainingDebt;
    bank -= fromBank;
    remainingDebt -= fromBank;
    paid += fromBank;
  }

  return { wallet, bank, paid, remainingDebt };
}

function buildDataPayload(baseData, bankBalance, bankMax, loanState) {
  const payload = {
    ...asPlainObject(baseData),
    [BANK_BALANCE_KEY]: toBigInt(bankBalance, 'Bank balance').toString(),
    [BANK_MAX_KEY]: toBigInt(bankMax, 'Bank max').toString(),
  };

  if (loanState) {
    payload[LOAN_STATE_KEY] = serializeLoanState(loanState);
  } else {
    delete payload[LOAN_STATE_KEY];
  }

  return payload;
}

async function persistEconomyState(
  client,
  userId,
  guildId,
  walletBalance,
  bankBalance,
  bankMax,
  loanState,
  baseData
) {
  const updatedData = buildDataPayload(baseData, bankBalance, bankMax, loanState);
  await client.query(
    `UPDATE economy
         SET balance = $3,
             data = $4::jsonb,
             lastgrow = COALESCE(lastgrow, $5)
         WHERE userid = $1 AND guildid = $2`,
    [userId, guildId, walletBalance, updatedData, new Date(0)]
  );
  return updatedData;
}

function normalizeLoanStateForRow(row, nowMs = Date.now()) {
  let walletBalance = toBigInt(row?.balance ?? DEFAULT_BALANCE, 'Wallet balance');
  let { bankBalance, bankMax } = parseBankValues(row);
  const baseData = asPlainObject(row?.data);
  let loanState = parseLoanState(baseData[LOAN_STATE_KEY]);
  let changed = false;
  let defaultedNow = false;
  let seizedOnDefault = 0n;
  let penaltyAdded = 0n;

  if (
    loanState &&
    loanState.status === 'active' &&
    loanState.dueAt > 0 &&
    nowMs > loanState.dueAt
  ) {
    defaultedNow = true;
    const penalty = (loanState.debt * BigInt(loanState.overduePenaltyBps)) / 10000n;
    penaltyAdded = penalty;
    loanState = {
      ...loanState,
      status: 'delinquent',
      defaultedAt: nowMs,
      debt: loanState.debt + penalty,
    };
    changed = true;

    const settlement = applyFundsToDebt(walletBalance, bankBalance, loanState.debt);
    walletBalance = settlement.wallet;
    bankBalance = settlement.bank;
    loanState.debt = settlement.remainingDebt;
    seizedOnDefault = settlement.paid;
    changed = true;
  }

  if (loanState && loanState.debt <= 0n) {
    loanState = null;
    changed = true;
  }

  return {
    walletBalance,
    bankBalance,
    bankMax,
    loanState,
    changed,
    defaultedNow,
    seizedOnDefault,
    penaltyAdded,
  };
}

function ensureTransferAllowedForLoanState(loanState, direction) {
  if (!loanState) {
    return;
  }

  if (loanState.status === 'active') {
    throw new Error(
      direction === 'sender'
        ? 'Transfers are disabled while you have an active loan.'
        : 'Transfers to this user are disabled while they have an active loan.'
    );
  }

  if (loanState.status === 'delinquent') {
    throw new Error(
      direction === 'sender'
        ? 'Transfers are disabled while your loan is delinquent.'
        : 'Transfers to this user are disabled while their loan is delinquent.'
    );
  }
}

async function addLoanNormalizationHistory(client, userId, guildId, normalized) {
  if (!normalized?.defaultedNow) {
    return;
  }

  await historyService.addHistory(
    {
      userid: userId,
      guildid: guildId,
      type: 'loan-default',
      amount: 0n,
    },
    client
  );

  if (normalized.penaltyAdded > 0n) {
    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'loan-overdue-penalty',
        amount: normalized.penaltyAdded,
      },
      client
    );
  }

  if (normalized.seizedOnDefault > 0n) {
    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'loan-default-seizure',
        amount: -normalized.seizedOnDefault,
      },
      client
    );
  }
}

function parseBankValues(row) {
  const bankBalance = toBigInt(row?.bank_balance ?? 0, 'Bank balance');
  let bankMax = toBigInt(row?.bank_max ?? BANK_DEFAULT_MAX, 'Bank max');
  if (bankMax < BANK_DEFAULT_MAX) {
    bankMax = BANK_DEFAULT_MAX;
  }
  if (bankMax < bankBalance) {
    bankMax = bankBalance;
  }

  return { bankBalance, bankMax };
}

function calculateBankNoteIncrease(currentMax, level) {
  const parsedCurrentMax = toBigInt(currentMax, 'Current bank max');
  const parsedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const scaledFromMax = (parsedCurrentMax * BigInt(BANK_NOTE_CURRENT_MAX_BPS)) / 10000n;
  const levelBonus = BigInt(parsedLevel) * BANK_NOTE_LEVEL_BONUS_PER_LEVEL;
  const increase = scaledFromMax + levelBonus;
  return increase >= BANK_NOTE_MIN_INCREASE ? increase : BANK_NOTE_MIN_INCREASE;
}

async function getOrCreateLockedEconomyRow(client, userId, guildId) {
  let row = await client.query(
    `SELECT balance,
              COALESCE(data, '{}'::jsonb) as data,
              COALESCE(data->>$3, '0') as bank_balance,
              COALESCE(data->>$4, $5) as bank_max
         FROM economy
         WHERE userid = $1 AND guildid = $2
         FOR UPDATE`,
    [userId, guildId, BANK_BALANCE_KEY, BANK_MAX_KEY, BANK_DEFAULT_MAX.toString()]
  );

  if (row.rowCount > 0) {
    return row.rows[0];
  }

  await client.query(
    `INSERT INTO economy (userid, guildid, balance, lastgrow, data)
         VALUES ($1, $2, $3, $4, jsonb_build_object($5, $6, $7, $8))
         ON CONFLICT (userid, guildid) DO NOTHING`,
    [
      userId,
      guildId,
      DEFAULT_BALANCE,
      new Date(0),
      BANK_BALANCE_KEY,
      '0',
      BANK_MAX_KEY,
      BANK_DEFAULT_MAX.toString(),
    ]
  );

  row = await client.query(
    `SELECT balance,
              COALESCE(data, '{}'::jsonb) as data,
              COALESCE(data->>$3, '0') as bank_balance,
              COALESCE(data->>$4, $5) as bank_max
         FROM economy
         WHERE userid = $1 AND guildid = $2
         FOR UPDATE`,
    [userId, guildId, BANK_BALANCE_KEY, BANK_MAX_KEY, BANK_DEFAULT_MAX.toString()]
  );

  if (row.rowCount > 0) {
    return row.rows[0];
  }

  throw new Error('Failed to initialize user economy row');
}

async function getLockedEconomyRowIfExists(client, userId, guildId) {
  const row = await client.query(
    `SELECT balance,
              COALESCE(data, '{}'::jsonb) as data,
              COALESCE(data->>$3, '0') as bank_balance,
              COALESCE(data->>$4, $5) as bank_max
         FROM economy
         WHERE userid = $1 AND guildid = $2
         FOR UPDATE`,
    [userId, guildId, BANK_BALANCE_KEY, BANK_MAX_KEY, BANK_DEFAULT_MAX.toString()]
  );

  if (row.rowCount === 0) {
    return null;
  }

  return row.rows[0];
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
  return withTransaction(async (client) => {
    try {
      const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
      const normalized = normalizeLoanStateForRow(row);

      if (normalized.changed) {
        await persistEconomyState(
          client,
          userId,
          guildId,
          normalized.walletBalance,
          normalized.bankBalance,
          normalized.bankMax,
          normalized.loanState,
          row.data
        );
      }

      invalidateCache(userId, guildId);
      return normalized.walletBalance;
    } catch (error) {
      logger.discord.dbError(`Error getting balance for ${userId}:${guildId}:`, error);
      throw error;
    }
  });
}

/**
 * Update user's balance with enhanced validation and atomic operations
 */
async function updateBalance(userId, guildId, amount, reason = 'update') {
  const parsedAmount = toBigInt(amount, 'Amount');

  return withTransaction(async (client) => {
    try {
      const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
      const previousBalance = toBigInt(row.balance ?? DEFAULT_BALANCE, 'Previous balance');
      const normalized = normalizeLoanStateForRow(row);

      let newBalance = normalized.walletBalance;
      let bankBalance = normalized.bankBalance;
      const bankMax = normalized.bankMax;
      let loanState = normalized.loanState;
      let redirectedToDebt = 0n;
      let debtIncreasedBy = 0n;

      if (loanState?.status === 'delinquent') {
        if (parsedAmount > 0n) {
          redirectedToDebt = parsedAmount < loanState.debt ? parsedAmount : loanState.debt;
          loanState = {
            ...loanState,
            debt: loanState.debt - redirectedToDebt,
          };
          newBalance += parsedAmount - redirectedToDebt;
        } else if (parsedAmount < 0n) {
          debtIncreasedBy = -parsedAmount;
          loanState = {
            ...loanState,
            debt: loanState.debt + debtIncreasedBy,
          };
        }
      } else {
        const proposedBalance = newBalance + parsedAmount;
        ensurePgBigIntRange(proposedBalance, 'Resulting balance');

        if (proposedBalance < MIN_BALANCE) {
          throw new Error(
            'Transaction would violate minimum balance. ' +
              `Current: ${newBalance}, Change: ${parsedAmount}, ` +
              `Resulting: ${proposedBalance}, Minimum: ${MIN_BALANCE}`
          );
        }

        newBalance = proposedBalance;
      }

      if (loanState && loanState.debt <= 0n) {
        loanState = null;
      }

      ensurePgBigIntRange(newBalance, 'Resulting wallet balance');
      ensurePgBigIntRange(bankBalance, 'Resulting bank balance');

      await persistEconomyState(
        client,
        userId,
        guildId,
        newBalance,
        bankBalance,
        bankMax,
        loanState,
        row.data
      );

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

      await addLoanNormalizationHistory(client, userId, guildId, normalized);

      if (redirectedToDebt > 0n) {
        await historyService.addHistory(
          {
            userid: userId,
            guildid: guildId,
            type: 'loan-debt-payment',
            amount: redirectedToDebt,
          },
          client
        );
      }

      if (debtIncreasedBy > 0n) {
        await historyService.addHistory(
          {
            userid: userId,
            guildid: guildId,
            type: 'loan-delinquent-loss',
            amount: debtIncreasedBy,
          },
          client
        );
      }

      // Invalidate cache
      invalidateCache(userId, guildId);

      return {
        userId,
        guildId,
        balance: newBalance,
        previousBalance,
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
    const fromRow = await getOrCreateLockedEconomyRow(client, fromUserId, guildId);
    const toRow = await getOrCreateLockedEconomyRow(client, toUserId, guildId);

    const fromNormalized = normalizeLoanStateForRow(fromRow);
    const toNormalized = normalizeLoanStateForRow(toRow);

    let fromData = fromRow.data;
    let toData = toRow.data;

    if (fromNormalized.changed) {
      fromData = await persistEconomyState(
        client,
        fromUserId,
        guildId,
        fromNormalized.walletBalance,
        fromNormalized.bankBalance,
        fromNormalized.bankMax,
        fromNormalized.loanState,
        fromData
      );
      await addLoanNormalizationHistory(client, fromUserId, guildId, fromNormalized);
    }

    if (toNormalized.changed) {
      toData = await persistEconomyState(
        client,
        toUserId,
        guildId,
        toNormalized.walletBalance,
        toNormalized.bankBalance,
        toNormalized.bankMax,
        toNormalized.loanState,
        toData
      );
      await addLoanNormalizationHistory(client, toUserId, guildId, toNormalized);
    }

    ensureTransferAllowedForLoanState(fromNormalized.loanState, 'sender');
    ensureTransferAllowedForLoanState(toNormalized.loanState, 'recipient');

    const fromBalance = fromNormalized.walletBalance;
    if (fromBalance < parsedAmount) {
      throw new Error(`Insufficient balance: ${fromBalance} < ${parsedAmount}`);
    }

    const toBalance = toNormalized.walletBalance;
    const fromNewBalance = fromBalance - parsedAmount;
    const toNewBalance = toBalance + parsedAmount;
    ensurePgBigIntRange(fromNewBalance, 'Sender resulting balance');
    ensurePgBigIntRange(toNewBalance, 'Recipient resulting balance');

    await persistEconomyState(
      client,
      fromUserId,
      guildId,
      fromNewBalance,
      fromNormalized.bankBalance,
      fromNormalized.bankMax,
      fromNormalized.loanState,
      fromData
    );

    await persistEconomyState(
      client,
      toUserId,
      guildId,
      toNewBalance,
      toNormalized.bankBalance,
      toNormalized.bankMax,
      toNormalized.loanState,
      toData
    );

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
 * Get wallet + bank balances and capacity.
 */
async function getBankData(userId, guildId) {
  const snapshot = await withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);

    if (normalized.changed) {
      await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        row.data
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    return normalized;
  });

  invalidateCache(userId, guildId);
  const walletBalance = snapshot.walletBalance;
  const bankBalance = snapshot.bankBalance;
  const bankMax = snapshot.bankMax;
  const availableSpace = bankMax > bankBalance ? bankMax - bankBalance : 0n;

  return {
    walletBalance,
    bankBalance,
    bankMax,
    availableSpace,
    totalBalance: walletBalance + bankBalance,
  };
}

/**
 * Move funds from wallet to bank.
 */
async function depositToBank(userId, guildId, amount) {
  const parsedAmount = parsePositiveAmount(amount, 'Deposit amount');

  return withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);
    let rowData = row.data;

    if (normalized.changed) {
      rowData = await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        rowData
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    if (normalized.loanState?.status === 'delinquent') {
      throw new Error('Bank transfers are disabled while your loan is delinquent.');
    }

    const walletBalance = normalized.walletBalance;
    const bankBalance = normalized.bankBalance;
    const bankMax = normalized.bankMax;
    const availableSpace = bankMax > bankBalance ? bankMax - bankBalance : 0n;

    if (walletBalance < parsedAmount) {
      throw new Error(
        `Insufficient wallet balance. Wallet: ${walletBalance}, requested: ${parsedAmount}`
      );
    }

    if (availableSpace < parsedAmount) {
      throw new Error(
        `Bank capacity exceeded. Available bank space: ${availableSpace}, requested: ${parsedAmount}`
      );
    }

    const newWalletBalance = walletBalance - parsedAmount;
    const newBankBalance = bankBalance + parsedAmount;

    if (newWalletBalance < MIN_BALANCE) {
      throw new Error(
        `Deposit would violate minimum wallet balance. Minimum wallet balance is ${MIN_BALANCE}.`
      );
    }

    ensurePgBigIntRange(newWalletBalance, 'Wallet balance after deposit');
    ensurePgBigIntRange(newBankBalance, 'Bank balance after deposit');

    await persistEconomyState(
      client,
      userId,
      guildId,
      newWalletBalance,
      newBankBalance,
      bankMax,
      normalized.loanState,
      rowData
    );

    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'bank-deposit',
        amount: 0n,
      },
      client
    );

    invalidateCache(userId, guildId);

    return {
      movedAmount: parsedAmount,
      walletBalance: newWalletBalance,
      bankBalance: newBankBalance,
      bankMax,
      availableSpace: bankMax > newBankBalance ? bankMax - newBankBalance : 0n,
    };
  });
}

/**
 * Move funds from bank to wallet.
 */
async function withdrawFromBank(userId, guildId, amount) {
  const parsedAmount = parsePositiveAmount(amount, 'Withdraw amount');

  return withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);
    let rowData = row.data;

    if (normalized.changed) {
      rowData = await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        rowData
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    if (normalized.loanState?.status === 'delinquent') {
      throw new Error('Bank transfers are disabled while your loan is delinquent.');
    }

    const walletBalance = normalized.walletBalance;
    const bankBalance = normalized.bankBalance;
    const bankMax = normalized.bankMax;

    if (bankBalance < parsedAmount) {
      throw new Error(
        `Insufficient bank balance. Bank: ${bankBalance}, requested: ${parsedAmount}`
      );
    }

    const newWalletBalance = walletBalance + parsedAmount;
    const newBankBalance = bankBalance - parsedAmount;
    ensurePgBigIntRange(newWalletBalance, 'Wallet balance after withdrawal');
    ensurePgBigIntRange(newBankBalance, 'Bank balance after withdrawal');

    await persistEconomyState(
      client,
      userId,
      guildId,
      newWalletBalance,
      newBankBalance,
      bankMax,
      normalized.loanState,
      rowData
    );

    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'bank-withdraw',
        amount: 0n,
      },
      client
    );

    invalidateCache(userId, guildId);

    return {
      movedAmount: parsedAmount,
      walletBalance: newWalletBalance,
      bankBalance: newBankBalance,
      bankMax,
      availableSpace: bankMax > newBankBalance ? bankMax - newBankBalance : 0n,
    };
  });
}

/**
 * Increase max bank capacity using upgrade items.
 */
async function expandBankCapacity(userId, guildId, quantity = 1, level = 1) {
  const parsedQuantity = parsePositiveAmount(quantity, 'Quantity');
  const parsedLevel = Math.max(1, Math.floor(Number(level) || 1));

  return withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);
    let rowData = row.data;

    if (normalized.changed) {
      rowData = await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        rowData
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    const walletBalance = normalized.walletBalance;
    const bankBalance = normalized.bankBalance;
    const initialBankMax = normalized.bankMax;
    let bankMax = initialBankMax;

    let totalIncrease = 0n;
    let used = 0n;
    while (used < parsedQuantity) {
      const increase = calculateBankNoteIncrease(bankMax, parsedLevel);
      bankMax += increase;
      totalIncrease += increase;
      used++;
    }

    ensurePgBigIntRange(bankMax, 'Bank max after upgrade');

    await persistEconomyState(
      client,
      userId,
      guildId,
      walletBalance,
      bankBalance,
      bankMax,
      normalized.loanState,
      rowData
    );

    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'bank-capacity-upgrade',
        amount: 0n,
      },
      client
    );

    invalidateCache(userId, guildId);

    return {
      quantity: parsedQuantity,
      totalIncrease,
      bankMax,
      bankBalance,
      availableSpace: bankMax > bankBalance ? bankMax - bankBalance : 0n,
      level: parsedLevel,
    };
  });
}

function buildLoanSnapshot(loanState, walletBalance, bankBalance, bankMax) {
  const totalBalance = walletBalance + bankBalance;
  if (!loanState) {
    return {
      hasLoan: false,
      loan: null,
      walletBalance,
      bankBalance,
      bankMax,
      totalBalance,
    };
  }

  return {
    hasLoan: true,
    loan: {
      status: loanState.status,
      debt: loanState.debt,
      principal: loanState.principal,
      dueAt: loanState.dueAt || null,
      interestBps: loanState.interestBps,
      overduePenaltyBps: loanState.overduePenaltyBps,
      takenAt: loanState.takenAt || null,
      defaultedAt: loanState.defaultedAt || null,
      optionId: loanState.optionId,
    },
    walletBalance,
    bankBalance,
    bankMax,
    totalBalance,
  };
}

async function getLoanState(userId, guildId) {
  const snapshot = await withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);

    if (normalized.changed) {
      await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        row.data
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    return buildLoanSnapshot(
      normalized.loanState,
      normalized.walletBalance,
      normalized.bankBalance,
      normalized.bankMax
    );
  });

  invalidateCache(userId, guildId);
  return snapshot;
}

async function consumeLoanReminderEvents(userId, guildId, nowMs = Date.now()) {
  return withTransaction(async (client) => {
    const row = await getLockedEconomyRowIfExists(client, userId, guildId);
    if (!row) {
      return [];
    }

    const normalized = normalizeLoanStateForRow(row, nowMs);
    let rowData = row.data;
    let loanState = normalized.loanState;
    const reminderEvents = [];

    if (normalized.changed) {
      rowData = await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        loanState,
        rowData
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    if (loanState?.status === 'active' && loanState.dueAt > nowMs) {
      const remainingMs = loanState.dueAt - nowMs;
      if (remainingMs <= LOAN_REMINDER_WINDOW_MS && !loanState.nearDueNotifiedAt) {
        reminderEvents.push({
          type: 'near-due',
          debt: loanState.debt,
          dueAt: loanState.dueAt,
          remainingMs,
        });
        loanState = {
          ...loanState,
          nearDueNotifiedAt: nowMs,
        };
      }
    }

    if (loanState?.status === 'delinquent' && !loanState.overdueNotifiedAt) {
      reminderEvents.push({
        type: 'overdue',
        debt: loanState.debt,
        dueAt: loanState.dueAt || null,
        defaultedAt: loanState.defaultedAt || nowMs,
      });
      loanState = {
        ...loanState,
        overdueNotifiedAt: nowMs,
      };
    }

    if (loanState && loanState.debt <= 0n) {
      loanState = null;
    }

    if (loanState !== normalized.loanState) {
      await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        loanState,
        rowData
      );
    }

    invalidateCache(userId, guildId);
    return reminderEvents;
  });
}

async function takeLoan(userId, guildId, optionId) {
  const option = getLoanOptionById(optionId);
  if (!option) {
    throw new Error('Invalid loan option.');
  }

  return withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);
    let rowData = row.data;

    if (normalized.changed) {
      rowData = await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        rowData
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    if (normalized.loanState) {
      throw new Error('You already have an active loan or delinquent debt.');
    }

    const now = Date.now();
    const durationMs = option.durationDays * 24 * 60 * 60 * 1000;
    const interest = (option.amount * BigInt(option.interestBps)) / 10000n;
    const debt = option.amount + interest;
    const newWalletBalance = normalized.walletBalance + option.amount;
    ensurePgBigIntRange(newWalletBalance, 'Wallet balance after loan');

    const loanState = {
      status: 'active',
      debt,
      principal: option.amount,
      dueAt: now + durationMs,
      interestBps: option.interestBps,
      overduePenaltyBps: LOAN_OVERDUE_PENALTY_BPS,
      takenAt: now,
      defaultedAt: null,
      nearDueNotifiedAt: null,
      overdueNotifiedAt: null,
      optionId: option.id,
    };

    await persistEconomyState(
      client,
      userId,
      guildId,
      newWalletBalance,
      normalized.bankBalance,
      normalized.bankMax,
      loanState,
      rowData
    );

    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'loan-taken',
        amount: option.amount,
      },
      client
    );

    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'loan-created-debt',
        amount: debt,
      },
      client
    );

    invalidateCache(userId, guildId);

    return buildLoanSnapshot(
      loanState,
      newWalletBalance,
      normalized.bankBalance,
      normalized.bankMax
    );
  });
}

async function payLoan(userId, guildId, amount = null) {
  const parsedAmount = amount === null ? null : parsePositiveAmount(amount, 'Loan payment amount');

  return withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);
    let rowData = row.data;

    if (normalized.changed) {
      rowData = await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        rowData
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    if (!normalized.loanState) {
      throw new Error('You have no active loan or debt.');
    }

    const availableFunds = normalized.walletBalance + normalized.bankBalance;
    if (availableFunds <= 0n) {
      throw new Error('You have no available funds in wallet/bank to pay this debt.');
    }

    const requested = parsedAmount ?? availableFunds;
    const targetPayment =
      requested < normalized.loanState.debt ? requested : normalized.loanState.debt;
    const payment = targetPayment < availableFunds ? targetPayment : availableFunds;

    if (payment <= 0n) {
      throw new Error('Payment amount must be greater than zero.');
    }

    const settlement = applyFundsToDebt(normalized.walletBalance, normalized.bankBalance, payment);
    let loanState = {
      ...normalized.loanState,
      debt: normalized.loanState.debt - payment,
    };

    if (loanState.debt <= 0n) {
      loanState = null;
    }

    await persistEconomyState(
      client,
      userId,
      guildId,
      settlement.wallet,
      settlement.bank,
      normalized.bankMax,
      loanState,
      rowData
    );

    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'loan-payment',
        amount: payment,
      },
      client
    );

    invalidateCache(userId, guildId);

    return {
      paid: payment,
      ...buildLoanSnapshot(loanState, settlement.wallet, settlement.bank, normalized.bankMax),
    };
  });
}

async function clearLoanForTesting(userId, guildId) {
  return withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);
    const hadLoan = Boolean(normalized.loanState);

    await persistEconomyState(
      client,
      userId,
      guildId,
      normalized.walletBalance,
      normalized.bankBalance,
      normalized.bankMax,
      null,
      row.data
    );

    await addLoanNormalizationHistory(client, userId, guildId, normalized);
    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'loan-test-clear',
        amount: 0n,
      },
      client
    );

    invalidateCache(userId, guildId);

    return {
      hadLoan,
      ...buildLoanSnapshot(
        null,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax
      ),
    };
  });
}

async function forceLoanDefaultForTesting(userId, guildId) {
  return withTransaction(async (client) => {
    const row = await getOrCreateLockedEconomyRow(client, userId, guildId);
    const normalized = normalizeLoanStateForRow(row);
    let rowData = row.data;

    if (normalized.changed) {
      rowData = await persistEconomyState(
        client,
        userId,
        guildId,
        normalized.walletBalance,
        normalized.bankBalance,
        normalized.bankMax,
        normalized.loanState,
        rowData
      );
      await addLoanNormalizationHistory(client, userId, guildId, normalized);
    }

    if (!normalized.loanState) {
      throw new Error('No active loan to force default.');
    }

    const now = Date.now();
    const forcedLoanState = {
      ...normalized.loanState,
      status: 'active',
      dueAt: now - 1,
      defaultedAt: null,
    };

    const forcedData = buildDataPayload(
      rowData,
      normalized.bankBalance,
      normalized.bankMax,
      forcedLoanState
    );
    const forcedRow = {
      balance: normalized.walletBalance,
      bank_balance: normalized.bankBalance.toString(),
      bank_max: normalized.bankMax.toString(),
      data: forcedData,
    };
    const forcedNormalized = normalizeLoanStateForRow(forcedRow, now);

    await persistEconomyState(
      client,
      userId,
      guildId,
      forcedNormalized.walletBalance,
      forcedNormalized.bankBalance,
      forcedNormalized.bankMax,
      forcedNormalized.loanState,
      forcedData
    );

    await addLoanNormalizationHistory(client, userId, guildId, forcedNormalized);
    await historyService.addHistory(
      {
        userid: userId,
        guildid: guildId,
        type: 'loan-test-force-default',
        amount: 0n,
      },
      client
    );

    invalidateCache(userId, guildId);

    return {
      ...buildLoanSnapshot(
        forcedNormalized.loanState,
        forcedNormalized.walletBalance,
        forcedNormalized.bankBalance,
        forcedNormalized.bankMax
      ),
      penaltyAdded: forcedNormalized.penaltyAdded,
      seizedOnDefault: forcedNormalized.seizedOnDefault,
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
  getBankData,
  depositToBank,
  withdrawFromBank,
  expandBankCapacity,
  getLoanOptions,
  getLoanReminderCandidates,
  getLoanState,
  consumeLoanReminderEvents,
  takeLoan,
  payLoan,
  clearLoanForTesting,
  forceLoanDefaultForTesting,
  getGuildStats,
  healthCheck,
  initializeDatabase,

  // Utility functions
  invalidateCache,
  getCacheStats,
};
