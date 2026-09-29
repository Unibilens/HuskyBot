import type { Client, Guild, GuildBasedChannel, GuildMember, VoiceBasedChannel } from 'discord.js';
import { shards } from '#models/shardDb/shardDb.ts';
import type { StatType } from '#models/types/enums.ts';
import {
  checkLevelup,
  getNewMemberRoles,
  runRoleUpdate,
  sendLevelupMessage,
} from './levelManager.ts';
import { getMemberModel, memberCache } from './models/guild/guildMemberModel.ts';
import { type GuildModel, getGuildModel } from './models/guild/guildModel.ts';
import { voiceSessions } from './util/voiceSessionCache.ts';
import { addXp } from './xpFlushCache.ts';

async function getXpMultiplier(
  member: GuildMember,
  roleIds: string[],
  guildModel: GuildModel,
  key: 'xpPerTextMessage' | 'xpPerVoiceMinute' | 'xpPerInvite' | 'xpPerVote',
): Promise<number> {
  // sentinel value: gets replaced with the guild default at the end of the function
  // This allows role overrides lower than the guild default to be applied
  let highestXpValue = 0;

  // TODO: refactor to use cached value
  const roles = await shards
    .get(guildModel.dbHost)
    .db.selectFrom('guildRole')
    .select(['roleId', key])
    .where('guildId', '=', member.guild.id)
    .where('roleId', 'in', roleIds)
    .where((w) =>
      w.or([
        w('xpPerTextMessage', '!=', 0),
        w('xpPerVoiceMinute', '!=', 0),
        w('xpPerInvite', '!=', 0),
        w('xpPerVote', '!=', 0),
      ]),
    )
    .execute();

  for (const role of roles) {
    if (role.roleId === member.guild.id) continue;
    if (role[key] <= highestXpValue) continue;
    highestXpValue = role[key];
  }

  // if a custom value has been set, return it. Otherwise, return the server default.
  let finalMultiplier = highestXpValue > 0 ? highestXpValue : guildModel.db[key];

  if (guildModel.db.guildTagEnabled && guildModel.db.guildTagRoleId) {
    if (member.roles.cache.has(guildModel.db.guildTagRoleId)) {
      finalMultiplier *= guildModel.db.guildTagMultiplier;
    }
  }

  return finalMultiplier;
}

export async function addTextMessage(
  member: GuildMember,
  // not textBased because forums can be ranked
  channel: GuildBasedChannel,
  count: number,
) {
  // Add to FlushCache
  const textMessageCache = await buildStatFlushCache(member.client, member.guild, 'textMessage');

  const cachedGuild = await getGuildModel(member.guild);

  let entry = textMessageCache[member.id + channel.id];
  if (!entry)
    entry = textMessageCache[member.id + channel.id] = {
      guildId: member.guild.id,
      userId: member.id,
      channelId: channel.id,
      count: count,
    };
  else entry.count += count;

  const xpMultiplier = await getXpMultiplier(
    member,
    [...member.roles.cache.keys()],
    cachedGuild,
    'xpPerTextMessage',
  );

  await addTotalXp(member, count * xpMultiplier);

  if (Number.parseInt(cachedGuild.db.bonusUntilDate) > Date.now() / 1000)
    await addBonus(member, count * cachedGuild.db.bonusPerTextMessage);
}

export async function addVoiceMinute(
  member: GuildMember,
  channel: VoiceBasedChannel,
  count: number,
) {
  // Add to FlushCache
  const voiceMinuteCache = await buildStatFlushCache(member.client, member.guild, 'voiceMinute');

  const cachedGuild = await getGuildModel(member.guild);

  let entry = voiceMinuteCache[member.id + channel.id];
  if (!entry)
    entry = voiceMinuteCache[member.id + channel.id] = {
      guildId: member.guild.id,
      userId: member.id,
      channelId: channel.id,
      count: count,
    };
  else entry.count += count;

  const xpMultiplier = await getXpMultiplier(
    member,
    [...member.roles.cache.keys()],
    cachedGuild,
    'xpPerVoiceMinute',
  );

  await addTotalXp(member, count * xpMultiplier);

  const session = voiceSessions.get(member.id);
  if (session) {
    session.minutesEarned += count;
    session.xpEarned += count * xpMultiplier;
    session.baseXpPerMinute = cachedGuild.db.xpPerVoiceMinute;
    session.finalMultiplier = xpMultiplier;
  }

  if (Number.parseInt(cachedGuild.db.bonusUntilDate) > Date.now() / 1000)
    await addBonus(member, count * cachedGuild.db.bonusPerVoiceMinute);
}

