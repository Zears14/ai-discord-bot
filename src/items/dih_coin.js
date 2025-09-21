import economy from '../services/economy.js';

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
    const totalValue = this.data.value * quantity;
    await economy.updateBalance(userId, guildId, totalValue, 'dih-coin-reward');
    return {
      success: true,
      message: `You used ${quantity} ${this.name} and got ${totalValue} Dih.`,
    };
  },
};
