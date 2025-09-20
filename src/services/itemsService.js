import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.POSTGRES_URI,
});

async function createItem(item) {
    const { name, title, type, price, data } = item;
    const query = `
        INSERT INTO items (name, title, type, price, data)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
    `;
    const values = [name, title, type, price, data || {}];
    const res = await pool.query(query, values);
    return res.rows[0];
}

async function getItemById(id) {
    const query = 'SELECT * FROM items WHERE id = $1;';
    const res = await pool.query(query, [id]);
    return res.rows[0];
}

async function getItemByName(name) {
    const query = 'SELECT * FROM items WHERE name = $1;';
    const res = await pool.query(query, [name]);
    return res.rows[0];
}

async function updateItem(id, updates) {
    const item = await getItemById(id);
    if (!item) {
        return null;
    }

    const updatedItem = { ...item, ...updates };
    const { name, title, type, price, data } = updatedItem;

    const query = `
        UPDATE items
        SET name = $1, title = $2, type = $3, price = $4, data = $5
        WHERE id = $6
        RETURNING *;
    `;
    const values = [name, title, type, price, data, id];
    const res = await pool.query(query, values);
    return res.rows[0];
}

async function deleteItem(id) {
    const query = 'DELETE FROM items WHERE id = $1 RETURNING *;';
    const res = await pool.query(query, [id]);
    return res.rows[0];
}

async function getAllItems() {
    const query = 'SELECT * FROM items;';
    const res = await pool.query(query);
    return res.rows;
}

export default {
    createItem,
    getItemById,
    getItemByName,
    updateItem,
    deleteItem,
    getAllItems,
};