export const addInvite = async (member: GuildMember, count: number) => {
  const inviteCache = await buildStatFlushCache(member.client, member.guild, 'invite');

  const cachedGuild = await getGuildModel(member.guild);

  let entry = inviteCache[member.id];
  if (!entry)
    entry = inviteCache[member.id] = {
      guildId: member.guild.id,
      userId: member.id,
      count: count,
    };
  else entry.count += count;

  const xpMultiplier = await getXpMultiplier(
    member,
    [...member.roles.cache.keys()],
    cachedGuild,
    'xpPerInvite',
  );

  await addTotalXp(member, count * xpMultiplier);

  if (Number.parseInt(cachedGuild.db.bonusUntilDate) > Date.now() / 1000)
    await addBonus(member, count * cachedGuild.db.bonusPerInvite);
};

export const addVote = async (member: GuildMember, count: number) => {
  const voteCache = await buildStatFlushCache(member.client, member.guild, 'vote');

  const cachedGuild = await getGuildModel(member.guild);

  let entry = voteCache[member.id];
  if (!entry)
    entry = voteCache[member.id] = {
      guildId: member.guild.id,
      userId: member.id,
      count: count,
    };
  else entry.count += count;

  const xpMultiplier = await getXpMultiplier(
    member,
    [...member.roles.cache.keys()],
    cachedGuild,
    'xpPerVote',
  );

  await addTotalXp(member, count * xpMultiplier);

  if (Number.parseInt(cachedGuild.db.bonusUntilDate) > Date.now() / 1000)
    await addBonus(member, count * cachedGuild.db.bonusPerVote);
};

export const addBonus = async (member: GuildMember, count: number) => {
  const bonusCache = await buildStatFlushCache(member.client, member.guild, 'bonus');

  const cachedGuild = await getGuildModel(member.guild);

  let entry = bonusCache[member.id];
  if (!entry)
    entry = bonusCache[member.id] = {
      guildId: member.guild.id,
      userId: member.id,
      count: count,
    };
  else entry.count += count;

  await addTotalXp(member, count * cachedGuild.db.xpPerBonus);
};

const addTotalXp = async (member: GuildMember, xp: number, silent = false) => {
  const cachedMember = await getMemberModel(member);

  const oldTotalXp = cachedMember.cache.totalXp ?? 0;
  const newTotalXp = oldTotalXp + xp;
  cachedMember.cache.totalXp = newTotalXp;

  // add XP to the guildMember table
  await addXp(member, xp);

  const { isLevelup, newLevel } = await checkLevelup(member.guild, oldTotalXp, newTotalXp);
  if (isLevelup) {
    const newRoles = await getNewMemberRoles(member, newLevel);
    if (!silent) await sendLevelupMessage(member, newLevel, newRoles);
    await runRoleUpdate(member, newLevel, newRoles);
  }
};

/**
 * Adds bonus XP to a member silently (no level-up messages).
 * Updates both the bonus stat and the member's total XP/level roles.
 * The given count is added as-is with no multiplier, so all members receive equal XP.
 *
 * For mass operations prefer {@link batchAddBonus} which is far more efficient.
 */
export const directlyAddBonus = async (member: GuildMember, count: number) => {
  const bonusCache = await buildStatFlushCache(member.client, member.guild, 'bonus');

  let entry = bonusCache[member.id];
  if (!entry)
    entry = bonusCache[member.id] = { guildId: member.guild.id, userId: member.id, count };
  else entry.count += count;

  await addTotalXp(member, count, true);
};

/**
 * Efficiently applies bonus XP to a large set of members at once.
 *
 * Instead of hitting the DB once per member, this function:
 *   1. Fetches all members' current XP in **one** bulk `IN` query.
 *   2. Writes to the in-memory bonus and XP flush caches synchronously.
 *   3. Runs level-up checks & role updates in concurrent batches.
 *
 * Level-up messages are intentionally suppressed to avoid Discord rate-limits.
 */
