import type { ShardDB } from '@activityrank/database';
import TTLCache from '@isaacs/ttlcache';
import {
  type ActionRowData,
  AttachmentBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  type DiscordAPIError,
  EmbedBuilder,
  type Guild,
  type InteractionEditReplyOptions,
  type MessageActionRowComponentData,
  type MessageComponentInteraction,
  MessageFlags,
  RESTJSONErrorCodes,
  time,
  type User,
} from 'discord.js';
import type { TFunction } from 'i18next';
import { command } from '#bot/commands.ts';
import { renderRankCard } from '#bot/util/rankImage.ts';
import {
  fetchGuildMemberScores,
  fetchGuildMemberStatistics,
  getGuildMemberScorePosition,
  getGuildMemberStatPosition,
  getGuildMemberTopChannels,
} from '#bot/models/rankModel.ts';
import { requireUserId } from '#bot/util/predicates.ts';
import { ComponentKey, component } from '#bot/util/registry/component.ts';
import { assertUnreachable } from '#bot/util/typescript.ts';
import { emoji } from '#const/config.ts';
import { type StatTimeInterval, type StatType, statTimeIntervals } from '#models/types/enums.ts';
import fct from '../../util/fct.ts';
import { type GuildModel, getGuildModel } from '../models/guild/guildModel.ts';
import { handleStatCommandsCooldown } from '../util/cooldownUtil.ts';
import nameUtil from '../util/nameUtil.ts';

interface CacheInstance {
  window: 'rank' | 'topChannels';
  time: StatTimeInterval;
  owner: string;
  targetUser: User;
  page: number;
  interaction: ChatInputCommandInteraction<'cached'>;
  t: TFunction<'command-content'>;
  locales: string[];
}

const activeCache = new Map();

export default command({
  name: 'rank',
  async execute({ interaction, client, options, t }) {
    if ((await handleStatCommandsCooldown(t, interaction)).denied) return;

    await interaction.deferReply();

    const cachedGuild = await getGuildModel(interaction.guild);
    const myGuild = await cachedGuild.fetch();

    const targetUser = options.member ?? interaction.user;

    const initialState: CacheInstance = {
      window: 'rank',
      time: 'alltime',
      owner: interaction.member.id,
      targetUser,
      page: 1,
      locales: [interaction.locale, 'en-US'],
      interaction,
      t,
    };

    const { id } = await interaction.editReply(
      await generateCard(initialState, interaction.guild, myGuild),
    );

    const cleanCache = async () => {
      const state = activeCache.get(id);
      activeCache.delete(id);
      if (!interaction.guild)
        return client.logger.debug({ interaction }, '/rank tried to update uncached guild');
      try {
        await interaction.editReply(await generateCard(state, interaction.guild, myGuild, true));
      } catch (_err) {
        const err = _err as DiscordAPIError;
        if (err.code === RESTJSONErrorCodes.UnknownMessage)
          client.logger.debug({ interaction }, '/rank tried to update unknown message');
        else client.logger.warn({ interaction, err }, '/rank failed to update message on cache cleanup');
      }
    };
    setTimeout(cleanCache, 5 * 60 * 1_000);

    activeCache.set(id, initialState);
  },
});

const pageButton = component<{ page: number }>({
  type: ComponentType.Button,
  async callback({ interaction, data }) {
    await execCacheSet(interaction, 'page', data.page);
  },
});

const windowButton = component<CacheInstance['window']>({
  type: ComponentType.Button,
  async callback({ interaction, data }) {
    await execCacheSet(interaction, 'window', data);
  },
});

const timeSelect = component({
  type: ComponentType.StringSelect,
  async callback({ interaction }) {
    const time = interaction.values[0];
    await execCacheSet(interaction, 'time', time as StatTimeInterval);
  },
});

const componentCooldowns = new TTLCache<string, number>({ ttl: 2500, max: 1000 });

