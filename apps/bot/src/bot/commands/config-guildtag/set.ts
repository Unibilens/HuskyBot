import { type GuildMember, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { command } from '#bot/commands.ts';
import { DANGEROUS_PERMISSIONS, DANGEROUS_PERMISSIONS_NAMES } from '#bot/levelManager.ts';
import { config, isProduction } from '#const/config.ts';
import { getGuildModel } from '../../models/guild/guildModel.ts';
import { getClanData } from '../../util/guildTagUtil.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Tracks the last time a member scan was triggered per guild (in-memory, resets on bot restart)
const lastScanTime = new Map<string, number>();
// Tracks guilds that currently have an active background member scan
const activeScans = new Set<string>();

/**
 * Fetches guild members via Gateway opcode 8, automatically waiting and retrying
 * if Discord hits a GatewayRateLimitError.
 */
async function fetchMembersWithRetry(guild: any, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await guild.members.fetch();
    } catch (err: any) {
      const retryAfter = Number(err?.data?.retry_after ?? err?.retry_after ?? 15);
      if (
        attempt < retries &&
        (err?.name === 'GatewayRateLimitError' ||
          err?.message?.includes('rate limited') ||
          err?.message?.includes('opcode 8'))
      ) {
        guild.client.logger.warn(
          { guildId: guild.id, attempt, retryAfter },
          `Gateway opcode 8 rate limited. Waiting ${retryAfter.toFixed(1)}s before retry...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.ceil(retryAfter * 1000) + 500),
        );
        continue;
      }
      throw err;
    }
  }
  return await guild.members.fetch();
}

export default command({
  name: 'config-guildtag set',
  async execute({ interaction, options }) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'You need the Manage Server permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tag = options.tag;
    const role = options.role;
    const multiplier = options.multiplier;

    // 1. Validate bot permissions & role hierarchy
    const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: 'I need the **Manage Roles** permission to assign roles for guild tags.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (role.managed) {
      await interaction.reply({
        content:
          'Cannot use a managed integration or bot role for guild tags. Please choose a standard role.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (me.roles.highest.comparePositionTo(role) <= 0) {
      await interaction.reply({
        content: `The role <@&${role.id}> is higher than or equal to my highest role. Please move my role above <@&${role.id}> in **Server Settings > Roles** so I can assign it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (role.permissions.any(DANGEROUS_PERMISSIONS)) {
      const fmt = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
      const list = fmt.format(DANGEROUS_PERMISSIONS_NAMES);
      await interaction.reply({
        embeds: [
          {
            title: '⚠️ Dangerous Role Permissions',
            color: 0xff4d4d,
            description: `Cannot set <@&${role.id}> as the Guild Tag role because it contains dangerous permissions:\n**${list}**\n\nAs a security measure to prevent unauthorized administrative access and server compromise, Husky avoids assigning roles with moderation or administration permissions.\n\n**Solution:**\n1. Remove these permissions from <@&${role.id}> in **Server Settings > Roles**, or\n2. Select a dedicated cosmetic role (e.g. \`@Tag Perk\` or \`@Member\`) without administrative permissions.`,
          },
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Persist configuration and automatically enable Guild Tag perks
    const cachedGuild = await getGuildModel(interaction.guild);
    const previousTag = cachedGuild.db.guildTag;
    const previousRoleId = cachedGuild.db.guildTagRoleId;
    const isTagChanged = Boolean(previousTag && previousTag.toLowerCase() !== tag.toLowerCase());
    const isRoleSwapping = Boolean(previousRoleId && previousRoleId !== role.id);
    const previousRole = isRoleSwapping
      ? (interaction.guild.roles.cache.get(previousRoleId!) ?? null)
      : null;
    const canManagePreviousRole = Boolean(
      previousRole && me.roles.highest.comparePositionTo(previousRole) > 0,
    );

    await cachedGuild.upsert({
      guildTag: tag,
      guildTagRoleId: role.id,
      guildTagMultiplier: multiplier,
      guildTagEnabled: 1,
    });

    // 3. Background scan coordination (safe for large 100k+ servers)
    const now = Date.now();
    const isDebugGuild =
      !isProduction || config.developmentServers.includes(interaction.guild.id);
    const lastScan = lastScanTime.get(interaction.guild.id) ?? 0;
    // For debug guilds, require a 15s cooldown to match Discord's gateway opcode 8 rate limit window
    const DEBUG_COOLDOWN_MS = 15 * 1000;
    const nextScanAt = isDebugGuild ? lastScan + DEBUG_COOLDOWN_MS : lastScan + MS_PER_DAY;
    const isScanRunning = activeScans.has(interaction.guild.id);

    let scanNote = '';
    if (isScanRunning) {
      scanNote = '\n\n⏳ **A member scan is already in progress for this server.**';
    } else if (now < nextScanAt) {
      scanNote = `\n\n⏳ **Member scan is on cooldown. Next scan available <t:${Math.floor(nextScanAt / 1000)}:R>.**`;
    } else {
      if (isRoleSwapping) {
        scanNote = `\n\n🔄 **Swapping roles in the background:** Eligible members will receive <@&${role.id}> and previous role <@&${previousRoleId}> will be removed.`;
      } else if (isTagChanged) {
        scanNote = `\n\n🔄 **Tag updated to \`${tag}\`:** Granting <@&${role.id}> to members with the new tag and revoking it from members with the old tag...`;
      } else {
        scanNote =
          '\n\n🔍 **Scanning server members in the background to assign roles to eligible members...**';
      }
      activeScans.add(interaction.guild.id);
      lastScanTime.set(interaction.guild.id, now);
      const guild = interaction.guild;

      // Background scan without blocking the interaction reply
      (async () => {
        try {
          // Fetch members via Gateway chunking with automatic rate-limit retry
          const members = await fetchMembersWithRetry(guild);

          interface MemberAction {
            member: GuildMember;
            addRole: boolean;
            removeTargetRole: boolean;
            removeOldRole: boolean;
          }

          // In-memory filter: executes in milliseconds, zero REST overhead
          const actions: MemberAction[] = [];
          for (const [, m] of members) {
            if (m.user.bot) continue;

            const userClan = getClanData(m);
            const clanIdentityGuildId = userClan?.identityGuildId ?? userClan?.identity_guild_id;
            const clanTag = userClan?.tag;

            const hasClanIdentity =
              Boolean(clanIdentityGuildId) && clanIdentityGuildId === guild.id;
            const hasClanTagMatch =
              Boolean(tag) && Boolean(clanTag) && clanTag.toLowerCase() === tag.toLowerCase();

            const shouldHavePerks = hasClanIdentity || hasClanTagMatch;
            const hasTargetRole = m.roles.cache.has(role.id);
            const hasOldRole = Boolean(
              isRoleSwapping && previousRoleId && m.roles.cache.has(previousRoleId),
            );

            // 1. Qualified members who don't have the target role yet -> ADD
            const needsAddTargetRole = shouldHavePerks && !hasTargetRole;

            // 2. Members who have target role but NO LONGER qualify (e.g. tag changed or member removed tag) -> REMOVE
            const needsRemoveTargetRole = !shouldHavePerks && hasTargetRole && userClan !== undefined;

            // 3. Members who still have the retired previous role (if role was swapped) -> REMOVE
            const needsRemoveOldRole = isRoleSwapping && canManagePreviousRole && hasOldRole;

            if (needsAddTargetRole || needsRemoveTargetRole || needsRemoveOldRole) {
              actions.push({
                member: m,
                addRole: needsAddTargetRole,
                removeTargetRole: needsRemoveTargetRole,
                removeOldRole: needsRemoveOldRole,
              });
            }
          }

          guild.client.logger.info(
            {
              guildId: guild.id,
              actionCount: actions.length,
              isRoleSwapping,
              isTagChanged,
              previousRoleId,
              totalMembers: members.size,
            },
            'Guild tag background scan found members for role updates',
          );

          // Execute role changes with rate limit spacing
          for (const action of actions) {
            try {
              // 1. Remove previous retired role if role was swapped
              if (action.removeOldRole && previousRoleId) {
                await action.member.roles.remove(
                  previousRoleId,
                  'Guild Tag Role Swap (Old Role Removed)',
                );
              }

              // 2. Remove target role if member no longer qualifies (e.g. tag changed)
              if (action.removeTargetRole) {
                await action.member.roles.remove(
                  role.id,
                  'Guild Tag Changed / Unqualified (Role Removed)',
                );
              }

              // 3. Add target role if member qualifies
              if (action.addRole) {
                await action.member.roles.add(
                  role.id,
                  'Guild Tag / Clan Perks Automation (New Role Added)',
                );
              }
            } catch (err) {
              guild.client.logger.debug(
                { err, memberId: action.member.id },
                'Failed to update guild tag roles in scan',
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
        } catch (err) {
          guild.client.logger.error({ err, guildId: guild.id }, 'Guild tag background scan failed');
        } finally {
          activeScans.delete(guild.id);

          // Clear uncached members from RAM who aren't active in voice or the bot itself
          guild.members.cache.sweep(
            (m) => m.id !== guild.client.user.id && m.voice?.channelId === null,
          );

          // Cleanup expired cooldown entries
          for (const [id, time] of lastScanTime) {
            if (Date.now() - time >= MS_PER_DAY) lastScanTime.delete(id);
          }
        }
      })();
    }

    const roleDetails = isRoleSwapping
      ? `**Previous Role:** <@&${previousRoleId}> *(being removed)*\n**New Role:** <@&${role.id}>`
      : `**Role:** <@&${role.id}>`;

    await interaction.reply({
      embeds: [
        {
          title: '🏆 Guild Tag Perks Updated',
          color: 0x36608e,
          description: `The Guild Tag settings have been updated:\n\n**Status:** 🟢 Enabled\n**Tag:** \`${tag}\`\n${roleDetails}\n**Multiplier:** \`${multiplier}x\`${scanNote}`,
          footer: { text: 'You can toggle Guild XP on or off anytime via /config-server set.' },
        },
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
});
