/**
 * @fileoverview Configuration for work command
 * @module config/commands/work
 */

import { Colors } from 'discord.js';

export default {
  STATE_KEY: 'workState',
  WORKS_REQUIRED_FOR_JOB_CHANGE: 20,

  JOBS: [
    {
      id: 'beggar',
      name: 'Beggar',
      aliases: ['beg'],
      entryFee: 0n,
      cooldownMinutes: 10,
      acceptanceChance: 1,
      earnings: {
        min: 8n,
        max: 22n,
      },
    },
    {
      id: 'dishwasher',
      name: 'Dishwasher',
      aliases: ['dish'],
      entryFee: 400n,
      cooldownMinutes: 15,
      acceptanceChance: 0.9,
      earnings: {
        min: 20n,
        max: 55n,
      },
    },
    {
      id: 'cashier',
      name: 'Cashier',
      aliases: ['retail'],
      entryFee: 1500n,
      cooldownMinutes: 25,
      acceptanceChance: 0.78,
      earnings: {
        min: 60n,
        max: 140n,
      },
    },
    {
      id: 'mechanic',
      name: 'Mechanic',
      aliases: ['tech'],
      entryFee: 6000n,
      cooldownMinutes: 40,
      acceptanceChance: 0.65,
      earnings: {
        min: 170n,
        max: 360n,
      },
    },
    {
      id: 'developer',
      name: 'Developer',
      aliases: ['dev'],
      entryFee: 20000n,
      cooldownMinutes: 60,
      acceptanceChance: 0.55,
      earnings: {
        min: 420n,
        max: 920n,
      },
    },
    {
      id: 'executive',
      name: 'Executive',
      aliases: ['ceo'],
      entryFee: 75000n,
      cooldownMinutes: 120,
      acceptanceChance: 0.45,
      earnings: {
        min: 1200n,
        max: 2800n,
      },
    },
  ],

  COLORS: {
    INFO: Colors.Blurple,
    SUCCESS: Colors.Green,
    WARNING: Colors.Orange,
    ERROR: Colors.Red,
  },
};
