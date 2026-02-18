import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import inventoryService from '../services/inventoryService.js';
import itemsService from '../services/itemsService.js';
import { parsePositiveAmount } from '../utils/moneyUtils.js';

class UseCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'use',
      description: 'Use an item from your inventory.',
      category: 'Economy',
      usage: 'use <item_name>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: [],
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const itemName = args[0];
    let quantity = 1n;

    if (!itemName) {
      return message.reply('Please specify an item to use.');
    }

    if (args[1] !== undefined) {
      try {
        quantity = parsePositiveAmount(args[1], 'Quantity');
      } catch {
        return message.reply('Please specify a valid quantity.');
      }
    }

    const item = await itemsService.getItemByName(itemName);

    if (!item) {
      return message.reply(`Item "${itemName}" not found.`);
    }

    const result = await inventoryService.useItem(userId, guildId, item.id, quantity);

    const embed = new EmbedBuilder()
      .setColor(result.success ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
      .setDescription(result.message);

    await message.reply({ embeds: [embed] });
  }
}

export default UseCommand;
