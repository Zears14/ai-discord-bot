/**
 * @fileoverview Combined command configurations
 * @module config/commands.config
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get all command config files from the commands directory
const commandsDir = path.join(__dirname, 'commands');
const commandConfigs = {};

const loadCommandConfigs = async () => {
  const files = await fs.readdir(commandsDir);
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const name = file.replace('.js', '').toUpperCase();
    const configModule = await import(path.join(commandsDir, file));
    commandConfigs[name] = configModule.default;
  }
};

await loadCommandConfigs();

export default commandConfigs;
