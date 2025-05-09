const BaseCommand = require('./BaseCommand');
const CONFIG = require("../config/config");

class PingCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'ping',
      description: 'Check the bot\'s latency',
      category: 'Utility',
      usage: 'ping',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['latency']
    });
  }

  async execute(message) {
    const sent = await message.reply('Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const apiLatency = Math.round(this.client.ws.ping);
    
    return sent.edit(`🏓 Pong!\nBot Latency: ${latency}ms\nAPI Latency: ${apiLatency}ms`);
  }
}

module.exports = PingCommand; 