import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TTLCache from '@isaacs/ttlcache';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { Time } from '@sapphire/duration';

// Register Inter fonts from local assets
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const regularFont = path.join(__dirname, '../assets/fonts/Inter-Regular.woff');
const boldFont = path.join(__dirname, '../assets/fonts/Inter-Bold.woff');

try {
  GlobalFonts.registerFromPath(regularFont, 'Inter');
  GlobalFonts.registerFromPath(boldFont, 'Inter');
} catch (e) {
  console.error('Failed to register Inter font for rank image:', e);
}

// In-memory cache for rendered rank cards (45 seconds TTL) to prevent spam and CPU exhaustion
const rankImageCache = new TTLCache<string, Buffer>({
  max: 200,
  ttl: Time.Second * 45,
});

export function formatCompactNumber(num: number): string {
  if (num === null || num === undefined || Number.isNaN(num)) return '0';
  if (Math.abs(num) < 10_000) return Math.round(num).toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(num)
    .toLowerCase();
}

export interface RankCardData {
  guildId: string;
  userId: string;
  time: string;
  rank: number | null;
  name: string;
  handle?: string;
  avatarUrl?: string | null;
  roleName?: string;
  roleColor?: string;
  level: number;
  currentXp: number;
  nextLevelXp: number;
  progressRatio: number;
  chatMessages: number;
  voiceText: string;
  trophyScore: number;
  upvotes?: number;
  showChat?: boolean;
  showVoice?: boolean;
  showTrophy?: boolean;
  showUpvote?: boolean;
  statusColor?: string;
  accentColor?: string;
}

