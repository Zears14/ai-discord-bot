// Required packages:
// npm install discord.js dotenv @google/genai express node-fetch

'use strict';

require('dotenv').config();
const express = require('express');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  Colors, 
  AttachmentBuilder,
  Collection
} = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// ==================== Config Management ====================
const CONFIG = {
  // Command settings
  COMMAND_PREFIX: {
    AI: '$ai',
    IMAGE_GEN: '$gen'
  },
  
  // Cooldown settings
  COOLDOWN: {
    TEXT: 20000, // 20 seconds
    IMAGE: 60000  // 60 seconds
  },
  
  // AI models
  MODELS: {
    GEMMA: "gemma-3-27b-it",
    GEMINI: "gemini-2.0-flash-lite"
  },
  
  // Image generation settings
  IMAGE_GEN: {
    API_URL: 'https://ir-api.myqa.cc/v1/openai/images/generations',
    MODEL: "stabilityai/sdxl-turbo:free",
    QUALITY: "auto"
  },
  
  // Discord message settings
  MESSAGE: {
    SIZE_LIMIT: 4000,
    ERROR_FALLBACK: "I ain't doing that, use google or something"
  },
  
  // Health check server
  SERVER: {
    PORT: process.env.PORT || 8000,
    HEALTH_MESSAGE: 'Discord Bot is alive!'
  },
  
  // Discord embed colors
  COLORS: {
    AI_LOADING: Colors.Blue,
    AI_RESPONSE: Colors.Green,
    IMAGE_LOADING: Colors.Purple,
    ERROR: Colors.Red
  },
  
  // Discord embed texts
  EMBED: {
    AI_TITLE: 'Zears AI H',
    IMAGE_TITLE: 'Zears AI Image Gen',
    AI_LOADING: 'Processing your query with zears ai h',
    ERROR_AI: 'Ts is having no.',
    ERROR_IMAGE_PREFIX: 'Failed to generate image. Error: ',
    EMPTY_QUERY: 'What am i supposed to do nga?',
    EMPTY_IMAGE_PROMPT: 'What do you want me to generate nga?'
  },
  
  // AI response settings
  AI: {
    MAX_OUTPUT_TOKENS: 1000
  },
  
  // Generated image settings
  IMAGE_OUTPUT: {
    FILENAME: 'generated_image.png'
  }
};

