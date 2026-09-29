import { DurationFormat } from '@formatjs/intl-durationformat';
import { AttachmentBuilder, EmbedBuilder, Status, MessageFlags } from 'discord.js';
import { Temporal } from 'temporal-polyfill';
import { command } from '#bot/commands.ts';
import { HELPSTAFF_ONLY } from '#bot/util/predicates.ts';
import { managerFetch } from '../../models/managerDb/managerDb.ts';

interface APIShard {
  shardId: number;
  status: Status;
  serverCount: number;
  uptimeSeconds: number;
  readyDate: Date | string | number;
  ip: string;
  changedHealthDate: Date | string | number;
}

export default command({
  name: 'shard-status',
  predicate: HELPSTAFF_ONLY,
  async execute({ interaction, options }) {
    const flags = options.eph ? MessageFlags.Ephemeral : undefined;

    await interaction.deferReply({ flags });

    const { stats }: { stats: APIShard[] } = await managerFetch('api/v0/shards/stats', {});

    let data = stats.map(({ ip, ...keepAttrs }) => keepAttrs);

    if (options.filtered) data = data.filter(({ status }) => status !== Status.Ready);

    const files = options.full
      ? [
          new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
            name: 'logs.json',
          }),
        ]
      : [];

    const search = options.search ?? null;

    if (search !== null) {
      const found = data.find((s) => s.shardId === search);
      await interaction.editReply({
        content: found
          ? `Shard ${found.shardId}:\n${parseShardInfoContent(found)}`
          : `Could not find shard with id \`${search}\``,
        files,
      });
      return;
    }

    const guildSearch = options['search-guild'] ?? null;

    if (guildSearch !== null) {
      const totalShards = interaction.client.shard?.count ?? 0;
      const shardId = Number((BigInt(guildSearch) >> 22n) % BigInt(totalShards));

      const found = data.find((s) => s.shardId === shardId);
      await interaction.editReply({
        content: `Shard ID of guild \`${guildSearch}\`: \`${shardId}\`\n\n${
          found
            ? `Shard ${found.shardId}:\n${parseShardInfoContent(found)}`
            : '🔴 Could not find shard'
        }`,
        files,
      });
      return;
    }

    if (!data.length) {
      await interaction.editReply({
        content: 'All shards are online!',
        files,
      });
      return;
    }

    const page = options.page ?? 0;

    const e = new EmbedBuilder()
      .setTitle(`Shards ${page * 15} - ${(page + 1) * 15} (total ${data.length})`)
      .setFields(
        data.slice(page * 15, (page + 1) * 15).map((shard) => ({
          name: shard.shardId.toString(),
          value: parseShardInfoContent(shard),
          inline: true,
        })),
      );

    await interaction.editReply({ embeds: [e], files });
  },
});

const durationFormatter = new DurationFormat('en-US', { style: 'long' });

function toUnixSeconds(date: Date | string | number): number {
  if (typeof date === 'number') {
    return date > 1e11 ? Math.floor(date / 1000) : Math.floor(date);
  }
  const ms = new Date(date).getTime();
  if (isNaN(ms)) return 0;
  if (ms > 0 && ms < 1e11) {
    return Math.floor(ms);
  }
  return Math.floor(ms / 1000);
}

function parseShardInfoContent(shard: Omit<APIShard, 'ip'>) {
  let uptime = Temporal.Duration.from({ seconds: shard.uptimeSeconds });
  uptime = uptime.round({
    smallestUnit: 'minutes',
    largestUnit: 'weeks',
    relativeTo: Temporal.Now.plainDateTimeISO(),
  });

  const formattedUptime = durationFormatter.format(uptime) || '< 1 minute';
  const readySec = toUnixSeconds(shard.readyDate);
  const healthSec = toUnixSeconds(shard.changedHealthDate);

  return [
    `  **Status**: \`${shard.status === 0 ? '🟢 Online' : `🔴 ${Status[shard.status]}`}\``,
    `  **Guilds**: \`${shard.serverCount.toLocaleString()}\``,
    `  **Uptime**: \`${formattedUptime}\` since <t:${readySec}:f>, <t:${readySec}:R>`,
    `  **Last updated**: <t:${healthSec}:T>, <t:${healthSec}:R>`,
  ].join('\n');
}
