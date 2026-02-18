import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

class SlotsCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'slots',
      description: 'Play the slot machine',
      category: 'Economy',
      usage: 'slots <bet>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: [],
      exclusiveSession: true,
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    let bet;
    try {
      bet = parsePositiveAmount(args[0], 'Bet amount');
    } catch {
      return message.reply('Please provide a valid bet amount.');
    }

    const balance = await economy.getBalance(userId, guildId);
    if (balance < bet) {
      return message.reply('You do not have enough Dih to place that bet.');
    }

    const reels = ['🍒', '🍊', '🍋', '🍇', '🍉', '🍓', '⭐', '💎'];
    const reel1 = reels[Math.floor(Math.random() * reels.length)];
    const reel2 = reels[Math.floor(Math.random() * reels.length)];
    const reel3 = reels[Math.floor(Math.random() * reels.length)];

    // Create initial embed with empty slots
    const initialEmbed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🎰 Slot Machine 🎰')
      .setDescription('```\n[ ❓ | ❓ | ❓ ]\n```')
      .setTimestamp();

    const msg = await message.reply({ embeds: [initialEmbed] });

    // First reel animation
    await new Promise((resolve) => setTimeout(resolve, 700));
    const firstReelEmbed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🎰 Slot Machine 🎰')
      .setDescription(`\`\`\`\n[ ${reel1} | ❓ | ❓ ]\n\`\`\``)
      .setTimestamp();
    await msg.edit({ embeds: [firstReelEmbed] });

    // Second reel animation
    await new Promise((resolve) => setTimeout(resolve, 700));
    const secondReelEmbed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🎰 Slot Machine 🎰')
      .setDescription(`\`\`\`\n[ ${reel1} | ${reel2} | ❓ ]\n\`\`\``)
      .setTimestamp();
    await msg.edit({ embeds: [secondReelEmbed] });

    // Third reel animation with suspense pause
    await new Promise((resolve) => setTimeout(resolve, 900));
    const thirdReelEmbed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🎰 Slot Machine 🎰')
      .setDescription(`\`\`\`\n[ ${reel1} | ${reel2} | ${reel3} ]\n\`\`\``)
      .setTimestamp();
    await msg.edit({ embeds: [thirdReelEmbed] });

    // Calculate winnings
    let winnings = 0n;
    let resultMessage = `You lost ${formatMoney(bet)} cm Dih.`;

    if (reel1 === reel2 && reel2 === reel3) {
      if (reel1 === '💎') {
        winnings = bet * 5n;
      } else if (reel1 === '⭐') {
        winnings = bet * 3n;
      } else {
        winnings = bet * 2n;
      }
    } else if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
      winnings = (bet * 3n) / 2n;
    }

    const balanceDelta = winnings - bet;

    await economy.updateBalance(userId, guildId, balanceDelta, 'slots');
    const newBalance = await economy.getBalance(userId, guildId);

    if (winnings > 0n) {
      resultMessage = `You won ${formatMoney(winnings)} cm Dih!`;
    }

    // Brief pause before showing result
    await new Promise((resolve) => setTimeout(resolve, 500));

    const finalEmbed = new EmbedBuilder()
      .setColor(winnings > 0n ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
      .setTitle('🎰 Slot Machine 🎰')
      .setDescription(`\`\`\`\n[ ${reel1} | ${reel2} | ${reel3} ]\n\`\`\``)
      .addFields(
        { name: 'Result', value: resultMessage, inline: true },
        { name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true }
      )
      .setTimestamp();

    await msg.edit({ embeds: [finalEmbed] });
  }
}

export default SlotsCommand;