// Environment validation
function validateEnvironment() {
  const requiredEnvVars = ['DISCORD_TOKEN', 'GOOGLE_API_KEY', 'IMAGEROUTER_API_KEY'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
}

// ==================== Discord Client Setup ====================
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

// ==================== API Clients ====================
let genAI;
try {
  genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
} catch (error) {
  console.error('Failed to initialize Google Generative AI client:', error);
  process.exit(1);
}

// ==================== Service State ====================
client.cooldowns = {
  text: new Collection(),
  image: new Collection()
};

// ==================== Health Check Server ====================
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

// ==================== Prompt Utilities ====================
function createSystemPrompt(username, serverName, memberCount, onlineMemberUsernames) {
  return `You are a helpful assistant that provides concise answers with Gen Z vibes.
    Keep your responses brief but use slang, emojis, and trendy expressions. Sound like you're texting a friend.
    If a query appears to violate content policies or asks for harmful, illegal, or unethical information,
    respond only with "I ain't doing that, use google or something" and nothing else.
    The user asking this question has the username: ${username}.
    The current Discord server is called: ${serverName}.
    This server has ${memberCount} human members.
    ${onlineMemberUsernames.length > 0 ? `The usernames of some online human members in this server are: ${onlineMemberUsernames.slice(0, 10).join(', ')}${onlineMemberUsernames.length > 10 ? '...' : ''}.` : ''}
    The following text is the user question:`;
}

// ==================== Discord Message Helpers ====================
function createLoadingEmbed(type, message, client) {
  const embedData = {
    'ai': {
      color: CONFIG.COLORS.AI_LOADING,
      title: CONFIG.EMBED.AI_TITLE,
      description: CONFIG.EMBED.AI_LOADING
    },
    'image': {
      color: CONFIG.COLORS.IMAGE_LOADING,
      title: CONFIG.EMBED.IMAGE_TITLE,
      description: `Generating image for: "${message.content.slice(CONFIG.COMMAND_PREFIX.IMAGE_GEN.length).trim()}"`,
      thumbnail: client.user.displayAvatarURL()
    }
  };

  const data = embedData[type];
  
  return new EmbedBuilder()
    .setColor(data.color)
    .setAuthor({ name: data.title, iconURL: client.user.displayAvatarURL() })
    .setDescription(data.description)
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp();
}

function createResponseEmbed(responseText, message, client) {
  const sanitizedText = responseText.length > CONFIG.MESSAGE.SIZE_LIMIT 
    ? responseText.substring(0, CONFIG.MESSAGE.SIZE_LIMIT) + '...' 
    : responseText;

  return new EmbedBuilder()
    .setColor(CONFIG.COLORS.AI_RESPONSE)
    .setAuthor({ name: CONFIG.EMBED.AI_TITLE, iconURL: client.user.displayAvatarURL() })
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp()
    .setDescription(sanitizedText);
}

function createErrorEmbed(type, error, message, client) {
  const errorMessage = error?.message || error?.toString() || 'Unknown error';

  const embedData = {
    'ai': {
      color: CONFIG.COLORS.ERROR,
      title: CONFIG.EMBED.AI_TITLE,
      description: CONFIG.EMBED.ERROR_AI
    },
    'image': {
      color: CONFIG.COLORS.ERROR,
      title: CONFIG.EMBED.IMAGE_TITLE,
      description: `${CONFIG.EMBED.ERROR_IMAGE_PREFIX}${errorMessage}`
    }
  };

  const data = embedData[type];
  
  return new EmbedBuilder()
    .setColor(data.color)
    .setAuthor({ name: data.title, iconURL: client.user.displayAvatarURL() })
    .setDescription(data.description)
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp();
}

async function sendLongResponse(responseText, message, firstMessageEmbed) {
  try {
    // Send the first part of the message
    await message.edit({ embeds: [firstMessageEmbed] });
    
    // If response exceeds the limit, send additional parts
    if (responseText.length > CONFIG.MESSAGE.SIZE_LIMIT) {
      const chunks = [];
      for (let i = CONFIG.MESSAGE.SIZE_LIMIT; i < responseText.length; i += CONFIG.MESSAGE.SIZE_LIMIT) {
        chunks.push(responseText.substring(i, Math.min(responseText.length, i + CONFIG.MESSAGE.SIZE_LIMIT)));
      }
      
      for (let i = 0; i < chunks.length; i++) {
        const additionalEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.AI_RESPONSE)
          .setDescription(chunks[i])
          .setFooter({ 
            text: `Part ${i + 2}/${chunks.length + 1} • Requested by ${message.author.tag}`, 
            iconURL: message.author.displayAvatarURL() 
          });
        await message.channel.send({ embeds: [additionalEmbed] });
      }
    }
  } catch (error) {
    console.error('Error sending long response:', error);
    throw new Error('Failed to send complete response');
  }
}

// ==================== Cooldown Management ====================
function checkCooldown(message, type) {
  const userId = message.author.id;
  const now = Date.now();
  const cooldownTime = type === 'text' ? CONFIG.COOLDOWN.TEXT : CONFIG.COOLDOWN.IMAGE;
  const cooldownMap = type === 'text' ? client.cooldowns.text : client.cooldowns.image;

  if (cooldownMap.has(userId)) {
    const expirationTime = cooldownMap.get(userId) + cooldownTime;
    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      message.reply(`Chillax for ${timeLeft.toFixed(1)} seconds${type === 'image' ? ' before generating again' : ''}.`)
        .catch(err => console.error(`Failed to send cooldown message: ${err.message}`));
      return false;
    }
  }
  
  cooldownMap.set(userId, now);
  setTimeout(() => cooldownMap.delete(userId), cooldownTime);
  return true;
}

// ==================== AI Text Generation ====================
async function generateTextResponse(userPrompt, username, serverName, memberCount, onlineMemberUsernames) {
  try {
    const systemPrompt = createSystemPrompt(username, serverName, memberCount, onlineMemberUsernames);
    const fullPrompt = systemPrompt + userPrompt;

    const response = await genAI.models.generateContent({
      model: CONFIG.MODELS.GEMMA,
      contents: fullPrompt,
      config: {
        maxOutputTokens: CONFIG.AI.MAX_OUTPUT_TOKENS
      }
    });
    
    return response.text;
  } catch (error) {
    console.error('Error generating text response:', error);
    if (error.message?.includes("safety") || 
        error.message?.includes("blocked") || 
        error.message?.includes("policy")) {
      return CONFIG.MESSAGE.ERROR_FALLBACK;
    }
    throw new Error(`AI generation error: ${error.message || 'Unknown error'}`);
  }
}

