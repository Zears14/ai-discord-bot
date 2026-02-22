/**
 * @fileoverview Redis-backed command session and exclusive-session locks.
 * @module services/commandSessionService
 */

import { createClient } from 'redis';
import logger from './loggerService.js';

const SESSION_PREFIX = 'command_session:';
const EXCLUSIVE_PREFIX = 'exclusive_session:';
const COOLDOWN_PREFIX = 'command_cooldown:';
const redisHostOrUrl = process.env.REDIS_URL || 'redis://localhost:6379';

function createRedisClient() {
  if (redisHostOrUrl.includes('://')) {
    return createClient({
      url: redisHostOrUrl,
    });
  }

  return createClient({
    socket: {
      host: redisHostOrUrl,
      port: Number(process.env.REDIS_PORT || 6379),
    },
  });
}

const client = createRedisClient();
let connectPromise = null;

client.on('error', (error) => {
  logger.warn('Command session redis error', {
    module: 'redis-session',
    error,
  });
});

async function ensureConnected() {
  if (client.isOpen) {
    return;
  }

  if (!connectPromise) {
    connectPromise = client.connect().catch((error) => {
      connectPromise = null;
      throw error;
    });
  }

  await connectPromise;
}

function getSessionKey(type, messageId) {
  return `${SESSION_PREFIX}${type}:${messageId}`;
}

function getExclusiveKey(userId, guildId) {
  return `${EXCLUSIVE_PREFIX}${guildId}:${userId}`;
}

function getCooldownKey(userId, guildId, commandName) {
  return `${COOLDOWN_PREFIX}${guildId}:${userId}:${commandName}`;
}

async function setSession(type, messageId, data, ttlSeconds) {
  try {
    await ensureConnected();
    const key = getSessionKey(type, messageId);
    const ttl = Math.max(1, Math.floor(Number(ttlSeconds) || 30));
    await client.set(key, JSON.stringify(data), {
      EX: ttl,
    });
    return true;
  } catch (error) {
    logger.warn('Failed to set command session', {
      module: 'redis-session',
      type,
      messageId,
      error,
    });
    return false;
  }
}

async function getSession(type, messageId) {
  try {
    await ensureConnected();
    const key = getSessionKey(type, messageId);
    const raw = await client.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    logger.warn('Failed to read command session', {
      module: 'redis-session',
      type,
      messageId,
      error,
    });
    return null;
  }
}

async function deleteSession(type, messageId) {
  try {
    await ensureConnected();
    const key = getSessionKey(type, messageId);
    await client.del(key);
  } catch (error) {
    logger.warn('Failed to delete command session', {
      module: 'redis-session',
      type,
      messageId,
      error,
    });
  }
}

async function acquireExclusiveSession(userId, guildId, commandName, ttlSeconds = 60) {
  const key = getExclusiveKey(userId, guildId);
  const expiresAt = Date.now() + Math.max(1, Math.floor(Number(ttlSeconds) || 60)) * 1000;
  const payload = JSON.stringify({
    commandName,
    expiresAt,
  });

  try {
    await ensureConnected();
    const result = await client.set(key, payload, {
      NX: true,
      EX: Math.max(1, Math.floor(Number(ttlSeconds) || 60)),
    });

    if (result === 'OK') {
      return { acquired: true, session: { commandName, expiresAt } };
    }

    return { acquired: false, session: null };
  } catch (error) {
    logger.warn('Failed to acquire exclusive session', {
      module: 'redis-session',
      userId,
      guildId,
      commandName,
      error,
    });
    return { acquired: false, session: null };
  }
}

async function getExclusiveSession(userId, guildId) {
  const key = getExclusiveKey(userId, guildId);
  try {
    await ensureConnected();
    const raw = await client.get(key);
    if (!raw) {
      return null;
    }

    const session = JSON.parse(raw);
    if (!session || typeof session !== 'object') {
      return null;
    }
    if (!session.commandName) {
      return null;
    }
    if (!Number.isFinite(Number(session.expiresAt))) {
      return null;
    }

    return {
      commandName: session.commandName,
      expiresAt: Math.floor(Number(session.expiresAt)),
    };
  } catch (error) {
    logger.warn('Failed to get exclusive session', {
      module: 'redis-session',
      userId,
      guildId,
      error,
    });
    return null;
  }
}

async function releaseExclusiveSession(userId, guildId) {
  const key = getExclusiveKey(userId, guildId);
  try {
    await ensureConnected();
    await client.del(key);
  } catch (error) {
    logger.warn('Failed to release exclusive session', {
      module: 'redis-session',
      userId,
      guildId,
      error,
    });
  }
}

async function setCommandCooldown(userId, guildId, commandName, expiresAtMs) {
  try {
    await ensureConnected();
    const key = getCooldownKey(userId, guildId, commandName);
    const now = Date.now();
    const ttlSeconds = Math.max(1, Math.ceil((Number(expiresAtMs) - now) / 1000));
    await client.set(key, String(Math.floor(Number(expiresAtMs))), {
      EX: ttlSeconds,
    });
  } catch (error) {
    logger.warn('Failed to set command cooldown', {
      module: 'redis-session',
      userId,
      guildId,
      commandName,
      error,
    });
  }
}

async function getCommandCooldownRemaining(userId, guildId, commandName) {
  try {
    await ensureConnected();
    const key = getCooldownKey(userId, guildId, commandName);
    const raw = await client.get(key);
    if (!raw) {
      return 0;
    }

    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt)) {
      return 0;
    }

    return Math.max(0, (expiresAt - Date.now()) / 1000);
  } catch (error) {
    logger.warn('Failed to get command cooldown', {
      module: 'redis-session',
      userId,
      guildId,
      commandName,
      error,
    });
    return 0;
  }
}

async function cleanup() {
  if (!client.isOpen) {
    return;
  }

  try {
    await client.quit();
  } catch (error) {
    logger.warn('Failed to close command session redis client', {
      module: 'redis-session',
      error,
    });
  } finally {
    connectPromise = null;
  }
}

export default {
  setSession,
  getSession,
  deleteSession,
  acquireExclusiveSession,
  getExclusiveSession,
  releaseExclusiveSession,
  setCommandCooldown,
  getCommandCooldownRemaining,
  cleanup,
};
