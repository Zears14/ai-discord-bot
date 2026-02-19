/**
 * @fileoverview JSONB service for managing additional user data
 * @module services/jsonbService
 */

import pg from 'pg';
import './pgTypeParsers.js';
import { createPoolConfig, isTransientDatabaseError } from './dbConfig.js';
import logger from './loggerService.js';
const { Pool } = pg;

const pool = new Pool(
  createPoolConfig({
    application_name: 'discord-bot-jsonbService',
  })
);

pool.on('error', (error) => {
  if (isTransientDatabaseError(error)) {
    logger.warn('JSONB service pool connection dropped; reconnecting on demand.', {
      module: 'database',
      error,
    });
    return;
  }

  logger.discord.dbError('JSONB service pool error:', error);
});

/**
 * Get JSONB data for user
 */
async function getData(userId, guildId) {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT data FROM economy WHERE userid = $1 AND guildid = $2', [
      userId,
      guildId,
    ]);

    return res.rowCount > 0 ? res.rows[0].data : {};
  } finally {
    client.release();
  }
}

/**
 * Set entire JSONB data for user
 */
async function setData(userId, guildId, data) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO economy (userid, guildid, balance, lastgrow, data)
             VALUES ($1, $2, 0, '1970-01-01 00:00:00+00', $3)
             ON CONFLICT (userid, guildid)
             DO UPDATE SET data = EXCLUDED.data`,
      [userId, guildId, JSON.stringify(data)]
    );
  } finally {
    client.release();
  }
}

/**
 * Get specific key from JSONB data
 */
async function getKey(userId, guildId, key) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT data->$3 as value FROM economy WHERE userid = $1 AND guildid = $2',
      [userId, guildId, key]
    );

    return res.rowCount > 0 ? res.rows[0].value : null;
  } finally {
    client.release();
  }
}

/**
 * Set specific key in JSONB data
 */
/**
 * Set specific key in JSONB data. This will create a JSONB object with the provided key and value,
 * and merge it with any existing data in the 'data' column.
 * @param {string} userId - The user's ID.
 * @param {string} guildId - The guild's ID.
 * @param {string} key - The key to set in the JSONB data.
 * @param {*} value - The value to set for the key. This can be any type that can be serialized to JSON.
 * @example
 * // Sets the 'lastDaily' key to the current ISO date string.
 * await setKey(userId, guildId, 'lastDaily', new Date().toISOString());
 */
async function setKey(userId, guildId, key, value) {
  const client = await pool.connect();
  try {
    const dataToSet = { [key]: value };
    await client.query(
      `INSERT INTO economy (userid, guildid, balance, lastgrow, data)
             VALUES ($1, $2, 0, '1970-01-01 00:00:00+00', $3::jsonb)
             ON CONFLICT (userid, guildid)
             DO UPDATE SET data = COALESCE(economy.data, '{}'::jsonb) || $3::jsonb`,
      [userId, guildId, dataToSet]
    );
  } finally {
    client.release();
  }
}

/**
 * Remove key from JSONB data
 */
async function removeKey(userId, guildId, key) {
  const client = await pool.connect();
  try {
    await client.query('UPDATE economy SET data = data - $3 WHERE userid = $1 AND guildid = $2', [
      userId,
      guildId,
      key,
    ]);
  } finally {
    client.release();
  }
}

/**
 * Increment numeric value in JSONB
 */
async function incrementKey(userId, guildId, key, amount = 1) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO economy (userid, guildid, balance, lastgrow, data)
             VALUES ($1, $2, 0, '1970-01-01 00:00:00+00', jsonb_build_object($3, $4))
             ON CONFLICT (userid, guildid)
             DO UPDATE SET data = COALESCE(economy.data, '{}'::jsonb) || 
                jsonb_build_object($3, COALESCE((economy.data->>$3)::bigint, 0) + $4::bigint)`,
      [userId, guildId, key, amount]
    );
  } finally {
    client.release();
  }
}

/**
 * Atomically acquire a timed JSONB lock-like key for a user.
 * This only sets the key if it is absent or expired.
 */
async function acquireTimedKey(userId, guildId, key, untilTimestamp, nowTimestamp = Date.now()) {
  const client = await pool.connect();
  try {
    const updated = await client.query(
      `UPDATE economy
             SET data = jsonb_set(
               COALESCE(data, '{}'::jsonb),
               ARRAY[$3]::text[],
               to_jsonb($4::bigint),
               true
             )
             WHERE userid = $1
               AND guildid = $2
               AND COALESCE((data->>$3)::bigint, 0) <= $5::bigint
             RETURNING $4::bigint as value`,
      [userId, guildId, key, untilTimestamp, nowTimestamp]
    );

    if (updated.rowCount > 0) {
      return { acquired: true, value: updated.rows[0].value };
    }

    const current = await client.query(
      `SELECT COALESCE((data->>$3)::bigint, 0) as value
             FROM economy
             WHERE userid = $1 AND guildid = $2`,
      [userId, guildId, key]
    );

    return {
      acquired: false,
      value: current.rowCount > 0 ? current.rows[0].value : 0n,
    };
  } finally {
    client.release();
  }
}

/**
 * Check if key exists in JSONB data
 */
async function hasKey(userId, guildId, key) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT data ? $3 as exists FROM economy WHERE userid = $1 AND guildid = $2',
      [userId, guildId, key]
    );

    return res.rowCount > 0 ? res.rows[0].exists : false;
  } finally {
    client.release();
  }
}

/**
 * Search users by JSONB key-value
 */
async function findByKey(guildId, key, value) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT userid, data FROM economy WHERE guildid = $1 AND data->$2 = $3',
      [guildId, key, JSON.stringify(value)]
    );

    return res.rows;
  } finally {
    client.release();
  }
}

export default {
  getData,
  setData,
  getKey,
  setKey,
  removeKey,
  incrementKey,
  acquireTimedKey,
  hasKey,
  findByKey,
};
