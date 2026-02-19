import economy from '../services/economy.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

function randomPerItemReward() {
  const min = 1500n;
  const max = 12000n;
  const spread = Number(max - min + 1n);
  return min + BigInt(Math.floor(Math.random() * spread));
}

export default {
  name: 'vault_key',
  title: 'Vault Key',
  type: 'consumable',
  price: 8000,
  data: {
    description: 'A high-roller key that unlocks a random cash stash.',
  },
  async use(userId, guildId, quantity = 1) {
    const parsedQuantity = toBigInt(quantity, 'Quantity');
    const perItem = randomPerItemReward();
    const totalValue = perItem * parsedQuantity;
    await economy.updateBalance(userId, guildId, totalValue, 'vault-key-reward');
    return {
      success: true,
      message: `You used ${formatMoney(parsedQuantity)} vault key(s) and received ${formatMoney(totalValue)} Dih.`,
    };
  },
};
