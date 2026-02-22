/**
 * @fileoverview Work command with selectable jobs and job-specific cooldowns.
 * @module commands/work
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import { formatMoney } from '../utils/moneyUtils.js';

const workConfig = CONFIG.COMMANDS.WORK;
const jobs = workConfig.JOBS;
const defaultJob = jobs[0];
const worksRequiredForJobChange = workConfig.WORKS_REQUIRED_FOR_JOB_CHANGE;
const workOperationLockKey = `${workConfig.STATE_KEY}OperationLockUntil`;
const workOperationLockMs = 8000;
const jobLookup = new Map();

for (const job of jobs) {
  jobLookup.set(job.id.toLowerCase(), job);
  jobLookup.set(job.name.toLowerCase().replace(/\s+/g, ''), job);
  for (const alias of job.aliases || []) {
    jobLookup.set(alias.toLowerCase(), job);
  }
}

function normalizeJobInput(input) {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getJobByInput(input) {
  return jobLookup.get(normalizeJobInput(input)) || null;
}

function getJobById(id) {
  if (!id || typeof id !== 'string') return defaultJob;
  return getJobByInput(id) || defaultJob;
}

function formatCooldown(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
}

function formatAcceptance(chance) {
  return chance >= 1 ? 'Always' : `${Math.round(chance * 100)}%`;
}

function randomBigIntInRange(min, max) {
  if (max <= min) return min;
  const span = Number(max - min + 1n);
  const roll = randomInt(span);
  return min + BigInt(roll);
}

function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function parseNonNegativeInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return 0;
}

async function getWorkState(userId, guildId) {
  const raw = await jsonbService.getKey(userId, guildId, workConfig.STATE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { currentJob: defaultJob.id, lastWorkAt: null, worksSinceJobChange: 0 };
  }

  const currentJob = getJobById(raw.currentJob).id;
  const lastWorkAt =
    typeof raw.lastWorkAt === 'string' && !Number.isNaN(Date.parse(raw.lastWorkAt))
      ? raw.lastWorkAt
      : null;
  const worksSinceJobChange = parseNonNegativeInteger(raw.worksSinceJobChange);

  return { currentJob, lastWorkAt, worksSinceJobChange };
}

async function setWorkState(userId, guildId, state) {
  await jsonbService.setKey(userId, guildId, workConfig.STATE_KEY, state);
}

class WorkCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'work',
      description: 'Work jobs, earn Dih, and apply for higher-tier jobs',
      category: 'Economy',
      usage: 'work [jobs|<job>]',
      cooldown: 0,
      aliases: ['job'],
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const input = args.join(' ').trim();

    if (!input) {
      const lock = await this.acquireOperationLock(userId, guildId);
      if (!lock.acquired) {
        return message.reply(
          'Your previous work action is still processing. Try again in a moment.'
        );
      }
      return this.runShift(message, userId, guildId);
    }

    const lowered = input.toLowerCase();
    if (lowered === 'jobs' || lowered === 'list') {
      return this.showJobs(message, userId, guildId);
    }

    const targetJob = getJobByInput(input);
    if (!targetJob) {
      return message.reply(
        `Invalid job. Use \`work jobs\` to view options.\nUsage: \`work\` or \`work <job>\``
      );
    }

    const lock = await this.acquireOperationLock(userId, guildId);
    if (!lock.acquired) {
      return message.reply('Your previous work action is still processing. Try again in a moment.');
    }

    return this.applyForJob(message, userId, guildId, targetJob);
  }

  async acquireOperationLock(userId, guildId) {
    const now = Date.now();
    let lock = await jsonbService.acquireTimedKey(
      userId,
      guildId,
      workOperationLockKey,
      now + workOperationLockMs,
      now
    );

    if (!lock.acquired && Number(lock.value ?? 0n) <= 0) {
      await jsonbService.setKey(userId, guildId, workOperationLockKey, 0);
      lock = await jsonbService.acquireTimedKey(
        userId,
        guildId,
        workOperationLockKey,
        now + workOperationLockMs,
        now
      );
    }

    return lock;
  }

  async showJobs(message, userId, guildId) {
    const workState = await getWorkState(userId, guildId);
    const currentJob = getJobById(workState.currentJob);
    const progress = `${workState.worksSinceJobChange}/${worksRequiredForJobChange}`;

    const lines = jobs.map((job, idx) => {
      const currentMark = job.id === currentJob.id ? ' (Current)' : '';
      return [
        `${idx + 1}. **${job.name}** (\`${job.id}\`)${currentMark}`,
        `Entry: ${formatMoney(job.entryFee)} cm | Cooldown: ${formatCooldown(job.cooldownMinutes)}`,
        `Acceptance: ${formatAcceptance(job.acceptanceChance)} | Pay: ${formatMoney(job.earnings.min)}-${formatMoney(job.earnings.max)} cm`,
      ].join('\n');
    });

    const embed = new EmbedBuilder()
      .setColor(workConfig.COLORS.INFO)
      .setTitle('💼 Job Board')
      .setDescription(
        `Job-change progress: **${progress} works**\nNeed **${worksRequiredForJobChange} works + entry fee** to switch jobs.\n\n${lines.join('\n\n')}`
      )
      .setFooter({ text: 'Use work <job> to apply. Entry fee is consumed on each application.' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  async applyForJob(message, userId, guildId, targetJob) {
    const workState = await getWorkState(userId, guildId);
    const currentJob = getJobById(workState.currentJob);

    if (targetJob.id === currentJob.id) {
      return message.reply(`You are already working as a ${targetJob.name}.`);
    }

    const hasRequiredWorks = workState.worksSinceJobChange >= worksRequiredForJobChange;
    const balance = await economy.getBalance(userId, guildId);
    const hasRequiredMoney = balance >= targetJob.entryFee;

    if (!hasRequiredWorks || !hasRequiredMoney) {
      const missingParts = [];
      if (!hasRequiredWorks) {
        missingParts.push(
          `Work requirement: ${workState.worksSinceJobChange}/${worksRequiredForJobChange}`
        );
      }
      if (!hasRequiredMoney) {
        missingParts.push(
          `Money requirement: ${formatMoney(balance)}/${formatMoney(targetJob.entryFee)} cm`
        );
      }

      return message.reply(
        `You cannot apply for **${targetJob.name}** yet.\n${missingParts.join('\n')}`
      );
    }

    if (targetJob.entryFee > 0n) {
      await economy.updateBalance(userId, guildId, -targetJob.entryFee, 'work-job-entry-fee');
    }

    const accepted = randomInt(1_000_000) / 1_000_000 < targetJob.acceptanceChance;
    if (accepted) {
      await setWorkState(userId, guildId, {
        currentJob: targetJob.id,
        lastWorkAt: null,
        worksSinceJobChange: 0,
      });
    }

    const newBalance = await economy.getBalance(userId, guildId);
    const embed = new EmbedBuilder()
      .setColor(accepted ? workConfig.COLORS.SUCCESS : workConfig.COLORS.WARNING)
      .setTitle(accepted ? '🎉 Application Accepted' : '❌ Application Denied')
      .setDescription(
        accepted
          ? `You paid ${formatMoney(targetJob.entryFee)} cm and got hired as **${targetJob.name}**.\nYour work cooldown has been reset.`
          : `You paid ${formatMoney(targetJob.entryFee)} cm to apply for **${targetJob.name}**, but you were denied.\nYou keep your current job: **${currentJob.name}**.\nWork progress is kept at **${workState.worksSinceJobChange}/${worksRequiredForJobChange}**.`
      )
      .addFields(
        { name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true },
        {
          name: 'Job Change Progress',
          value: accepted
            ? `0/${worksRequiredForJobChange}`
            : `${workState.worksSinceJobChange}/${worksRequiredForJobChange}`,
          inline: true,
        }
      )
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  async runShift(message, userId, guildId) {
    const workState = await getWorkState(userId, guildId);
    const currentJob = getJobById(workState.currentJob);
    const now = Date.now();
    const lastWorkMs = workState.lastWorkAt ? Date.parse(workState.lastWorkAt) : 0;
    const cooldownMs = currentJob.cooldownMinutes * 60 * 1000;
    const elapsed = now - lastWorkMs;

    if (lastWorkMs > 0 && elapsed < cooldownMs) {
      const remainingMs = cooldownMs - elapsed;
      const availableAt = Math.floor((now + remainingMs) / 1000);
      const embed = new EmbedBuilder()
        .setColor(workConfig.COLORS.ERROR)
        .setTitle('⏰ Work Cooldown Active')
        .setDescription(
          `You are currently working as **${currentJob.name}**.\nTry again <t:${availableAt}:R> (${formatRemaining(remainingMs)}).`
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    const payout = randomBigIntInRange(currentJob.earnings.min, currentJob.earnings.max);
    await economy.updateBalance(userId, guildId, payout, `work-${currentJob.id}`);
    await setWorkState(userId, guildId, {
      currentJob: currentJob.id,
      lastWorkAt: new Date(now).toISOString(),
      worksSinceJobChange: workState.worksSinceJobChange + 1,
    });

    const newBalance = await economy.getBalance(userId, guildId);
    const newWorkProgress = workState.worksSinceJobChange + 1;
    const embed = new EmbedBuilder()
      .setColor(workConfig.COLORS.SUCCESS)
      .setTitle('💼 Shift Complete')
      .setDescription(
        `You worked as **${currentJob.name}** and earned **${formatMoney(payout)} cm**.`
      )
      .addFields(
        { name: 'Job', value: currentJob.name, inline: true },
        { name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true },
        {
          name: 'Next Work',
          value: `In ${formatCooldown(currentJob.cooldownMinutes)}`,
          inline: true,
        },
        {
          name: 'Job Change Progress',
          value: `${newWorkProgress}/${worksRequiredForJobChange}`,
          inline: true,
        }
      )
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
}

export default WorkCommand;
