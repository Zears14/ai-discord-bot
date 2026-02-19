/**
 * @fileoverview Shop command for listing and purchasing items.
 * @module commands/shop
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import inventoryService from '../services/inventoryService.js';
import itemsService from '../services/itemsService.js';
import logger from '../services/loggerService.js';
import { ensurePgBigIntRange, formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

const ITEMS_PER_PAGE = 8;

function normalizeItemToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getShopItems(items) {
  return items
    .filter((item) => item.price !== null && item.price !== undefined)
    .sort((a, b) => (a.price > b.price ? 1 : a.price < b.price ? -1 : 0));
}

function findShopItem(items, query) {
  const normalizedQuery = normalizeItemToken(query);
  return (
    items.find((item) => normalizeItemToken(item.name) === normalizedQuery) ||
    items.find((item) => normalizeItemToken(item.title || item.name) === normalizedQuery)
  );
}

class ShopCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'shop',
      description: 'Browse and buy items',
      category: 'Economy',
      usage: 'shop [page] | shop buy <item_name> [quantity]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['store'],
    });
  }

  async execute(message, args) {
    if (args.length === 0) {
      return this.showShop(message, 1);
    }

    const subcommand = args[0].toLowerCase();
    if (subcommand === 'buy') {
      return this.buyItem(message, args.slice(1));
    }

    const page = Number.parseInt(args[0], 10);
    if (Number.isInteger(page) && page > 0) {
      return this.showShop(message, page);
    }

    return message.reply(
      'Usage: `shop [page]` or `shop buy <item_name> [quantity]`\nExample: `shop buy dih_coin 2`'
    );
  }

  async showShop(message, page) {
    const allItems = await itemsService.getAllItems();
    const shopItems = getShopItems(allItems);

    if (!shopItems.length) {
      return message.reply('The shop is currently empty.');
    }

    const maxPages = Math.ceil(shopItems.length / ITEMS_PER_PAGE);
    if (page > maxPages) {
      return message.reply(`Invalid page. There are only ${maxPages} pages.`);
    }

    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const pageItems = shopItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const description = pageItems
      .map((item) => {
        const details = item.data?.description ? `\n*${item.data.description}*` : '';
        return `**${item.title || item.name}** (\`${item.name}\`)\nPrice: ${formatMoney(item.price)} cm${details}`;
      })
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle(`🛒 Shop - Page ${page}/${maxPages}`)
      .setDescription(description)
      .setFooter({ text: 'Use `shop buy <item_name> [quantity]` to purchase an item.' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  async buyItem(message, args) {
    if (args.length < 1 || args.length > 2) {
      return message.reply('Usage: `shop buy <item_name> [quantity]`');
    }

    const userId = message.author.id;
    const guildId = message.guild.id;
    const itemQuery = args[0];
    let quantity = 1n;

    if (args[1] !== undefined) {
      try {
        quantity = parsePositiveAmount(args[1], 'Quantity');
      } catch {
        return message.reply('Please provide a valid quantity.');
      }
    }

    const allItems = await itemsService.getAllItems();
    const shopItems = getShopItems(allItems);
    const item = findShopItem(shopItems, itemQuery);

    if (!item) {
      return message.reply(`Item "${itemQuery}" was not found in the shop.`);
    }

    const totalCost = item.price * quantity;
    ensurePgBigIntRange(totalCost, 'Total purchase cost');

    const balance = await economy.getBalance(userId, guildId);
    if (balance < totalCost) {
      return message.reply(
        `You don't have enough Dih.\nCost: ${formatMoney(totalCost)} cm | Your balance: ${formatMoney(balance)} cm`
      );
    }

    await economy.updateBalance(userId, guildId, -totalCost, 'shop-purchase');

    try {
      await inventoryService.addItemToInventory(userId, guildId, item.id, quantity);
    } catch (error) {
      logger.discord.cmdError('Shop purchase failed while adding to inventory. Refunding user.', {
        error: error.message,
        userId,
        guildId,
        itemName: item.name,
        quantity: quantity.toString(),
      });
      await economy.updateBalance(userId, guildId, totalCost, 'shop-purchase-refund');
      throw error;
    }

    const newBalance = await economy.getBalance(userId, guildId);
    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.SUCCESS)
      .setTitle('✅ Purchase Successful')
      .setDescription(`You bought **${item.title || item.name}** x${formatMoney(quantity)}.`)
      .addFields(
        { name: 'Cost', value: `${formatMoney(totalCost)} cm`, inline: true },
        { name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true }
      )
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
}

export default ShopCommand;
