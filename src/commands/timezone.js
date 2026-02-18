/**
 * @fileoverview Timezone lookup command
 * @module commands/timezone
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';

function pad2(value) {
  return value.toString().padStart(2, '0');
}

function formatUtcOffsetLabel(totalMinutes) {
  const sign = totalMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return `UTC${sign}${pad2(hours)}:${pad2(minutes)}`;
}

function parseOffsetMinutes(input) {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  const normalized =
    cleaned.startsWith('UTC') || cleaned.startsWith('GMT') ? cleaned.slice(3) : cleaned;

  if (!normalized || normalized === 'Z') {
    return 0;
  }

  const match = normalized.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);

  if (hours > 14 || minutes > 59) {
    return null;
  }

  return sign * (hours * 60 + minutes);
}

function formatTimeAtOffset(offsetMinutes) {
  const offsetDate = new Date(Date.now() + offsetMinutes * 60 * 1000);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).format(offsetDate);
}

function formatTimeAtIanaZone(zone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
    timeZoneName: 'short',
  }).format(new Date());
}

class TimezoneCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'timezone',
      description: 'Show current time for UTC/GMT offsets or IANA regions (Asia/Tokyo)',
      category: 'Utility',
      usage: 'timezone <UTC+7 | GMT-5 | Asia/Jakarta>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['tz', 'time'],
    });
  }

  async execute(message, args) {
    if (!args.length) {
      return message.reply(
        'Usage: `timezone <zone>`\nExamples: `timezone UTC+7`, `timezone GMT-5`, `timezone Asia/Jakarta`'
      );
    }

    const input = args.join(' ').trim();
    const offsetMinutes = parseOffsetMinutes(input);

    if (offsetMinutes !== null) {
      const label = formatUtcOffsetLabel(offsetMinutes);
      const formattedTime = formatTimeAtOffset(offsetMinutes);
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🕒 Timezone Lookup')
        .addFields(
          { name: 'Input', value: input, inline: true },
          { name: 'Normalized', value: label, inline: true },
          { name: 'Current Time', value: formattedTime, inline: false }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    try {
      const formattedTime = formatTimeAtIanaZone(input);
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🕒 Timezone Lookup')
        .addFields(
          { name: 'Zone', value: input, inline: true },
          { name: 'Current Time', value: formattedTime, inline: false }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    } catch {
      return message.reply(
        'Invalid timezone. Use UTC/GMT offsets (`UTC+7`, `GMT-5`) or an IANA zone like `Asia/Jakarta`.'
      );
    }
  }
}

export default TimezoneCommand;