export async function renderRankCard(data: RankCardData): Promise<Buffer> {
  const cacheKey = `${data.guildId}:${data.userId}:${data.time}:${data.showChat}:${data.showVoice}:${data.showTrophy}:${data.showUpvote}`;
  const cached = rankImageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const width = 440;
  const height = 244;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Outer canvas clear
  ctx.clearRect(0, 0, width, height);

  // Card boundary with rounded corners - matching website preview
  const cardX = 0;
  const cardY = 0;
  const cardW = width;
  const cardH = height;
  const cardRadius = 16;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, cardRadius);
  ctx.fillStyle = '#141720';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.stroke();
  ctx.restore();

  const contentLeft = 28;
  const contentRight = width - 28;
  const accentColor = data.accentColor || '#36608e';

  // 1. Profile Section (Avatar + User Info + RANK Badge on Right)
  const avatarCenterX = contentLeft + 32;
  const avatarCenterY = 62;
  const avatarRadius = 32;

  // Outer accent ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius + 2.5, 0, Math.PI * 2);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Clip circular avatar
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let avatarLoaded = false;
  if (data.avatarUrl) {
    try {
      const res = await fetch(data.avatarUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ActivityBot/1.0)' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const img = await loadImage(Buffer.from(arrayBuf));
        ctx.drawImage(
          img,
          avatarCenterX - avatarRadius,
          avatarCenterY - avatarRadius,
          avatarRadius * 2,
          avatarRadius * 2,
        );
        avatarLoaded = true;
      }
    } catch {
      avatarLoaded = false;
    }
  }

  if (!avatarLoaded) {
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(
      avatarCenterX - avatarRadius,
      avatarCenterY - avatarRadius,
      avatarRadius * 2,
      avatarRadius * 2,
    );
    ctx.font = 'bold 30px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((data.name || '?')[0].toUpperCase(), avatarCenterX, avatarCenterY);
  }
  ctx.restore();

  // Status indicator dot (bottom-right of avatar)
  const angle = Math.PI / 4.2;
  const statusX = avatarCenterX + (avatarRadius + 1) * Math.cos(angle);
  const statusY = avatarCenterY + (avatarRadius + 1) * Math.sin(angle);
  const statusRadius = 7;

  ctx.save();
  ctx.beginPath();
  ctx.arc(statusX, statusY, statusRadius + 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#141720';
  ctx.fill();

  const statusColor = data.statusColor || '#22c55e'; // active green
  ctx.beginPath();
  ctx.arc(statusX, statusY, statusRadius, 0, Math.PI * 2);
  ctx.fillStyle = statusColor;
  ctx.fill();
  ctx.restore();

  // Rank Badge on Right
  const rankText = data.rank ? `RANK #${data.rank}` : 'UNRANKED';
  ctx.save();
  ctx.font = 'bold 12px Inter, sans-serif';
  const rankTextWidth = ctx.measureText(rankText).width;
  const badgePadX = 10;
  const badgeH = 26;
  const badgeW = rankTextWidth + badgePadX * 2;
  const badgeX = contentRight - badgeW;
  const badgeY = avatarCenterY - 13;

  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#f59e0b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(rankText, badgeX + badgeW / 2, badgeY + badgeH / 2);
  ctx.restore();

  // User text details (middle)
  const userTextX = contentLeft + 76;
  const maxNameWidth = badgeX - userTextX - 12;

  ctx.save();
  ctx.font = 'bold 20px Inter, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const nameY = avatarCenterY - 4;

  // Measure and truncate name if it exceeds bounds
  let displayName = data.name || 'User';
  let nameWidth = ctx.measureText(displayName).width;
  if (nameWidth > maxNameWidth - 45) {
    while (nameWidth > maxNameWidth - 60 && displayName.length > 3) {
      displayName = displayName.slice(0, -1);
      nameWidth = ctx.measureText(`${displayName}..`).width;
    }
    displayName = `${displayName}..`;
  }
  ctx.fillText(displayName, userTextX, nameY);

  if (data.handle && nameWidth + 50 < maxNameWidth) {
    ctx.font = '600 14px Inter, sans-serif';
    ctx.fillStyle = '#78889b';
    ctx.fillText(` ${data.handle}`, userTextX + nameWidth, nameY);
  }

  // Role Pill Badge
  if (data.roleName) {
    const roleY = avatarCenterY + 8;
    const roleH = 22;
    ctx.font = 'bold 11px Inter, sans-serif';
    let roleText = data.roleName;
    let roleTextW = ctx.measureText(roleText).width;
    if (roleTextW > maxNameWidth - 28) {
      roleText = `${roleText.slice(0, 14)}..`;
      roleTextW = ctx.measureText(roleText).width;
    }
    const rolePadX = 8;
    const roleW = roleTextW + rolePadX * 2;

    const roleColor = data.roleColor || '#7983f5';
    ctx.beginPath();
    ctx.roundRect(userTextX, roleY, roleW, roleH, 4);
    ctx.fillStyle = 'rgba(88, 101, 242, 0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(88, 101, 242, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = roleColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(roleText, userTextX + roleW / 2, roleY + roleH / 2);
  }
  ctx.restore();

  // 2. Level & XP Progress Section
  const xpTopY = 124;

  ctx.save();
  // "Level {level}"
  ctx.font = 'bold 14px Inter, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Level ${data.level ?? 1}`, contentLeft, xpTopY);

  // XP progress text (formatted with compact notation when >= 100k)
  const currXpStr =
    (data.currentXp ?? 0) >= 100_000
      ? formatCompactNumber(data.currentXp)
      : (data.currentXp ?? 0).toLocaleString('en-US');
  const nextXpStr =
    (data.nextLevelXp ?? 0) >= 100_000
      ? formatCompactNumber(data.nextLevelXp)
      : (data.nextLevelXp ?? 0).toLocaleString('en-US');

  ctx.font = 'bold 13px Inter, sans-serif';
  ctx.fillStyle = '#8e9caa';
  ctx.textAlign = 'right';
  ctx.fillText(`${currXpStr} / ${nextXpStr} XP`, contentRight, xpTopY);

  // Progress Bar
  const barY = xpTopY + 8;
  const barH = 8;
  const barW = contentRight - contentLeft;
  const barRadius = 4;

  // Track
  ctx.beginPath();
  ctx.roundRect(contentLeft, barY, barW, barH, barRadius);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();

  // Fill
  const progressRatio = Math.max(0, Math.min(1, data.progressRatio ?? 0));
  if (progressRatio > 0) {
    const fillW = Math.max(barH, barW * progressRatio);
    ctx.beginPath();
    ctx.roundRect(contentLeft, barY, fillW, barH, barRadius);
    ctx.fillStyle = accentColor;
    ctx.fill();
  }
  ctx.restore();

  // Subtle Stats Divider
  const dividerY = 168;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentLeft, dividerY);
  ctx.lineTo(contentRight, dividerY);
  ctx.stroke();
  ctx.restore();

  // 3. Bottom Stats Row (Dynamic: Chat -> Voice -> Trophy -> Upvote)
  const statsItems: Array<{ label: string; value: string }> = [];

  if (data.showChat !== false) {
    statsItems.push({
      label: 'Chat',
      value: formatCompactNumber(data.chatMessages ?? 0),
    });
  }

  if (data.showVoice !== false) {
    statsItems.push({
      label: 'Voice',
      value: data.voiceText ?? '0m',
    });
  }

  if (data.showTrophy !== false) {
    statsItems.push({
      label: 'Trophy',
      value: formatCompactNumber(data.trophyScore ?? 0),
    });
  }

  if (data.showUpvote !== false) {
    statsItems.push({
      label: 'Upvote',
      value: formatCompactNumber(data.upvotes ?? 0),
    });
  }

  if (statsItems.length > 0) {
    const colWidth = (contentRight - contentLeft) / statsItems.length;
    const statsY = 208;

    statsItems.forEach((item, index) => {
      ctx.save();
      const startX = contentLeft + index * colWidth;

      let fontSize = 14;
      ctx.font = `bold ${fontSize}px Inter, sans-serif`;
      const labelText = `${item.label}: `;
      let totalW = ctx.measureText(labelText).width + ctx.measureText(item.value).width;
      const maxAllowedW = colWidth - 6;

      while (totalW > maxAllowedW && fontSize > 10) {
        fontSize -= 0.5;
        ctx.font = `bold ${fontSize}px Inter, sans-serif`;
        totalW = ctx.measureText(labelText).width + ctx.measureText(item.value).width;
      }

      ctx.fillStyle = '#8e9caa';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(labelText, startX, statsY);
      const labelW = ctx.measureText(labelText).width;

      ctx.fillStyle = '#ffffff';
      ctx.fillText(item.value, startX + labelW, statsY);
      ctx.restore();
    });
  }

  const buffer = canvas.toBuffer('image/png');
  rankImageCache.set(cacheKey, buffer);
  return buffer;
}
