/**
 * @fileoverview Blackjack command
 * @module commands/blackjack
 */

const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

// Function to draw a random card
function drawCard() {
    const card = CONFIG.COMMANDS.BLACKJACK.RANKS[Math.floor(Math.random() * CONFIG.COMMANDS.BLACKJACK.RANKS.length)];
    const suit = CONFIG.COMMANDS.BLACKJACK.SUITS[Math.floor(Math.random() * CONFIG.COMMANDS.BLACKJACK.SUITS.length)];
    return { card, suit };
}

// Function to format card with suit
function formatCard(cardObj) {
    return `${cardObj.card}${cardObj.suit}`;
}

// Function to calculate hand value
function calculateHandValue(hand) {
    let value = 0;
    let aces = 0;

    for (const cardObj of hand) {
        if (cardObj.card === 'A') {
            aces++;
            value += 11;
        } else {
            value += CONFIG.COMMANDS.BLACKJACK.CARD_VALUES[cardObj.card];
        }
    }

    // Adjust for aces
    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }

    return value;
}

class BlackjackCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'blackjack',
            description: 'Play blackjack with your Dih',
            category: 'Economy',
            usage: 'blackjack <bet>',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
            aliases: ['bj', '21']
        });
    }

    async execute(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;

        // Check arguments
        if (args.length !== 1) {
            return message.reply('Please provide an amount to bet. Usage: `blackjack <bet>`');
        }

        // Parse bet amount
        const bet = parseInt(args[0]);
        if (isNaN(bet) || bet <= 0) {
            return message.reply('Please provide a valid amount to bet.');
        }

        // Check if user has enough balance
        const balance = await economy.getBalance(userId, guildId);
        if (balance < bet) {
            return message.reply(`You don't have enough Dih! Your balance: ${balance} cm`);
        }

        // Initialize game
        const playerHand = [drawCard(), drawCard()];
        const dealerHand = [drawCard(), drawCard()];
        const playerValue = calculateHandValue(playerHand);

        // Create initial game embed
        const gameEmbed = new EmbedBuilder()
            .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.IN_PROGRESS)
            .setTitle(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack`)
            .setDescription(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${bet} cm`)
            .addFields(
                { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`, value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`, inline: true },
                { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`, value: `${formatCard(dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`, inline: true }
            )
            .setFooter({ text: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.INSTRUCTIONS} React with Hit or Stand` });

        // Check for blackjack
        if (playerValue === 21) {
            const dealerValue = calculateHandValue(dealerHand);
            if (dealerValue === 21) {
                await economy.updateBalance(userId, guildId, 0, 'blackjack-push'); // Push
                gameEmbed.setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
                    .setDescription(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${bet} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Blackjack! Push - your bet is returned.`)
                    .addFields(
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`, value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`, inline: true },
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`, value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`, inline: true }
                    );
                return message.reply({ embeds: [gameEmbed] });
            } else {
                const winnings = Math.floor(bet * CONFIG.COMMANDS.BLACKJACK.GAME.BLACKJACK_PAYOUT);
                await economy.updateBalance(userId, guildId, winnings, 'blackjack-win');
                gameEmbed.setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.WIN)
                    .setDescription(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${bet} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Blackjack! You win ${winnings} cm Dih!`)
                    .addFields(
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`, value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`, inline: true },
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`, value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`, inline: true }
                    );
                return message.reply({ embeds: [gameEmbed] });
            }
        }

        // Create buttons for hit/stand
        const row = {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 1,
                    label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} Hit`,
                    custom_id: 'hit'
                },
                {
                    type: 2,
                    style: 4,
                    label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.STAND} Stand`,
                    custom_id: 'stand'
                }
            ]
        };

        const gameReply = await message.reply({
            embeds: [gameEmbed],
            components: [row]
        });

        // Create collector for button interactions
        const filter = i => i.user.id === userId;
        const collector = gameReply.createMessageComponentCollector({ filter, time: CONFIG.COMMANDS.BLACKJACK.GAME.TIMEOUT });

        collector.on('collect', async i => {
            if (i.customId === 'hit') {
                playerHand.push(drawCard());
                const playerValue = calculateHandValue(playerHand);
                
                if (playerValue > 21) {
                    await economy.updateBalance(userId, guildId, -bet, 'blackjack-bust');
                    gameEmbed.setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
                        .setDescription(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${bet} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} You drew: ${formatCard(playerHand[playerHand.length - 1])}\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BUST} Bust! You lose ${bet} cm Dih.`)
                        .addFields(
                            { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`, value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`, inline: true },
                            { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`, value: `${dealerHand.map(formatCard).join(' ')} (${calculateHandValue(dealerHand)})`, inline: true }
                        );
                    await i.update({
                        embeds: [gameEmbed],
                        components: []
                    });
                    collector.stop();
                } else {
                    gameEmbed.setFields(
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`, value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`, inline: true },
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`, value: `${formatCard(dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`, inline: true }
                    );
                    await i.update({
                        embeds: [gameEmbed],
                        components: [row]
                    });
                }
            } else if (i.customId === 'stand') {
                // Dealer's turn
                let dealerValue = calculateHandValue(dealerHand);
                while (dealerValue < CONFIG.COMMANDS.BLACKJACK.GAME.DEALER_STAND_VALUE) {
                    dealerHand.push(drawCard());
                    dealerValue = calculateHandValue(dealerHand);
                }

                const playerValue = calculateHandValue(playerHand);
                let result;
                let color;

                if (dealerValue > 21) {
                    result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Dealer busts! You win ${bet} cm Dih!`;
                    await economy.updateBalance(userId, guildId, bet, 'blackjack-win');
                    color = CONFIG.COMMANDS.BLACKJACK.COLORS.WIN;
                } else if (dealerValue > playerValue) {
                    result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.LOSE} Dealer wins! You lose ${bet} cm Dih.`;
                    await economy.updateBalance(userId, guildId, -bet, 'blackjack-loss');
                    color = CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE;
                } else if (dealerValue < playerValue) {
                    result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} You win ${bet} cm Dih!`;
                    await economy.updateBalance(userId, guildId, bet, 'blackjack-win');
                    color = CONFIG.COMMANDS.BLACKJACK.COLORS.WIN;
                } else {
                    result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Push - your bet is returned.`;
                    color = CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH;
                }

                gameEmbed.setColor(color)
                    .setDescription(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${bet} cm\n${result}`)
                    .setFields(
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`, value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`, inline: true },
                        { name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`, value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`, inline: true }
                    );

                await i.update({
                    embeds: [gameEmbed],
                    components: []
                });
                collector.stop();
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                gameEmbed.setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
                    .setDescription(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TIMEOUT} Game timed out!`);
                await message.reply({ embeds: [gameEmbed] });
            }
        });
    }
}

module.exports = BlackjackCommand; 