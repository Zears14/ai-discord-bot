import pg from 'pg';
import './pgTypeParsers.js';
import logger from './loggerService.js';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URI,
});

/**
 * Adds a new entry to the history table.
 *
 * @param {object} entry - The history entry to add.
 * @param {string} entry.userid - The user ID.
 * @param {string} entry.guildid - The guild ID.
 * @param {string} entry.type - The type of the event.
 * @param {number} [entry.itemid] - The ID of the item involved.
 * @param {number} [entry.amount] - The amount of currency involved.
 * @returns {Promise<void>}
 */
async function addHistory(entry, dbClient = null) {
  const { userid, guildid, type, itemid, amount } = entry;
  const query = `
        INSERT INTO history (userid, guildid, type, itemid, amount)
        VALUES ($1, $2, $3, $4, $5)
    `;
  const values = [userid, guildid, type, itemid ?? null, amount ?? 0n];
  try {
    const queryClient = dbClient || pool;
    await queryClient.query(query, values);
  } catch (error) {
    logger.discord.dbError('Error adding history:', error);
    throw error;
  }
}

/**
 * Get recent activity for a user in a guild.
 *
 * @param {string} userid - The user ID.
 * @param {string} guildid - The guild ID.
 * @param {number} [limit=10] - Number of entries to return.
 * @returns {Promise<Array>} Array of activity entries.
 */
async function getUserActivity(userid, guildid, limit = 10) {
  const query = `
        SELECT h.*, i.name as item_name, i.title as item_title
        FROM history h
        LEFT JOIN items i ON h.itemid = i.id
        WHERE h.userid = $1 AND h.guildid = $2
        ORDER BY h.created_at DESC
        LIMIT $3
    `;
  const values = [userid, guildid, limit];
  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    logger.discord.dbError('Error fetching user activity:', error);
    throw error;
  }
}

/**
 * Get statistics for a user in a guild.
 *
 * @param {string} userid - The user ID.
 * @param {string} guildid - The guild ID.
 * @returns {Promise<Object>} User statistics.
 */
async function getUserStats(userid, guildid) {
  const query = `
        SELECT 
            COUNT(*) FILTER (WHERE type IN ('slots', 'blackjack-win', 'blackjack-loss', 'blackjack-push', 'blackjack-surrender', 'roulette')) as games_played,
            COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('slots', 'blackjack-win', 'blackjack-loss', 'blackjack-push', 'blackjack-surrender', 'roulette')), 0) as total_gambled,
            COALESCE(SUM(amount) FILTER (WHERE type IN ('grow', 'daily')), 0) as total_earned,
            COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND type NOT IN ('grow', 'daily')), 0) as total_won,
            COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0) as total_lost,
            COUNT(*) FILTER (WHERE type = 'daily') as daily_claims,
            COUNT(*) FILTER (WHERE type = 'grow') as grow_claims,
            COUNT(*) FILTER (WHERE type = 'use-item') as items_used
        FROM history
        WHERE userid = $1 AND guildid = $2
    `;
  const values = [userid, guildid];
  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    logger.discord.dbError('Error fetching user stats:', error);
    throw error;
  }
}

/**
 * Get guild activity statistics.
 *
 * @param {string} guildid - The guild ID.
 * @returns {Promise<Object>} Guild statistics.
 */
async function getGuildStats(guildid) {
  const query = `
        SELECT 
            COUNT(DISTINCT userid) as active_users,
            COUNT(*) FILTER (WHERE type IN ('slots', 'blackjack', 'blackjack-loss', 'blackjack-push', 'blackjack-surrender', 'roulette')) as total_games,
            COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('slots', 'blackjack', 'blackjack-loss', 'blackjack-push', 'blackjack-surrender', 'roulette')), 0) as total_gambled,
            COUNT(DISTINCT type) as unique_activities,
            COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) as total_gained,
            COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0) as total_lost,
            COALESCE(SUM(ABS(amount)), 0) as total_volume,
            COUNT(*) FILTER (WHERE type = 'daily') as daily_claims,
            COUNT(*) FILTER (WHERE type = 'grow') as grow_claims,
            COUNT(*) FILTER (WHERE type = 'use-item') as items_used
        FROM history
        WHERE guildid = $1
        AND created_at >= NOW() - INTERVAL '30 days'
    `;
  const values = [guildid];
  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    logger.discord.dbError('Error fetching guild stats:', error);
    throw error;
  }
}

/**
 * Search history entries based on various criteria.
 *
 * @param {Object} criteria - Search criteria.
 * @param {string} [criteria.userid] - Filter by user ID.
 * @param {string} [criteria.guildid] - Filter by guild ID.
 * @param {string} [criteria.type] - Filter by activity type.
 * @param {number} [criteria.itemid] - Filter by item ID.
 * @param {string} [criteria.dateFrom] - Start date (ISO string).
 * @param {string} [criteria.dateTo] - End date (ISO string).
 * @param {number} [criteria.limit=50] - Maximum number of results.
 * @returns {Promise<Array>} Matching history entries.
 */
async function searchHistory(criteria) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (criteria.userid) {
    conditions.push(`userid = $${paramIndex}`);
    values.push(criteria.userid);
    paramIndex++;
  }

  if (criteria.guildid) {
    conditions.push(`guildid = $${paramIndex}`);
    values.push(criteria.guildid);
    paramIndex++;
  }

  if (criteria.type) {
    conditions.push(`type = $${paramIndex}`);
    values.push(criteria.type);
    paramIndex++;
  }

  if (criteria.itemid !== undefined && criteria.itemid !== null) {
    conditions.push(`itemid = $${paramIndex}`);
    values.push(criteria.itemid);
    paramIndex++;
  }

  if (criteria.dateFrom) {
    conditions.push(`created_at >= $${paramIndex}`);
    values.push(criteria.dateFrom);
    paramIndex++;
  }

  if (criteria.dateTo) {
    conditions.push(`created_at <= $${paramIndex}`);
    values.push(criteria.dateTo);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = criteria.limit || 50;

  const query = `
        SELECT h.*, i.name as item_name, i.title as item_title
        FROM history h
        LEFT JOIN items i ON h.itemid = i.id
        ${whereClause}
        ORDER BY h.created_at DESC
        LIMIT $${paramIndex}
    `;
  values.push(limit);

  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    logger.discord.dbError('Error searching history:', error);
    throw error;
  }
}

export default {
  addHistory,
  getUserActivity,
  getUserStats,
  getGuildStats,
  searchHistory,
};
