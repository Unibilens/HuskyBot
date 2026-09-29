import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Attachment,
  AttachmentBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ModalSubmitInteraction,
  Routes,
  WebhookClient,
} from 'discord.js';
import { command } from '#bot/commands.ts';
import { container, section, textDisplay } from '#bot/util/component.ts';
import { PREMIUM_BUTTON } from '#bot/util/constants.ts';
import { logger } from '#bot/util/logger.ts';
import { modal } from '#bot/util/registry/component.ts';
import { oneline } from '#bot/util/templateStrings.ts';
import { config, emoji, getStaffEntitlement } from '#const/config.ts';
import { hasValidEntitlement } from '#util/fct.ts';

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILE = fileURLToPath(
  new URL('../../../.cache/customize-cooldowns.json', import.meta.url),
);
const CACHE_DIR = path.dirname(CACHE_FILE);
const guildCooldowns = new Map<string, number>();

// Load persisted cooldowns on start
try {
  const data = await readFile(CACHE_FILE, 'utf8');
  const parsed = JSON.parse(data) as Record<string, number>;
  const now = Date.now();
  for (const [guildId, expiry] of Object.entries(parsed)) {
    if (typeof expiry === 'number' && expiry > now) {
      guildCooldowns.set(guildId, expiry);
    }
  }
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    logger.warn({ err }, 'Failed to load customize cooldowns cache');
  } // Cache file does not exist yet or is invalid
}

function cleanupExpiredCooldowns(now = Date.now()) {
  for (const [guildId, expiry] of guildCooldowns.entries()) {
    if (expiry <= now) {
      guildCooldowns.delete(guildId);
    }
  }
}

async function persistCooldowns() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    cleanupExpiredCooldowns();
    const obj: Record<string, number> = {};
    for (const [guildId, expiry] of guildCooldowns.entries()) {
      obj[guildId] = expiry;
    }
    await writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    logger.warn({ err }, 'Failed to persist customize cooldowns cache');
  } // Fail silently if cache write fails
}

function getGuildCooldown(guildId: string): { onCooldown: boolean; expiresTimestamp: number } {
  const now = Date.now();
  const expires = guildCooldowns.get(guildId);
  if (expires) {
    if (expires > now) {
      return {
        onCooldown: true,
        expiresTimestamp: Math.floor(expires / 1000),
      };
    }
    // Garbage collection: remove expired entry immediately
    guildCooldowns.delete(guildId);
  }
  return { onCooldown: false, expiresTimestamp: 0 };
}

function setGuildCooldown(guildId: string) {
  guildCooldowns.set(guildId, Date.now() + COOLDOWN_MS);
  void persistCooldowns();
}

function buildCooldownResponse(expiresTimestamp: number) {
  return {
    components: [
      container(
        [
          textDisplay('## Command on Cooldown'),
          textDisplay(
            oneline`
              Bot branding customization for this server is on cooldown. \
              To prevent abuse, bot branding can only be changed once every **24 hours**.`,
          ),
          textDisplay(
            `Next change available: <t:${expiresTimestamp}:R> (<t:${expiresTimestamp}:F>)`,
          ),
        ],
        { accentColor: 0xffa500 },
      ),
    ],
    allowedMentions: { parse: [] },
    flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
  } as const;
}

