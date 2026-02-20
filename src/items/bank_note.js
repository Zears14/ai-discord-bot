import economy from '../services/economy.js';
import levelService from '../services/levelService.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

export default {
  name: 'bank_note',
  title: 'Bank Note',
  type: 'consumable',
  price: 1000,
  data: {
    description: 'Expands your max bank storage based on your current cap and level.',
  },
  async use(userId, guildId, quantity = 1) {
    const parsedQuantity = toBigInt(quantity, 'Quantity');
    const levelData = await levelService.getLevelData(userId, guildId);

    try {
      const upgrade = await economy.expandBankCapacity(
        userId,
        guildId,
        parsedQuantity,
        levelData.level
      );

      return {
        success: true,
        message:
          `You used ${formatMoney(parsedQuantity)} bank note(s) at level ${upgrade.level}.\n` +
          `Bank max increased by ${formatMoney(upgrade.totalIncrease)} cm ` +
          `to ${formatMoney(upgrade.bankMax)} cm.`,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Bank note use failed.',
      };
    }
  },
};
