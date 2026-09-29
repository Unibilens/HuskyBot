import type { ShardDB } from '@activityrank/database';
import type { BaseInteraction, Entitlement, GuildMember } from 'discord.js';
import { getRoleModel } from '#bot/models/guild/guildRoleModel.ts';
import { PREMIUM_SKU_ID } from '#bot/util/constants.ts';
import { getUserModel } from '../bot/models/userModel.ts';

export function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function hasNoXpRole(member: GuildMember) {
  for (const role of member.roles.cache.values()) {
    const cachedRole = await getRoleModel(role);
    if (cachedRole.db.noXp) return true;
  }
  return false;
}

/**
 * An object describing the entries that should be provided to a page.
 */
export interface Pagination {
  /** The page to display. Indexed from 1. */
  page: number;
  /** The index of the first entry to display. */
  from: number;
  /** The index of the last entry to display. */
  to: number;
}

export function extractPageSimple(page: number, entriesPerPage: number): Pagination {
  const from = Math.max((page - 1) * entriesPerPage + 1);
  const to = page * entriesPerPage;
  return { page, from, to };
}

export function getLevel(levelProgression: number) {
  return Math.floor(levelProgression);
}

export function getLevelProgression(totalScore: number, levelFactor: number) {
  return (solve(levelFactor / 2, levelFactor / 2 + 100, -totalScore) ?? 0) + 1;
}

function solve(a: number, b: number, c: number) {
  const result = (-1 * b + Math.sqrt(b ** 2 - 4 * a * c)) / (2 * a);
  const result2 = (-1 * b - Math.sqrt(b ** 2 - 4 * a * c)) / (2 * a);

  if (result >= 0) return result;
  if (result2 >= 0) return result2;
  return null;
}

export function hasValidEntitlement(_interaction: BaseInteraction<'cached'>) {
  // Premium checks disabled - all servers have access
  return true;
}

export async function getPatreonTiers(interaction: BaseInteraction<'cached'>) {
  // Always return the highest tier for everyone
  return { userTier: 3, ownerTier: 3 };
}

export function getVoteMultiplier(dbUser: ShardDB.User): number {
  return 3;
}

export function getPatreonTierName(tier: number) {
  if (tier === 3) return 'Serveradmin';
  if (tier === 2) return 'Poweruser';
  if (tier === 1) return 'Supporter';
  return 'No tier';
}

export function formatVoiceTime(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.floor(totalMinutes % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}

export default {
  sleep,
  hasNoXpRole,
  extractPageSimple,
  getLevel,
  getLevelProgression,
  getPatreonTiers,
  getPatreonTierName,
  formatVoiceTime,
};
