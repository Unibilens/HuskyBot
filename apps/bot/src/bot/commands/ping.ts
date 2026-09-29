import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { command } from '#bot/commands.ts';
import { config, invites, isProduction } from '#const/config.ts';

export default command({
  name: 'ping',
  async execute({ interaction, t }) {
    const response = await interaction.deferReply({
      withResponse: true,
      flags: MessageFlags.Ephemeral,
    });
    const sent = response.resource?.message ?? (await interaction.fetchReply());

    const pingEmbed = new EmbedBuilder()
      .setColor(0x36608e)
      .setTitle(t('ping.title'))
      .setDescription(isProduction ? null : t('ping.isDev'))
      .addFields(
        {
          name: t('ping.latency.name'),
          value: `\`\`\`${t('ping.latency.value', { time: sent.createdTimestamp - interaction.createdTimestamp })}\`\`\``,
        },
        {
          name: t('ping.heartbeat.name'),
          value:
            interaction.client.ws.ping > 0
              ? `\`\`\`${t('ping.heartbeat.value', { time: Math.round(interaction.client.ws.ping) })}\`\`\``
              : t('ping.heartbeat.empty'),
        },
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(t('ping.invite'))
        .setURL(invites.admin)
        .setStyle(ButtonStyle.Link),
    );

    await interaction.editReply({
      embeds: [pingEmbed],
      components: [row],
    });
  },
});
