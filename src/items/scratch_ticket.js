import economy from '../services/economy.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

function randomPerItemReward() {
  const min = 0n;
  const max = 1800n;
  const spread = Number(max - min + 1n);
  return min + BigInt(Math.floor(Math.random() * spread));
}

export default {
  name: 'scratch_ticket',
  title: 'Scratch Ticket',
  type: 'consumable',
  price: 900,
  data: {
    description: 'A risky scratch card. Could be nothing, could be a big hit.',
  },
  async use(userId, guildId, quantity = 1) {
    const parsedQuantity = toBigInt(quantity, 'Quantity');
    const perItem = randomPerItemReward();
    const totalValue = perItem * parsedQuantity;
    await economy.updateBalance(userId, guildId, totalValue, 'scratch-ticket-reward');
    return {
      success: true,
      message: `You scratched ${formatMoney(parsedQuantity)} ticket(s) and won ${formatMoney(totalValue)} Dih.`,
    };
  },
};
