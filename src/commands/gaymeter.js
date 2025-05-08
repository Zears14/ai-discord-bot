/**
 * @fileoverview Gay meter command
 * @module commands/gaymeter
 */

const BaseCommand = require('./BaseCommand');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class GayMeterCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'gaymeter',
      description: 'Check how gay someone is',
      category: 'Fun',
      usage: 'gaymeter [@user]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['gay', 'howgay']
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
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🏳️‍🌈 Gay Meter 🏳️‍🌈')
      .setDescription(`${target.username} is **${percentage}%** gay!\n\n${progressBar} ${percentage}%`)
      .setThumbnail(target.displayAvatarURL())
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

module.exports = GayMeterCommand; 