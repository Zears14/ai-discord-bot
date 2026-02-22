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
import commandSessionService from './services/commandSessionService.js';
import deployLockService from './services/deployLockService.js';
import economyService from './services/economy.js';
import inventoryService from './services/inventoryService.js';
import logger from './services/loggerService.js';
import { formatMoney } from './utils/moneyUtils.js';
// Global error handler
process.on('unhandledRejection', (error) => {
  logger.discord.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.discord.error('Uncaught exception:', error);
  // Attempt graceful shutdown
  gracefulShutdown('uncaughtException').catch(() => {});
});

// Memory leak detection
const memoryUsageThreshold = 1024 * 1024 * 1024 * 2; // 2GB
const memoryMonitorInterval = setInterval(() => {
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
const LOAN_REMINDER_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let loanReminderSweepInterval = null;
let isLoanReminderSweepRunning = false;
let isShuttingDown = false;
let shutdownPromise = null;

function buildLoanReminderMessage(reminder, serverName) {
  if (reminder.type === 'near-due') {
    const dueTimestamp = Math.floor(Number(reminder.dueAt) / 1000);
    return [
      `Loan reminder for **${serverName}**`,
      `Your debt of **${formatMoney(reminder.debt)} cm** is almost due.`,
      `Due: <t:${dueTimestamp}:F> (<t:${dueTimestamp}:R>)`,
      'Use `$loan pay <amount|all>` to avoid delinquent debt lock.',
    ].join('\n');
  }

  return [
    `Loan overdue for **${serverName}**`,
    `Your debt is now **${formatMoney(reminder.debt)} cm** and is delinquent.`,
    'Transfers are disabled until the debt is cleared.',
    'Use `$loan pay <amount|all>` to repay it.',
  ].join('\n');
}

async function runLoanReminderSweep() {
  if (isShuttingDown) {
    return;
  }

  if (isLoanReminderSweepRunning) {
    return;
  }

  isLoanReminderSweepRunning = true;
  try {
    const candidates = await economyService.getLoanReminderCandidates();
    for (const candidate of candidates) {
      const reminderEvents = await economyService.consumeLoanReminderEvents(
        candidate.userId,
        candidate.guildId
      );
      if (!Array.isArray(reminderEvents) || reminderEvents.length === 0) {
        continue;
      }

      const user =
        client.users.cache.get(candidate.userId) ||
        (await client.users.fetch(candidate.userId).catch(() => null));
      if (!user) {
        continue;
      }

      const serverName =
        client.guilds.cache.get(candidate.guildId)?.name || `Server ${candidate.guildId}`;

      for (const reminder of reminderEvents) {
        try {
          await user.send(buildLoanReminderMessage(reminder, serverName));
        } catch (error) {
          logger.discord.cmdError('Failed to send loan reminder DM from sweep:', {
            userId: candidate.userId,
            guildId: candidate.guildId,
            reminderType: reminder?.type,
            error,
          });
        }
      }
    }
  } catch (error) {
    logger.discord.cmdError('Loan reminder sweep failed:', { error });
  } finally {
    isLoanReminderSweepRunning = false;
  }
}

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

    // Sweep loan reminders periodically so DMs can be sent even without user commands
    await runLoanReminderSweep();
    if (!loanReminderSweepInterval) {
      loanReminderSweepInterval = setInterval(() => {
        runLoanReminderSweep().catch((error) => {
          logger.discord.cmdError('Loan reminder sweep interval failed:', { error });
        });
      }, LOAN_REMINDER_SWEEP_INTERVAL_MS);
    }

    logger.discord.ready('Bot is ready!');
  } catch (error) {
    logger.discord.error('Error in ready event:', error);
  }
});

// Optimize message handling with debouncing
const messageQueue = new Map();
const MESSAGE_QUEUE_TIMEOUT = 1000; // 1 second

