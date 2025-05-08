// Required packages:
// npm install discord.js dotenv @google/generative-ai

require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, Colors, AttachmentBuilder } = require('discord.js');
const { GoogleGenAI, Modality } = require('@google/genai');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Koyeb thing
const express = require('express')
const app = express()
const port = 8000

app.get('/', (req, res) => {
  res.send('Discord Bot is alive!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})



const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const GEMMA_MODEL_NAME = "gemma-3-27b-it";
const GEMINI_MODEL_NAME = "gemini-2.0-flash-lite";

const cooldowns = new Map();
const imageGenCooldowns = new Map();

const IMAGE_GEN_COOLDOWN_TIME = 60000; // 60 seconds
const IMAGE_GEN_API_URL = 'https://ir-api.myqa.cc/v1/openai/images/generations';
const IMAGE_GEN_API_KEY = process.env.IMAGEROUTER_API_KEY; // Ensure you have this in your .env



async function generateTextResponse(userPrompt, username, serverName, memberCount, onlineMemberUsernames) {
  try {
    const systemPrompt = `You are a helpful assistant that provides concise answers with Gen Z vibes.
    Keep your responses brief but use slang, emojis, and trendy expressions. Sound like you're texting a friend.
    If a query appears to violate content policies or asks for harmful, illegal, or unethical information,
    respond only with "I ain't doing that, use google or something" and nothing else.
    The user asking this question has the username: ${username}.
    The current Discord server is called: ${serverName}.
    This server has ${memberCount} human members.
    The usernames of the human members in this server are: ${onlineMemberUsernames.join(', ')}.
    The following text is the user question:`;

    const response = await genAI.models.generateContent({
      model: GEMMA_MODEL_NAME,
      contents: systemPrompt + userPrompt,
      config: {
        maxOutputTokens: 1000
      }
    });
    return response.text;
  } catch (error) {
    console.error('Error generating text response:', error);
    if (error.message?.includes("safety") || error.message?.includes("blocked") || error.message?.includes("policy")) {
      return "I ain't doing that, use google or something";
    }
    return `Error: ${error.message}`;
  }
}

async function generateImageResponse(userPrompt, imageUrl, mimeType, username, serverName, memberCount, onlineMemberUsernames) {
  try {
    const systemPrompt = `You are a helpful assistant that provides concise answers with Gen Z vibes.
    Keep your responses brief but use slang, emojis, and trendy expressions. Sound like you're texting a friend.
    If a query appears to violate content policies or asks for harmful, illegal, or unethical information,
    respond only with "I ain't doing that, use google or something" and nothing else.
    The user asking this question has the username: ${username}.
    The current Discord server is called: ${serverName}.
    This server has ${memberCount} human members.
    The usernames of the human members in this server are: ${onlineMemberUsernames.join(', ')}.
    The following text is the user question:`;

    const response = await fetch(imageUrl);
    const imageArrayBuffer = await response.arrayBuffer();
    const base64ImageData = Buffer.from(imageArrayBuffer).toString('base64');

    const result = await genAI.models.generateContent({
      model: GEMINI_MODEL_NAME,
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
        maxOutputTokens: 1000
      }
    });
    return result.text;
  } catch (error) {
    console.error('Error generating image response:', error);
    return `Error understanding image: ${error.message}`;
  }
}
async function generateImage(prompt) {
  try {
    const options = {
      method: 'POST',
      headers: { Authorization: `Bearer ${IMAGE_GEN_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ "prompt": prompt, "model": "stabilityai/sdxl-turbo:free", "quality": "auto" })
    };

    const response = await fetch(IMAGE_GEN_API_URL, options);
    const data = await response.json();

    if (data && data.data && data.data.length > 0 && data.data[0].b64_json) {
      const base64Image = data.data[0].b64_json;
      const buffer = Buffer.from(base64Image, 'base64');
      return buffer;
    } else {
      console.error('Image generation API error:', data);
      return "Failed to generate image.";
    }
  } catch (error) {
    console.error('Error generating image:', error);
    return `Error generating image: ${error.message}`;
  }
}


client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Bot is ready to respond to $ai and $gen commands!');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const serverName = message.guild.name;
  const memberCount = message.guild.members.cache.filter(member => !member.user.bot).size;
  const onlineMemberUsernames = message.guild.members.cache
  .filter(member => !member.user.bot && member.presence?.status !== 'offline')
  .map(member => member.user.username);

  if (message.content.startsWith('$ai')) {
    const query = message.content.slice(3).trim();

    if (!query && message.attachments.size === 0) {
      message.reply('What am i supposed to do nga?');
      return;
    }

    const userId = message.author.id;
    const now = Date.now();
    const cooldownTime = 20000;

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + cooldownTime;
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        message.reply(`Chillax for ${timeLeft.toFixed(1)} seconds.`);
        return;
      }
    }
    cooldowns.set(userId, now);

    const loadingEmbed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setAuthor({ name: 'Zears AI H', iconURL: client.user.displayAvatarURL() })
    .setDescription('Processing your query with zears ai h')
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp();

    const loadingMessage = await message.reply({ embeds: [loadingEmbed] });

    try {
      let aiResponse;

      if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment?.contentType?.startsWith('image/')) {
          aiResponse = await generateImageResponse(query, attachment.url, attachment.contentType, message.author.username, serverName, memberCount, onlineMemberUsernames);
        } else {
          aiResponse = await generateTextResponse(query, message.author.username, serverName, memberCount, onlineMemberUsernames);
        }
      } else {
        aiResponse = await generateTextResponse(query, message.author.username, serverName, memberCount, onlineMemberUsernames);
      }

      const responseEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setAuthor({ name: 'Zears AI H', iconURL: client.user.displayAvatarURL() })
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp()
      .setDescription(aiResponse.length > 4000 ? aiResponse.substring(0, 4000) + '...' : aiResponse);

      await loadingMessage.edit({ embeds: [responseEmbed] });

      if (aiResponse.length > 4000) {
        const chunks = [];
        for (let i = 4000; i < aiResponse.length; i += 4000) {
          chunks.push(aiResponse.substring(i, Math.min(aiResponse.length, i + 4000)));
        }
        for (let i = 0; i < chunks.length; i++) {
          const additionalEmbed = new EmbedBuilder()
          .setColor(Colors.Green)
          .setDescription(chunks[i])
          .setFooter({ text: `Part ${i + 2}/${chunks.length + 1} • Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() });
          await message.channel.send({ embeds: [additionalEmbed] });
        }
      }
    } catch (error) {
      console.error('Error:', error);
      const errorEmbed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setAuthor({ name: 'Zears AI H', iconURL: client.user.displayAvatarURL() })
      .setDescription('Ts is having no.')
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();
      await loadingMessage.edit({ embeds: [errorEmbed] });
    }
  } else if (message.content.startsWith('$gen')) {
    const prompt = message.content.slice(4).trim();

    if (!prompt) {
      message.reply('What do you want me to generate nga?');
      return;
    }

    const userId = message.author.id;
    const now = Date.now();

    if (imageGenCooldowns.has(userId)) {
      const expirationTime = imageGenCooldowns.get(userId) + IMAGE_GEN_COOLDOWN_TIME;
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        message.reply(`Chillax for ${timeLeft.toFixed(1)} seconds before generating again.`);
        return;
      }
    }
    imageGenCooldowns.set(userId, now);

    const loadingEmbed = new EmbedBuilder()
    .setColor(Colors.Purple)
    .setAuthor({ name: 'Zears AI Image Gen', iconURL: client.user.displayAvatarURL() })
    .setDescription(`Generating image for: "${prompt}"`)
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp();

    const loadingMessage = await message.reply({ embeds: [loadingEmbed] });

    try {
      const imageBuffer = await generateImage(prompt);

      if (imageBuffer instanceof Buffer) {
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'generated_image.png' });
        await loadingMessage.delete();
        await message.channel.send({ files: [attachment] });
      } else {
        const errorEmbed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setAuthor({ name: 'Zears AI Image Gen', iconURL: client.user.displayAvatarURL() })
        .setDescription(`Failed to generate image: ${imageBuffer}`)
        .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();
        await loadingMessage.edit({ embeds: [errorEmbed] });
      }
    } catch (error) {
      console.error('Image generation error:', error);
      const errorEmbed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setAuthor({ name: 'Zears AI Image Gen', iconURL: client.user.displayAvatarURL() })
      .setDescription(`Failed to generate image. Error: ${error.message}`)
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();
      await loadingMessage.edit({ embeds: [errorEmbed] });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
