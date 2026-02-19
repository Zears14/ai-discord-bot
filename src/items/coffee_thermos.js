import economy from '../services/economy.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

function randomPerItemReward() {
  const min = 70n;
  const max = 180n;
  const spread = Number(max - min + 1n);
  return min + BigInt(Math.floor(Math.random() * spread));
}

export default {
  name: 'coffee_thermos',
  title: 'Coffee Thermos',
  type: 'consumable',
  price: 300,
  data: {
    description: 'A full thermos. You sell some cups and make a small side income.',
  },
  async use(userId, guildId, quantity = 1) {
    const parsedQuantity = toBigInt(quantity, 'Quantity');
    const perItem = randomPerItemReward();
    const totalValue = perItem * parsedQuantity;
    await economy.updateBalance(userId, guildId, totalValue, 'coffee-thermos-reward');
    return {
      success: true,
      message: `You sold coffee from ${formatMoney(parsedQuantity)} thermos(es) and earned ${formatMoney(totalValue)} Dih.`,
    };
  },
};