client.on('messageCreate', async (message) => {
  if (isShuttingDown) return;
  if (message.author.bot || message.system) return;

  const lockAcquired = await deployLockService.acquireLock(`message:${message.id}`, 10);
  if (!lockAcquired) {
    return;
  }

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

client.on('interactionCreate', async (interaction) => {
  if (isShuttingDown) return;
  if (!interaction.isButton()) {
    return;
  }

  const lockAcquired = await deployLockService.acquireLock(`interaction:${interaction.id}`, 10);
  if (!lockAcquired) {
    return;
  }

  await commandHandler.handleInteraction(interaction);
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
  if (isShuttingDown) {
    return;
  }

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
 * Clear pending message queue timeouts.
 */
function clearMessageQueue() {
  for (const timeout of messageQueue.values()) {
    clearTimeout(timeout);
  }
  messageQueue.clear();
}

/**
 * Close health server if running.
 */
async function closeHealthServer() {
  const server = CONFIG.getServer();
  if (!server) {
    return;
  }

  try {
    if (typeof server.stop === 'function') {
      server.stop(true);
    } else if (typeof server.close === 'function') {
      await new Promise((resolve) => server.close(resolve));
    }
  } catch (error) {
    logger.warn('Failed to close health server cleanly', {
      module: 'server',
      error,
    });
  } finally {
    CONFIG.setServer(null);
  }
}

/**
 * Cleanup transient runtime resources used by this process.
 */
async function cleanupRuntimeResources() {
  // Release startup lock first so replacement instances can proceed immediately.
  await deployLockService.releaseStartupLock().catch((error) => {
    logger.warn('Failed to release startup lock during shutdown', {
      module: 'redis-lock',
      error,
    });
  });

  if (loanReminderSweepInterval) {
    clearInterval(loanReminderSweepInterval);
    loanReminderSweepInterval = null;
  }
  isLoanReminderSweepRunning = false;
  clearMessageQueue();
  clearInterval(memoryMonitorInterval);

  await client.destroy().catch((error) => {
    logger.warn('Failed to destroy Discord client cleanly', {
      module: 'discord',
      error,
    });
  });

  await economyService.cleanup().catch((error) => {
    logger.warn('Failed to cleanup economy service cleanly', {
      module: 'database',
      error,
    });
  });

  await commandSessionService.cleanup().catch((error) => {
    logger.warn('Failed to close command session redis client cleanly', {
      module: 'redis-session',
      error,
    });
  });

  await deployLockService.cleanup().catch((error) => {
    logger.warn('Failed to close deploy lock redis client cleanly', {
      module: 'redis-lock',
      error,
    });
  });

  await closeHealthServer();
}

/**
 * Graceful shutdown function.
 */
async function gracefulShutdown(reason = 'shutdown') {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  isShuttingDown = true;
  logger.discord.disconnect(`Initiating graceful shutdown (${reason})...`);

  shutdownPromise = (async () => {
    let exitCode = 0;
    try {
      await cleanupRuntimeResources();
      logger.discord.disconnect('Graceful shutdown complete');
    } catch (error) {
      exitCode = 1;
      logger.discord.error('Error during graceful shutdown:', error);
    } finally {
      process.exit(exitCode);
    }
  })();

  return shutdownPromise;
}

/**
 * Reset transient startup state in case startup is retried in the same process.
 */
async function prepareForStartup() {
  clearMessageQueue();
  if (loanReminderSweepInterval) {
    clearInterval(loanReminderSweepInterval);
    loanReminderSweepInterval = null;
  }
  isLoanReminderSweepRunning = false;
  await closeHealthServer();
}

/**
 * Starts the bot with optimized startup sequence
 * @returns {Promise<void>}
 */
async function startBot() {
  try {
    // Validate environment variables
    validateEnvironment();

    await prepareForStartup();
    isShuttingDown = false;

    // Bring up health endpoint before lock wait so orchestration sees this instance as alive.
    const server = await setupHealthServer();
    CONFIG.setServer(server);

    // Ensure only one instance logs in at a time during rolling deploy overlap.
    await deployLockService.acquireStartupLock({
      key: 'bot-login',
      ttlSeconds: 30,
      pollMs: 5000,
    });

    // Initialize database schema before any other startup work
    await economyService.initializeDatabase();

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
    await cleanupRuntimeResources().catch(() => {});
    logger.discord.error('Critical startup error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown for all catchable stop/terminate signals.
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP', 'SIGBREAK', 'SIGUSR1', 'SIGUSR2'];

for (const signal of STOP_SIGNALS) {
  try {
    process.on(signal, () => {
      gracefulShutdown(signal).catch(() => {});
    });
  } catch (error) {
    logger.warn('Signal is not supported on this platform', {
      module: 'shutdown',
      signal,
      error,
    });
  }
}

// Start the bot
startBot();
