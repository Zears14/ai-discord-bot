/**
 * @fileoverview 8ball command for fortune telling
 * @module commands/8ball
 */

const BaseCommand = require('./BaseCommand');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class EightBallCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: '8ball',
      description: 'Ask the magic 8ball a question',
      category: 'Fun',
      usage: '8ball <question>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['fortune', 'ask']
    });
  }

  static RESPONSES = {
    positive: [
      'It is certain 🎯',
      'It is decidedly so ✨',
      'Without a doubt 💫',
      'Yes definitely 🌟',
      'You may rely on it 🎲',
      'As I see it, yes 👀',
      'Most likely 🎮',
      'Outlook good 🎪',
      'Yes 🎨',
      'Signs point to yes 🎭'
    ],
    neutral: [
      'Reply hazy, try again 🌫️',
      'Ask again later ⏳',
      'Better not tell you now 🤫',
      'Cannot predict now 🔮',
      'Concentrate and ask again 🧘',
      'My sources say no 🤔',
      'Outlook not so good 😕',
      'Very doubtful 🤨'
    ],
    negative: [
      'Don\'t count on it ❌',
      'My reply is no 🚫',
      'My sources say no 📵',
      'Outlook not so good 👎',
      'Very doubtful 🤷'
    ]
  };

  async execute(message, args) {
    const question = args.join(' ');

    if (!question) {
      return message.reply('What do you want to ask the magic 8ball? 🤔');
    }

    if (!question.endsWith('?')) {
      return message.reply('That doesn\'t look like a question! Try ending it with a "?" 🤔');
    }

    // Randomly select response type
    const responseType = Math.random() < 0.4 ? 'positive' : 
                        Math.random() < 0.7 ? 'neutral' : 'negative';
    const responses = EightBallCommand.RESPONSES[responseType];
    const response = responses[Math.floor(Math.random() * responses.length)];

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🎱 Magic 8-Ball')
      .addFields(
        { name: 'Question', value: question },
        { name: 'Answer', value: response }
      )
      .setFooter({ text: `Asked by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

module.exports = EightBallCommand; 