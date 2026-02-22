/**
 * @fileoverview Command handler for managing Discord bot commands
 * @module handlers/CommandHandler
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collection, MessageFlags } from 'discord.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import CONFIG from '../config/config.js';
import commandSessionService from '../services/commandSessionService.js';
import economyService from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import levelService from '../services/levelService.js';
import logger from '../services/loggerService.js';
import ErrorHandler from '../utils/errorHandler.js';
import { formatMoney } from '../utils/moneyUtils.js';

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
    this.interactionCommands = new Collection();

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
        for (const [userId, expirationTime] of timestamps) {
          if (now >= expirationTime) {
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
      await Promise.all(
        commandFiles.map(async (file) => {
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
              logger.discord.cmdError(`Command in ${file} is missing a name`);
              return;
            }

            // Store command metadata in WeakMap
            this.commandMetadata.set(command, {
              file,
              loadTime: Date.now(),
            });

            this.commands.set(command.name, command);
            this.categories.add(command.category);
            if (
              typeof command.interactionPrefix === 'string' &&
              command.interactionPrefix.length > 0 &&
              typeof command.handleInteraction === 'function'
            ) {
              this.interactionCommands.set(command.interactionPrefix, command);
            }

            // Register aliases using a more efficient approach
            if (command.aliases?.length) {
              command.aliases.forEach((alias) => {
                this.aliases.set(alias, command.name);
              });
            }

            logger.discord.command(`Loaded command: ${command.name} (${command.category})`);
          } catch (error) {
            // Only log errors for non-null commands
            if (error.message !== 'Command is not a constructor') {
              logger.discord.cmdError(`Failed to load command ${file}:`, error);
            }
          }
        })
      );

      logger.discord.command(
        `Loaded ${this.commands.size} commands in ${this.categories.size} categories`
      );
    } catch (error) {
      logger.discord.cmdError('Error loading commands:', error);
      throw error;
    }
  }

  /**
   * Gets remaining cooldown for a command/user in seconds
   * @param {string} userId - User ID
   * @param {Object} command - Command object
   * @returns {number} Remaining cooldown time in seconds
   */
  async getCooldownRemaining(userId, guildId, command) {
    const cooldownAmount = this.getCooldownAmountMs(command);
    if (cooldownAmount <= 0) {
      return 0;
    }

    const now = Date.now();
    const timestamps = this.cooldowns.get(command.name);
    const localRemaining = (() => {
      if (!timestamps) return 0;

      const expirationTime = timestamps.get(userId);
      if (expirationTime && now < expirationTime) {
        return (expirationTime - now) / 1000;
      }

      return 0;
    })();

    if (localRemaining > 0) {
      return localRemaining;
    }

    const persistedRemaining = await commandSessionService.getCommandCooldownRemaining(
      userId,
      guildId,
      command.name
    );

    return Math.max(localRemaining, persistedRemaining);
  }

  /**
   * Sets cooldown expiration for a command/user
   * @param {string} userId - User ID
   * @param {Object} command - Command object
   */
  async setCooldown(userId, guildId, command) {
    const now = Date.now();
    const cooldownAmount = this.getCooldownAmountMs(command);
    if (cooldownAmount <= 0) return;
    const expiresAt = now + cooldownAmount;
    const timestamps =
      this.cooldowns.get(command.name) ||
      this.cooldowns.set(command.name, new Collection()).get(command.name);
    timestamps.set(userId, expiresAt);

    await commandSessionService.setCommandCooldown(userId, guildId, command.name, expiresAt);
  }

  getCooldownAmountMs(command) {
    return (command.cooldown ?? CONFIG.COMMANDS.COOLDOWNS.DEFAULT) * 1000;
  }

  async reserveCooldown(userId, guildId, command) {
    const cooldownAmount = this.getCooldownAmountMs(command);
    if (cooldownAmount <= 0) {
      return { reserved: true, remainingSeconds: 0 };
    }

    const now = Date.now();
    const expiresAt = now + cooldownAmount;
    const timestamps =
      this.cooldowns.get(command.name) ||
      this.cooldowns.set(command.name, new Collection()).get(command.name);
    const localExpiry = timestamps.get(userId);

    if (localExpiry && now < localExpiry) {
      return {
        reserved: false,
        remainingSeconds: Math.max(0, (localExpiry - now) / 1000),
      };
    }

    const remoteReservation = await commandSessionService.reserveCommandCooldown(
      userId,
      guildId,
      command.name,
      expiresAt
    );
    if (!remoteReservation.reserved && remoteReservation.remainingSeconds > 0) {
      return remoteReservation;
    }

    timestamps.set(userId, expiresAt);
    return { reserved: true, remainingSeconds: 0 };
  }

  async clearCooldown(userId, guildId, command) {
    const timestamps = this.cooldowns.get(command.name);
    if (timestamps) {
      timestamps.delete(userId);
      if (timestamps.size === 0) {
        this.cooldowns.delete(command.name);
      }
    }

    await commandSessionService.clearCommandCooldown(userId, guildId, command.name);
  }

  /**
   * Determine whether cooldown should be skipped due to input/usage errors.
   * Commands can also explicitly return `{ skipCooldown: true }`.
   * @param {any} executionResult
   * @returns {boolean}
   */
  shouldSkipCooldown(executionResult) {
    if (executionResult && typeof executionResult === 'object' && executionResult.skipCooldown) {
      return true;
    }

    if (!executionResult || typeof executionResult !== 'object') {
      return false;
    }

    const content =
      typeof executionResult.content === 'string' ? executionResult.content.toLowerCase() : '';
    if (this.isLikelyInputErrorText(content)) {
      return true;
    }

    if (Array.isArray(executionResult.embeds)) {
      for (const embed of executionResult.embeds) {
        const title = (embed?.title || embed?.data?.title || '').toLowerCase();
        const description = (embed?.description || embed?.data?.description || '').toLowerCase();
        if (
          this.isLikelyInputErrorText(title) ||
          this.isLikelyInputErrorText(description) ||
          title.includes('invalid')
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Heuristic matcher for user input/usage validation responses.
   * @param {string} text
   * @returns {boolean}
   */
  isLikelyInputErrorText(text) {
    if (!text) return false;

    const patterns = [
      /usage:\s*`?/i,
      /\binvalid\b/i,
      /please (provide|mention|specify|ask)\b/i,
      /\bmust (be|have)\b/i,
      /\bat least\b/i,
      /\bat most\b/i,
      /\bnot found\b/i,
      /\byou cannot\b/i,
      /\byou can't\b/i,
      /\bdon't have enough\b/i,
      /\bdo not have enough\b/i,
      /\byou need at least\b/i,
    ];

    return patterns.some((pattern) => pattern.test(text));
  }

  parseJailUntilTimestamp(rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return 0;
    }

    if (typeof rawValue === 'number') {
      if (!Number.isFinite(rawValue)) return 0;
      return Math.max(0, Math.floor(rawValue));
    }

    if (typeof rawValue === 'bigint') {
      const asNumber = Number(rawValue);
      if (!Number.isFinite(asNumber)) return 0;
      return Math.max(0, Math.floor(asNumber));
    }

    if (typeof rawValue === 'string') {
      const parsed = Number(rawValue.trim());
      if (!Number.isFinite(parsed)) return 0;
      return Math.max(0, Math.floor(parsed));
    }

    return 0;
  }

  async getActiveJailUntil(userId, guildId) {
    const jailKey = CONFIG.COMMANDS.CRIME?.JAIL_UNTIL_KEY || 'jailUntil';
    try {
      const rawJailUntil = await jsonbService.getKey(userId, guildId, jailKey);
      const jailUntil = this.parseJailUntilTimestamp(rawJailUntil);
      const now = Date.now();

      if (jailUntil > now) {
        return jailUntil;
      }

      if (jailUntil > 0) {
        // Cleanup expired jail timer opportunistically.
        jsonbService.setKey(userId, guildId, jailKey, 0).catch((error) => {
          logger.discord.cmdError('Failed to clear expired jail timer:', {
            userId,
            guildId,
            error,
          });
        });
      }
    } catch (error) {
      logger.discord.cmdError('Failed to check jail status:', {
        userId,
        guildId,
        error,
      });
    }

    return 0;
  }

  async notifyLoanReminders(message) {
    if (!message?.guild || !message?.author) {
      return;
    }

    let reminderEvents = [];
    try {
      reminderEvents = await economyService.consumeLoanReminderEvents(
        message.author.id,
        message.guild.id
      );
    } catch (error) {
      logger.discord.cmdError('Failed to evaluate loan reminder state:', {
        userId: message.author.id,
        guildId: message.guild.id,
        error,
      });
      return;
    }

    if (!Array.isArray(reminderEvents) || reminderEvents.length === 0) {
      return;
    }

    const serverName = message.guild.name || 'Unknown Server';
    for (const reminder of reminderEvents) {
      try {
        if (reminder.type === 'near-due') {
          await message.author.send(
            [
              `Loan reminder for **${serverName}**`,
              `Your debt of **${formatMoney(reminder.debt)} cm** is almost due.`,
              `Due: <t:${Math.floor(Number(reminder.dueAt) / 1000)}:F> (<t:${Math.floor(Number(reminder.dueAt) / 1000)}:R>)`,
              'Use `$loan pay <amount|all>` to avoid delinquent debt lock.',
            ].join('\n')
          );
          continue;
        }

        if (reminder.type === 'overdue') {
          await message.author.send(
            [
              `Loan overdue for **${serverName}**`,
              `Your debt is now **${formatMoney(reminder.debt)} cm** and is delinquent.`,
              'Transfers are disabled until the debt is cleared.',
              'Use `$loan pay <amount|all>` to repay it.',
            ].join('\n')
          );
        }
      } catch (error) {
        logger.discord.cmdError('Failed to send loan reminder DM:', {
          userId: message.author.id,
          guildId: message.guild.id,
          reminderType: reminder?.type,
          error,
        });
      }
    }
  }

  /**
   * Handles Discord component interactions for commands that opt in.
   * @param {import('discord.js').Interaction} interaction
   * @returns {Promise<void>}
   */
  async handleInteraction(interaction) {
    if (!interaction?.isButton?.()) {
      return;
    }

    const customId = interaction.customId || '';
    const prefix = customId.split(':')[0];
    if (!prefix) {
      return;
    }

    const command = this.interactionCommands.get(prefix);
    if (!command || typeof command.handleInteraction !== 'function') {
      return;
    }

    try {
      await command.handleInteraction(interaction);
    } catch (error) {
      logger.discord.cmdError('Error handling interaction:', {
        command: command.name,
        customId,
        error,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: 'An unexpected error occurred while handling this interaction.',
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    }
  }

  /**
   * Handles incoming messages and executes appropriate commands
   * @param {Message} message - Discord.js message object
   * @returns {Promise<void>}
   */
  async handleMessage(message) {
    // Early returns for better performance
    if (message.author.bot || message.system) return;
    if (!message.guild) return;

    const prefix = message.content.startsWith(CONFIG.MESSAGE.PREFIX) ? CONFIG.MESSAGE.PREFIX : null;
    if (!prefix) return;

    // Optimize string operations
    const content = message.content.slice(prefix.length).trim();
    const args = content.split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const jailUntil = await this.getActiveJailUntil(message.author.id, message.guild.id);
    if (jailUntil > Date.now()) {
      return message.reply(
        `🚔 You are in jail. You can use commands again <t:${Math.floor(jailUntil / 1000)}:R>.`
      );
    }

    // Use Map's get-or-set pattern for better performance
    const command =
      this.commands.get(commandName) || this.commands.get(this.aliases.get(commandName));
    if (!command) return;

    if (!command.enabled) {
      return message.reply('This command is currently disabled.');
    }

    // Check permissions using Set for O(1) lookup
    if (command.permissions?.length) {
      const userPerms = new Set(message.member.permissions.toArray());
      const missingPermissions = command.permissions.filter((perm) => !userPerms.has(perm));
      if (missingPermissions.length) {
        return message.reply(
          `You need the following permissions to use this command: ${missingPermissions.join(', ')}`
        );
      }
    }

    await this.notifyLoanReminders(message);
    const hasExclusiveSession = Boolean(command.exclusiveSession);

    // For non-exclusive commands, check if another exclusive session is active.
    if (!hasExclusiveSession) {
      const activeExclusiveSession = await commandSessionService.getExclusiveSession(
        message.author.id,
        message.guild.id
      );
      if (activeExclusiveSession && activeExclusiveSession.expiresAt > Date.now()) {
        const activeCommandName = activeExclusiveSession.commandName || 'unknown';
        return message.reply(
          `You already have an active \`${activeCommandName}\` session. Finish it before starting another command.`
        );
      }
    }

    // Check cooldown
    const cooldownTime = await this.getCooldownRemaining(
      message.author.id,
      message.guild.id,
      command
    );
    if (cooldownTime > 0) {
      return message.reply(
        `Please wait ${cooldownTime.toFixed(1)} more second(s) before using the \`${command.name}\` command.`
      );
    }

    let executionResult;
    let didThrow = false;
    let acquiredExclusiveSession = false;
    let exclusiveSessionToken = null;
    let reservedCooldown = false;

    const cooldownReservation = await this.reserveCooldown(
      message.author.id,
      message.guild.id,
      command
    );
    if (!cooldownReservation.reserved) {
      return message.reply(
        `Please wait ${cooldownReservation.remainingSeconds.toFixed(1)} more second(s) before using the \`${command.name}\` command.`
      );
    }
    reservedCooldown = true;

    try {
      if (hasExclusiveSession) {
        const lockResult = await commandSessionService.acquireExclusiveSession(
          message.author.id,
          message.guild.id,
          command.name,
          command.exclusiveSessionTtlSeconds ?? 60
        );
        acquiredExclusiveSession = lockResult.acquired;
        exclusiveSessionToken = lockResult.token || null;
        message.__exclusiveSessionToken = exclusiveSessionToken;
        if (!lockResult.acquired) {
          if (reservedCooldown) {
            await this.clearCooldown(message.author.id, message.guild.id, command);
            reservedCooldown = false;
          }
          const lockedBy = lockResult.session?.commandName || 'another command';
          return message.reply(
            `You already have an active \`${lockedBy}\` session. Finish it before starting another command.`
          );
        }
      }
      executionResult = await command.execute(message, args);
    } catch (error) {
      didThrow = true;
      await ErrorHandler.handle(error, message, command);
    } finally {
      const keepExclusiveSession = Boolean(
        executionResult &&
          typeof executionResult === 'object' &&
          executionResult.keepExclusiveSession === true
      );

      if (hasExclusiveSession && acquiredExclusiveSession && (!keepExclusiveSession || didThrow)) {
        await commandSessionService.releaseExclusiveSession(
          message.author.id,
          message.guild.id,
          exclusiveSessionToken
        );
      }
    }

    const shouldSkipCooldown = didThrow ? true : this.shouldSkipCooldown(executionResult);
    if (shouldSkipCooldown && reservedCooldown) {
      await this.clearCooldown(message.author.id, message.guild.id, command);
      reservedCooldown = false;
    }

    if (!didThrow && !shouldSkipCooldown) {
      const xpResult = await levelService
        .awardCommandXp(message.author.id, message.guild.id, command.name)
        .catch((error) => {
          logger.discord.cmdError('Failed to award command XP:', {
            userId: message.author.id,
            guildId: message.guild.id,
            command: command.name,
            error,
          });
          return null;
        });

      if (xpResult?.leveledUp) {
        await message.channel
          .send(`🎉 ${message.author}, you reached **Level ${xpResult.level}**!`)
          .catch((error) => {
            logger.discord.cmdError('Failed to send level up message:', {
              userId: message.author.id,
              guildId: message.guild.id,
              command: command.name,
              error,
            });
          });
      }
    }
  }
}

export default CommandHandler;
