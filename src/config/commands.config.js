/**
 * @fileoverview Combined command configurations
 * @module config/commands.config
 */

const fs = require('fs');
const path = require('path');

// Get all command config files from the commands directory
const commandsDir = path.join(__dirname, 'commands');
const commandConfigs = {};

// Read all .js files in the commands directory
fs.readdirSync(commandsDir)
  .filter(file => file.endsWith('.js'))
  .forEach(file => {
    // Get the name without extension, preserving original case
    const name = file.replace('.js', '').toUpperCase();
    // Import the config file
    const config = require(path.join(commandsDir, file));
    // Add to our configs object, using the config directly
    commandConfigs[name] = config;
  });

module.exports = commandConfigs; 