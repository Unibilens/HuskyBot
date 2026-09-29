import { MessageFlags } from 'discord.js';
import { command } from '#bot/commands.ts';
import { resolveMember } from '#bot/util/parser.ts';
import statFlushCache from '../statFlushCache.ts';
import { getGuildModel } from '../models/guild/guildModel.ts';
import { shards } from '#models/shardDb/shardDb.ts';
import type { StatFlushCache } from '../statFlushCache.ts';

export default command({
    name: 'gift',
    async execute({ interaction, options, t }) {
        const cachedGuild = await getGuildModel(interaction.guild);
        if (!cachedGuild.db.giftEnabled) {
            await interaction.reply({
                content: t('gift.disabled'),
                flags: 64,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetMember = await resolveMember(options.member, interaction);
        if (!targetMember) {
            await interaction.editReply({
                content: t('missing.notOnServer'),
            });
            return;
        }
        if (targetMember.user.bot) {
            await interaction.editReply({
                content: t('gift.cannotGiftBot'),
            });
            return;
        }
        if (targetMember.id === interaction.member.id) {
            await interaction.editReply({
                content: t('gift.cannotGiftSelf'),
            });
            return;
        }
        const amount = options.amount;
        const { dbHost } = cachedGuild;
        const senderBonus = await shards
            .get(dbHost)
            .db.selectFrom('bonus')
            .select('alltime')
            .where('guildId', '=', interaction.guild.id)
            .where('userId', '=', interaction.member.id)
            .executeTakeFirst();

        // Pending (not yet flushed) cache changes for this user
        const allFlushCaches = interaction.client.statFlushCache as Record<string, StatFlushCache> | undefined;
        const flushCache = allFlushCaches?.[dbHost];
        const pendingChange = flushCache?.bonus?.[interaction.member.id]?.count ?? 0;

        const dbBonus = senderBonus?.alltime ?? 0;
        const senderCurrentBonus = dbBonus + pendingChange;

        if (senderCurrentBonus <= 0) {
            await interaction.editReply({
                content: t('gift.noBonus'),
            });
            return;
        }
        if (senderCurrentBonus < amount) {
            await interaction.editReply({
                content: t('gift.insufficientBonus', { current: senderCurrentBonus, amount }),
            });
            return;
        }
        await statFlushCache.addBonus(interaction.member, -amount);
        await statFlushCache.addBonus(targetMember, amount);
        await interaction.deleteReply();
        await interaction.followUp({
            embeds: [{
                title: t('gift.successTitle'),
                color: 0x36608e,
                description: t('gift.successDesc', { amount, member: targetMember.toString() }),
            }],
        });
    },
});