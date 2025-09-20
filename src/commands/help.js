import BaseCommand from './BaseCommand.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import CONFIG from '../config/config.js';

class HelpCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'help',
      description: 'Shows all available commands',
      category: 'Utility',
      usage: 'help [command]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['commands', 'h']
    });
  }

  async execute(message, args) {
    const commands = this.client.commandHandler.commands;
    const aliases = this.client.commandHandler.aliases;
    const prefix = CONFIG.MESSAGE.PREFIX;

    // If a command is specified, show detailed help for that command
    if (args.length > 0) {
      const commandName = args[0].toLowerCase();
      const command = commands.get(commandName) || commands.get(aliases.get(commandName));

      if (!command) {
        return message.reply(`Command \`${commandName}\` not found.`);
      }

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`Command: ${command.name}`)
        .setDescription(command.description)
        .addFields(
          { name: 'Category', value: command.category, inline: true },
          { name: 'Cooldown', value: `${command.cooldown} seconds`, inline: true },
          { name: 'Usage', value: `\`${prefix}${command.usage}\``, inline: false }
        );

      if (command.aliases && command.aliases.length) {
        embed.addFields({ 
          name: 'Aliases', 
          value: command.aliases.map(alias => `\`${prefix}${alias}\``).join(', '),
          inline: false 
        });
      }

      if (command.permissions && command.permissions.length) {
        embed.addFields({ 
          name: 'Required Permissions', 
          value: command.permissions.map(perm => `\`${perm}\``).join(', '),
          inline: false 
        });
      }

      return message.reply({ embeds: [embed] });
    }

    // Create category pages
    const categories = new Map();
    commands.forEach(command => {
      if (!categories.has(command.category)) {
        categories.set(command.category, []);
      }
      categories.get(command.category).push(command);
    });

    // Create embeds for each category
    const embeds = [];
    categories.forEach((commands, category) => {
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`${category} Commands`)
        .setDescription(`Use \`${prefix}help <command>\` for detailed information about a command.`)
        .setFooter({ 
          text: `Page ${embeds.length + 1}/${categories.size} • ${commands.length} commands in this category` 
        });

      commands.forEach(cmd => {
        embed.addFields({
          name: `${prefix}${cmd.name}`,
          value: `${cmd.description}\nAliases: ${cmd.aliases.map(a => `\`${prefix}${a}\``).join(', ') || 'None'}`
        });
      });

      embeds.push(embed);
    });

    // Add a main help page
    const mainEmbed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('Bot Help')
      .setDescription(`Use \`${prefix}help <command>\` for detailed information about a command.\nUse the buttons below to navigate through command categories.`)
      .addFields(
        { 
          name: 'Categories', 
          value: Array.from(categories.keys()).map(cat => `• ${cat}`).join('\n'),
          inline: false 
        }
      )
      .setFooter({ text: `Total Commands: ${commands.size}` });

    embeds.unshift(mainEmbed);

    // Create navigation buttons
    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('first')
          .setLabel('⏮️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('◀️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('▶️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('last')
          .setLabel('⏭️')
          .setStyle(ButtonStyle.Secondary)
      );

    let currentPage = 0;
    const helpMessage = await message.reply({
      embeds: [embeds[currentPage]],
      components: [buttons]
    });

    // Create button collector
    const collector = helpMessage.createMessageComponentCollector({
      time: 300000 // 5 minutes
    });

    collector.on('collect', async (interaction) => {
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({
          content: 'These buttons are not for you!',
          ephemeral: true
        });
      }

      switch (interaction.customId) {
        case 'first':
          currentPage = 0;
          break;
        case 'prev':
          currentPage = currentPage > 0 ? currentPage - 1 : embeds.length - 1;
          break;
        case 'next':
          currentPage = currentPage < embeds.length - 1 ? currentPage + 1 : 0;
          break;
        case 'last':
          currentPage = embeds.length - 1;
          break;
      }

      await interaction.update({
        embeds: [embeds[currentPage]],
        components: [buttons]
      });
    });

    collector.on('end', () => {
      helpMessage.edit({
        components: []
      }).catch(() => {});
    });
  }
}

export default HelpCommand; 