export default command({
  name: 'customize-bot',
  async execute({ interaction }) {
    if (!interaction.inCachedGuild()) return;

    if (!hasValidEntitlement(interaction)) {
      await interaction.reply({
        components: [
          container(
            [
              textDisplay('## This command requires Premium!'),
              textDisplay(
                oneline`
                  ${interaction.user.toString()}, please consider helping us by becoming a Premium supporter. \
                  The bot is mostly free! Activating Premium for you or your server gives you quality of life \
                  upgrades, like the ability to change your bot's banner and profile picture.`,
              ),
              section(
                {
                  type: ComponentType.TextDisplay,
                  content: `To support a server you love and help us improve the bot for everyone, consider **activating ${emoji('store')} Premium** for your server!`,
                },
                PREMIUM_BUTTON,
              ),
              textDisplay(`### ${emoji('activityrank')} Thank you for your support!`),
            ],
            { accentColor: 0x36608e },
          ),
        ],
        allowedMentions: { parse: [] },
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      });
      return;
    }

    const isStaff = getStaffEntitlement(interaction.user.id).isStaff;
    const cd = getGuildCooldown(interaction.guild.id);
    if (cd.onCooldown && !isStaff) {
      await interaction.reply(buildCooldownResponse(cd.expiresTimestamp));
      return;
    }

    await interaction.showModal({
      title: 'Customize Branding',
      custom_id: setModal.instanceId({ data: null }),
      components: [
        {
          type: ComponentType.Label,
          label: 'Profile Picture',
          description: "Edit Husky's avatar in your server.",
          component: {
            type: ComponentType.FileUpload,
            custom_id: 'avatar',
            required: false,
          },
        },
        {
          type: ComponentType.Label,
          label: 'Banner',
          component: {
            type: ComponentType.FileUpload,
            custom_id: 'banner',
            required: false,
          },
        },
      ],
    });
  },
});

