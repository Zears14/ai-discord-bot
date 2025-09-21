import pg from 'pg';
const { Pool } = pg;
import historyService from './historyService.js';
import itemsService from './itemsService.js';

let itemHandler;

function init(handler) {
  itemHandler = handler;
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URI,
});

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
  const query = `
        INSERT INTO inventory (userid, guildid, itemid, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (userid, guildid, itemid)
        DO UPDATE SET quantity = inventory.quantity + $4
        RETURNING *;
    `;
  const values = [userId, guildId, itemId, quantity];
  const res = await pool.query(query, values);
  return res.rows[0];
}

async function removeItemFromInventory(userId, guildId, itemId, quantity = 1) {
  const currentItem = await pool.query(
    'SELECT quantity FROM inventory WHERE userid = $1 AND guildid = $2 AND itemid = $3',
    [userId, guildId, itemId]
  );

  if (currentItem.rowCount === 0 || currentItem.rows[0].quantity < quantity) {
    throw new Error('Not enough items to remove.');
  }

  if (currentItem.rows[0].quantity === quantity) {
    const query =
      'DELETE FROM inventory WHERE userid = $1 AND guildid = $2 AND itemid = $3 RETURNING *;';
    const res = await pool.query(query, [userId, guildId, itemId]);
    return res.rows[0];
  } else {
    const query = `
            UPDATE inventory
            SET quantity = quantity - $4
            WHERE userid = $1 AND guildid = $2 AND itemid = $3
            RETURNING *;
        `;
    const values = [userId, guildId, itemId, quantity];
    const res = await pool.query(query, values);
    return res.rows[0];
  }
}

async function hasItem(userId, guildId, itemId, quantity = 1) {
  const query =
    'SELECT quantity FROM inventory WHERE userid = $1 AND guildid = $2 AND itemid = $3;';
  const res = await pool.query(query, [userId, guildId, itemId]);
  if (res.rowCount === 0) {
    return false;
  }
  return res.rows[0].quantity >= quantity;
}

async function useItem(userId, guildId, itemId, quantity = 1) {
  const userHasItem = await hasItem(userId, guildId, itemId, quantity);
  if (!userHasItem) {
    return { success: false, message: "You don't have enough of this item." };
  }

  const item = await itemsService.getItemById(itemId);
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
    itemid: itemId,
    amount: quantity,
  });

  if (item.type === 'consumable') {
    await removeItemFromInventory(userId, guildId, itemId, quantity);
  }

  return itemDefinition.use(userId, guildId, quantity);
}

export default {
  init,
  getInventory,
  addItemToInventory,
  removeItemFromInventory,
  hasItem,
  useItem,
};
