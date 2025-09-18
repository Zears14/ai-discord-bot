/**
 * @fileoverview Main application entry point
 * @module index
 */

require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const express = require('express');
const CommandHandler = require('./handlers/CommandHandler');
const CONFIG = require('./config/config');

// Global error handler
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Attempt graceful shutdown
  gracefulShutdown();
});

// Memory leak detection
const memoryUsageThreshold = 1024 * 1024 * 512; // 512MB
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  if (memoryUsage.heapUsed > memoryUsageThreshold) {
    console.warn('High memory usage detected:', memoryUsage);
    global.gc && global.gc(); // Trigger garbage collection if --expose-gc flag is set
  }
}, 300000); // Check every 5 minutes

/**
 * Validates required environment variables
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
  const requiredEnvVars = ['DISCORD_TOKEN', 'GOOGLE_API_KEY', 'POSTGRES_URI', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

/**
 * Sets up the health check server with optimized settings
 * @returns {Promise<http.Server>} Express server instance
 */
function setupHealthServer() {
  const app = express();
  const port = CONFIG.SERVER.PORT;

  // Optimize Express settings
  app.disable('x-powered-by');
  app.enable('trust proxy');
  app.set('etag', 'strong');

  // Health check endpoint with caching
  app.get('/', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
    res.send(CONFIG.SERVER.HEALTH_MESSAGE);
  });

  // Health status endpoint with detailed metrics
  app.get('/health', (req, res) => {
    const healthData = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };
    res.status(200).json(healthData);
  });

  // Stats endpoint with rate limiting
  const statsCache = new Map();
  const CACHE_DURATION = 60000; // 1 minute

  app.get('/stats', (req, res) => {
    const now = Date.now();
    const cachedStats = statsCache.get('stats');
    
    if (cachedStats && now - cachedStats.timestamp < CACHE_DURATION) {
      return res.status(200).json(cachedStats.data);
    }

    const stats = {
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
      memory: process.memoryUsage(),
      timestamp: now
    };

    statsCache.set('stats', { data: stats, timestamp: now });
    res.status(200).json(stats);
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Health check server listening on port ${port}`);
      resolve(server);
    });

    server.on('error', (error) => {
      console.error(`Failed to start health check server: ${error.message}`);
      reject(error);
    });

    // Optimize server settings
    server.keepAliveTimeout = 65000; // Slightly higher than default 60s
    server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout
  });
}

// Initialize Discord client with optimized settings
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  failIfNotExists: false,
  allowedMentions: { parse: ['users'] },
  restTimeOffset: 0,
  restRequestTimeout: 30000,
  retryLimit: 3
});

// Initialize command handler
const commandHandler = new CommandHandler(client);
client.commandHandler = commandHandler;

// Discord event handlers with optimized error handling
client.once('ready', async () => {
  try {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot is in ${client.guilds.cache.size} guilds`);

    // Set status with optimized activity
    await client.user.setActivity('$help for commands', { 
      type: ActivityType.Listening,
      shardId: client.shard?.id
    });

    // Load commands
    await commandHandler.loadCommands();
  } catch (error) {
    console.error('Error in ready event:', error);
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
      console.error('Error handling message:', error);
    }
  }, MESSAGE_QUEUE_TIMEOUT);

  messageQueue.set(queueKey, timeout);
});

// Enhanced error handling for Discord events
client.on('error', error => {
  console.error('Discord client error:', error);
  // Attempt to recover from error
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    client.ws.reconnect();
  }
});

client.on('warn', warning => {
  console.warn('Discord client warning:', warning);
});

client.on('disconnect', () => {
  console.warn('Bot disconnected from Discord!');
  // Attempt to reconnect
  setTimeout(() => {
    client.ws.reconnect();
  }, 5000);
});

client.on('reconnecting', () => {
  console.log('Bot reconnecting to Discord...');
});

/**
 * Graceful shutdown function
 */
async function gracefulShutdown() {
  console.log('Initiating graceful shutdown...');
  
  try {
    // Close Discord connection
    await client.destroy();
    
    // Close health server
    const server = CONFIG.getServer();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
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

    // Set up the health check server
    const server = await setupHealthServer();
    CONFIG.setServer(server);

    // Login to Discord with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await client.login(process.env.DISCORD_TOKEN);
        console.log('Logged in to Discord!');
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.warn(`Login failed, retrying... (${retries} attempts remaining)`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    console.log('Bot startup complete!');
  } catch (error) {
    console.error('Critical startup error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start the bot
startBot();