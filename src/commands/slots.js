const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class SlotsCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'slots',
            description: 'Play the slot machine',
            category: 'Economy',
            usage: 'slots <bet>',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
            aliases: []
        });
    }

    async execute(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const bet = parseInt(args[0]);

        if (isNaN(bet) || bet <= 0) {
            return message.reply('Please provide a valid bet amount.');
        }

        const balance = await economy.getBalance(userId, guildId);
        if (balance < bet) {
            return message.reply('You do not have enough Dih to place that bet.');
        }

        const reels = ['🍒', '🍊', '🍋', '🍇', '🍉', '🍓', '⭐', '💎'];
        const reel1 = reels[Math.floor(Math.random() * reels.length)];
        const reel2 = reels[Math.floor(Math.random() * reels.length)];
        const reel3 = reels[Math.floor(Math.random() * reels.length)];

        let winnings = 0;
        let resultMessage = `You lost ${bet} cm Dih.`;

        if (reel1 === reel2 && reel2 === reel3) {
            if (reel1 === '💎') {
                winnings = bet * 5;
            } else if (reel1 === '⭐') {
                winnings = bet * 3;
            } else {
                winnings = bet * 2;
            }
        } else if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
            winnings = bet * 1.5;
        }

        let finalWinnings = winnings - bet;

        await economy.updateBalance(userId, guildId, finalWinnings);
        const newBalance = await economy.getBalance(userId, guildId);

        if (winnings > 0) {
            resultMessage = `You won ${winnings} cm Dih!`
        }

        const embed = new EmbedBuilder()
            .setColor(winnings > 0 ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
            .setTitle('🎰 Slot Machine 🎰')
            .setDescription(`[ ${reel1} | ${reel2} | ${reel3} ]`)
            .addFields(
                { name: 'Result', value: resultMessage, inline: true },
                { name: 'New Balance', value: `${newBalance} cm`, inline: true }
            )
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
}

module.exports = SlotsCommand;