// ==================== AI Image Description ====================
async function generateImageResponse(userPrompt, imageUrl, mimeType, username, serverName, memberCount, onlineMemberUsernames) {
  try {
    const systemPrompt = createSystemPrompt(username, serverName, memberCount, onlineMemberUsernames);

    // Fetch image with timeout and retry logic
    const fetchWithTimeout = async (url, options = {}, retries = 3, timeout = 10000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        if (retries > 0) {
          console.log(`Retrying image fetch (${retries} attempts left)`);
          return fetchWithTimeout(url, options, retries - 1, timeout);
        }
        throw error;
      }
    };
    
    const response = await fetchWithTimeout(imageUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    const imageArrayBuffer = await response.arrayBuffer();
    const base64ImageData = Buffer.from(imageArrayBuffer).toString('base64');

    const result = await genAI.models.generateContent({
      model: CONFIG.MODELS.GEMINI,
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64ImageData,
          },
        },
        { text: systemPrompt + userPrompt }
      ],
      config: {
        maxOutputTokens: CONFIG.AI.MAX_OUTPUT_TOKENS
      }
    });
    
    return result.text;
  } catch (error) {
    console.error('Error generating image response:', error);
    throw new Error(`Image analysis error: ${error.message || 'Unknown error'}`);
  }
}

// ==================== Image Generation ====================
async function generateImage(prompt) {
  try {
    const options = {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${process.env.IMAGEROUTER_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        "prompt": prompt, 
        "model": CONFIG.IMAGE_GEN.MODEL, 
        "quality": CONFIG.IMAGE_GEN.QUALITY 
      }),
      timeout: 30000 // 30 second timeout
    };

    const response = await fetch(CONFIG.IMAGE_GEN.API_URL, options);
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`API responded with status ${response.status}: ${errorData}`);
    }
    
    const data = await response.json();

    if (!data || !data.data || !data.data.length || !data.data[0].b64_json) {
      console.error('Invalid image generation API response:', 
        JSON.stringify(data, null, 2).substring(0, 500) + '...');
      throw new Error('Failed to generate image - invalid response format');
    }
    
    const base64Image = data.data[0].b64_json;
    return Buffer.from(base64Image, 'base64');
  } catch (error) {
    console.error('Error generating image:', error);
    throw new Error(`Image generation failed: ${error.message || 'Unknown error'}`);
  }
}

// ==================== Command Handlers ====================
async function handleAICommand(message) {
  const query = message.content.slice(CONFIG.COMMAND_PREFIX.AI.length).trim();

  if (!query && message.attachments.size === 0) {
    return message.reply(CONFIG.EMBED.EMPTY_QUERY)
      .catch(err => console.error(`Failed to send empty query message: ${err.message}`));
  }

  if (!checkCooldown(message, 'text')) return;

  let loadingMessage;
  
  try {
    loadingMessage = await message.reply({ 
      embeds: [createLoadingEmbed('ai', message, client)] 
    });
    
    const serverInfo = await getServerInfo(message);
    let aiResponse;

    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      if (attachment?.contentType?.startsWith('image/')) {
        aiResponse = await generateImageResponse(
          query, 
          attachment.url, 
          attachment.contentType, 
          ...serverInfo
        );
      } else {
        aiResponse = await generateTextResponse(query, ...serverInfo);
      }
    } else {
      aiResponse = await generateTextResponse(query, ...serverInfo);
    }

    const responseEmbed = createResponseEmbed(aiResponse, message, client);
    await sendLongResponse(aiResponse, loadingMessage, responseEmbed);
  } catch (error) {
    console.error('AI command error:', error);
    if (loadingMessage) {
      await loadingMessage.edit({ 
        embeds: [createErrorEmbed('ai', error, message, client)] 
      }).catch(err => console.error(`Failed to update loading message: ${err.message}`));
    } else {
      await message.reply({ 
        embeds: [createErrorEmbed('ai', error, message, client)] 
      }).catch(err => console.error(`Failed to send error message: ${err.message}`));
    }
  }
}