const setModal = modal({
  async callback({ interaction }) {
    if (!interaction.inCachedGuild()) return;

    const isStaff = getStaffEntitlement(interaction.user.id).isStaff;
    const cd = getGuildCooldown(interaction.guild.id);
    if (cd.onCooldown && !isStaff) {
      await interaction.reply(buildCooldownResponse(cd.expiresTimestamp));
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const avatar = interaction.fields.getUploadedFiles('avatar')?.first() ?? null;
    const banner = interaction.fields.getUploadedFiles('banner')?.first() ?? null;

    const avatarData = await resolveImageData(avatar);
    const bannerData = await resolveImageData(banner);

    // If an upload was provided but failed validation (invalid mime type, too large, corrupt)
    if ((avatar && !avatarData) || (banner && !bannerData)) {
      await interaction.editReply({
        components: [
          container(
            [
              textDisplay('## ❌ Invalid Image File'),
              textDisplay(
                'The uploaded image is invalid or unsupported. Please upload a PNG or JPEG file under 10MB.',
              ),
            ],
            { accentColor: 0xed4245 },
          ),
        ],
        allowedMentions: { parse: [] },
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    try {
      await interaction.client.rest.patch(Routes.guildMember(interaction.guild.id, '@me'), {
        body: {
          avatar: avatarData?.dataUri ?? null,
          banner: bannerData?.dataUri ?? null,
        },
      });
    } catch (err) {
      interaction.client.logger.error(
        { err, guildId: interaction.guild.id, userId: interaction.user.id },
        'Failed to patch bot branding',
      );
      await interaction.editReply({
        components: [
          container(
            [
              textDisplay('## ❌ Failed to Update Branding'),
              textDisplay(
                'An error occurred while updating the bot branding. Please check permissions and try again later.',
              ),
            ],
            { accentColor: 0xed4245 },
          ),
        ],
        allowedMentions: { parse: [] },
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Set cooldown only after a successful patch
    setGuildCooldown(interaction.guild.id);

    // Free large base64 strings from memory before audit log sending and garbage collection
    const avatarAudit = avatarData
      ? { buffer: avatarData.buffer, contentType: avatarData.contentType }
      : null;
    const bannerAudit = bannerData
      ? { buffer: bannerData.buffer, contentType: bannerData.contentType }
      : null;
    if (avatarData) avatarData.dataUri = '';
    if (bannerData) bannerData.dataUri = '';

    interaction.client.logger.info(
      {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guild.id,
        guildName: interaction.guild.name,
        hasAvatar: Boolean(avatarAudit),
        hasBanner: Boolean(bannerAudit),
      },
      'Bot branding customized',
    );

    await sendCustomizeAuditLog({
      interaction,
      avatar: avatarAudit,
      banner: bannerAudit,
    });

    const hasChanges = Boolean(avatarAudit || bannerAudit);
    await interaction.editReply({
      components: [
        container(
          [
            textDisplay('## ✅ Bot Branding Updated'),
            textDisplay(
              hasChanges
                ? "Husky's branding has been successfully updated for this server!"
                : "Husky's branding has been reset to default for this server.",
            ),
            textDisplay(
              `Next change available: <t:${Math.floor((Date.now() + COOLDOWN_MS) / 1000)}:R>`,
            ),
          ],
          { accentColor: 0x57f287 },
        ),
      ],
      allowedMentions: { parse: [] },
      flags: [MessageFlags.IsComponentsV2],
    });
  },
});

interface ImageData {
  buffer: Buffer;
  contentType: string;
  dataUri: string;
}

async function resolveImageData(image: Attachment | null): Promise<ImageData | null> {
  if (!image) return null;
  if (!['image/jpg', 'image/jpeg', 'image/png'].includes(image.contentType ?? '')) return null;
  if (image.size && image.size > 10 * 1024 * 1024) return null;

  try {
    const res = await fetch(image.url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || image.contentType || 'image/png';
    const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;

    return {
      buffer,
      contentType,
      dataUri,
    };
  } catch {
    return null;
  }
}

function getImageExtension(contentType: string): string {
  return contentType === 'image/jpeg' || contentType === 'image/jpg' ? 'jpg' : 'png';
}

let cachedWebhook: WebhookClient | null = null;
let cachedWebhookUrl: string | null = null;

function getWebhookClient(url: string): WebhookClient {
  if (!cachedWebhook || cachedWebhookUrl !== url) {
    cachedWebhook?.destroy();
    cachedWebhook = new WebhookClient({ url });
    cachedWebhookUrl = url;
  }
  return cachedWebhook;
}

interface AuditImage {
  buffer: Buffer;
  contentType: string;
}

async function sendCustomizeAuditLog({
  interaction,
  avatar,
  banner,
}: {
  interaction: ModalSubmitInteraction<'cached'>;
  avatar: AuditImage | null;
  banner: AuditImage | null;
}) {
  const webhookUrl = config.LogWebhook || process.env.LOG_WEBHOOK_URL;
  if (!webhookUrl) {
    interaction.client.logger.debug(
      'LogWebhook not configured in config.json, skipping audit webhook.',
    );
    return;
  }

  try {
    const webhook = getWebhookClient(webhookUrl);
    const files: AttachmentBuilder[] = [];

    const now = Math.floor(Date.now() / 1000);
    const embed = new EmbedBuilder()
      .setTitle('Bot Branding Customized')
      .setColor(0x5865f2)
      .setAuthor({
        name: `${interaction.user.tag} (${interaction.user.id})`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .addFields(
        {
          name: 'User:',
          value: `${interaction.user.toString()} (\`${interaction.user.tag}\`)\n**ID:** \`${interaction.user.id}\``,
          inline: true,
        },
        {
          name: 'Server:',
          value: `**${interaction.guild.name}**\n**ID:** \`${interaction.guild.id}\``,
          inline: true,
        },
        {
          name: 'Time:',
          value: `<t:${now}:F> (<t:${now}:R>)`,
          inline: false,
        },
        {
          name: 'Changes:',
          value: [
            `• **Avatar:** ${avatar ? '`✅ Uploaded`' : '`❌ None`'}`,
            `• **Banner:** ${banner ? '`✅ Uploaded`' : '`❌ None`'}`,
          ].join('\n'),
          inline: false,
        },
        {
          name: 'Quick Moderation', //it's kinda no need but i like it :)
          value: [
            '```sh',
            `/blacklist user user:${interaction.user.id}`,
            `/blacklist guild id:${interaction.guild.id}`,
            '```',
          ].join('\n'),
          inline: false,
        },
      )
      .setTimestamp();

    if (avatar) {
      const ext = getImageExtension(avatar.contentType);
      files.push(new AttachmentBuilder(avatar.buffer, { name: `avatar.${ext}` }));
      embed.setThumbnail(`attachment://avatar.${ext}`);
    }

    if (banner) {
      const ext = getImageExtension(banner.contentType);
      files.push(new AttachmentBuilder(banner.buffer, { name: `banner.${ext}` }));
      embed.setImage(`attachment://banner.${ext}`);
    }

    await webhook.send({
      username: 'Husky Audit Logs',
      avatarURL: interaction.client.user?.displayAvatarURL(),
      embeds: [embed],
      files,
    });
  } catch (err) {
    interaction.client.logger.error({ err }, 'Failed to send customize audit webhook');
  }
}
