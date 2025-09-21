import { Collection } from 'discord.js';
import fs from 'fs/promises';
import logger from '../services/loggerService.js';
import path from 'path';
import { fileURLToPath } from 'url';
import itemsService from '../services/itemsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
                    const itemModule = await import(path.join(itemsPath, file));
                    const item = itemModule.default;
                    this.items.set(item.name, item);
                    existingItemNames.add(item.name);

                    const dbItem = dbItemMap.get(item.name);
                    if (!dbItem) {
                        await itemsService.createItem(item);
                        logger.discord.db(`Loaded and created item: ${item.name}`);
                    }
                } catch (error) {
                    logger.discord.cmdError(`Failed to load item ${file}:`, error);
                }
            }

            // Clean up orphaned items from database
            await this.cleanupOrphanedItems(dbItems, existingItemNames);

        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('No items directory found. Skipping item loading.');
            } else {
                logger.discord.cmdError('Error loading items:', error);
            }
        }
    }

    async cleanupOrphanedItems(dbItems, existingItemNames) {
        for (const dbItem of dbItems) {
            if (!existingItemNames.has(dbItem.name)) {
                try {
                    await itemsService.deleteItem(dbItem.id);
                    logger.discord.db(`Removed orphaned item from database: ${dbItem.name} (ID: ${dbItem.id})`);
                } catch (error) {
                    if (error.code === '23503') { // Foreign key violation
                        logger.warn(`Could not remove item ${dbItem.name} (ID: ${dbItem.id}) as it is referenced in inventory`);
                    } else {
                        logger.discord.dbError(`Error removing orphaned item ${dbItem.name}:`, error);
                    }
                }
            }
        }
    }

    getItem(itemName) {
        return this.items.get(itemName);
    }
}

export default ItemHandler;