async function execCacheSet<T extends keyof CacheInstance>(
  interaction: MessageComponentInteraction<'cached'>,
  key: T,
  value: CacheInstance[T],
) {
  const userCdKey = `${interaction.user.id}:${interaction.message.id}`;
  const lastClick = componentCooldowns.get(userCdKey);
  if (lastClick) {
    const remainingSeconds = Math.max(1, Math.ceil((2500 - (Date.now() - lastClick)) / 1000));
    await interaction.reply({
      content: `Please wait ${remainingSeconds}s before switching again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  componentCooldowns.set(userCdKey, Date.now());

  const cachedMessage = activeCache.get(interaction.message.id);
  if (!cachedMessage) {
    interaction.client.logger.debug(
      { interaction, id: interaction.message.id },
      'Could not find cachedMessage',
    );
    return;
  }

  const guildModel = await getGuildModel(interaction.guild);
  const myGuild = await guildModel.fetch();

  activeCache.set(interaction.message.id, { ...cachedMessage, [key]: value });

  await interaction.deferUpdate();

  const state = activeCache.get(interaction.message.id);
  await interaction.editReply(await generateCard(state, interaction.guild, myGuild));
}

async function generateCard(
  cache: CacheInstance,
  guild: Guild,
  myGuild: ShardDB.Guild,
  disabled = false,
): Promise<InteractionEditReplyOptions> {
  if (cache.window === 'rank') {
    return await generateRankCard(cache, guild, myGuild, disabled);
  }
  if (cache.window === 'topChannels') {
    return await generateChannelCard(cache, guild, myGuild, disabled);
  }
  assertUnreachable(cache.window);
}

function getScoreForLevel(level: number, levelFactor: number): number {
  if (level <= 1) return 0;
  const a = levelFactor / 2;
  const b = levelFactor / 2 + 100;
  const x = level - 1;
  return Math.round(a * x * x + b * x);
}

async function generateRankCard(
  state: CacheInstance,
  guild: Guild,
  myGuild: ShardDB.Guild,
  disabled = false,
): Promise<InteractionEditReplyOptions> {
  const scores = await fetchGuildMemberScores(guild, state.targetUser.id);
  const statistics = await fetchGuildMemberStatistics(guild, state.targetUser.id);

  const guildCache = await getGuildModel(guild);

  const positions = await getPositions(
    guild,
    state.targetUser.id,
    getTypes(guildCache),
    state.time,
  );

  const guildMemberInfo = await nameUtil.getGuildMemberInfo(guild, state.targetUser.id);
  const levelProgression = fct.getLevelProgression(scores.alltime, guildCache.db.levelFactor);
  const level = Math.max(1, Math.floor(levelProgression));

  const currentLevelFloorXp = getScoreForLevel(level, guildCache.db.levelFactor);
  const nextLevelCeilingXp = getScoreForLevel(level + 1, guildCache.db.levelFactor);
  const currentTotalXp = Math.max(0, Math.round(scores.alltime));
  const currentLevelProgressXp = Math.max(0, currentTotalXp - currentLevelFloorXp);
  const neededLevelXp = Math.max(1, nextLevelCeilingXp - currentLevelFloorXp);
  const progressRatio = Math.min(1, Math.max(0, currentLevelProgressXp / neededLevelXp));

  // Determine highest non-everyone role and color
  let roleName: string | undefined;
  let roleColor: string | undefined;
  const member =
    guild.members.cache.get(state.targetUser.id) ??
    (await guild.members.fetch(state.targetUser.id).catch(() => null));
  if (member) {
    const nonEveryoneRoles = member.roles.cache
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position);
    const highestRole = nonEveryoneRoles.first();
    if (highestRole) {
      roleName = highestRole.name;
      if (highestRole.hexColor && highestRole.hexColor !== '#000000') {
        roleColor = highestRole.hexColor;
      }
    }
  }

  // Handle (only legacy 4-digit discriminator if present, e.g. #1337)
  let handle: string | undefined;
  if (state.targetUser.discriminator && state.targetUser.discriminator !== '0') {
    handle = `#${state.targetUser.discriminator}`;
  }

  // Voice duration formatted (e.g. 1d 12h 40m)
  const voiceMins = statistics?.voiceMinute[state.time] ?? 0;
  const voiceText = fct.formatVoiceTime(voiceMins);

  // Trophy score: bonus XP (0 if none)
  const trophyScore = statistics?.bonus[state.time] ?? 0;

  // Status indicator color
  let statusColor = '#22c55e';
  if (member?.presence?.status === 'idle') statusColor = '#f59e0b';
  else if (member?.presence?.status === 'dnd') statusColor = '#f43f5e';

  const imageBuffer = await renderRankCard({
    guildId: guild.id,
    userId: state.targetUser.id,
    time: state.time,
    rank: positions.xp,
    name: guildMemberInfo.name,
    handle,
    avatarUrl: state.targetUser.displayAvatarURL({ extension: 'png', size: 256 }),
    roleName,
    roleColor,
    level,
    currentXp: currentLevelProgressXp,
    nextLevelXp: neededLevelXp,
    progressRatio,
    chatMessages: statistics?.textMessage[state.time] ?? 0,
    voiceText,
    trophyScore,
    upvotes: statistics?.vote[state.time] ?? 0,
    showChat: Boolean(guildCache.db.textXp),
    showVoice: Boolean(guildCache.db.voiceXp),
    showTrophy: Boolean(guildCache.db.bonusXp),
    showUpvote: Boolean(guildCache.db.voteXp),
    statusColor,
    accentColor: '#36608e',
  });

  const attachment = new AttachmentBuilder(imageBuffer, { name: 'rank.png' });

  const timeSelectRow: ActionRowData<MessageActionRowComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: timeSelect.instanceId({ predicate: requireUserId(state.owner) }),
        disabled,
        options: statTimeIntervals.map((interval) => ({
          label: state.t(`rank.${interval}`),
          value: interval,
          default: state.time === interval,
        })),
      },
    ],
  };

  const bonusUntil = new Date(Number.parseInt(myGuild.bonusUntilDate) * 1000);
  const content =
    bonusUntil.getTime() > Date.now()
      ? `**${state.t('rank.bonusEnds', { date: time(bonusUntil, 'R') })}**`
      : null;

  return {
    content,
    files: [attachment],
    embeds: [],
    components: [timeSelectRow, ...getGlobalComponents(state, disabled)],
  };
}

