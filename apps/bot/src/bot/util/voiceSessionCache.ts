import type { GuildMember } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

interface VoiceSession {
  joinTime: number;
  minutesEarned: number;
  xpEarned: number;
  baseXpPerMinute: number;
  finalMultiplier: number;
}

// A highly optimized Map to store session data in memory.
export const voiceSessions = new Map<string, VoiceSession>();

export async function endAndReportVoiceSession(member: GuildMember) {
  const session = voiceSessions.get(member.id);
  if (!session) return;

  // Cleanup immediately to allow Garbage Collection and prevent memory leaks
  voiceSessions.delete(member.id);

  // If no XP was earned, don't send anything
  if (session.xpEarned <= 0 || session.minutesEarned <= 0) return;

  const durationMs = Date.now() - session.joinTime;
  const durationMin = Math.floor(durationMs / 60000);

  // Format total XP. Ensure it is nicely rounded if it has decimals.
  const totalXpStr = session.xpEarned % 1 === 0 ? session.xpEarned.toString() : session.xpEarned.toFixed(1);

  let xpText = `\`${totalXpStr} XP!\``;

  if (session.finalMultiplier > session.baseXpPerMinute && session.baseXpPerMinute > 0) {
    const totalBaseXp = session.minutesEarned * session.baseXpPerMinute;
    const multiplier = (session.finalMultiplier / session.baseXpPerMinute).toFixed(1);
    xpText = `\`${totalBaseXp} * ${multiplier}x = ${totalXpStr} XP!\``;
  }

  const hours = Math.floor(durationMin / 60);
  const remainingMins = durationMin % 60;

  let durationText = '';
  if (hours > 0) {
    durationText += `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  if (remainingMins > 0) {
    if (durationText) durationText += ' ';
    durationText += `${remainingMins} ${remainingMins === 1 ? 'minute' : 'minutes'}`;
  }
  if (!durationText) {
    durationText = `${durationMin} minutes`;
  }

  const embed = new EmbedBuilder()
    .setAuthor({
      name: 'Voice XP gained!',
      iconURL: member.guild.iconURL() ?? member.client.user.displayAvatarURL(),
    })
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(`Hey, **${member.displayName}** you were in Voice for **${durationText}**!\nGained: ${xpText}`)
    .setColor(0x36608e);

  try {
    await member.send({ embeds: [embed] });
  } catch (err) {
    // Member might have DMs disabled or bot is blocked, fail silently
  }
}
