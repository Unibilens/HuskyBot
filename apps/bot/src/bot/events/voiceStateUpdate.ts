import { Events, type VoiceState } from 'discord.js';
import { getMemberModel } from '#bot/models/guild/guildMemberModel.ts';
import { getGuildModel } from '#bot/models/guild/guildModel.ts';
import { event } from '#bot/util/registry/event.ts';
import { endAndReportVoiceSession, voiceSessions } from '#bot/util/voiceSessionCache.ts';

export default event(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const joined = !oldState.channelId && newState.channelId;
  const left = oldState.channelId && !newState.channelId;
  
  if (joined) {
    // Check if the guild has the notification feature enabled before allocating memory for the session
    const cachedGuild = await getGuildModel(member.guild);
    if (!cachedGuild.db.notifyVoiceSessionDm) return;

    // Check if the member has enabled DM notifications in /config-member
    const cachedMember = await getMemberModel(member);
    if (!cachedMember.db.notifyLevelupDm) return;

    voiceSessions.set(member.id, {
      joinTime: Date.now(),
      minutesEarned: 0,
      xpEarned: 0,
      baseXpPerMinute: 0,
      finalMultiplier: 0,
    });
  } else if (left) {
    // Completely left the voice channels. Let's finish the session and optionally DM the user.
    await endAndReportVoiceSession(member);
  }
});
