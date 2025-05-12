/**
 * @fileoverview Gay meter command
 * @module commands/gaymeter
 */

const BaseCommand = require('./BaseCommand');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

function getWhiteToBrownToBlackGradient(percentage) {
  let r, g, b;

  if (percentage <= 50) {
      // Interpolate from white (255,255,255) to brown (165,42,42)
      const t = percentage / 50;
      r = Math.round(255 + t * (165 - 255));
      g = Math.round(255 + t * (42 - 255));
      b = Math.round(255 + t * (42 - 255));
  } else {
      // Interpolate from brown (165,42,42) to black (0,0,0)
      const t = (percentage - 50) / 50;
      r = Math.round(165 + t * (0 - 165));
      g = Math.round(42 + t * (0 - 42));
      b = Math.round(42 + t * (0 - 42));
  }

  return (r << 16) | (g << 8) | b;
}


class NiggerMeterCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'niggermeter',
      description: 'Check how nigger someone is',
      category: 'Fun',
      usage: 'niggermeter [@user]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['nigga', 'hownigger']
    });
  }

  async execute(message, args) {
    // Get target user (mentioned user or message author)
    const target = message.mentions.users.first() || message.author;
    
    // Generate random percentage
    const percentage = Math.floor(Math.random() * 101);
    
    // Create progress bar
    const progressBarLength = 10;
    const filledBlocks = Math.round((percentage / 100) * progressBarLength);
    const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(progressBarLength - filledBlocks);
    
    // Create embed
    const embed = new EmbedBuilder()
      .setColor(getWhiteToBrownToBlackGradient(percentage))
      .setTitle('✋🏿 Nigger Meter ✋🏿')
      .setDescription(`${target.username} is **${percentage}%** nigger!\n\n${progressBar} ${percentage}%`)
      .setThumbnail(target.displayAvatarURL())
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

module.exports = NiggerMeterCommand; 