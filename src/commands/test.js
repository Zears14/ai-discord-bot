import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import inventoryService from '../services/inventoryService.js';
import itemsService from '../services/itemsService.js';
import { formatMoney, parsePositiveAmount, toBigInt } from '../utils/moneyUtils.js';

class TestCommand extends BaseCommand {
  constructor(client) {
    // Only register the command if in development mode
    if (process.env.IS_DEVEL !== 'true') {
      return null;
    }

    super(client, {
      name: 'test',
      description: 'Test economy commands (Admin only)',
      category: 'Admin',
      usage: 'test <command> [@user] [args]',
      cooldown: 0,
      aliases: ['t'],
    });
  }

  async execute(message, args) {
    // Check if user is authorized
    if (message.author.id !== CONFIG.ADMIN.ID) {
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Unauthorized')
        .setDescription('This command is only available to the bot administrator.');

      return message.reply({ embeds: [errorEmbed] });
    }

    if (!args.length) {
      const helpEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🛠️ Test Commands')
        .setDescription('Available test commands:')
        .addFields(
          { name: 'balance', value: '`test balance [@user]` - Check balance', inline: true },
          { name: 'grow', value: '`test grow [@user]` - Test grow command', inline: true },
          {
            name: 'setbalance',
            value: '`test setbalance @user <amount>` - Set user balance',
            inline: true,
          },
          {
            name: 'resetgrowcooldown',
            value:
              '`test resetgrowcooldown [@user]` - Reset grow cooldown (`resetcooldown`/`resetgrow` also work)',
            inline: true,
          }
        )
        .setFooter({ text: 'Admin commands' })
        .setTimestamp();

      return message.reply({ embeds: [helpEmbed] });
    }

    const command = args[0].toLowerCase();
    const guildId = message.guild.id;

    try {
      switch (command) {
        case 'balance': {
          const targetUser = message.mentions.users.first() || message.author;
          const balance = await economy.getBalance(targetUser.id, guildId);

          const balanceEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.DEFAULT)
            .setTitle('💰 Test Balance Check')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: 'User', value: targetUser.username, inline: true },
              { name: 'Length', value: `${formatMoney(balance)} cm`, inline: true }
            )
            .setFooter({ text: 'Test command result' })
            .setTimestamp();

          await message.reply({ embeds: [balanceEmbed] });
          break;
        }

        case 'grow': {
          const targetUser = message.mentions.users.first() || message.author;
          const growth = BigInt(Math.floor(Math.random() * 5) + 1);
          await economy.updateBalance(targetUser.id, guildId, growth);
          const newBalance = await economy.getBalance(targetUser.id, guildId);

          const growEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('📈 Test Growth')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: 'User', value: targetUser.username, inline: true },
              { name: 'Growth', value: `+${formatMoney(growth)} cm`, inline: true },
              { name: 'New Length', value: `${formatMoney(newBalance)} cm`, inline: true }
            )
            .setFooter({ text: 'Test command result' })
            .setTimestamp();

          await message.reply({ embeds: [growEmbed] });
          break;
        }

        case 'setbalance': {
          if (args.length < 3) {
            const errorEmbed = new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle('❌ Invalid Usage')
              .setDescription('Please provide a user and amount.')
              .addFields(
                { name: 'Usage', value: '`test setbalance @user <amount>`' },
                { name: 'Example', value: '`test setbalance @user 100`' }
              );

            return message.reply({ embeds: [errorEmbed] });
          }

          const targetUser = message.mentions.users.first();
          if (!targetUser) {
            const errorEmbed = new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle('❌ Invalid User')
              .setDescription('Please mention a valid user.');

            return message.reply({ embeds: [errorEmbed] });
          }

          let amount;
          try {
            amount = toBigInt(args[2], 'Amount');
          } catch {
            const errorEmbed = new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle('❌ Invalid Amount')
              .setDescription('Please provide a valid amount.');

            return message.reply({ embeds: [errorEmbed] });
          }
          if (amount < 0n) {
            const errorEmbed = new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle('❌ Invalid Amount')
              .setDescription('Please provide a non-negative amount.');
            return message.reply({ embeds: [errorEmbed] });
          }

          const oldBalance = await economy.getBalance(targetUser.id, guildId);
          await economy.setBalance(targetUser.id, guildId, amount);

          const setBalanceEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('💰 Balance Updated')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: 'User', value: targetUser.username, inline: true },
              { name: 'Old Length', value: `${formatMoney(oldBalance)} cm`, inline: true },
              { name: 'New Length', value: `${formatMoney(amount)} cm`, inline: true }
            )
            .setFooter({ text: 'Test command result' })
            .setTimestamp();

          await message.reply({ embeds: [setBalanceEmbed] });
          break;
        }

        case 'resetcooldown':
        case 'resetgrow':
        case 'resetgrowcooldown': {
          const targetUser = message.mentions.users.first() || message.author;

          await economy.updateLastGrow(targetUser.id, guildId, new Date(0));

          const resetEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('⏰ Cooldown Reset')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: 'User', value: targetUser.username, inline: true },
              { name: 'Status', value: 'Cooldown has been reset', inline: true }
            )
            .setFooter({ text: 'Test command result' })
            .setTimestamp();

          await message.reply({ embeds: [resetEmbed] });
          break;
        }

        case 'giveitem': {
          if (args.length < 3) {
            return message.reply('Usage: `test giveitem @user <item_name> [quantity]`');
          }
          const targetUser = message.mentions.users.first();
          if (!targetUser) {
            return message.reply('Please mention a user.');
          }
          const itemName = args[2];
          let quantity = 1n;
          if (args[3] !== undefined) {
            try {
              quantity = parsePositiveAmount(args[3], 'Quantity');
            } catch {
              return message.reply('Please provide a valid quantity.');
            }
          }
          const item = await itemsService.getItemByName(itemName);
          if (!item) {
            return message.reply(`Item "${itemName}" not found.`);
          }
          await inventoryService.addItemToInventory(targetUser.id, guildId, item.id, quantity);
          await message.reply(
            `Gave ${formatMoney(quantity)} ${item.name} to ${targetUser.username}.`
          );
          break;
        }

        case 'listitems': {
          const allItems = await itemsService.getAllItems();
          if (!allItems.length) {
            return message.reply('No items found.');
          }
          const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.DEFAULT)
            .setTitle('Available Items')
            .setDescription(allItems.map((item) => `**${item.name}** - ${item.title}`).join('\n'));
          await message.reply({ embeds: [embed] });
          break;
        }

        default: {
          const errorEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.ERROR)
            .setTitle('❌ Invalid Command')
            .setDescription('Unknown test command. Use `test` to see available commands.');

          await message.reply({ embeds: [errorEmbed] });
        }
      }
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Error')
        .setDescription(`An error occurred: ${error.message}`);

      await message.reply({ embeds: [errorEmbed] });
    }
  }
}

export default process.env.IS_DEVEL === 'true' ? TestCommand : null;
