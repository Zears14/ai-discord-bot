/**
 * @fileoverview Configuration for gokys command
 * @module config/commands/gokys
 */

export default {
  COOLDOWN_KEY: 'gokysCooldownUntil',
  ACTION_COOLDOWN_SECONDS: 600, // 10 minutes
  SUCCESS_ONE_IN: 1000000, // 0.0001%
  DEATH_LOSS_MIN_PERCENT: 25,
  DEATH_LOSS_MAX_PERCENT: 75,
  SITES: [
    'You open a cursed command prompt and whisper bad ideas into it.',
    'You type with full confidence and absolutely no survival instinct.',
    'You invoke ancient meme magic in the middle of chat.',
    'You stand in front of everyone and press the red button.',
  ],
  ACTIONS: [
    'You commit to the bit and hit enter...',
    'You point at your target and let fate handle the rest...',
    'You roll cosmic dice that clearly hate you...',
    'You trigger the trap and hope statistics are optional...',
  ],
  SUCCESS_MESSAGES: [
    'Reality glitched for a second and your target got folded.',
    'The impossible happened. Your target got nuked from orbit.',
    'Every law of probability failed. Your target is gone.',
  ],
  FAIL_MESSAGES: [
    'The command was a trap. You deleted yourself instead.',
    'Karma speedran and you got clapped instantly.',
    'The universe laughed and reflected the damage to you.',
    'Critical backfire. You played yourself.',
  ],
};
