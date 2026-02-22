/**
 * @fileoverview Blackjack command
 * @module commands/blackjack
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import commandSessionService from '../services/commandSessionService.js';
import deployLockService from '../services/deployLockService.js';
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

function formatCard(cardObj) {
  return `${cardObj.card}${cardObj.suit}`;
}

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

  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return {
    value,
    isSoft: aces > 0,
  };
}

function calculateHandValue(hand) {
  return calculateHandDetails(hand).value;
}

function getTotalBet(hands) {
  return hands.reduce((sum, hand) => sum + hand.bet, 0n);
}

function canSplitHand(hand) {
  return (
    hand &&
    Array.isArray(hand.cards) &&
    hand.cards.length === 2 &&
    hand.cards[0]?.card === hand.cards[1]?.card
  );
}

function getAvailableActions(session) {
  const hand = session.hands[session.activeHandIndex] || null;
  if (!hand || hand.isDone) {
    return {
      canSurrender: false,
      canSplit: false,
      canDouble: false,
    };
  }

  return {
    canSurrender: session.canSurrender && !session.hasTakenAction && session.hands.length === 1,
    canSplit: !session.hasTakenAction && session.hands.length === 1 && canSplitHand(hand),
    canDouble: hand.cards.length === 2 && !hand.isDoubled,
  };
}

function buildButtons({ canSurrender, canSplit, canDouble, isHighTable }) {
  const components = [
    {
      type: 2,
      style: isHighTable ? 4 : 1,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} Hit`,
      custom_id: 'blackjack:hit',
    },
    {
      type: 2,
      style: isHighTable ? 1 : 4,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.STAND} Stand`,
      custom_id: 'blackjack:stand',
    },
  ];

  if (canDouble) {
    components.push({
      type: 2,
      style: 2,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DOUBLE} Double`,
      custom_id: 'blackjack:double',
    });
  }

  if (canSplit) {
    components.push({
      type: 2,
      style: 2,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SPLIT} Split`,
      custom_id: 'blackjack:split',
    });
  }

  if (canSurrender) {
    components.push({
      type: 2,
      style: 2,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} Surrender`,
      custom_id: 'blackjack:surrender',
    });
  }

  return [{ type: 1, components }];
}

function buildFooterText(shoeLength, totalShoeCards, options) {
  const actions = ['Hit', 'Stand'];
  if (options.canDouble) actions.push('Double');
  if (options.canSplit) actions.push('Split');
  if (options.canSurrender) actions.push('Surrender');

  return `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.INSTRUCTIONS} ${actions.join(', ')} • Shoe: ${shoeLength}/${totalShoeCards}`;
}

function buildPlayerFields(session) {
  const multipleHands = session.hands.length > 1;

  return session.hands.map((hand, index) => {
    const handValue = calculateHandValue(hand.cards);
    const isActive = index === session.activeHandIndex && !hand.isDone;
    const stateLabel =
      handValue > 21 ? 'BUST' : hand.isDone ? 'STAND' : isActive ? 'ACTIVE' : 'WAIT';
    const titlePrefix = multipleHands && isActive ? '▶️ ' : '';

    return {
      name: multipleHands
        ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} ${titlePrefix}Hand ${index + 1}`
        : `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
      value:
        `${hand.cards.map(formatCard).join(' ')} (${handValue})\n` +
        `Bet: ${formatMoney(hand.bet)} cm${hand.isDoubled ? ' • Doubled' : ''}${multipleHands ? ` • ${stateLabel}` : ''}`,
      inline: true,
    };
  });
}

function buildDealerField(session, revealDealer = false) {
  return {
    name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
    value: revealDealer
      ? `${session.dealerHand.map(formatCard).join(' ')} (${calculateHandValue(session.dealerHand)})`
      : `${formatCard(session.dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`,
    inline: true,
  };
}

function buildStateEmbed(session, options, description, revealDealer = false) {
  const totalBet = getTotalBet(session.hands);

  return new EmbedBuilder()
    .setColor(
      session.isHighTable
        ? CONFIG.COMMANDS.BLACKJACK.COLORS.HIGH_TABLE_IN_PROGRESS
        : CONFIG.COMMANDS.BLACKJACK.COLORS.IN_PROGRESS
    )
    .setTitle(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
    )
    .setDescription(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} ${session.hands.length > 1 ? 'Total Bet' : 'Bet'}: ${formatMoney(totalBet)} cm\n${description}`
    )
    .setFooter({
      text: buildFooterText(session.shoe.length, session.totalShoeCards, options),
    })
    .setFields([...buildPlayerFields(session), buildDealerField(session, revealDealer)]);
}

function serializeSession(session) {
  return {
    ...session,
    bet: session.bet.toString(),
    hands: session.hands.map((hand) => ({
      cards: hand.cards,
      bet: hand.bet.toString(),
      isDone: Boolean(hand.isDone),
      isDoubled: Boolean(hand.isDoubled),
    })),
    playerHand: session.hands[0]?.cards || [],
  };
}

function parseSession(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  try {
    const bet = BigInt(session.bet);
    const dealerHand = Array.isArray(session.dealerHand)
      ? session.dealerHand.filter(isValidCard)
      : [];
    const shoe = normalizeShoe(session.shoe) || [];
    const totalShoeCards = Number(session.totalShoeCards || 312);

    let hands = [];
    if (Array.isArray(session.hands) && session.hands.length > 0) {
      hands = session.hands
        .map((hand) => {
          const cards = Array.isArray(hand?.cards) ? hand.cards.filter(isValidCard) : [];
          if (cards.length < 2) return null;

          let handBet;
          try {
            handBet = BigInt(hand.bet);
          } catch {
            handBet = bet;
          }

          return {
            cards,
            bet: handBet,
            isDone: Boolean(hand.isDone),
            isDoubled: Boolean(hand.isDoubled),
          };
        })
        .filter(Boolean);
    }

    if (hands.length === 0) {
      const playerHand = Array.isArray(session.playerHand)
        ? session.playerHand.filter(isValidCard)
        : [];
      if (playerHand.length < 2) {
        return null;
      }
      hands = [
        {
          cards: playerHand,
          bet,
          isDone: false,
          isDoubled: false,
        },
      ];
    }

    if (dealerHand.length < 2) {
      return null;
    }

    const rawActiveIndex = Math.floor(Number(session.activeHandIndex ?? 0));
    const activeHandIndex =
      Number.isFinite(rawActiveIndex) && rawActiveIndex >= 0 && rawActiveIndex < hands.length
        ? rawActiveIndex
        : 0;

    return {
      ...session,
      bet,
      hands,
      activeHandIndex,
      dealerHand,
      shoe,
      totalShoeCards,
      canSurrender: Boolean(session.canSurrender),
      hasTakenAction: Boolean(session.hasTakenAction),
      isHighTable: Boolean(session.isHighTable),
      isSplit: Boolean(session.isSplit),
      expiresAt: Number(session.expiresAt || 0),
    };
  } catch {
    return null;
  }
}

async function persistShoe(userId, guildId, shoeStateKey, shoe) {
  const shoeCacheKey = getShoeCacheKey(userId, guildId);
  shoeCache.set(shoeCacheKey, shoe);

  try {
    await jsonbService.setKey(userId, guildId, shoeStateKey, shoe);
  } catch (error) {
    logger.discord.dbError('Failed to persist blackjack shoe:', error);
  }
}

function advanceToNextHand(session) {
  for (let index = session.activeHandIndex + 1; index < session.hands.length; index++) {
    if (!session.hands[index].isDone) {
      session.activeHandIndex = index;
      return true;
    }
  }

  for (let index = 0; index < session.hands.length; index++) {
    if (!session.hands[index].isDone) {
      session.activeHandIndex = index;
      return true;
    }
  }

  return false;
}

async function settleSession(session, userId, guildId, drawFromShoe) {
  const totalBet = getTotalBet(session.hands);
  const allHandsBust = session.hands.every((hand) => calculateHandValue(hand.cards) > 21);

  let dealerDetails = calculateHandDetails(session.dealerHand);
  if (!allHandsBust) {
    while (
      dealerDetails.value < CONFIG.COMMANDS.BLACKJACK.GAME.DEALER_STAND_VALUE ||
      (session.isHighTable &&
        dealerDetails.value === CONFIG.COMMANDS.BLACKJACK.GAME.DEALER_STAND_VALUE &&
        dealerDetails.isSoft)
    ) {
      session.dealerHand.push(drawFromShoe());
      dealerDetails = calculateHandDetails(session.dealerHand);
    }
  }

  const dealerValue = dealerDetails.value;
  let totalPayout = 0n;
  const lines = [];

  for (let index = 0; index < session.hands.length; index++) {
    const hand = session.hands[index];
    const handValue = calculateHandValue(hand.cards);
    const handLabel = session.hands.length > 1 ? `Hand ${index + 1}` : 'Hand';

    if (handValue > 21) {
      lines.push(
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.LOSE} ${handLabel}: Bust (lost ${formatMoney(hand.bet)} cm)`
      );
      continue;
    }

    if (dealerValue > 21 || handValue > dealerValue) {
      const payout = hand.bet * 2n;
      totalPayout += payout;
      lines.push(
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} ${handLabel}: Win (+${formatMoney(hand.bet)} cm)`
      );
      continue;
    }

    if (handValue === dealerValue) {
      totalPayout += hand.bet;
      lines.push(
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} ${handLabel}: Push (returned ${formatMoney(hand.bet)} cm)`
      );
      continue;
    }

    lines.push(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.LOSE} ${handLabel}: Lose (${formatMoney(hand.bet)} cm)`
    );
  }

  if (totalPayout > 0n) {
    const reason =
      totalPayout > totalBet
        ? 'blackjack-win'
        : totalPayout === totalBet
          ? 'blackjack-push'
          : 'blackjack-settle';
    await economy.updateBalance(userId, guildId, totalPayout, reason);
  } else {
    await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss');
  }

  const net = totalPayout - totalBet;
  const absNet = net < 0n ? -net : net;
  const netLabel =
    net > 0n
      ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Net: +${formatMoney(absNet)} cm`
      : net < 0n
        ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.LOSE} Net: -${formatMoney(absNet)} cm`
        : `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Net: 0 cm`;

  const color =
    net > 0n
      ? CONFIG.COMMANDS.BLACKJACK.COLORS.WIN
      : net < 0n
        ? CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE
        : CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
    )
    .setDescription(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Total Bet: ${formatMoney(totalBet)} cm\n${lines.join('\n')}\n${netLabel}`
    )
    .setFooter({
      text: buildFooterText(session.shoe.length, session.totalShoeCards, {
        canSurrender: false,
        canSplit: false,
        canDouble: false,
      }),
    })
    .setFields([...buildPlayerFields(session), buildDealerField(session, true)]);
}

function buildTimedOutEmbed(session) {
  return new EmbedBuilder()
    .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
    .setTitle(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
    )
    .setDescription(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TIMEOUT} Game timed out! You forfeited ${formatMoney(getTotalBet(session.hands))} cm Dih.`
    )
    .setFooter({
      text: buildFooterText(session.shoe.length, session.totalShoeCards, {
        canSurrender: false,
        canSplit: false,
        canDouble: false,
      }),
    })
    .setFields([...buildPlayerFields(session), buildDealerField(session, false)]);
}

function scheduleBlackjackTimeout(message) {
  const messageId = message.id;

  setTimeout(async () => {
    try {
      const lockAcquired = await deployLockService.acquireLock(
        `blackjack:timeout:${messageId}`,
        15
      );
      if (!lockAcquired) {
        return;
      }

      const rawSession = await commandSessionService.getSession('blackjack', messageId);
      const session = parseSession(rawSession);
      if (!session) {
        return;
      }

      if (session.expiresAt > Date.now()) {
        return;
      }

      const timeoutEmbed = buildTimedOutEmbed(session);
      await message.edit({ embeds: [timeoutEmbed], components: [] }).catch(() => {});

      await economy
        .updateBalance(session.userId, session.guildId, 0n, 'blackjack-loss')
        .catch((error) => {
          logger.discord.dbError('Failed to settle timed-out blackjack game:', error);
        });

      await persistShoe(session.userId, session.guildId, session.shoeStateKey, session.shoe);
      await commandSessionService.deleteSession('blackjack', messageId);
      await commandSessionService.releaseExclusiveSession(
        session.userId,
        session.guildId,
        session.exclusiveSessionToken || null
      );
    } catch (error) {
      logger.discord.cmdError('Blackjack timeout scheduler error:', {
        messageId,
        error,
      });
    }
  }, CONFIG.COMMANDS.BLACKJACK.GAME.TIMEOUT + 250);
}

class BlackjackCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'blackjack',
      description: 'Play blackjack with your Dih',
      category: 'Economy',
      usage: 'blackjack <bet> | blackjack help',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['bj', '21'],
      exclusiveSession: true,
      exclusiveSessionTtlSeconds: 50,
      interactionPrefix: 'blackjack',
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const highTableMinBet = CONFIG.COMMANDS.BLACKJACK.GAME.HIGH_TABLE_MIN_BET;

    if (args.length === 1 && ['help', 'rule', 'rules'].includes(args[0].toLowerCase())) {
      const rulesEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🎲 Blackjack Rules')
        .setDescription(
          [
            'Beat the dealer without going over 21.',
            'Cards: 2-10 face value, J/Q/K = 10, A = 1 or 11.',
            `Blackjack pays 3:2. Dealer blackjack returns your bet.`,
            `High Table starts at ${formatMoney(highTableMinBet)} cm and dealer hits soft 17.`,
            'Surrender is only before your first action and only below High Table.',
            'Double costs +1x current hand bet, draws 1 card, then auto-stands.',
            'Split is first action only on a pair, costs +1x hand bet, then play both hands.',
            'Timeout forfeits your active hand(s) total bet.',
          ].join('\n')
        )
        .setFooter({ text: '6-deck persistent shoe per player (shown in footer during games)' })
        .setTimestamp();

      return message.reply({ embeds: [rulesEmbed] });
    }

    if (args.length !== 1) {
      return message.reply(
        'Please provide an amount to bet. Usage: `blackjack <bet>` or `blackjack help`'
      );
    }

    let bet;
    try {
      bet = parsePositiveAmount(args[0], 'Bet amount');
    } catch {
      return message.reply('Please provide a valid amount to bet.');
    }

    const balance = await economy.getBalance(userId, guildId);
    if (balance < bet) {
      return message.reply(`You don't have enough Dih! Your balance: ${formatMoney(balance)} cm`);
    }

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

    const drawFromShoe = () => {
      if (shoe.length === 0) {
        shoe = createShoe();
        shoeReshuffled = true;
      }
      return drawCard(shoe);
    };

    await economy.updateBalance(userId, guildId, -bet, 'blackjack-bet');

    const playerHand = [drawFromShoe(), drawFromShoe()];
    const dealerHand = [drawFromShoe(), drawFromShoe()];
    const playerValue = calculateHandValue(playerHand);
    const reshuffleNotice = shoeReshuffled
      ? '\n🃏 A fresh 6-deck shoe was shuffled for this hand.'
      : '';

    const liveSession = {
      userId,
      guildId,
      exclusiveSessionToken: message.__exclusiveSessionToken || null,
      bet,
      isHighTable,
      canSurrender,
      hasTakenAction: false,
      isSplit: false,
      activeHandIndex: 0,
      hands: [
        {
          cards: playerHand,
          bet,
          isDone: false,
          isDoubled: false,
        },
      ],
      dealerHand,
      shoe,
      totalShoeCards,
      shoeStateKey,
      expiresAt: 0,
    };

    const gameEmbed = buildStateEmbed(
      liveSession,
      getAvailableActions(liveSession),
      `${
        isHighTable
          ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIGH_TABLE} This is now a High Table. Dealer hits on soft 17.`
          : `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} Surrender is available before your first action for a 50% refund.`
      }${reshuffleNotice}`
    );

    if (playerValue === 21) {
      const dealerValue = calculateHandValue(dealerHand);
      if (dealerValue === 21) {
        await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
        gameEmbed
          .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Blackjack! Push - your bet is returned.`
          )
          .setFields([
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
              value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
              inline: true,
            },
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
              value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
              inline: true,
            },
          ]);
        await persistShoe(userId, guildId, shoeStateKey, shoe);
        return message.reply({ embeds: [gameEmbed] });
      }

      const winnings = (bet * 3n) / 2n;
      await economy.updateBalance(userId, guildId, bet + winnings, 'blackjack-win');
      gameEmbed
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.WIN)
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Blackjack! You win ${formatMoney(winnings)} cm Dih!`
        )
        .setFields([
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
            inline: true,
          },
        ]);
      await persistShoe(userId, guildId, shoeStateKey, shoe);
      return message.reply({ embeds: [gameEmbed] });
    }

    const dealerInitialValue = calculateHandValue(dealerHand);
    if (dealerInitialValue === 21) {
      await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
      gameEmbed
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Dealer has blackjack. Your bet is returned.`
        )
        .setFields([
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${dealerHand.map(formatCard).join(' ')} (${dealerInitialValue})`,
            inline: true,
          },
        ]);
      await persistShoe(userId, guildId, shoeStateKey, shoe);
      return message.reply({ embeds: [gameEmbed] });
    }

    const gameReply = await message.reply({
      embeds: [gameEmbed],
      components: buildButtons({
        ...getAvailableActions(liveSession),
        isHighTable,
      }),
    });

    const timeoutMs = CONFIG.COMMANDS.BLACKJACK.GAME.TIMEOUT;
    liveSession.expiresAt = Date.now() + timeoutMs;

    const stored = await commandSessionService.setSession(
      'blackjack',
      gameReply.id,
      serializeSession(liveSession),
      Math.ceil(timeoutMs / 1000) + 30
    );

    if (!stored) {
      await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
      await commandSessionService.releaseExclusiveSession(
        userId,
        guildId,
        message.__exclusiveSessionToken || null
      );
      await gameReply
        .edit({
          embeds: [
            new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle('❌ Blackjack Unavailable')
              .setDescription('Could not start blackjack session. Your bet was refunded.')
              .setTimestamp(),
          ],
          components: [],
        })
        .catch(() => {});
      await persistShoe(userId, guildId, shoeStateKey, shoe);
      return { skipCooldown: true };
    }

    scheduleBlackjackTimeout(gameReply);
    return { keepExclusiveSession: true };
  }

  async handleInteraction(interaction) {
    const action = (interaction.customId || '').split(':')[1];
    if (!action || !['hit', 'stand', 'surrender', 'split', 'double'].includes(action)) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const messageId = interaction.message.id;
    const lockKey = interaction.id || `blackjack:fallback:${messageId}:${interaction.user.id}`;
    const lockAcquired = await deployLockService.acquireLock(
      `blackjack:interaction:${lockKey}`,
      15
    );
    if (!lockAcquired) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const rawSession = await commandSessionService.getSession('blackjack', messageId);
    const session = parseSession(rawSession);
    if (!session) {
      const expiredEmbed = new EmbedBuilder()
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
        .setTitle(`${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack`)
        .setDescription(
          'This blackjack hand is no longer active. Start a new game with `blackjack <bet>`.'
        )
        .setTimestamp();

      await interaction
        .update({
          embeds: [expiredEmbed],
          components: [],
        })
        .catch(async () => {
          await interaction.message
            .edit({ embeds: [expiredEmbed], components: [] })
            .catch(() => {});
          if (!interaction.replied && !interaction.deferred) {
            await interaction
              .reply({
                content:
                  'This blackjack hand is no longer active. Start a new game with `blackjack <bet>`.',
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          }
        });
      return;
    }

    const { userId, guildId } = session;
    if (interaction.user.id !== userId) {
      await interaction
        .reply({
          content: 'This blackjack hand is not yours.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const finalize = async (embed) => {
      await interaction.update({ embeds: [embed], components: [] }).catch(async () => {
        await interaction.message.edit({ embeds: [embed], components: [] }).catch(() => {});
      });
      await persistShoe(userId, guildId, session.shoeStateKey, session.shoe);
      await commandSessionService.deleteSession('blackjack', messageId);
      await commandSessionService.releaseExclusiveSession(
        userId,
        guildId,
        session.exclusiveSessionToken || null
      );
    };

    const now = Date.now();
    if (session.expiresAt <= now) {
      const timeoutEmbed = buildTimedOutEmbed(session);

      await finalize(timeoutEmbed);
      await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss').catch((error) => {
        logger.discord.dbError('Failed to settle timed-out blackjack game:', error);
      });
      return;
    }

    const drawFromShoe = () => {
      if (session.shoe.length === 0) {
        session.shoe = createShoe();
      }
      return drawCard(session.shoe);
    };

    const currentHand = session.hands[session.activeHandIndex];
    if (!currentHand || currentHand.isDone) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const options = getAvailableActions(session);

    if (action === 'surrender') {
      if (!options.canSurrender) {
        await interaction
          .reply({
            content:
              'Surrender is only available before your first action on tables below 10,000 cm.',
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return;
      }

      const refund = session.bet / 2n;
      await economy.updateBalance(userId, guildId, refund, 'blackjack-surrender');

      const resultEmbed = new EmbedBuilder()
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
        .setTitle(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
        )
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(session.bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} You surrendered and got back ${formatMoney(refund)} cm Dih.`
        )
        .setFooter({
          text: buildFooterText(session.shoe.length, session.totalShoeCards, {
            canSurrender: false,
            canSplit: false,
            canDouble: false,
          }),
        })
        .setFields([...buildPlayerFields(session), buildDealerField(session, true)]);

      await finalize(resultEmbed);
      return;
    }

    if (action === 'split') {
      if (!options.canSplit) {
        await interaction
          .reply({
            content: 'Split is only available as your first action on a matching pair.',
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return;
      }

      const balance = await economy.getBalance(userId, guildId);
      if (balance < currentHand.bet) {
        await interaction
          .reply({
            content: `You need ${formatMoney(currentHand.bet)} cm more to split this hand.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return;
      }

      await economy.updateBalance(userId, guildId, -currentHand.bet, 'blackjack-split-bet');

      const [firstCard, secondCard] = currentHand.cards;
      const firstHand = {
        cards: [firstCard, drawFromShoe()],
        bet: currentHand.bet,
        isDone: false,
        isDoubled: false,
      };
      const secondHand = {
        cards: [secondCard, drawFromShoe()],
        bet: currentHand.bet,
        isDone: false,
        isDoubled: false,
      };

      session.hands = [firstHand, secondHand];
      session.activeHandIndex = 0;
      session.isSplit = true;
      session.hasTakenAction = true;
      session.canSurrender = false;

      const splitEmbed = buildStateEmbed(
        session,
        getAvailableActions(session),
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SPLIT} Hand split. Play Hand 1 first.`
      );

      await interaction.update({
        embeds: [splitEmbed],
        components: buildButtons({
          ...getAvailableActions(session),
          isHighTable: session.isHighTable,
        }),
      });

      const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
      await commandSessionService.setSession(
        'blackjack',
        messageId,
        serializeSession(session),
        ttlSeconds
      );
      return;
    }

    if (action === 'double') {
      if (!options.canDouble) {
        await interaction
          .reply({
            content: 'Double down is only available on a fresh two-card hand.',
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return;
      }

      const balance = await economy.getBalance(userId, guildId);
      if (balance < currentHand.bet) {
        await interaction
          .reply({
            content: `You need ${formatMoney(currentHand.bet)} cm more to double down.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return;
      }

      await economy.updateBalance(userId, guildId, -currentHand.bet, 'blackjack-double-bet');

      session.hasTakenAction = true;
      session.canSurrender = false;
      currentHand.bet *= 2n;
      currentHand.isDoubled = true;

      const drawnCard = drawFromShoe();
      currentHand.cards.push(drawnCard);
      const handValue = calculateHandValue(currentHand.cards);
      currentHand.isDone = true;

      const movedToNext = advanceToNextHand(session);
      if (movedToNext) {
        const nextEmbed = buildStateEmbed(
          session,
          getAvailableActions(session),
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DOUBLE} Drew ${formatCard(drawnCard)} (${handValue}). Moving to Hand ${session.activeHandIndex + 1}.`
        );

        await interaction.update({
          embeds: [nextEmbed],
          components: buildButtons({
            ...getAvailableActions(session),
            isHighTable: session.isHighTable,
          }),
        });

        const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
        await commandSessionService.setSession(
          'blackjack',
          messageId,
          serializeSession(session),
          ttlSeconds
        );
        return;
      }

      const resultEmbed = await settleSession(session, userId, guildId, drawFromShoe);
      await finalize(resultEmbed);
      return;
    }

    session.hasTakenAction = true;
    session.canSurrender = false;

    if (action === 'hit') {
      const drawnCard = drawFromShoe();
      currentHand.cards.push(drawnCard);
      const handValue = calculateHandValue(currentHand.cards);

      if (handValue > 21) {
        currentHand.isDone = true;
        const movedToNext = advanceToNextHand(session);

        if (movedToNext) {
          const nextEmbed = buildStateEmbed(
            session,
            getAvailableActions(session),
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} Drew ${formatCard(drawnCard)} and busted (${handValue}). Moving to Hand ${session.activeHandIndex + 1}.`
          );

          await interaction.update({
            embeds: [nextEmbed],
            components: buildButtons({
              ...getAvailableActions(session),
              isHighTable: session.isHighTable,
            }),
          });

          const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
          await commandSessionService.setSession(
            'blackjack',
            messageId,
            serializeSession(session),
            ttlSeconds
          );
          return;
        }

        const resultEmbed = await settleSession(session, userId, guildId, drawFromShoe);
        await finalize(resultEmbed);
        return;
      }

      const inProgressEmbed = buildStateEmbed(
        session,
        getAvailableActions(session),
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} You drew ${formatCard(drawnCard)} (${handValue}).`
      );

      await interaction.update({
        embeds: [inProgressEmbed],
        components: buildButtons({
          ...getAvailableActions(session),
          isHighTable: session.isHighTable,
        }),
      });

      const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
      await commandSessionService.setSession(
        'blackjack',
        messageId,
        serializeSession(session),
        ttlSeconds
      );
      return;
    }

    currentHand.isDone = true;
    const movedToNext = advanceToNextHand(session);

    if (movedToNext) {
      const nextEmbed = buildStateEmbed(
        session,
        getAvailableActions(session),
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.STAND} Standing. Moving to Hand ${session.activeHandIndex + 1}.`
      );

      await interaction.update({
        embeds: [nextEmbed],
        components: buildButtons({
          ...getAvailableActions(session),
          isHighTable: session.isHighTable,
        }),
      });

      const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
      await commandSessionService.setSession(
        'blackjack',
        messageId,
        serializeSession(session),
        ttlSeconds
      );
      return;
    }

    const resultEmbed = await settleSession(session, userId, guildId, drawFromShoe);
    await finalize(resultEmbed);
  }
}

export default BlackjackCommand;
