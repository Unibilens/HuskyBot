import { Time } from '@sapphire/duration';
import { DiscordSnowflake } from '@sapphire/snowflake';
import {
  type ChatInputCommandInteraction,
  type Client,
  Events,
  GatewayOpcodes,
  type GuildMember,
  type InteractionEditReplyOptions,
  MessageFlags,
  type ReadonlyCollection,
  type Role,
} from 'discord.js';
import type { TFunction } from 'i18next';
import { outdent } from 'outdent';
import { command } from '#bot/commands.ts';
import statFlushCache from '../../statFlushCache.ts';

export const currentJobs = new Set<string>();

export default command({
  name: 'bonus role',
  async execute({ interaction, client, options, t }) {
    if (currentJobs.has(interaction.guild.id)) {
      await interaction.reply({
        content: t('bonus.massXP'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = options.role;
    const change = options.change;

    currentJobs.add(interaction.guild.id);
    // backup removes after 1h in case of unexpected hang
    const sweepTimer = setTimeout(() => {
      if (currentJobs.delete(interaction.guild.id)) {
        client.logger.warn(
          `role bonus job removed during sweep from guild ${interaction.guild.id}`,
        );
      }
    }, Time.Hour);

    try {
      await applyBonusToRole(t, interaction, role, change);
    } finally {
      clearTimeout(sweepTimer);
      currentJobs.delete(interaction.guild.id);
    }
  },
});

async function applyBonusToRole(
  t: TFunction<'command-content'>,
  interaction: ChatInputCommandInteraction<'cached'>,
  role: Role,
  changeAmount: number,
) {
  // DJS GuildMemberManager.fetch()
  // https://github.com/discordjs/discord.js/blob/ff85481d3e7cd6f7c5e38edbe43b27b104e82fba/packages/discord.js/src/managers/GuildMemberManager.js#L493

  await interaction.reply({
    content: t('bonus.processing', { count: interaction.guild.memberCount }),
    flags: MessageFlags.Ephemeral,
  });

  const nonce = DiscordSnowflake.generate().toString();

  interaction.guild.shard.send({
    op: GatewayOpcodes.RequestGuildMembers,
    d: {
      guild_id: interaction.guild.id,
      presences: false,
      query: '', // required to be empty string in order to fetch all
      nonce,
      limit: 0,
    },
  });

  interaction.client.logger.debug(
    `Bonus role: fetching members for guild ${interaction.guild.id} (memberCount: ${interaction.guild.memberCount})`,
  );

  const members = await getApplicableMembers(
    role.id,
    nonce,
    interaction.client,
    (c) => interaction.editReply(c),
    t,
  );

  interaction.client.logger.debug(`Bonus role: ${members.size} applicable members found`);

  await interaction.followUp({ content: t('bonus.applyXP'), flags: MessageFlags.Ephemeral });

  const affected = await statFlushCache.batchAddBonus(members, changeAmount, (done, total) => {
    interaction.editReply({
      content: outdent`
        ${t('bonus.processing', { count: total })}
        \`\`\`yml
        ${progressBar(done, total)}
        \`\`\`
      `,
    });
  });

  interaction.client.logger.debug(`Bonus role: applied ${changeAmount} XP to ${affected} members`);

  await interaction.followUp({
    content: t('bonus.successfully', {
      changeAmount,
      affected,
      role: role.toString(),
      count: affected,
    }),
    allowedMentions: { parse: [] },
    flags: MessageFlags.Ephemeral,
  });
}

// not sure how to use async/await here so just promise-based
async function getApplicableMembers(
  roleId: string,
  nonce: string,
  client: Client,
  reply: (opt: InteractionEditReplyOptions) => unknown,
  t: TFunction<'command-content'>,
): Promise<Set<GuildMember>> {
  return new Promise((resolve, reject) => {
    const applicableMembers = new Set<GuildMember>();
    let i = 0;

    const cleanup = () => {
      clearTimeout(timeout);
      client.off(Events.GuildMembersChunk, handler);
      // @ts-expect-error decrementMaxListeners is private but properly handled here
      client.decrementMaxListeners();
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for guild member chunks'));
    }, 5 * Time.Minute);

    const handler = async (
      members: ReadonlyCollection<string, GuildMember>,
      _guild: unknown,
      chunk: { index: number; count: number; nonce?: string },
    ) => {
      if (chunk.nonce !== nonce) return;
      i++;

      if (i % 20 === 0) {
        reply({
          content: outdent`
            ${t('bonus.processing', { count: members.size })}
            \`\`\`yml
            ${progressBar(i, chunk.count)}
            \`\`\`
          `,
        });
      }

      for (const member of members.values()) {
        if (member.roles.cache.has(roleId) && !member.user.bot) {
          applicableMembers.add(member);
        }
      }

      const isLastChunk = chunk.count
        ? i >= chunk.count || chunk.index === chunk.count - 1
        : members.size < 1_000;

      if (isLastChunk) {
        cleanup();
        resolve(applicableMembers);
      }
    };

    // @ts-expect-error incrementMaxListeners is private but properly handled here
    client.incrementMaxListeners();
    client.on(Events.GuildMembersChunk, handler);
  });
}

function progressBar(index: number, max: number, len = 40) {
  const fraction = index / max;
  const progress = Math.ceil(len * fraction);
  return `${'■'.repeat(progress)}${'□'.repeat(len - progress)} ${
    Math.round(fraction * 1_000) / 10
  }%`;
}
