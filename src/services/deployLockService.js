/**
 * @fileoverview Redis-backed short-lived deploy overlap dedupe locks.
 * @module services/deployLockService
 */

import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import logger from './loggerService.js';

const LOCK_PREFIX = 'deploy_lock:';
const DEFAULT_TTL_SECONDS = 10;
const STARTUP_LOCK_KEY = 'bot-login';
const STARTUP_LOCK_TTL_SECONDS = 30;
const STARTUP_LOCK_POLL_MS = 1000;
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
let startupLockState = null;

client.on('error', (error) => {
  logger.warn('Deploy lock redis error', {
    module: 'redis-lock',
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(key, ttl = DEFAULT_TTL_SECONDS) {
  if (!key || typeof key !== 'string') {
    return false;
  }

  const parsedTtl = Math.max(1, Math.floor(Number(ttl) || DEFAULT_TTL_SECONDS));

  try {
    await ensureConnected();
    const result = await client.set(`${LOCK_PREFIX}${key}`, '1', {
      NX: true,
      EX: parsedTtl,
    });

    return result === 'OK';
  } catch (error) {
    logger.warn('Deploy lock check failed; skipping event processing', {
      module: 'redis-lock',
      key,
      error,
    });
    return false;
  }
}

async function refreshStartupLock() {
  if (!startupLockState) {
    return;
  }

  const redisKey = `${LOCK_PREFIX}${startupLockState.key}`;

  try {
    await ensureConnected();
    const refreshed = await client.eval(
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
      else
        return 0
      end
      `,
      {
        keys: [redisKey],
        arguments: [startupLockState.token, String(startupLockState.ttlSeconds)],
      }
    );

    if (Number(refreshed) !== 1) {
      logger.warn('Lost startup lock ownership while running', {
        module: 'redis-lock',
        key: startupLockState.key,
      });
      clearInterval(startupLockState.refreshInterval);
      startupLockState = null;
    }
  } catch (error) {
    logger.warn('Failed to refresh startup lock', {
      module: 'redis-lock',
      key: startupLockState?.key,
      error,
    });
  }
}

async function acquireStartupLock({
  key = STARTUP_LOCK_KEY,
  ttlSeconds = STARTUP_LOCK_TTL_SECONDS,
  pollMs = STARTUP_LOCK_POLL_MS,
} = {}) {
  if (startupLockState) {
    return true;
  }

  const parsedTtl = Math.max(5, Math.floor(Number(ttlSeconds) || STARTUP_LOCK_TTL_SECONDS));
  const parsedPollMs = Math.max(100, Math.floor(Number(pollMs) || STARTUP_LOCK_POLL_MS));
  const redisKey = `${LOCK_PREFIX}${key}`;
  const token = randomUUID();
  let hasLoggedWait = false;

  while (true) {
    try {
      await ensureConnected();
      const result = await client.set(redisKey, token, {
        NX: true,
        EX: parsedTtl,
      });

      if (result === 'OK') {
        const refreshInterval = setInterval(
          () => {
            refreshStartupLock().catch(() => {});
          },
          Math.max(1000, Math.floor((parsedTtl * 1000) / 3))
        );
        startupLockState = {
          key,
          token,
          ttlSeconds: parsedTtl,
          refreshInterval,
        };
        logger.info('Acquired startup login lock', {
          module: 'redis-lock',
          key,
          ttlSeconds: parsedTtl,
        });
        return true;
      }

      if (!hasLoggedWait) {
        logger.info('Startup lock already held; waiting for release', {
          module: 'redis-lock',
          key,
        });
        hasLoggedWait = true;
      }

      await sleep(parsedPollMs);
    } catch (error) {
      logger.warn('Failed to acquire startup lock; retrying', {
        module: 'redis-lock',
        key,
        error,
      });
      await sleep(parsedPollMs);
    }
  }
}

async function releaseStartupLock() {
  if (!startupLockState) {
    return;
  }

  const { key, token, refreshInterval } = startupLockState;
  const redisKey = `${LOCK_PREFIX}${key}`;
  clearInterval(refreshInterval);
  startupLockState = null;

  try {
    await ensureConnected();
    await client.eval(
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
      `,
      {
        keys: [redisKey],
        arguments: [token],
      }
    );
    logger.info('Released startup login lock', {
      module: 'redis-lock',
      key,
    });
  } catch (error) {
    logger.warn('Failed to release startup lock', {
      module: 'redis-lock',
      key,
      error,
    });
  }
}

async function cleanup() {
  await releaseStartupLock();
  if (!client.isOpen) return;
  await client.quit();
}

export default {
  acquireLock,
  acquireStartupLock,
  releaseStartupLock,
  cleanup,
};
