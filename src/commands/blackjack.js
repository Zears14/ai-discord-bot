/**
 * @fileoverview Blackjack command
 * @module commands/blackjack
 */

const BaseCommand = require('./BaseCommand');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const CONFIG = require('../config/config');

class BlackjackCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'blackjack',
      description: 'Play a game of blackjack',
      category: 'Fun',
      usage: 'blackjack',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['bj', '21']
    });

    // Store active games
    this.activeGames = new Map();
  }

  // Card deck and values
  static SUITS = ['♠️', '♥️', '♦️', '♣️'];
  static RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  static CARD_VALUES = {
    'A': 11,
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 10, 'Q': 10, 'K': 10
  };

  // Create a new deck
  createDeck() {
    const deck = [];
    for (const suit of BlackjackCommand.SUITS) {
      for (const rank of BlackjackCommand.RANKS) {
        deck.push({ suit, rank });
      }
    }
    return this.shuffleDeck(deck);
  }

  // Shuffle deck using Fisher-Yates algorithm
  shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // Calculate hand value
  calculateHandValue(hand) {
    let value = 0;
    let aces = 0;

    for (const card of hand) {
      if (card.rank === 'A') {
        aces++;
        value += 11;
      } else {
        value += BlackjackCommand.CARD_VALUES[card.rank];
      }
    }

    // Adjust for aces
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }

    return value;
  }

  // Format hand for display
  formatHand(hand) {
    return hand.map(card => `${card.rank}${card.suit}`).join(' ');
  }

  // Create game embed
  createGameEmbed(game, showDealerCard = false) {
    const playerValue = this.calculateHandValue(game.playerHand);
    const dealerValue = this.calculateHandValue(game.dealerHand);
    const dealerDisplay = showDealerCard 
      ? `Dealer's hand (${dealerValue}): ${this.formatHand(game.dealerHand)}`
      : `Dealer's hand: ${game.dealerHand[0].rank}${game.dealerHand[0].suit} ?️`;

    return new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🎲 Blackjack')
      .setDescription(
        `${dealerDisplay}\n\n` +
        `Your hand (${playerValue}): ${this.formatHand(game.playerHand)}\n\n` +
        (game.status ? `**${game.status}**` : '')
      )
      .setFooter({ text: `Game ID: ${game.id}`, iconURL: game.author.displayAvatarURL() })
      .setTimestamp();
  }

  // Create game buttons
  createGameButtons(game) {
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('hit')
          .setLabel('Hit')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('stand')
          .setLabel('Stand')
          .setStyle(ButtonStyle.Secondary)
      );
  }

  // Handle dealer's turn
  async handleDealerTurn(game) {
    while (this.calculateHandValue(game.dealerHand) < 17) {
      game.dealerHand.push(game.deck.pop());
    }

    const playerValue = this.calculateHandValue(game.playerHand);
    const dealerValue = this.calculateHandValue(game.dealerHand);

    if (dealerValue > 21) {
      game.status = 'Dealer busts! You win! 🎉';
    } else if (dealerValue > playerValue) {
      game.status = 'Dealer wins! 😢';
    } else if (dealerValue < playerValue) {
      game.status = 'You win! 🎉';
    } else {
      game.status = 'Push! It\'s a tie! 🤝';
    }

    await game.message.edit({
      embeds: [this.createGameEmbed(game, true)],
      components: []
    });

    this.activeGames.delete(game.id);
  }

  async execute(message, args) {
    // Check if user already has an active game
    if (this.activeGames.has(message.author.id)) {
      return message.reply('You already have an active game! Finish it first.');
    }

    // Create new game
    const game = {
      id: message.author.id,
      author: message.author,
      message: null,
      deck: this.createDeck(),
      playerHand: [],
      dealerHand: [],
      status: null
    };

    // Deal initial cards
    game.playerHand.push(game.deck.pop(), game.deck.pop());
    game.dealerHand.push(game.deck.pop(), game.deck.pop());

    // Check for blackjack
    const playerValue = this.calculateHandValue(game.playerHand);
    const dealerValue = this.calculateHandValue(game.dealerHand);

    if (playerValue === 21) {
      game.status = dealerValue === 21 ? 'Push! Both have blackjack! 🤝' : 'Blackjack! You win! 🎉';
      const embed = this.createGameEmbed(game, true);
      await message.reply({ embeds: [embed] });
      return;
    }

    // Send initial game state
    const embed = this.createGameEmbed(game);
    const buttons = this.createGameButtons(game);
    const gameMessage = await message.reply({ embeds: [embed], components: [buttons] });
    game.message = gameMessage;

    // Store game
    this.activeGames.set(message.author.id, game);

    // Create button collector
    const collector = gameMessage.createMessageComponentCollector({
      time: 60000 // 1 minute timeout
    });

    collector.on('collect', async (interaction) => {
      if (interaction.user.id !== message.author.id) {
        await interaction.reply({ content: 'This is not your game!', ephemeral: true });
        return;
      }

      const game = this.activeGames.get(message.author.id);
      if (!game) return;

      if (interaction.customId === 'hit') {
        game.playerHand.push(game.deck.pop());
        const playerValue = this.calculateHandValue(game.playerHand);

        if (playerValue > 21) {
          game.status = 'Bust! You lose! 😢';
          await game.message.edit({
            embeds: [this.createGameEmbed(game, true)],
            components: []
          });
          this.activeGames.delete(message.author.id);
        } else {
          await game.message.edit({
            embeds: [this.createGameEmbed(game)],
            components: [this.createGameButtons(game)]
          });
        }
      } else if (interaction.customId === 'stand') {
        await this.handleDealerTurn(game);
      }

      await interaction.deferUpdate();
    });

    collector.on('end', () => {
      if (this.activeGames.has(message.author.id)) {
        this.activeGames.delete(message.author.id);
        gameMessage.edit({ components: [] }).catch(() => {});
      }
    });
  }
}

module.exports = BlackjackCommand; 