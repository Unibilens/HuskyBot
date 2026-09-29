import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { SystemStats } from './systemStats.ts';

// Register Inter fonts from local assets so text renders properly in Linux/Docker
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const regularFont = path.join(__dirname, '../assets/fonts/Inter-Regular.woff');
const boldFont = path.join(__dirname, '../assets/fonts/Inter-Bold.woff');

try {
  GlobalFonts.registerFromPath(regularFont, 'Inter');
  GlobalFonts.registerFromPath(boldFont, 'Inter');
} catch (e) {
  console.error('Failed to register Inter font:', e);
}

function drawServerIcon(ctx: any, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = '#c4c9ce';
  ctx.fillStyle = '#c4c9ce';
  ctx.lineWidth = 1.8;

  // 3 stacked server units
  for (let i = 0; i < 3; i++) {
    const y = cy - 11 + i * 8.5;
    ctx.beginPath();
    ctx.roundRect(cx - 12, y, 24, 6, 2);
    ctx.stroke();

    // Small LED dot
    ctx.beginPath();
    ctx.arc(cx + 7, y + 3, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawUserIcon(ctx: any, cx: number, cy: number) {
  ctx.save();
  ctx.fillStyle = '#c4c9ce';
  // Head
  ctx.beginPath();
  ctx.arc(cx, cy - 5, 5.5, 0, Math.PI * 2);
  ctx.fill();
  // Torso
  ctx.beginPath();
  ctx.arc(cx, cy + 9, 8.5, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCpuIcon(ctx: any, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = '#c4c9ce';
  ctx.fillStyle = '#c4c9ce';
  ctx.lineWidth = 1.8;

  // Center chip body
  ctx.beginPath();
  ctx.roundRect(cx - 7.5, cy - 7.5, 15, 15, 3);
  ctx.stroke();

  // Core inside
  ctx.fillRect(cx - 3.5, cy - 3.5, 7, 7);

  // Connection pins
  const pinLen = 3;
  ctx.beginPath();
  // Top pins
  ctx.moveTo(cx - 3.5, cy - 7.5);
  ctx.lineTo(cx - 3.5, cy - 7.5 - pinLen);
  ctx.moveTo(cx + 3.5, cy - 7.5);
  ctx.lineTo(cx + 3.5, cy - 7.5 - pinLen);
  // Bottom pins
  ctx.moveTo(cx - 3.5, cy + 7.5);
  ctx.lineTo(cx - 3.5, cy + 7.5 + pinLen);
  ctx.moveTo(cx + 3.5, cy + 7.5);
  ctx.lineTo(cx + 3.5, cy + 7.5 + pinLen);
  // Left pins
  ctx.moveTo(cx - 7.5, cy - 3.5);
  ctx.lineTo(cx - 7.5 - pinLen, cy - 3.5);
  ctx.moveTo(cx - 7.5, cy + 3.5);
  ctx.lineTo(cx - 7.5 - pinLen, cy + 3.5);
  // Right pins
  ctx.moveTo(cx + 7.5, cy - 3.5);
  ctx.lineTo(cx + 7.5 + pinLen, cy - 3.5);
  ctx.moveTo(cx + 7.5, cy + 3.5);
  ctx.lineTo(cx + 7.5 + pinLen, cy + 3.5);
  ctx.stroke();

  ctx.restore();
}

function drawRamIcon(ctx: any, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = '#c4c9ce';
  ctx.fillStyle = '#c4c9ce';
  ctx.lineWidth = 1.8;

  // Horizontal RAM module
  ctx.beginPath();
  ctx.roundRect(cx - 12, cy - 6, 24, 12, 2.5);
  ctx.stroke();

  // Integrated chip modules
  ctx.fillRect(cx - 8.5, cy - 3.5, 3.5, 5);
  ctx.fillRect(cx - 2, cy - 3.5, 3.5, 5);
  ctx.fillRect(cx + 4.5, cy - 3.5, 3.5, 5);

  // Bottom contact pins
  ctx.beginPath();
  for (let i = -8; i <= 8; i += 3.5) {
    ctx.moveTo(cx + i, cy + 6);
    ctx.lineTo(cx + i, cy + 8);
  }
  ctx.stroke();
  ctx.restore();
}

function drawWifiIcon(ctx: any, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = '#23a55a';
  ctx.fillStyle = '#23a55a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  // Center beacon dot
  ctx.beginPath();
  ctx.arc(cx, cy + 4, 2, 0, Math.PI * 2);
  ctx.fill();

  // Inner signal arc
  ctx.beginPath();
  ctx.arc(cx, cy + 4, 6.5, -Math.PI * 0.75, -Math.PI * 0.25);
  ctx.stroke();

  // Outer signal arc
  ctx.beginPath();
  ctx.arc(cx, cy + 4, 11.5, -Math.PI * 0.75, -Math.PI * 0.25);
  ctx.stroke();

  ctx.restore();
}

export function renderStatsCard(stats: SystemStats): Buffer {
  // Tight card dimensions - no huge outer black frame
  const width = 890;
  const height = 460;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Main Card Body with rounded corners
  const cardR = 24;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, cardR);
  ctx.fillStyle = '#13161f';
  ctx.fill();

  // Subtle Card Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // LEFT BOX: Shard Status & Ping
  const leftX = 25;
  const leftY = 25;
  const leftW = 375;
  const leftH = 355;
  const boxR = 18;

  // Left Box Background
  ctx.beginPath();
  ctx.roundRect(leftX, leftY, leftW, leftH, boxR);
  ctx.fillStyle = '#1f2127';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Shard Status Title
  ctx.font = '600 23px Inter, sans-serif';
  ctx.fillStyle = '#f0f2f5';
  ctx.textAlign = 'center';
  ctx.fillText('Shard Status', leftX + leftW / 2, leftY + 52);

  // Big Number (Shard Count)
  ctx.font = 'bold 92px Inter, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(stats.shardCount), leftX + leftW / 2, leftY + 178);

  // Online status indicator
  const statusY = leftY + 252;
  ctx.save();
  ctx.shadowColor = 'rgba(35, 165, 90, 0.6)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#23a55a';
  ctx.beginPath();
  ctx.arc(leftX + leftW / 2 - 48, statusY - 6, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.font = '500 20px Inter, sans-serif';
  ctx.fillStyle = '#9aa0a6';
  ctx.textAlign = 'left';
  const onlineLabel = `${stats.onlineShards} online`;
  ctx.fillText(onlineLabel, leftX + leftW / 2 - 34, statusY);

  // Ping Row inside left box
  const pingY = leftY + 302;
  drawWifiIcon(ctx, leftX + leftW / 2 - 50, pingY - 8);
  ctx.font = '500 20px Inter, sans-serif';
  ctx.fillStyle = '#c4c9ce';
  ctx.fillText(`Ping: ${stats.currentShardPing}ms`, leftX + leftW / 2 - 34, pingY);

  // RIGHT BOX: Hardware & Metrics
  const rightX = 425;
  const rightY = 25;
  const rightW = 440;
  const rightH = 355;

  // Right Box Background
  ctx.beginPath();
  ctx.roundRect(rightX, rightY, rightW, rightH, boxR);
  ctx.fillStyle = '#1f2127';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Metrics items
  const items = [
    {
      icon: drawServerIcon,
      label: 'Servers:',
      value: stats.totalGuilds.toLocaleString('en-US'),
    },
    {
      icon: drawUserIcon,
      label: 'Users:',
      value: stats.totalUsers.toLocaleString('en-US'),
    },
    {
      icon: drawCpuIcon,
      label: 'CPU Usage:',
      value: `${stats.cpuPercent}%`,
    },
    {
      icon: drawRamIcon,
      label: 'Memory Usage:',
      value: `[${stats.ramPercent}%] [${stats.ramUsedMb.toLocaleString('en-US')} MB | ${stats.ramTotalMb.toLocaleString('en-US')} MB]`,
    },
  ];

  const rowStartY = rightY + 28;
  const rowSpacing = 78;

  items.forEach((item, index) => {
    const y = rowStartY + index * rowSpacing;
    const badgeX = rightX + 24;
    const badgeY = y;
    const badgeSize = 48;

    // Squircle Icon Badge
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeSize, badgeSize, 13);
    ctx.fillStyle = '#292b34';
    ctx.fill();

    // Draw Vector Icon
    item.icon(ctx, badgeX + badgeSize / 2, badgeY + badgeSize / 2);

    // Label & Value
    const textX = badgeX + badgeSize + 18;
    if (index === 3) {
      // Memory: Two-line layout for clarity
      ctx.font = '500 16px Inter, sans-serif';
      ctx.fillStyle = '#9aa0a6';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, textX, badgeY + 18);

      ctx.font = '600 18px Inter, sans-serif';
      ctx.fillStyle = '#f0f2f5';
      ctx.fillText(item.value, textX, badgeY + 41);
    } else {
      ctx.font = '500 19px Inter, sans-serif';
      ctx.fillStyle = '#9aa0a6';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, textX, badgeY + 31);

      const labelWidth = ctx.measureText(item.label).width;
      ctx.font = '600 19px Inter, sans-serif';
      ctx.fillStyle = '#f0f2f5';
      ctx.fillText(item.value, textX + labelWidth + 8, badgeY + 31);
    }
  });

  // Footer: Uptime (centered in the bottom area)
  ctx.font = '500 17px Inter, sans-serif';
  ctx.fillStyle = '#8a919c';
  ctx.textAlign = 'center';
  ctx.fillText(`Uptime: ${stats.uptimeFormatted}`, width / 2, 422);

  return canvas.toBuffer('image/png');
}
