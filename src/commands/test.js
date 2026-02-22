import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import inventoryService from '../services/inventoryService.js';
import itemsService from '../services/itemsService.js';
import jsonbService from '../services/jsonbService.js';
import { formatMoney, parsePositiveAmount, toBigInt } from '../utils/moneyUtils.js';

const RUNSERIES_SEPARATOR_REGEX = /\s*;;\s*/;
const MAX_SERIES_COMMANDS = 20;

function parseRunSeriesCommands(rawInput) {
  return rawInput
    .split(RUNSERIES_SEPARATOR_REGEX)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function tokenizeSeriesCommand(commandText) {
  const tokens = [];
  const regex = /"[^"]*"|'[^']*'|\S+/g;
  const matches = commandText.match(regex) || [];

  for (const match of matches) {
    const startsWithQuote = match.startsWith('"') || match.startsWith("'");
    const endsWithQuote = match.endsWith('"') || match.endsWith("'");
    if (startsWithQuote && endsWithQuote && match.length >= 2) {
      tokens.push(match.slice(1, -1));
    } else {
      tokens.push(match);
    }
  }

  return tokens;
}

class TestCommand extends BaseCommand {
  constructor(client) {
    // Only register the command if in development mode
    if (process.env.IS_DEVEL !== 'true' || process.env.NODE_ENV === 'production') {
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
          },
          {
            name: 'resetallcooldowns',
            value:
              '`test resetallcooldowns [@user]` - Reset all command cooldowns for this guild/user',
            inline: true,
          },
          {
            name: 'loanstatus',
            value: '`test loanstatus [@user]` - View loan/debt status',
            inline: true,
          },
          {
            name: 'takeloan',
            value: '`test takeloan @user <option_id|amount>` - Take a loan option',
            inline: true,
          },
          {
            name: 'payloan',
            value: '`test payloan [@user] <amount|all>` - Pay loan from wallet+bank',
            inline: true,
          },
          {
            name: 'clearloan',
            value: '`test clearloan [@user]` - Clear active/delinquent loan (dev)',
            inline: true,
          },
          {
            name: 'defaultloan',
            value: '`test defaultloan [@user]` - Force immediate loan default',
            inline: true,
          },
          {
            name: 'runseries',
            value:
              '`test runseries <cmd1> ;; <cmd2> ;; ...` - Run multiple test commands concurrently',
            inline: false,
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
          await jsonbService.setKey(targetUser.id, guildId, 'growCooldownUntil', 0);

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

        case 'resetallcooldowns':
        case 'resetallcd':
        case 'resetcommandcooldowns': {
          const targetUser = message.mentions.users.first() || message.author;
          const commandHandler = this.client?.commandHandler;
          if (!commandHandler || typeof commandHandler.clearCooldown !== 'function') {
            return message.reply('Command handler is unavailable. Cannot clear command cooldowns.');
          }

          const uniqueCommands = [
            ...new Map(
              Array.from(commandHandler.commands.values()).map((loadedCommand) => [
                loadedCommand.name,
                loadedCommand,
              ])
            ).values(),
          ];

          await Promise.all(
            uniqueCommands.map((loadedCommand) =>
              commandHandler.clearCooldown(targetUser.id, guildId, loadedCommand)
            )
          );

          const resetEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('⏰ All Command Cooldowns Reset')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: 'User', value: targetUser.username, inline: true },
              {
                name: 'Commands Cleared',
                value: `${uniqueCommands.length}`,
                inline: true,
              },
              {
                name: 'Scope',
                value: 'Redis + in-memory command cooldowns',
                inline: true,
              }
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

        case 'loanstatus': {
          const targetUser = message.mentions.users.first() || message.author;
          const [loanState, options] = await Promise.all([
            economy.getLoanState(targetUser.id, guildId),
            economy.getLoanOptions(),
          ]);

          const optionsText = options
            .map(
              (option) =>
                `\`${option.id}\` => ${formatMoney(option.amount)} cm / ${option.durationDays}d / ${(Number(option.interestBps) / 100).toFixed(2)}%`
            )
            .join('\n');

          const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.DEFAULT)
            .setTitle('🧪 Loan Status (Test)')
            .setDescription(`Target: **${targetUser.username}**`)
            .addFields(
              {
                name: 'Loan',
                value: loanState.hasLoan
                  ? [
                      `Status: ${loanState.loan.status}`,
                      `Debt: ${formatMoney(loanState.loan.debt)} cm`,
                      `Principal: ${formatMoney(loanState.loan.principal)} cm`,
                      `Due: ${loanState.loan.dueAt ? `<t:${Math.floor(loanState.loan.dueAt / 1000)}:F>` : 'N/A'}`,
                      `Option: ${loanState.loan.optionId || 'N/A'}`,
                    ].join('\n')
                  : 'None',
                inline: false,
              },
              {
                name: 'Funds',
                value: [
                  `Wallet: ${formatMoney(loanState.walletBalance)} cm`,
                  `Bank: ${formatMoney(loanState.bankBalance)} cm`,
                  `Total: ${formatMoney(loanState.totalBalance)} cm`,
                ].join('\n'),
                inline: true,
              },
              {
                name: 'Options',
                value: optionsText || 'No loan options configured.',
                inline: false,
              }
            )
            .setTimestamp();

          await message.reply({ embeds: [embed] });
          break;
        }

        case 'takeloan': {
          if (args.length < 3) {
            return message.reply('Usage: `test takeloan @user <option_id|amount>`');
          }

          const targetUser = message.mentions.users.first();
          if (!targetUser) {
            return message.reply('Please mention a valid user.');
          }

          const optionToken = args[2].toLowerCase();
          const options = await economy.getLoanOptions();
          let selectedOption = options.find((option) => option.id === optionToken);
          if (!selectedOption && /^\d+$/.test(optionToken)) {
            const targetAmount = BigInt(optionToken);
            selectedOption = options.find((option) => option.amount === targetAmount);
          }

          if (!selectedOption) {
            return message.reply(
              `Unknown loan option "${optionToken}". Use \`test loanstatus\` to list options.`
            );
          }

          const result = await economy.takeLoan(targetUser.id, guildId, selectedOption.id);
          const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('🧪 Loan Issued (Test)')
            .setDescription(
              `Issued **${formatMoney(selectedOption.amount)} cm** to **${targetUser.username}** via option \`${selectedOption.id}\`.`
            )
            .addFields(
              { name: 'Debt', value: `${formatMoney(result.loan.debt)} cm`, inline: true },
              {
                name: 'Due',
                value: result.loan.dueAt ? `<t:${Math.floor(result.loan.dueAt / 1000)}:R>` : 'N/A',
                inline: true,
              }
            )
            .setTimestamp();

          await message.reply({ embeds: [embed] });
          break;
        }

        case 'payloan': {
          if (args.length < 2) {
            return message.reply('Usage: `test payloan [@user] <amount|all>`');
          }

          const mentioned = message.mentions.users.first();
          const targetUser = mentioned || message.author;
          const amountArg = mentioned ? args[2] : args[1];
          if (!amountArg) {
            return message.reply('Usage: `test payloan [@user] <amount|all>`');
          }

          const token = amountArg.toLowerCase();
          const amount = token === 'all' || token === 'max' ? null : parsePositiveAmount(amountArg);
          const payment = await economy.payLoan(targetUser.id, guildId, amount);

          const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('🧪 Loan Payment (Test)')
            .setDescription(
              `Paid **${formatMoney(payment.paid)} cm** for **${targetUser.username}**.`
            )
            .addFields(
              {
                name: 'Debt Remaining',
                value: payment.hasLoan ? `${formatMoney(payment.loan.debt)} cm` : 'Paid off ✅',
                inline: true,
              },
              { name: 'Wallet', value: `${formatMoney(payment.walletBalance)} cm`, inline: true },
              { name: 'Bank', value: `${formatMoney(payment.bankBalance)} cm`, inline: true }
            )
            .setTimestamp();

          await message.reply({ embeds: [embed] });
          break;
        }

        case 'clearloan': {
          const targetUser = message.mentions.users.first() || message.author;
          const cleared = await economy.clearLoanForTesting(targetUser.id, guildId);
          const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('🧪 Loan Cleared (Test)')
            .setDescription(
              `${targetUser.username}'s loan state has been cleared.\nPreviously had loan: **${cleared.hadLoan ? 'yes' : 'no'}**`
            )
            .setTimestamp();
          await message.reply({ embeds: [embed] });
          break;
        }

        case 'defaultloan': {
          const targetUser = message.mentions.users.first() || message.author;
          const result = await economy.forceLoanDefaultForTesting(targetUser.id, guildId);
          const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.WARNING)
            .setTitle('🧪 Loan Default Forced (Test)')
            .setDescription(`Forced default for **${targetUser.username}**.`)
            .addFields(
              {
                name: 'Penalty Added',
                value: `${formatMoney(result.penaltyAdded ?? 0n)} cm`,
                inline: true,
              },
              {
                name: 'Seized On Default',
                value: `${formatMoney(result.seizedOnDefault ?? 0n)} cm`,
                inline: true,
              },
              {
                name: 'Debt State',
                value: result.hasLoan
                  ? `${result.loan.status} (${formatMoney(result.loan.debt)} cm remaining)`
                  : 'Cleared immediately',
                inline: false,
              }
            )
            .setTimestamp();
          await message.reply({ embeds: [embed] });
          break;
        }

