import { type GuildMember, PermissionFlagsBits } from 'discord.js';
import { DANGEROUS_PERMISSIONS } from '#bot/levelManager.ts';
import { getGuildModel } from '#bot/models/guild/guildModel.ts';

export interface CheckGuildTagOptions {
  /** When true, do not send welcome DM (e.g. during bulk scans) */
  skipDm?: boolean;
  /** When true, only add roles, do not remove roles */
  onlyAdd?: boolean;
}

/**
 * Extracts clan / primary guild data from raw websocket packets or the GuildMember.user object.
 *
 * Crucially distinguishes between:
 * - `object`: user has a clan
 * - `null`: user explicitly has NO clan / removed primary guild
 * - `undefined`: clan data was NOT present in this event or context
 */
export function getClanData(member: GuildMember, rawData?: any): any {
  // 1. Raw websocket packet takes priority when present (real-time gateway payload)
  if (rawData) {
    if (rawData.user && 'primary_guild' in rawData.user) return rawData.user.primary_guild;
    if (rawData.user && 'primaryGuild' in rawData.user) return rawData.user.primaryGuild;
    if ('primary_guild' in rawData) return rawData.primary_guild;
    if ('primaryGuild' in rawData) return rawData.primaryGuild;
  }

  // 2. Discord.js User object (discord.js uses primaryGuild)
  const userObj = member.user as any;
  if (userObj) {
    if ('primaryGuild' in userObj && userObj.primaryGuild !== undefined)
      return userObj.primaryGuild;
    if ('primary_guild' in userObj && userObj.primary_guild !== undefined)
      return userObj.primary_guild;
  }

  return undefined;
}

const warnedDangerousGuilds = new Set<string>();

export async function checkAndApplyGuildTag(
  member: GuildMember,
  rawData?: any,
  options?: CheckGuildTagOptions,
): Promise<void> {
  if (!member.guild) return;

  const guildDb = await getGuildModel(member.guild);
  if (!guildDb.db.guildTagEnabled || !guildDb.db.guildTagRoleId) {
    return;
  }

  // Pre-validate role existence, dangerous permissions, and bot permissions
  const targetRole = member.guild.roles.cache.get(guildDb.db.guildTagRoleId);
  if (!targetRole) return;

  if (targetRole.permissions.any(DANGEROUS_PERMISSIONS)) {
    if (!warnedDangerousGuilds.has(member.guild.id)) {
      warnedDangerousGuilds.add(member.guild.id);
      member.client.logger.warn(
        { guildId: member.guild.id, roleId: targetRole.id },
        'Refused to process guild tag role because it has dangerous permissions (warned once)',
      );
    }
    return;
  }

  const me = member.guild.members.me;
  if (me) {
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    if (me.roles.highest.comparePositionTo(targetRole) <= 0) return;
  }

  // Discord Clan / Primary Guild Feature check
  const userClan = getClanData(member, rawData);

  const clanIdentityGuildId = userClan?.identityGuildId ?? userClan?.identity_guild_id;
  const clanTag = userClan?.tag;

  const hasClanIdentity = Boolean(clanIdentityGuildId) && clanIdentityGuildId === member.guild.id;
  const hasClanTagMatch = Boolean(
    clanTag && guildDb.db.guildTag && clanTag.toLowerCase() === guildDb.db.guildTag.toLowerCase(),
  );

  const shouldHavePerks = hasClanIdentity || hasClanTagMatch;
  const hasRole = member.roles.cache.has(guildDb.db.guildTagRoleId);

  if (shouldHavePerks && !hasRole) {
    try {
      await member.roles.add(guildDb.db.guildTagRoleId, 'Guild Tag / Clan Perks Automation');

      // Send welcome message if enabled (and not suppressed by skipDm)
      if (
        !options?.skipDm &&
        guildDb.db.guildTagMessageEnabled === 1 &&
        guildDb.db.guildTagMessage
      ) {
        const messageStr = guildDb.db.guildTagMessage
          .replace(/<mention>/g, `<@${member.id}>`)
          .replace(/<name>/g, member.user.username)
          .replace(/<servername>/g, member.guild.name)
          .replace(/<guildtag>/g, guildDb.db.guildTag ?? '');

        try {
          await member.send(messageStr);
        } catch (dmErr) {
          member.client.logger.debug({ err: dmErr }, 'Failed to send guild tag welcome DM to user');
        }
      }
    } catch (err) {
      member.client.logger.warn(
        { err },
        'Failed to add guild tag role (check bot permissions or role hierarchy)',
      );
    }
  } else if (!shouldHavePerks && hasRole) {
    // If onlyAdd is requested, do not remove roles
    if (options?.onlyAdd) return;

    // Safety guard: If userClan is undefined (meaning clan data was not present in this event/context),
    // do NOT strip the role! Only strip if we have explicit confirmation (userClan is null or mismatched).
    if (userClan === undefined) {
      return;
    }

    try {
      await member.roles.remove(guildDb.db.guildTagRoleId, 'Guild Tag / Clan Perks Automation');
    } catch (err) {
      member.client.logger.warn(
        { err },
        'Failed to remove guild tag role (check bot permissions or role hierarchy)',
      );
    }
  }
}
