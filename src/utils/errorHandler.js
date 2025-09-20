/**
 * @fileoverview Error handling utilities
 * @module utils/errorHandler
 */

import { EmbedBuilder } from 'discord.js';
import CONFIG from '../config/config.js';

class ErrorHandler {
  static async handle(error, message, command = null) {
    console.error(`Error in ${command ? command.name : 'unknown command'}:`, error);

    // Create error embed
    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.ERROR)
      .setTitle('❌ Error')
      .setDescription(this.getErrorMessage(error))
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    try {
      await message.reply({ embeds: [embed] });
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
      try {
        await message.channel.send('An error occurred while processing your command.');
      } catch (fallbackError) {
        console.error('Failed to send fallback error message:', fallbackError);
      }
    }
  }

  static getErrorMessage(error) {
    // Handle specific error types
    if (error.name === 'DiscordAPIError') {
      switch (error.code) {
        case 50013:
          return 'I don\'t have permission to do that!';
        case 50001:
          return 'I can\'t access that channel!';
        case 50005:
          return 'I can\'t send messages in that channel!';
        default:
          return `Discord API Error: ${error.message}`;
      }
    }

    // Handle custom error messages
    if (error.message) {
      return error.message;
    }

    // Default error message
    return 'An unexpected error occurred. Please try again later.';
  }

  static isOperational(error) {
    if (error.isOperational) {
      return true;
    }

    return false;
  }

  static async handleUncaughtException(error) {
    console.error('Uncaught Exception:', error);
    // Here you could add additional error reporting services
    process.exit(1);
  }

  static async handleUnhandledRejection(reason, promise) {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Here you could add additional error reporting services
  }
}

process.on('uncaughtException', ErrorHandler.handleUncaughtException);
process.on('unhandledRejection', ErrorHandler.handleUnhandledRejection);


export default ErrorHandler;