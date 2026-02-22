/**
 * @fileoverview Embed-related configuration settings
 * @module config/embed/config
 */

import { Colors } from 'discord.js';

export default {
  COLORS: {
    AI_LOADING: Colors.Blue,
    AI_RESPONSE: Colors.Green,
    IMAGE_LOADING: Colors.Purple,
    ERROR: Colors.Red,
    WARNING: Colors.Yellow,
    DEFAULT: Colors.Blurple,
    SUCCESS: Colors.Green,
    ULTRA_GROWTH: Colors.Gold,
  },
  EMBED: {
    AI_TITLE: 'Zears AI H',
    IMAGE_TITLE: 'Zears AI Image Gen',
    AI_LOADING: 'Processing your query with zears ai h',
    ERROR_AI: 'Ts is having no.',
    ERROR_IMAGE_PREFIX: 'Failed to generate image. Error: ',
    EMPTY_QUERY: 'What am i supposed to do nga?',
    EMPTY_IMAGE_PROMPT: 'What do you want me to generate nga?',
  },
};
