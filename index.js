// Discord Gemma AI Bot
// This bot connects to Discord and sends user queries to Gemma 3 27b using google-genai

// Required packages:
// npm install discord.js dotenv @google/generative-ai

// Load environment variables from .env file
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, Colors } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Discord client setup with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

// Initialize Google Generative AI with your API key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// The model name for Gemma 3 27b
const MODEL_NAME = "models/gemma-3-27b";

// Cooldown tracking - Map to store user IDs and their last command timestamp
const cooldowns = new Map();

// Function to interact with Gemma model
async function generateResponse(userPrompt, username) {
  try {
    // Create a system prompt that instructs the model to be concise and handle policy violations
    const systemPrompt = `You are a helpful assistant that provides concise, direct answers. 
Keep your responses brief and to the point. If a query appears to violate content policies 
or asks for harmful, illegal, or unethical information, respond only with "No" and nothing else.
The user asking this question has the username: ${username}.`;
    
    // Combine system prompt with user query
    const prompt = [
      { text: systemPrompt, role: "system" },
      { text: userPrompt, role: "user" }
    ];
    
    // Initialize the model
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    // Generate content
    const result = await model.generateContent(prompt);
    
    // Check if response was blocked due to safety settings
    if (result.response.promptFeedback && 
        result.response.promptFeedback.blockReason) {
      return "No";
    }
    
    const response = result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating response:', error);
    
    // Check if error is related to safety filters or content policies
    if (error.message && (error.message.includes("safety") || 
                          error.message.includes("blocked") || 
                          error.message.includes("policy"))) {
      return "No";
    }
    
    return `Error: ${error.message}`;
  }
}

// Event handler for when the bot is ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Bot is ready to respond to $ai commands!');
});

// Event handler for when a message is created
client.on('messageCreate', async (message) => {
  // Ignore messages from bots to prevent potential loops
  if (message.author.bot) return;
  
  // Check if the message starts with the command prefix
  if (message.content.startsWith('$ai ')) {
    // Get the query part (everything after "$ai ")
    const query = message.content.slice(4).trim();
    
    if (!query) {
      message.reply('Please provide a query after the $ai command.');
      return;
    }

    // Check cooldown
    const userId = message.author.id;
    const now = Date.now();
    const cooldownTime = 20000; // 20 seconds in milliseconds
    
    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + cooldownTime;
      
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        message.reply(`Please wait ${timeLeft.toFixed(1)} more seconds before using the command again.`);
        return;
      }
    }
    
    // Set cooldown for user
    cooldowns.set(userId, now);
    
    // Optional: Show typing indicator to indicate the bot is processing
    message.channel.sendTyping();
    
    // Create a loading embed
    const loadingEmbed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setAuthor({
        name: 'Gemma AI',
        iconURL: client.user.displayAvatarURL()
      })
      .setDescription('Processing your query with Gemma 3 27b...')
      .setFooter({
        text: `Requested by ${message.author.tag}`,
        iconURL: message.author.displayAvatarURL()
      })
      .setTimestamp();
    
    // Send the loading embed
    const loadingMessage = await message.reply({ embeds: [loadingEmbed] });
    
    try {
      // Get response from Gemma (passing username)
      const aiResponse = await generateResponse(query, message.author.username);
      
      // Create response embed
      const responseEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setAuthor({
          name: 'Gemma AI',
          iconURL: client.user.displayAvatarURL()
        })
        .setFooter({
          text: `Requested by ${message.author.tag}`,
          iconURL: message.author.displayAvatarURL()
        })
        .setTimestamp();
      
      // If the response is too long for Discord embed (4096 char limit)
      if (aiResponse.length > 4000) {
        // Split into chunks of 4000 characters
        const chunks = [];
        for (let i = 0; i < aiResponse.length; i += 4000) {
          chunks.push(aiResponse.substring(i, i + 4000));
        }
        
        // Update the first embed with the first chunk
        responseEmbed.setDescription(chunks[0]);
        await loadingMessage.edit({ embeds: [responseEmbed] });
        
        // Send additional chunks as new embeds
        for (let i = 1; i < chunks.length; i++) {
          const additionalEmbed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setDescription(chunks[i])
            .setFooter({
              text: `Part ${i+1}/${chunks.length} • Requested by ${message.author.tag}`,
              iconURL: message.author.displayAvatarURL()
            });
          
          await message.channel.send({ embeds: [additionalEmbed] });
        }
      } else {
        // Response fits in a single embed
        responseEmbed.setDescription(aiResponse);
        await loadingMessage.edit({ embeds: [responseEmbed] });
      }
    } catch (error) {
      console.error('Error:', error);
      
      // Create error embed
      const errorEmbed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setAuthor({
          name: 'Gemma AI',
          iconURL: client.user.displayAvatarURL()
        })
        .setDescription('Sorry, there was an error processing your request.')
        .setFooter({
          text: `Requested by ${message.author.tag}`,
          iconURL: message.author.displayAvatarURL()
        })
        .setTimestamp();
      
      await loadingMessage.edit({ embeds: [errorEmbed] });
    }
  }
});

// Log the bot in using the token from .env
client.login(process.env.DISCORD_TOKEN);
