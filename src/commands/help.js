import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import commandSessionService from '../services/commandSessionService.js';

const COMMANDS_PER_CATEGORY_PAGE = 8;
const HELP_COLLECTOR_TIMEOUT_MS = 300000;

function chunkArray(values, size) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function normalizeCommandsByCategory(commandsCollection) {
  const categories = new Map();

  commandsCollection.forEach((command) => {
    if (!command?.name || !command?.enabled) {
      return;
    }

    if (!categories.has(command.category)) {
      categories.set(command.category, []);
    }

    categories.get(command.category).push(command);
  });

  for (const commandList of categories.values()) {
    commandList.sort((a, b) => a.name.localeCompare(b.name));
  }

  return new Map([...categories.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function buildOverviewEmbed(prefix, categories, totalCommands) {
  const categoryLines = [];
  for (const [category, commandList] of categories.entries()) {
    const pageCount = Math.max(1, Math.ceil(commandList.length / COMMANDS_PER_CATEGORY_PAGE));
    categoryLines.push(`• **${category}**: ${commandList.length} command(s), ${pageCount} page(s)`);
  }

  return new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle('Bot Help')
    .setDescription(
      [
        `Use \`${prefix}help <command>\` for detailed command info.`,
        'Use the buttons below to browse all categories.',
      ].join('\n')
    )
    .addFields({
      name: 'Categories',
      value: categoryLines.join('\n') || 'No categories available.',
      inline: false,
    })
    .addFields({
      name: 'Tips',
      value: [
        `• Try \`${prefix}help blackjack\` for a specific command.`,
        `• Use aliases too, e.g. \`${prefix}help bj\`.`,
      ].join('\n'),
      inline: false,
    })
    .setFooter({ text: `Total Commands: ${totalCommands}` })
    .setTimestamp();
}

function buildCategoryEmbed({
  prefix,
  category,
  commandChunk,
  chunkIndex,
  totalCategoryPages,
  totalCategoryCommands,
}) {
  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle(`${category} Commands`)
    .setDescription(`Use \`${prefix}help <command>\` to view full details.`)
    .setTimestamp();

  for (const cmd of commandChunk) {
    const aliasesText = cmd.aliases?.length
      ? cmd.aliases.map((alias) => `\`${prefix}${alias}\``).join(', ')
      : 'None';
    const usage = cmd.usage ? `\`${prefix}${cmd.usage}\`` : `\`${prefix}${cmd.name}\``;

    embed.addFields({
      name: `${prefix}${cmd.name}`,
      value: `${cmd.description}\nUsage: ${usage}\nAliases: ${aliasesText}`,
      inline: false,
    });
  }

  embed.setFooter({
    text: `${category} ${chunkIndex + 1}/${totalCategoryPages} • ${totalCategoryCommands} command(s)`,
  });

  return embed;
}

function buildCommandDetailEmbed(command, prefix) {
  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle(`Command: ${command.name}`)
    .setDescription(command.description || 'No description provided.')
    .addFields(
      { name: 'Category', value: command.category || 'Uncategorized', inline: true },
      { name: 'Cooldown', value: `${command.cooldown ?? 0} second(s)`, inline: true },
      {
        name: 'Usage',
        value: `\`${prefix}${command.usage || command.name}\``,
        inline: false,
      }
    )
    .setTimestamp();

  if (command.aliases?.length) {
    embed.addFields({
      name: 'Aliases',
      value: command.aliases.map((alias) => `\`${prefix}${alias}\``).join(', '),
      inline: false,
    });
  }

  if (command.permissions?.length) {
    embed.addFields({
      name: 'Required Permissions',
      value: command.permissions.map((perm) => `\`${perm}\``).join(', '),
      inline: false,
    });
  }

  if (command.exclusiveSession) {
    embed.addFields({
      name: 'Session Mode',
      value: 'Exclusive (blocks other commands until finished)',
      inline: false,
    });
  }

  return embed;
}

function buildNavigationRow(currentPage, totalPages) {
  const disableNav = totalPages <= 1;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('help:first')
      .setLabel('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableNav || currentPage === 0),
    new ButtonBuilder()
      .setCustomId('help:prev')
      .setLabel('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableNav || currentPage === 0),
    new ButtonBuilder()
      .setCustomId('help:page')
      .setLabel(`${currentPage + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('help:next')
      .setLabel('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableNav || currentPage >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId('help:last')
      .setLabel('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableNav || currentPage >= totalPages - 1)
  );
}

function buildPages(commands, prefix) {
  const categories = normalizeCommandsByCategory(commands);
  const pages = [buildOverviewEmbed(prefix, categories, commands.size)];

  for (const [category, commandList] of categories.entries()) {
    const chunks = chunkArray(commandList, COMMANDS_PER_CATEGORY_PAGE);
    chunks.forEach((chunk, index) => {
      pages.push(
        buildCategoryEmbed({
          prefix,
          category,
          commandChunk: chunk,
          chunkIndex: index,
          totalCategoryPages: chunks.length,
          totalCategoryCommands: commandList.length,
        })
      );
    });
  }

  return pages;
}

class HelpCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'help',
      description: 'Shows all available commands',
      category: 'Utility',
      usage: 'help [command]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['commands', 'h'],
      interactionPrefix: 'help',
    });
  }

  async execute(message, args) {
    const commands = this.client.commandHandler.commands;
    const aliases = this.client.commandHandler.aliases;
    const prefix = CONFIG.MESSAGE.PREFIX;

    if (args.length > 0) {
      const query = args[0].toLowerCase();
      const command = commands.get(query) || commands.get(aliases.get(query));

      if (!command) {
        return message.reply(`Command \`${query}\` not found.`);
      }

      return message.reply({ embeds: [buildCommandDetailEmbed(command, prefix)] });
    }

    const pages = buildPages(commands, prefix);
    if (pages.length === 1) {
      return message.reply({ embeds: [pages[0]] });
    }

    const helpMessage = await message.reply({
      embeds: [pages[0]],
      components: [buildNavigationRow(0, pages.length)],
    });

    const expiresAt = Date.now() + HELP_COLLECTOR_TIMEOUT_MS;
    await commandSessionService.setSession(
      'help',
      helpMessage.id,
      {
        userId: message.author.id,
        currentPage: 0,
        expiresAt,
      },
      Math.ceil(HELP_COLLECTOR_TIMEOUT_MS / 1000) + 10
    );

    return null;
  }

  async handleInteraction(interaction) {
    const action = (interaction.customId || '').split(':')[1];
    if (!action || action === 'page') {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const session = await commandSessionService.getSession('help', interaction.message.id);
    if (!session) {
      await interaction
        .reply({
          content: 'This help menu has expired. Run `help` again.',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    if (session.userId !== interaction.user.id) {
      await interaction
        .reply({
          content: 'These buttons are not for you!',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    const now = Date.now();
    if (Number(session.expiresAt || 0) <= now) {
      await commandSessionService.deleteSession('help', interaction.message.id);
      await interaction
        .update({
          components: [],
        })
        .catch(() => {});
      return;
    }

    const commands = this.client.commandHandler.commands;
    const prefix = CONFIG.MESSAGE.PREFIX;
    const pages = buildPages(commands, prefix);
    let currentPage = Math.max(0, Math.min(pages.length - 1, Number(session.currentPage || 0)));

    switch (action) {
      case 'first':
        currentPage = 0;
        break;
      case 'prev':
        currentPage = Math.max(0, currentPage - 1);
        break;
      case 'next':
        currentPage = Math.min(pages.length - 1, currentPage + 1);
        break;
      case 'last':
        currentPage = pages.length - 1;
        break;
      default:
        break;
    }

    await interaction.update({
      embeds: [pages[currentPage]],
      components: [buildNavigationRow(currentPage, pages.length)],
    });

    const ttlSeconds = Math.max(1, Math.ceil((Number(session.expiresAt) - now) / 1000));
    await commandSessionService.setSession(
      'help',
      interaction.message.id,
      {
        userId: session.userId,
        currentPage,
        expiresAt: Number(session.expiresAt),
      },
      ttlSeconds
    );
  }
}

export default HelpCommand;
