import economy from '../services/economy.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

export default {
  name: 'dih_coin',
  title: 'Dih Coin',
  type: 'consumable',
  price: 100,
  data: {
    description: 'A shiny coin that grants you 10 Dih when used.',
    value: 10,
  },
  async use(userId, guildId, quantity = 1) {
    const parsedQuantity = toBigInt(quantity, 'Quantity');
    const totalValue = BigInt(this.data.value) * parsedQuantity;
    await economy.updateBalance(userId, guildId, totalValue, 'dih-coin-reward');
    return {
      success: true,
      message: `You used ${formatMoney(parsedQuantity)} ${this.name} and got ${formatMoney(totalValue)} Dih.`,
    };
  },
};
