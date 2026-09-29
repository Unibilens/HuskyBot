import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import { command } from '#bot/commands.ts';

export default command({
  name: 'clear',
  async execute({ interaction, t, options }) {
    if (
      interaction.channel &&
      !interaction.member.permissionsIn(interaction.channel).has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({ content: t('missing.manageServer'), flags: MessageFlags.Ephemeral });
      return;
    }

    const amount = options.amount;

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.reply({
        content: 'This command can only be used in text channels.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Try deleting messages
    try {
      if ('bulkDelete' in interaction.channel) {
        // Bulk delete accepts 1-100 messages, but can't delete messages older than 14 days
        const deleted = await interaction.channel.bulkDelete(amount, true);
        await interaction.reply({
          content: `Successfully deleted ${deleted.size} messages.`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: 'Cannot bulk delete messages in this channel type.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error('Error clearing messages:', error);
      await interaction.reply({
        content: 'There was an error trying to clear messages in this channel.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
});
