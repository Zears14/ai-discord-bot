/**
 * @fileoverview Main application entry point
 * @module index
 */

import 'dotenv/config';
// eslint-disable-next-line import/no-unresolved
import Bun from 'bun'; // Using Bun's native HTTP server
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import CONFIG from './config/config.js';
import CommandHandler from './handlers/CommandHandler.js';
import ItemHandler from './handlers/ItemHandler.js';
import economyService from './services/economy.js';
import inventoryService from './services/inventoryService.js';
import logger from './services/loggerService.js';
// Global error handler
process.on('unhandledRejection', (error) => {
  logger.discord.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.discord.error('Uncaught exception:', error);
  // Attempt graceful shutdown
  gracefulShutdown();
});

// Memory leak detection
const memoryUsageThreshold = 1024 * 1024 * 1024 * 2; // 2GB
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  if (memoryUsage.heapUsed > memoryUsageThreshold) {
    logger.warn('High memory usage detected:', memoryUsage);
    global.gc && global.gc(); // Trigger garbage collection if --expose-gc flag is set
  }
}, 300000); // Check every 5 minutes

/**
 * Validates required environment variables
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
  const requiredEnvVars = [
    'DISCORD_TOKEN',
    'GOOGLE_API_KEY',
    'POSTGRES_URI',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
  ];
  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

/**
 * Sets up the health check server using Bun's native HTTP server
 * @returns {Promise<Server>} Bun server instance
 */
function setupHealthServer() {
  const port = CONFIG.SERVER.PORT;
  const statsCache = new Map();
  const CACHE_DURATION = 60000; // 1 minute

  return new Promise((resolve) => {
    const server = Bun.serve({
      port: port,
      async fetch(req) {
        const url = new URL(req.url);
        const headers = {
          Server: 'Dih Bot Health Server',
        };

        // Root health check endpoint
        if (url.pathname === '/') {
          headers['Cache-Control'] = 'public, max-age=300';
          return new Response(CONFIG.SERVER.HEALTH_MESSAGE, {
            headers,
          });
        }

        // Detailed health status endpoint
        if (url.pathname === '/health') {
          const healthData = {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
          };

          return Response.json(healthData, {
            headers,
          });
        }

        // Stats endpoint with caching
        if (url.pathname === '/stats') {
          const now = Date.now();
          const cachedStats = statsCache.get('stats');

          if (cachedStats && now - cachedStats.timestamp < CACHE_DURATION) {
            return Response.json(cachedStats.data, {
              headers,
            });
          }

          const stats = {
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            memory: process.memoryUsage(),
            timestamp: now,
          };

          statsCache.set('stats', { data: stats, timestamp: now });
          return Response.json(stats, {
            headers,
          });
        }

        // 404 for unknown routes
        return new Response('Not Found', {
          status: 404,
          headers,
        });
      },
      error(error) {
        logger.error('Health server error:', error);
        return new Response('Internal Server Error', {
          status: 500,
          headers: {
            Server: 'Dih Bot Health Server',
          },
        });
      },
    });

    logger.info(`Health check server listening on port ${port}`);
    resolve(server);
  });
}

// Initialize Discord client with optimized settings
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ],
  failIfNotExists: false,
  allowedMentions: { parse: ['users'] },
  restTimeOffset: 0,
  restRequestTimeout: 30000,
  retryLimit: 3,
});

// Initialize command handler
const commandHandler = new CommandHandler(client);
client.commandHandler = commandHandler;
const itemHandler = new ItemHandler();
inventoryService.init(itemHandler);

// Discord event handlers with optimized error handling
client.once('clientReady', async () => {
  try {
    logger.discord.ready(`Logged in as ${client.user.tag}!`);
    logger.discord.ready(`Bot is in ${client.guilds.cache.size} guilds`);

    // Set status with optimized activity
    await client.user.setActivity('$help for commands', {
      type: ActivityType.Listening,
      shardId: client.shard?.id,
    });

    // Load commands
    await commandHandler.loadCommands();

    // Load items
    await itemHandler.loadItems();

    logger.discord.ready('Bot is ready!');
  } catch (error) {
    logger.discord.error('Error in ready event:', error);
  }
});

// Optimize message handling with debouncing
const messageQueue = new Map();
const MESSAGE_QUEUE_TIMEOUT = 1000; // 1 second

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.system) return;

  const queueKey = `${message.channelId}-${message.author.id}`;
  const existingTimeout = messageQueue.get(queueKey);

  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeout = setTimeout(async () => {
    messageQueue.delete(queueKey);
    try {
      await commandHandler.handleMessage(message);
    } catch (error) {
      logger.discord.cmdError('Error handling message:', error);
    }
  }, MESSAGE_QUEUE_TIMEOUT);

  messageQueue.set(queueKey, timeout);
});

// Enhanced error handling for Discord events
client.on('error', (error) => {
  logger.discord.error('Discord client error:', error);
  // Attempt to recover from error
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    client.ws.reconnect();
  }
});

client.on('warn', (warning) => {
  logger.warn('Discord client warning:', warning);
});

client.on('disconnect', () => {
  logger.discord.disconnect('Bot disconnected from Discord!');
  // Attempt to reconnect
  setTimeout(() => {
    client.ws.reconnect();
  }, 5000);
});

client.on('reconnecting', () => {
  logger.discord.connect('Bot reconnecting to Discord...');
});

/**
 * Graceful shutdown function
 */
async function gracefulShutdown() {
  logger.discord.disconnect('Initiating graceful shutdown...');

  try {
    // Close Discord connection
    await client.destroy();

    // Close health server
    const server = CONFIG.getServer();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    logger.discord.disconnect('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.discord.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

/**
 * Starts the bot with optimized startup sequence
 * @returns {Promise<void>}
 */
async function startBot() {
  try {
    // Validate environment variables
    validateEnvironment();

    // Initialize database schema before any other startup work
    await economyService.initializeDatabase();

    // Set up the health check server
    const server = await setupHealthServer();
    CONFIG.setServer(server);

    // Login to Discord with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await client.login(process.env.DISCORD_TOKEN);
        logger.discord.connect('Logged in to Discord!');
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        logger.warn(`Login failed, retrying... (${retries} attempts remaining)`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    logger.discord.ready('Bot startup complete!');
  } catch (error) {
    logger.discord.error('Critical startup error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start the bot
startBot();
