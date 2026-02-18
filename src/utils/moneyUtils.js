/**
 * @fileoverview Utilities for BIGINT-safe money parsing/formatting/math
 * @module utils/moneyUtils
 */

const PG_BIGINT_MAX = (1n << 63n) - 1n;
const PG_BIGINT_MIN = -(1n << 63n);

function ensurePgBigIntRange(value, label = 'Value') {
  if (value < PG_BIGINT_MIN || value > PG_BIGINT_MAX) {
    throw new Error(`${label} is out of PostgreSQL BIGINT range`);
  }
}

function toBigInt(value, label = 'Value') {
  let parsed;

  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${label} must be an integer`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} exceeds JavaScript safe integer range`);
    }
    parsed = BigInt(value);
  } else if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`${label} must be an integer`);
    }
    parsed = BigInt(value.trim());
  } else {
    throw new Error(`${label} must be a bigint, integer number, or integer string`);
  }

  ensurePgBigIntRange(parsed, label);
  return parsed;
}

function parsePositiveAmount(raw, label = 'Amount') {
  const parsed = toBigInt(raw, label);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than 0`);
  }
  return parsed;
}

function formatMoney(value) {
  return toBigInt(value, 'Money').toString();
}

function bigintAbs(value) {
  const parsed = toBigInt(value, 'Value');
  return parsed < 0n ? -parsed : parsed;
}

function floorPercentOf(value, percent, scale = 1_000_000) {
  const parsedValue = toBigInt(value, 'Value');
  const scaled = BigInt(Math.max(0, Math.floor(percent * scale)));
  return (parsedValue * scaled) / BigInt(scale);
}

function toNumberClamped(value, max = Number.MAX_SAFE_INTEGER) {
  const parsed = toBigInt(value, 'Value');
  const maxBigInt = BigInt(max);
  const minBigInt = -maxBigInt;
  if (parsed > maxBigInt) return max;
  if (parsed < minBigInt) return -max;
  return Number(parsed);
}

export {
  toBigInt,
  parsePositiveAmount,
  formatMoney,
  bigintAbs,
  floorPercentOf,
  toNumberClamped,
  ensurePgBigIntRange,
};
