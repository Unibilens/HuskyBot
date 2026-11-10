import Cron from 'croner';
import {
  type Client,
  ComponentType,
  DiscordAPIError,
  type Guild,
  MessageFlags,
  REST,
  RESTJSONErrorCodes,
  Routes,
  type Webhook,
  type WebhookMessageCreateOptions,
} from 'discord.js';
import invariant from 'tiny-invariant';
import { type GuildModel, getGuildModel } from '#bot/models/guild/guildModel.ts';
import { getGuildMemberRanks } from '#bot/models/rankModel.ts';
import { container, textDisplay } from '#bot/util/component.ts';
import { getGuildMemberNamesWithRanks } from '#bot/util/nameUtil.ts';
import { catchDjsError as ignoreDjsError } from '#bot/util/parser.ts';
import { emoji } from '#const/config.ts';
import { shards } from '#models/shardDb/shardDb.ts';
import type { StatType } from '#models/types/enums.ts';
import fct from '../../util/fct.ts';
import { UPDATE_LEADERBOARDS_CRON } from './scheduler.ts';

export async function updateLeaderboards(client: Client) {
  // unauthenticated REST client for webhook edits
  const rest = new REST();

  const guilds = await shards.executeOnAllHosts((db) =>
    db
      .selectFrom('guild')
      .select(['guildId'])
      .where('leaderboardWebhook', 'is not', null)
      .execute(),
  );

  for (const guildData of guilds) {
    const guild = client.guilds.cache.get(guildData.guildId);

    // skip guilds that this shard cannot access
    if (!guild) {
      continue;
    }

    // a failure in one guild must not prevent the remaining guilds from updating
    try {
      await updateLeaderboard(rest, guild);
    } catch (err) {
      client.logger.warn({ err, guildId: guild.id }, 'Error in updateLeaderboards');
    }
  }
}

export async function updateLeaderboard(rest: REST, guild: Guild) {
  const cachedGuild = await getGuildModel(guild);
  const guildData = await cachedGuild.fetch();

  if (!guildData.leaderboardWebhook) return;

  const message = await produceToplistMessage(guild, cachedGuild);
  const webhook = deserializeWebhook(guildData.leaderboardWebhook);
  const { id, token, messageId } = webhook;

  try {
    await rest.patch(Routes.webhookMessage(id, token, messageId), { body: message, auth: false });
  } catch (err) {
    if (!(err instanceof DiscordAPIError)) {
      throw err;
    }
    if (err.code === RESTJSONErrorCodes.UnknownWebhook) {
      // webhook has been deleted
      guild.client.logger.info(
        { guildId: guild.id, cause: 'missing webhook' },
        'Closing leaderboard',
      );
      await cachedGuild.upsert({ leaderboardWebhook: null });
    } else if (err.code === RESTJSONErrorCodes.UnknownMessage) {
      // message has been deleted; destroy webhook
      guild.client.logger.info(
        { guildId: guild.id, cause: 'missing message' },
        'Closing leaderboard',
      );
      await rest
        .delete(Routes.webhook(id, token), { auth: false })
        .catch(ignoreDjsError(RESTJSONErrorCodes.UnknownWebhook));
      await cachedGuild.upsert({ leaderboardWebhook: null });
    } else {
      throw err;
    }
  }
}

export function serializeWebhook(webhook: Webhook, messageId: string): string {
  return `${webhook.token}/${webhook.id}/${messageId}`;
}

export function deserializeWebhook(str: string): { token: string; id: string; messageId: string } {
  const parsed = /^(.+)\/(\d+)\/(\d+)$/.exec(str);
  if (!parsed) throw new Error(`Failed to deserialize webhook string "${str}"`);
  return { token: parsed[1], id: parsed[2], messageId: parsed[3] };
}

export async function produceToplistMessage(
  guild: Guild,
  cachedGuild: GuildModel,
): Promise<WebhookMessageCreateOptions> {
  const targetCount = cachedGuild.db.entriesPerPage;
  let offset = 1;
  const batchSize = Math.max(targetCount, 50);
  const MAX_SCAN_RANKS = 2000;
  type GuildMemberRank = Awaited<ReturnType<typeof getGuildMemberRanks>>[number];
  const activeMembers: (GuildMemberRank & { name: string; isMember: boolean })[] = [];

  while (activeMembers.length < targetCount) {
    const ranks = await getGuildMemberRanks(guild, 'totalScore', 'alltime', offset, offset + batchSize - 1);
    if (!ranks || ranks.length === 0) break;

    const ranksWithNames = await getGuildMemberNamesWithRanks(guild, ranks);
    const active = ranksWithNames.filter((r) => r.isMember);
    activeMembers.push(...active);

    if (ranks.length < batchSize) break;
    offset += batchSize;
    if (offset > MAX_SCAN_RANKS) {
      guild.client.logger.warn(
        `Leaderboard scan reached max limit (${MAX_SCAN_RANKS}) for guild ${guild.id}`,
      );
      break;
    }
  }

  const nextUpdateDate = new Cron(UPDATE_LEADERBOARDS_CRON).nextRun();
  invariant(nextUpdateDate);
  const nextUpdate = Math.floor(nextUpdateDate.getTime() / 1000);

  if (activeMembers.length === 0) {
    return {
      components: [
        container(
          [
            textDisplay(`# Leaderboard • ${guild.name}`),
            { type: ComponentType.Separator },
            textDisplay('*No users to display*'),
            textDisplay(`-# Powered by deydays  •  Next update <t:${nextUpdate}:R>`),
          ],
          { accentColor: 0x36608e },
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  const memberRanksWithNames = activeMembers.slice(0, targetCount);

  const message: WebhookMessageCreateOptions = {
    components: [
      container(
        [
          textDisplay(`# Leaderboard • ${guild.name}`),
          { type: ComponentType.Separator },
          ...memberRanksWithNames.map((rank, i) => {
            const header = `### \\#${i + 1} ${rank.name} ${emoji('level')}${Math.floor(rank.levelProgression)}`;
            const getScoreString = (type: StatType) => {
              if (type === 'textMessage' && cachedGuild.db.textXp)
                return `${emoji('message')} ${rank.textMessage}`;
              if (type === 'voiceMinute' && cachedGuild.db.voiceXp)
                return `${emoji('voice')} ${fct.formatVoiceTime(rank.voiceMinute)}`;
              if (type === 'invite' && cachedGuild.db.inviteXp)
                return `${emoji('invite')} ${rank.invite}`;
              if (type === 'vote' && cachedGuild.db.voteXp)
                return `${cachedGuild.db.voteEmote} ${rank.vote}`;
              if (type === 'bonus' && cachedGuild.db.bonusXp)
                return `${cachedGuild.db.bonusEmote} ${rank.bonus}`;
              return null;
            };

            const scoreStrings = [
              getScoreString('textMessage'),
              getScoreString('voiceMinute'),
              getScoreString('invite'),
              getScoreString('vote'),
              getScoreString('bonus'),
            ].filter((s) => s !== null);
            const body = `**${rank.totalScore}** xp: ${scoreStrings.join(' • ')}`;
            return textDisplay(`${header}\n${body}`);
          }),
          textDisplay(`-# Powered by deydays  •  Next update <t:${nextUpdate}:R>`),
        ],
        { accentColor: 0x36608e },
      ),
    ],
    flags: MessageFlags.IsComponentsV2,
  };

  return message;
}
