import { DiscordAPIError, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { command } from '#bot/commands.ts';

export default command({
  name: 'clear',
  async execute({ interaction, t, options }) {
    if (
      interaction.channel &&
      !interaction.member.permissionsIn(interaction.channel).has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: t('missing.manageServer'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.reply({
        content: 'This command can only be used in text channels.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if the bot has permissions to manage messages and read message history
    const botPermissions =
      interaction.appPermissions ??
      interaction.guild?.members.me?.permissionsIn(interaction.channel);

    const requiredPermissions = [
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ];

    if (!botPermissions?.has(requiredPermissions)) {
      await interaction.reply({
        content:
          'Missing required permissions: **Manage Messages** and/or **Read Message History** in this channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const amount = options.amount;

    if (!('bulkDelete' in interaction.channel)) {
      await interaction.reply({
        content: 'Cannot bulk delete messages in this channel type.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);

      if (deleted.size === 0) {
        await interaction.editReply({
          content:
            'No messages were deleted. Discord does not allow deleting messages older than 14 days.',
        });
        return;
      }

      await interaction.editReply({
        content: `Successfully deleted ${deleted.size} message(s).`,
      });
    } catch (error) {
      if (error instanceof DiscordAPIError && (error.code === 50013 || error.code === 50034)) {
        await interaction.editReply({
          content:
            'Failed to delete messages due to missing permissions or messages being older than 14 days.',
        });
        return;
      }

      interaction.client.logger.error(error, 'Unexpected error clearing messages');
      await interaction.editReply({
        content: 'An unexpected error occurred while clearing messages.',
      });
    }
  },
});
