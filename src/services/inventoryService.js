import pg from 'pg';
import './pgTypeParsers.js';
const { Pool } = pg;
import { createPoolConfig } from './dbConfig.js';
import historyService from './historyService.js';
import itemsService from './itemsService.js';
import { parsePositiveAmount, toBigInt } from '../utils/moneyUtils.js';

let itemHandler;

function init(handler) {
  itemHandler = handler;
}

const pool = new Pool(createPoolConfig());

async function getInventory(userId, guildId) {
  const query = `
        SELECT i.itemid, i.quantity, i.meta, it.name, it.title, it.type, it.price, it.data
        FROM inventory i
        JOIN items it ON i.itemid = it.id
        WHERE i.userid = $1 AND i.guildid = $2;
    `;
  const res = await pool.query(query, [userId, guildId]);
  return res.rows;
}

async function addItemToInventory(userId, guildId, itemId, quantity = 1) {
  const parsedItemId = toBigInt(itemId, 'Item ID');
  const parsedQuantity = parsePositiveAmount(quantity, 'Quantity');
  const query = `
        INSERT INTO inventory (userid, guildid, itemid, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (userid, guildid, itemid)
        DO UPDATE SET quantity = inventory.quantity + $4
        RETURNING *;
    `;
  const values = [userId, guildId, parsedItemId, parsedQuantity];
  const res = await pool.query(query, values);
  return res.rows[0];
}

async function removeItemFromInventory(userId, guildId, itemId, quantity = 1) {
  const parsedItemId = toBigInt(itemId, 'Item ID');
  const parsedQuantity = parsePositiveAmount(quantity, 'Quantity');
  const currentItem = await pool.query(
    'SELECT quantity FROM inventory WHERE userid = $1 AND guildid = $2 AND itemid = $3',
    [userId, guildId, parsedItemId]
  );

  if (currentItem.rowCount === 0 || currentItem.rows[0].quantity < parsedQuantity) {
    throw new Error('Not enough items to remove.');
  }

  if (currentItem.rows[0].quantity === parsedQuantity) {
    const query =
      'DELETE FROM inventory WHERE userid = $1 AND guildid = $2 AND itemid = $3 RETURNING *;';
    const res = await pool.query(query, [userId, guildId, parsedItemId]);
    return res.rows[0];
  } else {
    const query = `
            UPDATE inventory
            SET quantity = quantity - $4
            WHERE userid = $1 AND guildid = $2 AND itemid = $3
            RETURNING *;
        `;
    const values = [userId, guildId, parsedItemId, parsedQuantity];
    const res = await pool.query(query, values);
    return res.rows[0];
  }
}

async function hasItem(userId, guildId, itemId, quantity = 1) {
  const parsedItemId = toBigInt(itemId, 'Item ID');
  const parsedQuantity = parsePositiveAmount(quantity, 'Quantity');
  const query =
    'SELECT quantity FROM inventory WHERE userid = $1 AND guildid = $2 AND itemid = $3;';
  const res = await pool.query(query, [userId, guildId, parsedItemId]);
  if (res.rowCount === 0) {
    return false;
  }
  return res.rows[0].quantity >= parsedQuantity;
}

async function useItem(userId, guildId, itemId, quantity = 1) {
  const parsedItemId = toBigInt(itemId, 'Item ID');
  const parsedQuantity = parsePositiveAmount(quantity, 'Quantity');
  const userHasItem = await hasItem(userId, guildId, parsedItemId, parsedQuantity);
  if (!userHasItem) {
    return { success: false, message: "You don't have enough of this item." };
  }

  const item = await itemsService.getItemById(parsedItemId);
  if (!item) {
    return { success: false, message: 'Item not found.' };
  }

  const itemDefinition = itemHandler.getItem(item.name);
  if (!itemDefinition || !itemDefinition.use) {
    return { success: false, message: `${item.name} cannot be used.` };
  }

  // Log the item usage
  await historyService.addHistory({
    userid: userId,
    guildid: guildId,
    type: 'use-item',
    itemid: parsedItemId,
    amount: parsedQuantity,
  });

  if (item.type === 'consumable') {
    await removeItemFromInventory(userId, guildId, parsedItemId, parsedQuantity);
  }

  return itemDefinition.use(userId, guildId, parsedQuantity);
}

export default {
  init,
  getInventory,
  addItemToInventory,
  removeItemFromInventory,
  hasItem,
  useItem,
};
