import { Events } from 'discord.js';
import { checkAndApplyGuildTag } from '#bot/util/guildTagUtil.ts';
import { event } from '#bot/util/registry/event.ts';

export default event(Events.Raw, async function (this: any, data: any) {
  if (!this || !this.guilds) return;

  // Listen directly to raw websocket packets to catch Discord's new primary_guild property
  if (
    data.t === 'GUILD_MEMBER_UPDATE' ||
    data.t === 'USER_UPDATE' ||
    data.t === 'PRESENCE_UPDATE'
  ) {
    const rawData = data.d;
    const userId = rawData?.user?.id ?? rawData?.id;
    if (!rawData || !userId) return;

    // Performance optimization: Only proceed if this update actually contains clan / primary_guild info
    const hasClanInfo =
      (rawData?.user && ('primary_guild' in rawData.user || 'primaryGuild' in rawData.user)) ||
      'primary_guild' in rawData ||
      'primaryGuild' in rawData;
    if (!hasClanInfo && data.t === 'PRESENCE_UPDATE') return;

    // If guild_id is not directly in rawData (e.g. USER_UPDATE), check cached guilds
    const guildIds = rawData.guild_id ? [rawData.guild_id] : Array.from(this.guilds.cache.keys());

    for (const guildId of guildIds as string[]) {
      const guild = this.guilds.cache.get(guildId);
      if (!guild) continue;

      try {
        const member = await guild.members.fetch(userId);
        if (member) {
          await checkAndApplyGuildTag(member, rawData);
        }
      } catch {
        // Ignore if member is not in this guild
      }
    }
  }
});