async function generateChannelCard(
  state: CacheInstance,
  guild: Guild,
  myGuild: ShardDB.Guild,
  disabled: boolean,
): Promise<InteractionEditReplyOptions> {
  const page = fct.extractPageSimple(state.page, myGuild.entriesPerPage);

  const guildMemberInfo = await nameUtil.getGuildMemberInfo(guild, state.targetUser.id);

  const topText = await getTopChannelStrings(
    state.t,
    page,
    guild,
    state.targetUser.id,
    state.time,
    'textMessage',
  );
  const topVoice = await getTopChannelStrings(
    state.t,
    page,
    guild,
    state.targetUser.id,
    state.time,
    'voiceMinute',
  );

  const contents = [
    [topText, 'text'],
    [topVoice, 'voice'],
  ] as const;

  const activeContent = contents
    .filter(([val, _]) => val !== null)
    .map(([val, type]) => `## ${state.t(`rank.${type}`)}\n${val}`)
    .join('\n\n');

  const inactiveContent = contents
    .filter(([val, _]) => val === null)
    .map(([_, type]) => `-# ${state.t(`rank.${type}Empty`)}`)
    .join('\n');

  const description = [activeContent, inactiveContent].filter(Boolean).join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle(
      state.t(`rank.topChannelHeaders.${state.time}`, {
        name: guildMemberInfo.name,
      }),
    )
    .setColor(0x36608e)
    .setThumbnail(state.targetUser.displayAvatarURL({ size: 128 }))
    .setDescription(description || state.t('rank.textEmpty'));

  const timeSelectRow: ActionRowData<MessageActionRowComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: timeSelect.instanceId({ predicate: requireUserId(state.owner) }),
        disabled,
        options: statTimeIntervals.map((interval) => ({
          label: state.t(`rank.${interval}`),
          value: interval,
          default: state.time === interval,
        })),
      },
    ],
  };

  const pageRow: ActionRowData<MessageActionRowComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        emoji: { name: '⬅' },
        customId: pageButton.instanceId({
          data: { page: state.page - 1 },
          predicate: requireUserId(state.owner),
        }),
        style: ButtonStyle.Secondary,
        disabled: state.page <= 1 || disabled,
      },
      {
        type: ComponentType.Button,
        label: state.page.toString(),
        customId: ComponentKey.Throw,
        style: ButtonStyle.Primary,
        disabled: true,
      },
      {
        type: ComponentType.Button,
        emoji: { name: '➡️' },
        customId: pageButton.instanceId({
          data: { page: state.page + 1 },
          predicate: requireUserId(state.owner),
        }),
        style: ButtonStyle.Secondary,
        disabled,
      },
    ],
  };

  return {
    content: null,
    files: [],
    attachments: [],
    embeds: [embed],
    components: [timeSelectRow, pageRow, ...getGlobalComponents(state, disabled)],
  };
}

