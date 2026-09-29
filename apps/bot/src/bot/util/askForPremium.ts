import { type ChatInputCommandInteraction, ComponentType, MessageFlags } from 'discord.js';
import { getGuildModel } from '#bot/models/guild/guildModel.ts';
import { emoji } from '#const/config.ts';
import fct, { hasValidEntitlement } from '../../util/fct.ts';
import { getUserModel } from '../models/userModel.ts';
import { section } from './component.ts';
import { PATREON_BUTTON, PATREON_URL, PREMIUM_BUTTON } from './constants.ts';
import { getWaitTime } from './cooldownUtil.ts';
import { oneline } from './templateStrings.ts';

const isDev = process.env.NODE_ENV !== 'production';

const askForPremiumCdGuild = isDev ? 3600 * 0.4 : 3600 * 0.4;
const askForPremiumCdUser = isDev ? 3600 * 6 : 3600 * 6;

export async function askForPremium(interaction: ChatInputCommandInteraction<'cached'>) {
  // Patreon ads have been disabled
  return;
}

async function sendAskForPremiumRequest(interaction: ChatInputCommandInteraction<'cached'>) {
  await interaction.followUp({
    components: [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: '## Husky depends on your support!',
          },
          {
            type: ComponentType.TextDisplay,
            content: oneline`
              ${interaction.user.toString()}, please consider helping us by becoming a Premium supporter. \
              The bot is mostly free! Activating Premium for you or your server can unlock some new \
              features and gives you quality of life upgrades, like reduced cooldowns on commands.`,
          },
          {
            type: ComponentType.Section,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: `To remove these ads and support the bot, please consider **[becoming a Patron](<${PATREON_URL}>)**.`,
              },
            ],
            accessory: PATREON_BUTTON,
          },
          section(
            {
              type: ComponentType.TextDisplay,
              content: `To support a server you love and help us improve the bot for everyone, consider **activating ${emoji('store')} Premium** for your server!`,
            },
            PREMIUM_BUTTON,
          ),
          {
            type: ComponentType.TextDisplay,
            content: `### ${emoji('activityrank')} Thank you for your support!`,
          },
        ],
        accentColor: 0x36608e,
      },
    ],
    allowedMentions: { parse: [] },
    flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
  });
}
