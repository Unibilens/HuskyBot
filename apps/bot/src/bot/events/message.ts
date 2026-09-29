import { ChannelType, Events, type Message, MessageType } from 'discord.js';
import { getRoleModel } from '#bot/models/guild/guildRoleModel.ts';
import { event } from '#bot/util/registry/event.ts';
import guildChannelModel from '../models/guild/guildChannelModel.ts';
import { getMemberModel } from '../models/guild/guildMemberModel.ts';
import { type GuildModel, getGuildModel } from '../models/guild/guildModel.ts';
import skip from '../skip.ts';
import statFlushCache from '../statFlushCache.ts';

const acceptedChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];
const acceptedMessageTypes = [MessageType.Default, MessageType.Reply];

// Synchronous lock to prevent race conditions — blocks concurrent processing for the same user.
const processingLocks = new Set<string>();
// Cooldown map — only updated when XP is actually earned.
const textCooldowns = new Map<string, number>();

export default event(Events.MessageCreate, async (message) => {
  if (
    message.author.bot ||
    message.system ||
    skip() ||
    !acceptedMessageTypes.includes(message.type) ||
    !message.inGuild()
  )
    return;

  const cachedGuild = await getGuildModel(message.guild);

  const mentionRegex = new RegExp(`^(<@!?${message.client.user.id}>)\\s*test\\s*$`);
  if (message.content && mentionRegex.test(message.content))
    await message.reply('This test is successful. The bot is up and running.');

  if (!message.channel) {
    // TODO: find why this might occur
    message.client.logger.warn({ message }, 'Message.channel undefined');
  }

  if (cachedGuild.db.textXp && acceptedChannelTypes.includes(message.channel.type))
    await rankMessage(message, cachedGuild);
});

async function rankMessage(msg: Message<true>, cachedGuild: GuildModel) {
  if (!msg.channel) return;

  const cooldownKey = `${msg.guild.id}-${msg.author.id}`;
  const now = Date.now();

  // If this user already has a message being processed, skip (prevents race condition).
  if (processingLocks.has(cooldownKey)) return;

  // Check cooldown
  if (typeof cachedGuild.db.textMessageCooldownSeconds !== 'undefined') {
    const lastTimestamp = textCooldowns.get(cooldownKey);
    if (
      lastTimestamp &&
      now - lastTimestamp < cachedGuild.db.textMessageCooldownSeconds * 1000
    )
      return;
  }

  // Lock this user so concurrent messages are blocked during async checks.
  processingLocks.add(cooldownKey);

  try {
    const channel = msg.channel.isThread() ? msg.channel.parent : msg.channel;
    if (!channel) throw new Error('no channel defined in rankMessage second stage');

    await msg.guild.members.fetch(msg.author.id);

    if (!msg.member) return;

    const cachedMember = await getMemberModel(msg.member);
    cachedMember.cache.lastMessageChannelId = msg.channel.id;

    // Check noxp channel
    const cachedChannel = await guildChannelModel.cache.get(channel);

    if (cachedChannel.db.noXp) return;

    const category = channel?.parent;
    if (category) {
      const cachedParent = await guildChannelModel.cache.get(category);
      if (cachedParent.db.noXp) return;
    }

    // Check noxp role
    for (const role of msg.member.roles.cache.values()) {
      const cachedRole = await getRoleModel(role);

      if (cachedRole.db.noXp) return;
    }

    // All checks passed — set cooldown and award XP.
    textCooldowns.set(cooldownKey, Date.now());

    msg.client.botShardStat.textMessagesTotal++;

    // Add Score
    await statFlushCache.addTextMessage(msg.member, channel, 1);
  } finally {
    processingLocks.delete(cooldownKey);
  }
}

