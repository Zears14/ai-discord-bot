/**
 * @fileoverview Weather lookup command
 * @module commands/weather
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import logger from '../services/loggerService.js';

function safeField(value, fallback = 'N/A') {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value);
}

class WeatherCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'weather',
      description: 'Look up current weather for a location',
      category: 'Utility',
      usage: 'weather <location>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['wthr', 'wt', 'temp'],
    });
  }

  async execute(message, args) {
    const location = args.join(' ').trim();
    if (!location) {
      return message.reply('Usage: `weather <location>` (for example: `weather Tokyo`).');
    }

    try {
      const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ai-discord-bot-weather/1.0',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Weather API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const current = data?.current_condition?.[0];
      const area = data?.nearest_area?.[0];

      if (!current || !area) {
        return message.reply('Weather data is unavailable for that location.');
      }

      const resolvedLocation = [
        area?.areaName?.[0]?.value,
        area?.region?.[0]?.value,
        area?.country?.[0]?.value,
      ]
        .filter(Boolean)
        .join(', ');

      const weatherDescription = current?.weatherDesc?.[0]?.value || 'Unknown';

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`🌤️ Weather: ${resolvedLocation || location}`)
        .setDescription(`**Condition:** ${weatherDescription}`)
        .addFields(
          { name: 'Temperature', value: `${safeField(current.temp_C)}°C`, inline: true },
          { name: 'Feels Like', value: `${safeField(current.FeelsLikeC)}°C`, inline: true },
          { name: 'Humidity', value: `${safeField(current.humidity)}%`, inline: true },
          { name: 'Wind', value: `${safeField(current.windspeedKmph)} km/h`, inline: true },
          { name: 'Precipitation', value: `${safeField(current.precipMM)} mm`, inline: true },
          { name: 'Cloud Cover', value: `${safeField(current.cloudcover)}%`, inline: true }
        )
        .setFooter({ text: 'Source: wttr.in' })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Weather command error:', error);
      return message.reply('Failed to fetch weather data right now. Please try again later.');
    }
  }
}

export default WeatherCommand;
