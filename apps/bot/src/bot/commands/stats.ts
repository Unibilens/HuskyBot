import { AttachmentBuilder, ButtonStyle, ComponentType, MessageFlags, type User } from 'discord.js';
import { command } from '#bot/commands.ts';
import { actionrow } from '#bot/util/component.ts';
import { requireUser } from '#bot/util/predicates.ts';
import { component } from '#bot/util/registry/component.ts';
import { renderStatsCard } from '#bot/util/statsImage.ts';
import { getSystemStats } from '#bot/util/systemStats.ts';
import { config, invites } from '#const/config.ts';

const COOLDOWN_MS = 20 * 1000;
const cooldowns = new Map<string, number>();

function checkCooldown(userId: string): {
  onCooldown: boolean;
  remainingSec: number;
} {
  const now = Date.now();
  const expiresAt = cooldowns.get(userId);
  if (expiresAt && expiresAt > now) {
    return {
      onCooldown: true,
      remainingSec: Math.ceil((expiresAt - now) / 1000),
    };
  }
  cooldowns.set(userId, now + COOLDOWN_MS);
  return { onCooldown: false, remainingSec: 0 };
}

export default command({
  name: 'stats',
  async execute({ interaction }) {
    // Spam protection: check 20s cooldown per user
    const cd = checkCooldown(interaction.user.id);
    if (cd.onCooldown) {
      await interaction.reply({
        content: `⏳ Please wait **${cd.remainingSec}s** before generating a new stats card.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const currentShardId = interaction.guild?.shardId ?? interaction.client.shard?.ids[0] ?? 0;
    const stats = await getSystemStats(interaction.client, currentShardId);

    const imageBuffer = renderStatsCard(stats);
    const attachment = new AttachmentBuilder(imageBuffer, {
      name: 'stats.png',
      description: 'Husky System Statistics',
    });

    await interaction.editReply({
      files: [attachment],
      components: buildStatsComponents(stats.currentShardId, interaction.user),
    });
  },
});

function buildStatsComponents(shardId: number, user: User) {
  const predicate = requireUser(user);

  return [
    actionrow([
      {
        type: ComponentType.Button,
        customId: refreshButton.instanceId({
          data: { shardId },
          predicate,
        }),
        style: ButtonStyle.Secondary,
        label: 'Refresh',
        emoji: { name: '🔄' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: 'Invite',
        url: invites.admin,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: 'Support Server',
        url: config.supportServer.invite,
      },
    ]),
  ];
}

const refreshButton = component<{ shardId: number }>({
  type: ComponentType.Button,
  async callback({ interaction, data }) {
    // 10s cooldown for refresh button
    const cd = checkCooldown(interaction.user.id);
    if (cd.onCooldown) {
      await interaction.reply({
        content: `⏳ Please wait **${cd.remainingSec}s** before refreshing again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    const stats = await getSystemStats(interaction.client, data.shardId);

    const imageBuffer = renderStatsCard(stats);
    const attachment = new AttachmentBuilder(imageBuffer, {
      name: 'stats.png',
      description: 'Husky System Statistics',
    });

    await interaction.editReply({
      files: [attachment],
      components: buildStatsComponents(stats.currentShardId, interaction.user),
    });
  },
});
