import economy from '../services/economy.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

function randomPerItemReward() {
  const min = 600n;
  const max = 4000n;
  const spread = Number(max - min + 1n);
  return min + BigInt(Math.floor(Math.random() * spread));
}

export default {
  name: 'payday_box',
  title: 'Payday Box',
  type: 'consumable',
  price: 2500,
  data: {
    description: 'A sealed box with a random payout voucher inside.',
  },
  async use(userId, guildId, quantity = 1) {
    const parsedQuantity = toBigInt(quantity, 'Quantity');
    const perItem = randomPerItemReward();
    const totalValue = perItem * parsedQuantity;
    await economy.updateBalance(userId, guildId, totalValue, 'payday-box-reward');
    return {
      success: true,
      message: `You opened ${formatMoney(parsedQuantity)} payday box(es) and got ${formatMoney(totalValue)} Dih.`,
    };
  },
};