export const batchAddBonus = async (
  members: Set<GuildMember>,
  count: number,
  /** Called periodically so callers can update a progress indicator. */
  onProgress?: (done: number, total: number) => void,
): Promise<number> => {
  if (members.size === 0) return 0;

  const memberArray = [...members];
  const first = memberArray[0];
  const { guild } = first;

  for (const member of memberArray) {
    if (member.guild.id !== guild.id || member.client !== first.client) {
      throw new Error('batchAddBonus expects all members to belong to the same guild/client');
    }
  }

  const guildModel = await getGuildModel(guild);
  const { dbHost } = guildModel;
  const db = shards.get(dbHost).db;

  // ── 1. Fetch current XP for all members in chunked queries ──────────────
  const DB_CHUNK_SIZE = 2_000;
  const memberIds = memberArray.map((m) => m.id);
  const rows: { userId: string; alltime: number | null }[] = [];

  for (let i = 0; i < memberIds.length; i += DB_CHUNK_SIZE) {
    const chunkIds = memberIds.slice(i, i + DB_CHUNK_SIZE);
    const chunkRows = await db
      .selectFrom('guildMember')
      .select(['userId', 'alltime'])
      .where('guildId', '=', guild.id)
      .where('userId', 'in', chunkIds)
      .execute();
    rows.push(...chunkRows);
  }

  const currentXpMap = new Map<string, number>(rows.map((r) => [r.userId, r.alltime ?? 0]));

  // ── 2. Write to in-memory caches synchronously (no DB calls) ─────────────
  const { statFlushCache, xpFlushCache } = first.client;

  if (!statFlushCache[dbHost])
    statFlushCache[dbHost] = { textMessage: {}, voiceMinute: {}, invite: {}, vote: {}, bonus: {} };
  const bonusCache = statFlushCache[dbHost].bonus;

  if (!xpFlushCache[dbHost]) xpFlushCache[dbHost] = {};
  const xpCache = xpFlushCache[dbHost];

  for (const member of memberArray) {
    // bonus cache
    const bEntry = bonusCache[member.id];
    if (!bEntry) bonusCache[member.id] = { guildId: guild.id, userId: member.id, count };
    else bEntry.count += count;

    // xp flush cache
    const xpKey = `${guild.id}.${member.id}`;
    const xEntry = xpCache[xpKey];
    if (!xEntry) xpCache[xpKey] = { guildId: guild.id, userId: member.id, count };
    else xEntry.count += count;
  }

  // ── 3. Level-up checks & role updates in parallel batches ───────────────
  const BATCH_SIZE = 50;
  let done = 0;

  for (let i = 0; i < memberArray.length; i += BATCH_SIZE) {
    const batch = memberArray.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (member) => {
        const cached = memberCache.get(member);
        const oldXp = cached?.cache.totalXp ?? (currentXpMap.get(member.id) ?? 0);
        const newXp = oldXp + count;

        // update member model cache if it's already warm
        if (cached) cached.cache.totalXp = newXp;

        const { isLevelup, newLevel } = await checkLevelup(guild, oldXp, newXp);
        if (isLevelup) {
          const newRoles = await getNewMemberRoles(member, newLevel);
          // Only update roles if they actually differ, avoiding unnecessary Discord PATCH requests
          const currentRoleIds = new Set(member.roles.cache.keys());
          const rolesChanged =
            newRoles.length !== currentRoleIds.size ||
            newRoles.some((r) => !currentRoleIds.has(r));

          if (rolesChanged) {
            // silent: no level-up message to avoid Discord rate-limits
            await runRoleUpdate(member, newLevel, newRoles);
          }
        }
      }),
    );

    done += batch.length;
    onProgress?.(done, memberArray.length);
  }

  return memberArray.length;
};

export interface StatFlushCacheGuildEntry {
  guildId: string;
  userId: string;
  count: number;
}
export interface StatFlushCacheChannelEntry extends StatFlushCacheGuildEntry {
  channelId: string;
}
export interface StatFlushCache {
  textMessage: Record<string, StatFlushCacheChannelEntry>;
  voiceMinute: Record<string, StatFlushCacheChannelEntry>;
  invite: Record<string, StatFlushCacheGuildEntry>;
  vote: Record<string, StatFlushCacheGuildEntry>;
  bonus: Record<string, StatFlushCacheGuildEntry>;
}

const buildStatFlushCache = async (client: Client, guild: Guild, type: StatType) => {
  const { dbHost } = await getGuildModel(guild);
  const { statFlushCache } = client;

  if (!Object.keys(statFlushCache).includes(dbHost))
    statFlushCache[dbHost] = {
      textMessage: {},
      voiceMinute: {},
      invite: {},
      vote: {},
      bonus: {},
    };

  return statFlushCache[dbHost][type];
};

export default {
  addTextMessage,
  addVoiceMinute,
  addInvite,
  addVote,
  addBonus,
  directlyAddBonus,
  batchAddBonus,
};
