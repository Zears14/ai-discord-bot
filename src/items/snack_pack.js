import economy from '../services/economy.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

function randomPerItemReward() {
  const min = 15n;
  const max = 40n;
  const spread = Number(max - min + 1n);
  return min + BigInt(Math.floor(Math.random() * spread));
}

export default {
  name: 'snack_pack',
  title: 'Snack Pack',
  type: 'consumable',
  price: 80,
  data: {
    description: 'A cheap snack with a tiny chance of giving decent pocket change.',
  },
  async use(userId, guildId, quantity = 1) {
    const parsedQuantity = toBigInt(quantity, 'Quantity');
    const perItem = randomPerItemReward();
    const totalValue = perItem * parsedQuantity;
    await economy.updateBalance(userId, guildId, totalValue, 'snack-pack-reward');
    return {
      success: true,
      message: `You used ${formatMoney(parsedQuantity)} snack pack(s) and got ${formatMoney(totalValue)} Dih.`,
    };
  },
};
