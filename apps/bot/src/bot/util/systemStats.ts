import fs from 'node:fs';
import os from 'node:os';
import type { Client } from 'discord.js';

export interface ShardSummary {
  id: number;
  ping: number;
  status: number;
  guilds: number;
  users: number;
  rss: number;
}

export interface SystemStats {
  shardCount: number;
  currentShardId: number;
  onlineShards: number;
  issueShards: number;
  currentShardPing: number;
  minPing: number;
  maxPing: number;
  totalGuilds: number;
  totalUsers: number;
  cpuPercent: string;
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  uptimeMs: number;
  uptimeFormatted: string;
}

export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);

  return parts.join(' ');
}

let lastCpuSnapshot = readCpuTimes();
let lastCpuTime = Date.now();
let currentCpuPercent = '0.0';

function readCpuTimes(): { idle: number; total: number } {
  // Linux / Docker / Raspberry Pi 5: Direct read from /proc/stat for host CPU ticks
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const firstLine = stat.split('\n')[0];
    if (firstLine?.startsWith('cpu ')) {
      const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);
      const [
        user = 0,
        nice = 0,
        system = 0,
        idle = 0,
        iowait = 0,
        irq = 0,
        softirq = 0,
        steal = 0,
      ] = parts;
      const idleTime = idle + iowait;
      const totalTime = user + nice + system + idleTime + irq + softirq + steal;
      return { idle: idleTime, total: totalTime };
    }
  } catch {
    // Non-linux (e.g. local macOS dev) or fallback
  }

  // Fallback to os.cpus()
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const t of Object.keys(c.times) as (keyof typeof c.times)[]) {
      total += c.times[t];
    }
    idle += c.times.idle;
  }
  return { idle, total };
}

function updateCpuUsage(): string {
  const current = readCpuTimes();
  const now = Date.now();
  const elapsedMs = now - lastCpuTime;

  if (elapsedMs >= 500) {
    const idleDiff = current.idle - lastCpuSnapshot.idle;
    const totalDiff = current.total - lastCpuSnapshot.total;
    if (totalDiff > 0) {
      const rawCpu = 100 - (100 * idleDiff) / totalDiff;
      const clamped = Math.min(100, Math.max(0.1, Number.isFinite(rawCpu) ? rawCpu : 0.1));
      currentCpuPercent = clamped.toFixed(1);
    }
    lastCpuSnapshot = current;
    lastCpuTime = now;
  }

  return currentCpuPercent;
}

// Background rolling sampler every 2 seconds
const cpuInterval = setInterval(updateCpuUsage, 2000);
cpuInterval.unref();

function getSystemMemory() {
  // Linux / Docker / Raspberry Pi 5: Read /proc/meminfo for true host system memory
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (totalMatch && availMatch) {
      const totalKb = Number.parseInt(totalMatch[1], 10);
      const availKb = Number.parseInt(availMatch[1], 10);
      const usedKb = totalKb - availKb;
      const totalMb = Math.round(totalKb / 1024);
      const usedMb = Math.round(usedKb / 1024);
      const percent = Math.min(100, Math.max(1, Math.round((usedKb / totalKb) * 100)));
      return { totalMb, usedMb, percent };
    }
  } catch {
    // Non-linux or fallback
  }

  // Fallback using os.totalmem and os.freemem
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const percent = Math.min(100, Math.max(1, Math.round((usedMem / totalMem) * 100)));
  const usedMb = Math.round(usedMem / (1024 * 1024));
  const totalMb = Math.round(totalMem / (1024 * 1024));
  return { totalMb, usedMb, percent };
}

export async function getSystemStats(client: Client, currentShardId = 0): Promise<SystemStats> {
  const cpuStart = readCpuTimes();
  const startTime = Date.now();

  let shardData: ShardSummary[] = [];

  if (client.shard && client.shard.count > 0) {
    try {
      shardData = await client.shard.broadcastEval((c) => ({
        id: c.shard?.ids[0] ?? 0,
        ping: c.ws.ping,
        status: c.ws.status,
        guilds: c.guilds.cache.size,
        users: c.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
        rss: process.memoryUsage().rss,
      }));
    } catch {
      shardData = [];
    }
  }

  if (shardData.length === 0) {
    shardData = [
      {
        id: currentShardId,
        ping: client.ws.ping,
        status: client.ws.status,
        guilds: client.guilds.cache.size,
        users: client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
        rss: process.memoryUsage().rss,
      },
    ];
  }

  // Dynamic real-time CPU percentage calculation
  let cpuPercent = updateCpuUsage();
  if (cpuPercent === '0.0') {
    const elapsed = Date.now() - startTime;
    if (elapsed < 150) {
      await new Promise((resolve) => setTimeout(resolve, 150 - elapsed));
    }
    const cpuEnd = readCpuTimes();
    const idleDiff = cpuEnd.idle - cpuStart.idle;
    const totalDiff = cpuEnd.total - cpuStart.total;
    const rawCpu = totalDiff > 0 ? 100 - (100 * idleDiff) / totalDiff : 0;
    cpuPercent = Math.min(100, Math.max(0.1, Number.isFinite(rawCpu) ? rawCpu : 0.1)).toFixed(1);
  }

  const shardCount = client.shard?.count ?? shardData.length;
  const onlineShards = shardData.filter((s) => s.status === 0).length;
  const issueShards = shardCount - onlineShards;

  const validPings = shardData.map((s) => s.ping).filter((p) => p > 0);
  const currentShardPing =
    client.ws.ping > 0
      ? Math.round(client.ws.ping)
      : validPings.length > 0
        ? Math.round(validPings[0])
        : 45;
  const minPing = validPings.length > 0 ? Math.round(Math.min(...validPings)) : currentShardPing;
  const maxPing = validPings.length > 0 ? Math.round(Math.max(...validPings)) : currentShardPing;

  const totalGuilds = shardData.reduce((acc, s) => acc + s.guilds, 0);
  const totalUsers = shardData.reduce((acc, s) => acc + s.users, 0);

  const mem = getSystemMemory();

  const uptimeMs = client.uptime ?? 0;
  const uptimeFormatted = formatUptime(uptimeMs);

  return {
    shardCount,
    currentShardId,
    onlineShards,
    issueShards,
    currentShardPing,
    minPing,
    maxPing,
    totalGuilds,
    totalUsers,
    cpuPercent,
    ramPercent: mem.percent,
    ramUsedMb: mem.usedMb,
    ramTotalMb: mem.totalMb,
    uptimeMs,
    uptimeFormatted,
  };
}
