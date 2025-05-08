/**
 * @fileoverview Command handler for managing Discord bot commands
 * @module handlers/CommandHandler
 */

const { Collection } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const CONFIG = require('../config/config');
const ErrorHandler = require('../utils/errorHandler');

/**
 * @class CommandHandler
 * @description Handles command registration and execution
 */
class CommandHandler {
  /**
   * @constructor
   * @param {Object} client - Discord.js client instance
   */
  constructor(client) {
    this.client = client;
    this.commands = new Collection();
    this.aliases = new Collection();
    this.categories = new Set();
    this.cooldowns = new Collection();
  }

  /**
   * Loads all commands from the commands directory
   * @returns {Promise<void>}
   */
  async loadCommands() {
    try {
      const commandsPath = path.join(__dirname, '..', 'commands');
      const commandFiles = await fs.readdir(commandsPath);

      for (const file of commandFiles) {
        if (!file.endsWith('.js') || file === 'BaseCommand.js') continue;

        try {
          const Command = require(path.join(commandsPath, file));
          const command = new Command(this.client);

          if (!command.name) {
            console.warn(`Command in ${file} is missing a name`);
            continue;
          }

          this.commands.set(command.name, command);
          this.categories.add(command.category);

          // Register aliases
          if (command.aliases && command.aliases.length) {
            command.aliases.forEach(alias => {
              this.aliases.set(alias, command.name);
            });
          }

          console.log(`Loaded command: ${command.name} (${command.category})`);
        } catch (error) {
          console.error(`Failed to load command ${file}:`, error);
        }
      }

      console.log(`Loaded ${this.commands.size} commands in ${this.categories.size} categories`);
    } catch (error) {
      console.error('Error loading commands:', error);
      throw error;
    }
  }

  /**
   * Checks if a user is on cooldown for a command
   * @param {string} userId - User ID
   * @param {Object} command - Command object
   * @returns {number} Remaining cooldown time in seconds
   */
  checkCooldown(userId, command) {
    if (!this.cooldowns.has(command.name)) {
      this.cooldowns.set(command.name, new Collection());
    }

    const now = Date.now();
    const timestamps = this.cooldowns.get(command.name);
    const cooldownAmount = (command.cooldown || CONFIG.COMMANDS.COOLDOWNS.DEFAULT) * 1000;

    if (timestamps.has(userId)) {
      const expirationTime = timestamps.get(userId) + cooldownAmount;

      if (now < expirationTime) {
        return (expirationTime - now) / 1000;
      }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownAmount);
    return 0;
  }

  /**
   * Handles incoming messages and executes appropriate commands
   * @param {Message} message - Discord.js message object
   * @returns {Promise<void>}
   */
  async handleMessage(message) {
    if (message.author.bot || message.system) return;

    const prefix = message.content.startsWith(CONFIG.MESSAGE.PREFIX) ? CONFIG.MESSAGE.PREFIX : null;
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = this.commands.get(commandName) || this.commands.get(this.aliases.get(commandName));
    if (!command) return;

    if (!command.enabled) {
      return message.reply('This command is currently disabled.');
    }

    // Check permissions
    if (command.permissions && command.permissions.length) {
      const missingPermissions = command.permissions.filter(perm => !message.member.permissions.has(perm));
      if (missingPermissions.length) {
        return message.reply(`You need the following permissions to use this command: ${missingPermissions.join(', ')}`);
      }
    }

    // Check cooldown
    const cooldownTime = this.checkCooldown(message.author.id, command);
    if (cooldownTime > 0) {
      return message.reply(`Please wait ${cooldownTime.toFixed(1)} more second(s) before using the \`${command.name}\` command.`);
    }

    try {
      await command.execute(message, args);
    } catch (error) {
      await ErrorHandler.handle(error, message, command);
    }
  }
}

module.exports = CommandHandler; 