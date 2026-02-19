/**
 * @fileoverview Leveling service based on successful command activity.
 * @module services/levelService
 */

import jsonbService from './jsonbService.js';
import logger from './loggerService.js';
import CONFIG from '../config/config.js';
import { toBigInt } from '../utils/moneyUtils.js';

const levelCfg = CONFIG.ECONOMY.LEVELING;
const BPS_DENOMINATOR = 10000n;

function getBaseXpToLevel() {
  return toBigInt(levelCfg.BASE_XP_TO_LEVEL ?? 100, 'Base XP to level');
}

function getGrowthBps() {
  const raw = Number(levelCfg.XP_GROWTH_BPS ?? 11500);
  if (!Number.isFinite(raw)) return 11500;
  return Math.max(10001, Math.floor(raw));
}

function scaleXpRequirement(currentRequirement) {
  const growthBps = BigInt(getGrowthBps());
  const scaled = (currentRequirement * growthBps) / BPS_DENOMINATOR;
  return scaled > currentRequirement ? scaled : currentRequirement + 1n;
}

function xpRequiredForLevel(level) {
  let requirement = getBaseXpToLevel();
  for (let i = 1; i < Math.max(1, level); i++) {
    requirement = scaleXpRequirement(requirement);
  }
  return requirement;
}

function calculateProgression(totalXpRaw) {
  let totalXp = toBigInt(totalXpRaw, 'Total XP');
  if (totalXp < 0n) totalXp = 0n;

  let level = 1;
  let remaining = totalXp;
  let xpToNext = xpRequiredForLevel(level);

  while (remaining >= xpToNext) {
    remaining -= xpToNext;
    level++;
    xpToNext = scaleXpRequirement(xpToNext);
  }

  return {
    level,
    totalXp,
    currentXp: remaining,
    xpToNext,
  };
}

function parseStoredTotalXp(rawLevelData) {
  if (!rawLevelData || typeof rawLevelData !== 'object' || Array.isArray(rawLevelData)) {
    return 0n;
  }

  if (rawLevelData.totalXp === undefined || rawLevelData.totalXp === null) {
    return 0n;
  }

  try {
    return toBigInt(rawLevelData.totalXp, 'Stored total XP');
  } catch {
    return 0n;
  }
}

async function getLevelData(userId, guildId) {
  const rawLevelData = await jsonbService.getKey(userId, guildId, levelCfg.STATE_KEY);
  const totalXp = parseStoredTotalXp(rawLevelData);
  return calculateProgression(totalXp);
}

async function awardCommandXp(userId, guildId, commandName = 'unknown') {
  const now = Date.now();
  const cooldownMs = levelCfg.XP_COOLDOWN_SECONDS * 1000;
  let lock = await jsonbService.acquireTimedKey(
    userId,
    guildId,
    levelCfg.XP_COOLDOWN_KEY,
    now + cooldownMs,
    now
  );

  // If the user row does not exist yet, initialize level data once and retry lock acquisition.
  if (!lock.acquired && toBigInt(lock.value ?? 0n, 'XP lock value') === 0n) {
    await jsonbService.setKey(userId, guildId, levelCfg.STATE_KEY, {
      totalXp: '0',
      level: 1,
      updatedAt: new Date().toISOString(),
    });

    lock = await jsonbService.acquireTimedKey(
      userId,
      guildId,
      levelCfg.XP_COOLDOWN_KEY,
      now + cooldownMs,
      now
    );
  }

  if (!lock.acquired) {
    return { awarded: false, reason: 'cooldown' };
  }

  const before = await getLevelData(userId, guildId);
  const xpGainRange = levelCfg.XP_PER_COMMAND_MAX - levelCfg.XP_PER_COMMAND_MIN + 1;
  const xpGain = BigInt(Math.floor(Math.random() * xpGainRange) + levelCfg.XP_PER_COMMAND_MIN);
  const after = calculateProgression(before.totalXp + xpGain);

  await jsonbService.setKey(userId, guildId, levelCfg.STATE_KEY, {
    totalXp: after.totalXp.toString(),
    level: after.level,
    updatedAt: new Date().toISOString(),
  });

  if (after.level > before.level) {
    logger.discord.event('User leveled up from command activity', {
      userId,
      guildId,
      commandName,
      fromLevel: before.level,
      toLevel: after.level,
      xpGain: xpGain.toString(),
    });
  }

  return {
    awarded: true,
    xpGain,
    leveledUp: after.level > before.level,
    ...after,
  };
}

export default {
  getLevelData,
  awardCommandXp,
};
