const BaseCommand = require('./BaseCommand');
const inventoryService = require('../services/inventoryService');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class InventoryCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'inventory',
            description: 'Displays your inventory.',
            category: 'Economy',
            usage: 'inventory',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
            aliases: ['inv'],
        });
    }

    async execute(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;

        const inventory = await inventoryService.getInventory(userId, guildId);

        if (!inventory.length) {
            return message.reply('Your inventory is empty.');
        }

        const itemsPerPage = 10;
        const page = parseInt(args[0]) || 1;
        const maxPages = Math.ceil(inventory.length / itemsPerPage);

        if (page > maxPages) {
            return message.reply(`Invalid page. There are only ${maxPages} pages.`);
        }

        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = page * itemsPerPage;
        const inventoryPage = inventory.slice(startIndex, endIndex);

        const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.DEFAULT)
            .setTitle(`${message.author.username}'s Inventory - Page ${page}/${maxPages}`)
            .setDescription(inventoryPage.map(item => `**${item.title}** (x${item.quantity}) - ${item.price} Dih\n*${item.data.description}*`).join('\n\n'));

        await message.reply({ embeds: [embed] });
    }
}

module.exports = InventoryCommand;
