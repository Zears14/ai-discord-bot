/**
 * @fileoverview Gay meter command
 * @module commands/gaymeter
 */

import BaseCommand from './BaseCommand.js';
import { EmbedBuilder } from 'discord.js';
import CONFIG from '../config/config.js';

function getBlueToRedGradient(percentage) {
  const red = Math.round((percentage / 100) * 255);
  const blue = Math.round((1 - percentage / 100) * 255);
  const green = 0;

  return (red << 16) | (green << 8) | blue;
}

class PedoMeterCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'pedometer',
      description: 'Check how pedo someone is',
      category: 'Fun',
      usage: 'pedometer [@user]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['pd', 'howpedo']
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
      .setColor(getBlueToRedGradient(percentage))
      .setTitle('🚨 Pedo Meter 🚨')
      .setDescription(`${target.username} is **${percentage}%** pedo!\n\n${progressBar} ${percentage}%`)
      .setThumbnail(target.displayAvatarURL())
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    if (percentage >= 80) {
      await message.reply("Bro is the next: https://cdn.discordapp.com/attachments/1360498657526288606/1371722555542605824/61c0d0d3-a54f-4d30-8ee4-c5f68ed6dbb4-JosephArthurBowlesMorrison.png");
    }
  }
}

export default PedoMeterCommand; 