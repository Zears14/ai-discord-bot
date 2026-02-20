/**
 * @fileoverview Blackjack command
 * @module commands/blackjack
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import logger from '../services/loggerService.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

const shoeCache = new Map();

function getShoeCacheKey(userId, guildId) {
  return `${guildId}:${userId}`;
}

function shuffleCards(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

function createShoe() {
  const cards = [];
  const { DECKS } = CONFIG.COMMANDS.BLACKJACK.GAME;

  for (let deck = 0; deck < DECKS; deck++) {
    for (const suit of CONFIG.COMMANDS.BLACKJACK.SUITS) {
      for (const rank of CONFIG.COMMANDS.BLACKJACK.RANKS) {
        cards.push({ card: rank, suit });
      }
    }
  }

  shuffleCards(cards);
  return cards;
}

function isValidCard(cardObj) {
  return (
    cardObj &&
    typeof cardObj === 'object' &&
    typeof cardObj.card === 'string' &&
    typeof cardObj.suit === 'string' &&
    CONFIG.COMMANDS.BLACKJACK.RANKS.includes(cardObj.card) &&
    CONFIG.COMMANDS.BLACKJACK.SUITS.includes(cardObj.suit)
  );
}

function normalizeShoe(rawShoe) {
  if (!Array.isArray(rawShoe)) {
    return null;
  }

  return rawShoe.filter(isValidCard);
}

function drawCard(shoe) {
  return shoe.pop();
}

// Function to format card with suit
function formatCard(cardObj) {
  return `${cardObj.card}${cardObj.suit}`;
}

// Function to calculate hand value and softness
function calculateHandDetails(hand) {
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

  return {
    value,
    isSoft: aces > 0,
  };
}

// Function to calculate hand value
function calculateHandValue(hand) {
  return calculateHandDetails(hand).value;
}

class BlackjackCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'blackjack',
      description: 'Play blackjack with your Dih',
      category: 'Economy',
      usage: 'blackjack <bet>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['bj', '21'],
      exclusiveSession: true,
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
    let bet;
    try {
      bet = parsePositiveAmount(args[0], 'Bet amount');
    } catch {
      return message.reply('Please provide a valid amount to bet.');
    }

    // Check if user has enough balance
    const balance = await economy.getBalance(userId, guildId);
    if (balance < bet) {
      return message.reply(`You don't have enough Dih! Your balance: ${formatMoney(balance)} cm`);
    }

    const highTableMinBet = CONFIG.COMMANDS.BLACKJACK.GAME.HIGH_TABLE_MIN_BET;
    const isHighTable = bet >= highTableMinBet;
    const canSurrender = bet < highTableMinBet;
    const shoeStateKey = CONFIG.COMMANDS.BLACKJACK.GAME.SHOE_STATE_KEY;
    const reshuffleAt = CONFIG.COMMANDS.BLACKJACK.GAME.SHOE_RESHUFFLE_AT;
    const shoeCacheKey = getShoeCacheKey(userId, guildId);
    const totalShoeCards =
      CONFIG.COMMANDS.BLACKJACK.GAME.DECKS *
      CONFIG.COMMANDS.BLACKJACK.RANKS.length *
      CONFIG.COMMANDS.BLACKJACK.SUITS.length;

    let shoe = normalizeShoe(shoeCache.get(shoeCacheKey));

    if (!shoe) {
      try {
        shoe = normalizeShoe(await jsonbService.getKey(userId, guildId, shoeStateKey));
      } catch (error) {
        logger.discord.dbError('Failed to load blackjack shoe:', error);
      }
    }

    let shoeReshuffled = false;
    if (!shoe || shoe.length < reshuffleAt) {
      shoe = createShoe();
      shoeReshuffled = true;
    }
    shoeCache.set(shoeCacheKey, shoe);

    const persistShoe = async () => {
      shoeCache.set(shoeCacheKey, shoe);
      try {
        await jsonbService.setKey(userId, guildId, shoeStateKey, shoe);
      } catch (error) {
        logger.discord.dbError('Failed to persist blackjack shoe:', error);
      }
    };

    const drawFromShoe = () => {
      if (shoe.length === 0) {
        shoe = createShoe();
        shoeReshuffled = true;
      }
      return drawCard(shoe);
    };

    // Deduct bet up front to prevent timeout/selection exploit
    await economy.updateBalance(userId, guildId, -bet, 'blackjack-bet');

    // Initialize game
    const playerHand = [drawFromShoe(), drawFromShoe()];
    const dealerHand = [drawFromShoe(), drawFromShoe()];
    const playerValue = calculateHandValue(playerHand);
    const reshuffleNotice = shoeReshuffled
      ? '\n🃏 A fresh 6-deck shoe was shuffled for this hand.'
      : '';
    const tableNotice = isHighTable
      ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIGH_TABLE} This is now a High Table. Dealer hits on soft 17.`
      : `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} Surrender is available before your first action for a 50% refund.`;
    const buildFooterText = (allowSurrender) => {
      const instructions = allowSurrender
        ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.INSTRUCTIONS} React with Hit, Stand, or Surrender`
        : `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.INSTRUCTIONS} React with Hit or Stand`;
      return `${instructions} • Shoe: ${shoe.length}/${totalShoeCards}`;
    };

    // Create initial game embed
    const gameEmbed = new EmbedBuilder()
      .setColor(
        isHighTable
          ? CONFIG.COMMANDS.BLACKJACK.COLORS.HIGH_TABLE_IN_PROGRESS
          : CONFIG.COMMANDS.BLACKJACK.COLORS.IN_PROGRESS
      )
      .setTitle(
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${isHighTable ? ' • High Table' : ''}`
      )
      .setDescription(
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${tableNotice}${reshuffleNotice}`
      )
      .addFields(
        {
          name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
          value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
          inline: true,
        },
        {
          name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
          value: `${formatCard(dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`,
          inline: true,
        }
      )
      .setFooter({
        text: buildFooterText(canSurrender),
      });

    // Check for blackjack
    if (playerValue === 21) {
      const dealerValue = calculateHandValue(dealerHand);
      if (dealerValue === 21) {
        await economy.updateBalance(userId, guildId, bet, 'blackjack-push'); // Refund stake
        gameEmbed
          .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Blackjack! Push - your bet is returned.`
          )
          .addFields(
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
              value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
              inline: true,
            },
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
              value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
              inline: true,
            }
          );
        await persistShoe();
        return message.reply({ embeds: [gameEmbed] });
      } else {
        const winnings = (bet * 3n) / 2n;
        // Refund stake + blackjack payout profit
        await economy.updateBalance(userId, guildId, bet + winnings, 'blackjack-win');
        gameEmbed
          .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.WIN)
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Blackjack! You win ${formatMoney(winnings)} cm Dih!`
          )
          .addFields(
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
              value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
              inline: true,
            },
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
              value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
              inline: true,
            }
          );
        await persistShoe();
        return message.reply({ embeds: [gameEmbed] });
      }
    }

    const dealerInitialValue = calculateHandValue(dealerHand);
    if (dealerInitialValue === 21) {
      await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
      gameEmbed
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Dealer has blackjack. Your bet is returned.`
        )
        .setFields(
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${dealerHand.map(formatCard).join(' ')} (${dealerInitialValue})`,
            inline: true,
          }
        );
      await persistShoe();
      return message.reply({ embeds: [gameEmbed] });
    }

    const hitButton = {
      type: 2,
      style: isHighTable ? 4 : 1,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} Hit`,
      custom_id: 'hit',
    };
    const standButton = {
      type: 2,
      style: isHighTable ? 1 : 4,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.STAND} Stand`,
      custom_id: 'stand',
    };
    const surrenderButton = {
      type: 2,
      style: 2,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} Surrender`,
      custom_id: 'surrender',
    };

    const rowWithoutSurrender = {
      type: 1,
      components: [hitButton, standButton],
    };
    const rowWithSurrender = {
      type: 1,
      components: [hitButton, standButton, surrenderButton],
    };
    const initialRow = canSurrender ? rowWithSurrender : rowWithoutSurrender;

    const gameReply = await message.reply({
      embeds: [gameEmbed],
      components: [initialRow],
    });

    // Create collector for button interactions
    const filter = (i) => i.user.id === userId;
    const collector = gameReply.createMessageComponentCollector({
      filter,
      time: CONFIG.COMMANDS.BLACKJACK.GAME.TIMEOUT,
    });
    let hasTakenAction = false;

    collector.on('collect', async (i) => {
      if (i.customId === 'surrender') {
        if (!canSurrender || hasTakenAction) {
          await i.reply({
            content:
              'Surrender is only available before your first action on tables below 10,000 cm.',
            ephemeral: true,
          });
          return;
        }

        const refund = bet / 2n;
        await economy.updateBalance(userId, guildId, refund, 'blackjack-surrender');
        gameEmbed
          .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} You surrendered and got back ${formatMoney(refund)} cm Dih.`
          )
          .setFooter({
            text: buildFooterText(canSurrender),
          })
          .setFields(
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
              value: `${playerHand.map(formatCard).join(' ')} (${calculateHandValue(playerHand)})`,
              inline: true,
            },
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
              value: `${dealerHand.map(formatCard).join(' ')} (${calculateHandValue(dealerHand)})`,
              inline: true,
            }
          );

        await i.update({
          embeds: [gameEmbed],
          components: [],
        });
        collector.stop('surrender');
      } else if (i.customId === 'hit') {
        hasTakenAction = true;
        playerHand.push(drawFromShoe());
        const playerValue = calculateHandValue(playerHand);

        if (playerValue > 21) {
          await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss');
          gameEmbed
            .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
            .setDescription(
              `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} You drew: ${formatCard(playerHand[playerHand.length - 1])}\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BUST} Bust! You lose ${formatMoney(bet)} cm Dih.`
            )
            .setFooter({
              text: buildFooterText(false),
            })
            .addFields(
              {
                name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
                value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
                inline: true,
              },
              {
                name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
                value: `${dealerHand.map(formatCard).join(' ')} (${calculateHandValue(dealerHand)})`,
                inline: true,
              }
            );
          await i.update({
            embeds: [gameEmbed],
            components: [],
          });
          collector.stop();
        } else {
          gameEmbed
            .setFooter({
              text: buildFooterText(false),
            })
            .setFields(
              {
                name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
                value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
                inline: true,
              },
              {
                name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
                value: `${formatCard(dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`,
                inline: true,
              }
            );
          await i.update({
            embeds: [gameEmbed],
            components: [rowWithoutSurrender],
          });
        }
      } else if (i.customId === 'stand') {
        hasTakenAction = true;
        // Dealer's turn
        let dealerDetails = calculateHandDetails(dealerHand);
        while (
          dealerDetails.value < CONFIG.COMMANDS.BLACKJACK.GAME.DEALER_STAND_VALUE ||
          (isHighTable &&
            dealerDetails.value === CONFIG.COMMANDS.BLACKJACK.GAME.DEALER_STAND_VALUE &&
            dealerDetails.isSoft)
        ) {
          dealerHand.push(drawFromShoe());
          dealerDetails = calculateHandDetails(dealerHand);
        }
        const dealerValue = dealerDetails.value;

        const playerValue = calculateHandValue(playerHand);
        let result;
        let color;

        if (dealerValue > 21) {
          result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Dealer busts! You win ${formatMoney(bet)} cm Dih!`;
          await economy.updateBalance(userId, guildId, bet * 2n, 'blackjack-win');
          color = CONFIG.COMMANDS.BLACKJACK.COLORS.WIN;
        } else if (dealerValue > playerValue) {
          result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.LOSE} Dealer wins! You lose ${formatMoney(bet)} cm Dih.`;
          await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss');
          color = CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE;
        } else if (dealerValue < playerValue) {
          result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} You win ${formatMoney(bet)} cm Dih!`;
          await economy.updateBalance(userId, guildId, bet * 2n, 'blackjack-win');
          color = CONFIG.COMMANDS.BLACKJACK.COLORS.WIN;
        } else {
          result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Push - your bet is returned.`;
          await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
          color = CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH;
        }

        gameEmbed
          .setColor(color)
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${result}`
          )
          .setFooter({
            text: buildFooterText(false),
          })
          .setFields(
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
              value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
              inline: true,
            },
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
              value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
              inline: true,
            }
          );

        await i.update({
          embeds: [gameEmbed],
          components: [],
        });
        collector.stop();
      }
    });

    collector.on('end', async (collected, reason) => {
      await persistShoe();

      if (reason === 'time') {
        gameEmbed
          .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TIMEOUT} Game timed out! You forfeited ${formatMoney(bet)} cm Dih.`
          )
          .setFooter({
            text: buildFooterText(false),
          });
        // Always clear buttons first to avoid orphaned/active-looking interactions.
        await gameReply.edit({ embeds: [gameEmbed], components: [] }).catch((error) => {
          logger.discord.cmdError('Failed to edit timed-out blackjack message:', error);
        });

        await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss').catch((error) => {
          logger.discord.dbError('Failed to settle timed-out blackjack game:', error);
        });
      }
    });

    // Keep the command session active until the collector ends
    await new Promise((resolve) => {
      collector.on('end', resolve);
    });
  }
}

export default BlackjackCommand;