        case 'runseries': {
          const rawSeries = args.slice(1).join(' ').trim();
          if (!rawSeries) {
            return message.reply(
              'Usage: `test runseries <cmd1> ;; <cmd2> ;; ...`\nExample: `test runseries balance ;; loanstatus @user ;; clearloan @user`'
            );
          }

          const commands = parseRunSeriesCommands(rawSeries);
          if (commands.length === 0) {
            return message.reply('No commands found. Use `;;` to separate commands.');
          }
          if (commands.length > MAX_SERIES_COMMANDS) {
            return message.reply(
              `Too many commands in one series. Maximum is ${MAX_SERIES_COMMANDS}.`
            );
          }

          const results = Array(commands.length).fill(null);
          const runTasks = [];

          for (let i = 0; i < commands.length; i++) {
            const commandText = commands[i];
            const commandArgs = tokenizeSeriesCommand(commandText);
            const subcommand = (commandArgs[0] || '').toLowerCase();

            if (!subcommand) {
              results[i] = `❌ ${i + 1}. Empty command skipped`;
              continue;
            }

            if (subcommand === 'runseries') {
              results[i] = `❌ ${i + 1}. Nested runseries is not allowed`;
              continue;
            }

            runTasks.push(
              (async () => {
                try {
                  await this.execute(message, commandArgs);
                  results[i] = `✅ ${i + 1}. ${commandText}`;
                } catch (error) {
                  results[i] = `❌ ${i + 1}. ${commandText} (${error.message})`;
                }
              })()
            );
          }

          await Promise.all(runTasks);

          const summaryEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.DEFAULT)
            .setTitle('🧪 Run Series Complete')
            .setDescription(results.filter(Boolean).join('\n'))
            .setFooter({ text: `${commands.length} command(s) dispatched concurrently` })
            .setTimestamp();

          await message.reply({ embeds: [summaryEmbed] });
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

export default process.env.IS_DEVEL === 'true' && process.env.NODE_ENV !== 'production'
  ? TestCommand
  : null;
