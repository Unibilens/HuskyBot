import { Events } from 'discord.js';
import { handleMemberJoin } from '#bot/util/memberJoin.ts';
import { event } from '#bot/util/registry/event.ts';

import { checkAndApplyGuildTag } from '#bot/util/guildTagUtil.ts';

export default event(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (oldMember.pending && !newMember.pending) await handleMemberJoin(newMember);

  await checkAndApplyGuildTag(newMember);
});