async function getTopChannelStrings(
  _t: TFunction<'command-content'>,
  page: { from: number; to: number },
  guild: Guild,
  memberId: string,
  time: StatTimeInterval,
  type: StatType,
): Promise<string | null> {
  const guildMemberTopChannels = await getGuildMemberTopChannels(
    guild,
    memberId,
    type,
    time,
    page.from,
    page.to,
  );

  if (!guildMemberTopChannels || guildMemberTopChannels.length === 0) {
    return null;
  }

  const channelMention = (index: number) =>
    nameUtil.getChannelMention(guild.channels.cache, guildMemberTopChannels[index].channelId);
  const label = type === 'voiceMinute' ? emoji('voice') : emoji('message');
  const channelValue = (index: number) =>
    type === 'voiceMinute'
      ? fct.formatVoiceTime(guildMemberTopChannels[index].entries)
      : guildMemberTopChannels[index].entries;

  const s = [];
  for (let i = 0; i < guildMemberTopChannels.length; i++)
    s.push(`**#${page.from + i}** ${channelMention(i)}: ${label} ${channelValue(i)}`);

  return s.join('\n');
}

function getGlobalComponents(
  state: CacheInstance,
  disabled: boolean,
): ActionRowData<MessageActionRowComponentData>[] {
  const pageComponent = (
    id: 'rank' | 'topChannels',
    label: string,
  ): MessageActionRowComponentData => ({
    type: ComponentType.Button,
    style: state.window === id ? ButtonStyle.Primary : ButtonStyle.Secondary,
    disabled: disabled || state.window === id,
    customId: windowButton.instanceId({ data: id, predicate: requireUserId(state.owner) }),
    label,
  });

  return [
    {
      type: ComponentType.ActionRow,
      components: [
        pageComponent('rank', state.t('rank.stats')),
        pageComponent('topChannels', state.t('rank.topChannels')),
      ],
    },
  ];
}

function getStatisticStrings(
  myGuild: GuildModel,
  stats: NonNullable<Awaited<ReturnType<typeof fetchGuildMemberStatistics>>>,
  positions: Record<string, number | null>,
  time: StatTimeInterval,
) {
  const scoreStrings = [];
  if (myGuild.db.textXp) {
    scoreStrings.push(
      positions.textMessage !== null
        ? `${emoji('message')} ${stats.textMessage[time]} (#${positions.textMessage})`
        : // don't show the rank if it's 0
        `${emoji('message')} ${stats.textMessage[time]}`,
    );
  }
  if (myGuild.db.voiceXp) {
    scoreStrings.push(
      positions.voiceMinute !== null
        ? `${emoji('voice')} ${fct.formatVoiceTime(stats.voiceMinute[time])} (#${positions.voiceMinute})`
        : `${emoji('voice')} ${fct.formatVoiceTime(stats.voiceMinute[time])}`,
    );
  }
  if (myGuild.db.inviteXp) {
    scoreStrings.push(
      positions.invite !== null
        ? `${emoji('invite')} ${stats.invite[time]} (#${positions.invite})`
        : `${emoji('invite')} ${stats.invite[time]}`,
    );
  }
  if (myGuild.db.voteXp) {
    scoreStrings.push(
      positions.vote !== null
        ? `${myGuild.db.voteEmote} ${stats.vote[time]} (#${positions.vote})`
        : `${myGuild.db.voteEmote} ${stats.vote[time]}`,
    );
  }
  if (myGuild.db.bonusXp) {
    scoreStrings.push(
      positions.bonus !== null
        ? `${myGuild.db.bonusEmote} ${stats.bonus[time]} (#${positions.bonus})`
        : `${myGuild.db.bonusEmote} ${stats.bonus[time]}`,
    );
  }

  return scoreStrings.join('\n');
}

async function getPositions<T extends StatType[]>(
  guild: Guild,
  memberId: string,
  types: T,
  time: StatTimeInterval,
): Promise<Record<T[number] | 'xp', number | null>> {
  const positions = types.map(
    async (t) =>
      [t, await getGuildMemberStatPosition(guild, memberId, t, time)] as [T[number], number],
  );
  const entries = await Promise.all([
    ...positions,
    (async () => ['xp', await getGuildMemberScorePosition(guild, memberId, time)])(),
  ]);
  return Object.fromEntries(entries);
}

function getTypes(myGuild: GuildModel): StatType[] {
  return [
    myGuild.db.textXp ? ('textMessage' as const) : null,
    myGuild.db.voiceXp ? ('voiceMinute' as const) : null,
    myGuild.db.inviteXp ? ('invite' as const) : null,
    myGuild.db.voteXp ? ('vote' as const) : null,
    myGuild.db.bonusXp ? ('bonus' as const) : null,
  ].filter((i) => i !== null);
}
