/**
 * @fileoverview Main application entry point
 * @module index
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const CommandHandler = require('./handlers/CommandHandler');
const CONFIG = require('./config/config');

/**
 * Validates required environment variables
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
  const requiredEnvVars = ['DISCORD_TOKEN', 'GOOGLE_API_KEY', 'IMAGEROUTER_API_KEY'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Sets up the health check server
 * @returns {Promise<http.Server>} Express server instance
 */
function setupHealthServer() {
  const app = express();
  const port = CONFIG.SERVER.PORT;

  app.get('/', (req, res) => {
    res.send(CONFIG.SERVER.HEALTH_MESSAGE);
  });

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  app.get('/stats', (req, res) => {
    res.status(200).json({
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
      memory: process.memoryUsage()
    });
  });

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        console.log(`Health check server listening on port ${port}`);
        resolve(server);
      });

      server.on('error', (error) => {
        console.error(`Failed to start health check server: ${error.message}`);
        reject(error);
      });
    } catch (error) {
      console.error(`Error setting up health check server: ${error.message}`);
      reject(error);
    }
  });
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  failIfNotExists: false,
  allowedMentions: { parse: ['users'] }
});

// Initialize command handler
const commandHandler = new CommandHandler(client);
client.commandHandler = commandHandler;

// Discord event handlers
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is in ${client.guilds.cache.size} guilds`);

  // Set status
  client.user.setActivity('$help for commands', { type: 'LISTENING' });

  // Load commands
  await commandHandler.loadCommands();
});

client.on('messageCreate', async (message) => {
  await commandHandler.handleMessage(message);
});

// Error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

client.on('warn', warning => {
  console.warn('Discord client warning:', warning);
});

client.on('disconnect', () => {
  console.warn('Bot disconnected from Discord!');
});

client.on('reconnecting', () => {
  console.log('Bot reconnecting to Discord...');
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

/**
 * Starts the bot
 * @returns {Promise<void>}
 */
async function startBot() {
  try {
    // Validate environment variables
    validateEnvironment();

    // Set up the health check server
    await setupHealthServer();

    // Login to Discord
    await client.login(process.env.DISCORD_TOKEN);

    console.log('Bot startup complete!');
  } catch (error) {
    console.error('Critical startup error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT. Bot is shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Bot is shutting down...');
  client.destroy();
  process.exit(0);
});

// Start the bot
startBot();