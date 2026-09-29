import { MessageFlags } from 'discord.js';
import { command } from '#bot/commands.ts';
import { resolveMember } from '#bot/util/parser.ts';
import { attemptUpvote, getUpvoteMessage } from '#bot/util/upvote.ts';

export default command({
  name: 'upvote',
  async execute({ interaction, options, t }) {
    const targetMember = await resolveMember(options.member, interaction);
    if (!targetMember) {
      await interaction.reply({ content: t('missing.notOnServer'), flags: MessageFlags.Ephemeral });
      return;
    }

    const result = await attemptUpvote(interaction.member, targetMember);

    await interaction.reply(getUpvoteMessage(result, targetMember));
  },
});
