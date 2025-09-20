/**
 * @fileoverview Command handler for managing Discord bot commands
 * @module handlers/CommandHandler
 */

import { Collection } from 'discord.js';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import CONFIG from '../config/config.js';
import ErrorHandler from '../utils/errorHandler.js';

// Cache for command files to prevent repeated disk reads
const commandCache = new Map();

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
    
    // WeakMap for storing command metadata to allow garbage collection
    this.commandMetadata = new WeakMap();
    
    // Initialize command cache cleanup interval
    this._initCacheCleanup();
  }

  /**
   * Initialize periodic cache cleanup
   * @private
   */
  _initCacheCleanup() {
    // Clean up cooldowns every hour
    setInterval(() => {
      const now = Date.now();
      for (const [commandName, timestamps] of this.cooldowns) {
        for (const [userId, timestamp] of timestamps) {
          if (now - timestamp > CONFIG.COMMANDS.COOLDOWNS.DEFAULT * 1000) {
            timestamps.delete(userId);
          }
        }
        if (timestamps.size === 0) {
          this.cooldowns.delete(commandName);
        }
      }
    }, 3600000); // 1 hour
  }

  /**
   * Loads all commands from the commands directory
   * @returns {Promise<void>}
   */
  async loadCommands() {
    try {
      const commandsPath = path.join(__dirname, '..', 'commands');
      const commandFiles = await fs.readdir(commandsPath);

      // Process commands in parallel for better performance
      await Promise.all(commandFiles.map(async (file) => {
        if (!file.endsWith('.js') || file === 'BaseCommand.js') return;

        try {
          // Check cache first
          let Command;
          if (commandCache.has(file)) {
            Command = commandCache.get(file);
          } else {
            const commandModule = await import(path.join(commandsPath, file));
            Command = commandModule.default;
            commandCache.set(file, Command);
          }

          // Skip if command is null (e.g., disabled in development mode)
          if (!Command) {
            return;
          }

          const command = new Command(this.client);

          if (!command.name) {
            console.warn(`Command in ${file} is missing a name`);
            return;
          }

          // Store command metadata in WeakMap
          this.commandMetadata.set(command, {
            file,
            loadTime: Date.now()
          });

          this.commands.set(command.name, command);
          this.categories.add(command.category);

          // Register aliases using a more efficient approach
          if (command.aliases?.length) {
            command.aliases.forEach(alias => {
              this.aliases.set(alias, command.name);
            });
          }

          console.log(`Loaded command: ${command.name} (${command.category})`);
        } catch (error) {
          // Only log errors for non-null commands
          if (error.message !== 'Command is not a constructor') {
            console.error(`Failed to load command ${file}:`, error);
          }
        }
      }));

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
    const now = Date.now();
    const cooldownAmount = (command.cooldown || CONFIG.COMMANDS.COOLDOWNS.DEFAULT) * 1000;

    // Use Map's get-or-set pattern for better performance
    const timestamps = this.cooldowns.get(command.name) || this.cooldowns.set(command.name, new Collection()).get(command.name);
    
    const expirationTime = timestamps.get(userId);
    if (expirationTime && now < expirationTime) {
      return (expirationTime - now) / 1000;
    }

    timestamps.set(userId, now + cooldownAmount);
    return 0;
  }

  /**
   * Handles incoming messages and executes appropriate commands
   * @param {Message} message - Discord.js message object
   * @returns {Promise<void>}
   */
  async handleMessage(message) {
    // Early returns for better performance
    if (message.author.bot || message.system) return;

    const prefix = message.content.startsWith(CONFIG.MESSAGE.PREFIX) ? CONFIG.MESSAGE.PREFIX : null;
    if (!prefix) return;

    // Optimize string operations
    const content = message.content.slice(prefix.length).trim();
    const args = content.split(/\s+/);
    const commandName = args.shift().toLowerCase();

    // Use Map's get-or-set pattern for better performance
    const command = this.commands.get(commandName) || this.commands.get(this.aliases.get(commandName));
    if (!command) return;

    if (!command.enabled) {
      return message.reply('This command is currently disabled.');
    }

    // Check permissions using Set for O(1) lookup
    if (command.permissions?.length) {
      const userPerms = new Set(message.member.permissions.toArray());
      const missingPermissions = command.permissions.filter(perm => !userPerms.has(perm));
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

export default CommandHandler; 