async function handleImageGenCommand(message) {
  const prompt = message.content.slice(CONFIG.COMMAND_PREFIX.IMAGE_GEN.length).trim();

  if (!prompt) {
    return message.reply(CONFIG.EMBED.EMPTY_IMAGE_PROMPT)
      .catch(err => console.error(`Failed to send empty prompt message: ${err.message}`));
  }

  if (!checkCooldown(message, 'image')) return;

  let loadingMessage;
  
  try {
    loadingMessage = await message.reply({ 
      embeds: [createLoadingEmbed('image', message, client)] 
    });

    const imageBuffer = await generateImage(prompt);
    const attachment = new AttachmentBuilder(imageBuffer, { name: CONFIG.IMAGE_OUTPUT.FILENAME });
    
    // Try to delete loading message but continue if it fails
    await loadingMessage.delete().catch(err => {
      console.warn(`Failed to delete loading message: ${err.message}`);
    });
    
    await message.channel.send({ 
      content: `Generated image for ${message.author}:`,
      files: [attachment] 
    });
  } catch (error) {
    console.error('Image generation command error:', error);
    if (loadingMessage) {
      await loadingMessage.edit({ 
        embeds: [createErrorEmbed('image', error, message, client)] 
      }).catch(err => console.error(`Failed to update loading message: ${err.message}`));
    } else {
      await message.reply({ 
        embeds: [createErrorEmbed('image', error, message, client)] 
      }).catch(err => console.error(`Failed to send error message: ${err.message}`));
    }
  }
}

// ==================== Server Information ====================
async function getServerInfo(message) {
  try {
    const serverName = message.guild?.name || 'Direct Message';
    
    // Check if this is a DM
    if (!message.guild) {
      return [message.author.username, 'Direct Message', 1, [message.author.username]];
    }
    
    // For guild messages, get member information with caching and error handling
    let memberCount = 0;
    let onlineMemberUsernames = [];
    
    try {
      // Check if we need to fetch members (for large guilds)
      const shouldFetchMembers = message.guild.memberCount > 50 && 
                                message.guild.members.cache.size < 50;
                                
      if (shouldFetchMembers) {
        try {
          // Try to fetch more members, but don't fail if it doesn't work
          await message.guild.members.fetch({ limit: 100 })
            .catch(err => console.warn(`Couldn't fetch members: ${err.message}`));
        } catch (err) {
          console.warn(`Error fetching guild members: ${err.message}`);
        }
      }
      
      memberCount = message.guild.members.cache.filter(m => !m.user.bot).size;
      
      // Get online members with a reasonable limit
      onlineMemberUsernames = message.guild.members.cache
        .filter(m => !m.user.bot && m.presence?.status !== 'offline')
        .map(m => m.user.username)
        .slice(0, 20); // Limit to avoid huge messages
        
    } catch (err) {
      console.warn(`Error processing guild members: ${err.message}`);
      memberCount = message.guild.memberCount; // Fallback
      onlineMemberUsernames = [message.author.username]; // Fallback
    }
    
    return [message.author.username, serverName, memberCount, onlineMemberUsernames];
  } catch (error) {
    console.error('Error getting server info:', error);
    // Fallback to minimal info in case of errors
    return [message.author.username, 'Unknown Server', 1, [message.author.username]];
  }
}

// ==================== Discord Event Handlers ====================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is in ${client.guilds.cache.size} guilds`);
  console.log(`Bot is ready to respond to ${CONFIG.COMMAND_PREFIX.AI} and ${CONFIG.COMMAND_PREFIX.IMAGE_GEN} commands!`);
  
  // Set status
  client.user.setActivity(`${CONFIG.COMMAND_PREFIX.AI} for help`, { type: 'LISTENING' });
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages and system messages
  if (message.author.bot || message.system) return;

  try {
    if (message.content.startsWith(CONFIG.COMMAND_PREFIX.AI)) {
      await handleAICommand(message);
    } else if (message.content.startsWith(CONFIG.COMMAND_PREFIX.IMAGE_GEN)) {
      await handleImageGenCommand(message);
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
});

// Error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

client.on('warn', warning => {
  console.warn('Discord client warning:', warning);
});

client
