/**
 * @fileoverview Reward scaling utilities for risk/reward economy commands.
 * @module utils/adventureRewardScaling
 */

import { toBigInt, toNumberClamped } from './moneyUtils.js';

function toPositiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeScalingConfig(raw = {}) {
  return {
    BALANCE_PIVOT: toPositiveInteger(raw.BALANCE_PIVOT, 10000),
    BALANCE_CURVE_POWER: Math.max(0.1, Number(raw.BALANCE_CURVE_POWER ?? 1)),
    BALANCE_MIN_MULT_BPS: toNonNegativeInteger(raw.BALANCE_MIN_MULT_BPS, 6000),
    BALANCE_MAX_MULT_BPS: toNonNegativeInteger(raw.BALANCE_MAX_MULT_BPS, 20000),
    LEVEL_BONUS_BPS_PER_LEVEL: toNonNegativeInteger(raw.LEVEL_BONUS_BPS_PER_LEVEL, 100),
    LEVEL_BONUS_MAX_BPS: toNonNegativeInteger(raw.LEVEL_BONUS_MAX_BPS, 8000),
    GLOBAL_MAX_MULT_BPS: toPositiveInteger(raw.GLOBAL_MAX_MULT_BPS, 30000),
    REWARD_CAP_BASE: toNonNegativeInteger(raw.REWARD_CAP_BASE, 0),
    REWARD_BALANCE_CAP_BPS: toNonNegativeInteger(raw.REWARD_BALANCE_CAP_BPS, 0),
  };
}

function getScaleBps(totalBalance, level, scalingConfig = {}) {
  const cfg = normalizeScalingConfig(scalingConfig);
  const clampedBalance = Math.max(0, toNumberClamped(totalBalance, 1_000_000_000_000));
  const balanceRatio = clampedBalance / (clampedBalance + cfg.BALANCE_PIVOT);
  const curvedRatio = Math.pow(balanceRatio, cfg.BALANCE_CURVE_POWER);

  const minBps = cfg.BALANCE_MIN_MULT_BPS;
  const maxBps = Math.max(minBps, cfg.BALANCE_MAX_MULT_BPS);
  const balanceBps = minBps + Math.floor((maxBps - minBps) * curvedRatio);

  const parsedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const levelBonusBps = Math.min(
    cfg.LEVEL_BONUS_MAX_BPS,
    (parsedLevel - 1) * cfg.LEVEL_BONUS_BPS_PER_LEVEL
  );
  const levelBps = 10000 + levelBonusBps;

  const combinedBps = Math.floor((balanceBps * levelBps) / 10000);
  return Math.min(cfg.GLOBAL_MAX_MULT_BPS, combinedBps);
}

function applyRewardCap(scaledReward, totalBalance, scalingConfig = {}) {
  const cfg = normalizeScalingConfig(scalingConfig);
  const capBase = BigInt(cfg.REWARD_CAP_BASE);
  const capBps = BigInt(cfg.REWARD_BALANCE_CAP_BPS);
  const parsedTotalBalance = toBigInt(totalBalance, 'Total balance');
  const nonNegativeBalance = parsedTotalBalance > 0n ? parsedTotalBalance : 0n;
  const capByBalance = (nonNegativeBalance * capBps) / 10000n;
  const cap = capByBalance + capBase;

  if (cap <= 0n) {
    return { cappedReward: scaledReward, cap };
  }

  return {
    cappedReward: scaledReward > cap ? cap : scaledReward,
    cap,
  };
}

function computeScaledAdventureReward(baseReward, totalBalance, level, scalingConfig = {}) {
  const parsedBaseReward = toBigInt(baseReward, 'Base reward');
  if (parsedBaseReward <= 0n) {
    return {
      reward: 0n,
      baseReward: parsedBaseReward,
      scaleBps: 0,
      cap: 0n,
    };
  }

  const scaleBps = getScaleBps(totalBalance, level, scalingConfig);
  let scaledReward = (parsedBaseReward * BigInt(scaleBps)) / 10000n;
  if (scaledReward < 1n) {
    scaledReward = 1n;
  }

  const { cappedReward, cap } = applyRewardCap(scaledReward, totalBalance, scalingConfig);

  return {
    reward: cappedReward,
    baseReward: parsedBaseReward,
    scaleBps,
    cap,
  };
}

function formatMultiplierFromBps(bps) {
  const parsedBps = toNonNegativeInteger(bps, 0);
  return `${(parsedBps / 10000).toFixed(2)}x`;
}

export { computeScaledAdventureReward, formatMultiplierFromBps };
