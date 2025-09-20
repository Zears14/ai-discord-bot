/**
 * @fileoverview Base command class that all commands extend from
 * @module commands/BaseCommand
 */

import CONFIG from '../config/config.js';

class BaseCommand {
  constructor(client, {
    name = null,
    description = 'No description provided.',
    category = 'Miscellaneous',
    usage = 'No usage provided.',
    enabled = true,
    cooldown = CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
    aliases = [],
    permissions = []
  }) {
    this.client = client;
    this.name = name;
    this.description = description;
    this.category = category;
    this.usage = usage;
    this.enabled = enabled;
    this.cooldown = cooldown;
    this.aliases = aliases;
    this.permissions = permissions;
  }

  async execute(message, args) {
    throw new Error(`${this.name} doesn't have an execute method!`);
  }
}

export default BaseCommand; 