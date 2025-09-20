const { Collection } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const itemsService = require('../services/itemsService');

class ItemHandler {
    constructor() {
        this.items = new Collection();
    }

    async loadItems() {
        const itemsPath = path.join(__dirname, '..', 'items');
        try {
            // Get all items from database first
            const dbItems = await itemsService.getAllItems();
            const dbItemMap = new Map(dbItems.map(item => [item.name, item]));

            // Load items from files
            const itemFiles = await fs.readdir(itemsPath);
            const existingItemNames = new Set();

            for (const file of itemFiles) {
                if (!file.endsWith('.js')) continue;

                try {
                    const item = require(path.join(itemsPath, file));
                    this.items.set(item.name, item);
                    existingItemNames.add(item.name);

                    const dbItem = dbItemMap.get(item.name);
                    if (!dbItem) {
                        await itemsService.createItem(item);
                        console.log(`Loaded and created item: ${item.name}`);
                    }
                } catch (error) {
                    console.error(`Failed to load item ${file}:`, error);
                }
            }

            // Clean up orphaned items from database
            await this.cleanupOrphanedItems(dbItems, existingItemNames);

        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn('No items directory found. Skipping item loading.');
            } else {
                console.error('Error loading items:', error);
            }
        }
    }

    async cleanupOrphanedItems(dbItems, existingItemNames) {
        for (const dbItem of dbItems) {
            if (!existingItemNames.has(dbItem.name)) {
                try {
                    await itemsService.deleteItem(dbItem.id);
                    console.log(`Removed orphaned item from database: ${dbItem.name} (ID: ${dbItem.id})`);
                } catch (error) {
                    if (error.code === '23503') { // Foreign key violation
                        console.warn(`Could not remove item ${dbItem.name} (ID: ${dbItem.id}) as it is referenced in inventory`);
                    } else {
                        console.error(`Error removing orphaned item ${dbItem.name}:`, error);
                    }
                }
            }
        }
    }

    getItem(itemName) {
        return this.items.get(itemName);
    }
}

module.exports = ItemHandler;
