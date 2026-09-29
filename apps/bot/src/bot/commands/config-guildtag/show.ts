import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { command } from '#bot/commands.ts';
import { DANGEROUS_PERMISSIONS } from '#bot/levelManager.ts';
import { getGuildModel } from '../../models/guild/guildModel.ts';

export default command({
  name: 'config-guildtag show',
  async execute({ interaction }) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'You need the Manage Server permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cachedGuild = await getGuildModel(interaction.guild);

    const enabled = cachedGuild.db.guildTagEnabled === 1;
    const tag = cachedGuild.db.guildTag || 'None';
    const roleId = cachedGuild.db.guildTagRoleId;
    const roleText = roleId ? `<@&${roleId}>` : 'None';
    const multiplier = cachedGuild.db.guildTagMultiplier;

    const targetRole = roleId ? interaction.guild.roles.cache.get(roleId) : null;
    const isDangerous = targetRole?.permissions.any(DANGEROUS_PERMISSIONS) ?? false;

    const description = isDangerous
      ? '⚠️ **Security Warning:** The configured role contains dangerous administrative/moderation permissions and will **not** be assigned to members. Please select a role without administrative permissions using `/config-guildtag set`.'
      : undefined;

    await interaction.reply({
      embeds: [
        {
          title: '🏆 Guild Tag Perks Configuration',
          color: isDangerous ? 0xff4d4d : 0x36608e,
          description,
          fields: [
            { name: 'Status', value: enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
            { name: 'Tag', value: `\`${tag}\``, inline: true },
            { name: 'Role', value: roleText, inline: true },
            { name: 'Multiplier', value: `\`${multiplier}x\``, inline: true },
          ],
          footer: { text: 'Use /config-server set to toggle this feature.' },
        },
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
});
