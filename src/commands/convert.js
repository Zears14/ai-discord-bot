/**
 * @fileoverview Currency conversion command
 * @module commands/convert
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import logger from '../services/loggerService.js';

function parseConvertArgs(args) {
  const input = args.join(' ').trim();

  let match = input.match(/^(\d+(?:\.\d+)?)\s+([A-Za-z]{3})\s+(?:to|in)\s+([A-Za-z]{3})$/i);
  if (match) {
    return {
      amount: Number(match[1]),
      from: match[2].toUpperCase(),
      to: match[3].toUpperCase(),
    };
  }

  match = input.match(/^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d+(?:\.\d+)?)$/i);
  if (match) {
    return {
      amount: Number(match[3]),
      from: match[1].toUpperCase(),
      to: match[2].toUpperCase(),
    };
  }

  return null;
}

function formatAmount(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

class ConvertCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'convert',
      description: 'Convert one currency to another',
      category: 'Utility',
      usage: 'convert <amount> <from> to <to>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['fx', 'currency', 'curr'],
    });
  }

  async execute(message, args) {
    if (!args.length) {
      return message.reply(
        'Usage: `convert <amount> <from> to <to>`\nExamples: `convert 100 usd to eur`, `convert usd jpy 50`'
      );
    }

    const parsed = parseConvertArgs(args);
    if (!parsed || !Number.isFinite(parsed.amount) || parsed.amount <= 0) {
      return message.reply(
        'Invalid format. Use `convert <amount> <from> to <to>` (for example: `convert 100 usd to eur`).'
      );
    }

    if (parsed.from === parsed.to) {
      return message.reply('Source and target currency must be different.');
    }

    const apiKey = process.env.UNIRATE_API_KEY;
    if (!apiKey) {
      return message.reply(
        'Currency conversion is not configured. Missing `UNIRATE_API_KEY` in environment variables.'
      );
    }

    try {
      const params = new URLSearchParams({
        api_key: apiKey,
        amount: parsed.amount.toString(),
        from: parsed.from,
        to: parsed.to,
        format: 'json',
      });
      const url = `https://api.unirateapi.com/api/convert?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 401) {
          return message.reply(
            'Currency conversion failed: invalid UniRate API key (`UNIRATE_API_KEY`).'
          );
        }
        if (response.status === 404) {
          return message.reply('Currency not found. Use valid ISO-4217 currency codes.');
        }
        if (response.status === 503) {
          return message.reply('UniRate is currently unavailable. Please try again later.');
        }

        const errorText = await response.text();
        throw new Error(`UniRate API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const converted =
        typeof data?.result === 'number'
          ? data.result
          : typeof data?.results?.[parsed.to] === 'number'
            ? data.results[parsed.to]
            : typeof data?.rates?.[parsed.to] === 'number'
              ? data.rates[parsed.to] * parsed.amount
              : null;

      if (typeof converted !== 'number') {
        throw new Error('Conversion rate not available for the requested pair.');
      }

      const rate =
        typeof data?.rate === 'number'
          ? data.rate
          : parsed.amount === 0
            ? 0
            : converted / parsed.amount;

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('💱 Currency Conversion')
        .setDescription(
          `**${formatAmount(parsed.amount)} ${parsed.from}** = **${formatAmount(converted)} ${parsed.to}**`
        )
        .addFields(
          {
            name: 'Rate',
            value: `1 ${parsed.from} = ${formatAmount(rate)} ${parsed.to}`,
            inline: true,
          },
          {
            name: 'Source',
            value: 'UniRate API',
            inline: true,
          }
        )
        .setFooter({ text: `UniRate • ${parsed.from} → ${parsed.to}` })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Currency convert command error:', error);
      return message.reply(
        'Failed to fetch conversion rates right now. Try again later or verify currency codes (ISO-4217).'
      );
    }
  }
}

export default ConvertCommand;
