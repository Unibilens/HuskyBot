import { MessageFlags } from 'discord.js';
import { command } from '#bot/commands.ts';
import { resolveMember } from '#bot/util/parser.ts';
import statFlushCache from '../../statFlushCache.ts';

export default command({
  name: 'bonus member',
  async execute({ interaction, options, t }) {
    const member = await resolveMember(options.member, interaction);

    if (!member) {
      await interaction.reply({ content: t('missing.notOnServer'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (member.user.bot) {
      await interaction.reply({ content: t('bonus.cannotAddXP'), flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();

    await statFlushCache.addBonus(member, options.change);
    await interaction.editReply({
      content: t(options.change >= 0 ? 'bonus.successPositive' : 'bonus.successNegative', {
        change: Math.abs(options.change),
        member: member.toString(),
      }),
      allowedMentions: { parse: [] },
    });
  },
});
