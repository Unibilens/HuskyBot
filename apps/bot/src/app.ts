import { fileURLToPath } from 'node:url';
import { ShardingManager, type ShardingManagerOptions } from 'discord.js';
import { exposedPort, keys } from '#const/config.ts';
import scheduler from './cron/scheduler.ts';
import fct from './util/fct.ts';
import logger from './util/logger.ts';

if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production')
  process.env.NODE_ENV = 'development';

const managerOptions: ShardingManagerOptions = { token: keys.botAuth };

const manager = new ShardingManager(
  fileURLToPath(new URL('./bot/bot.ts', import.meta.url)),
  managerOptions,
);
// Catch shard-level errors (e.g. ShardingReadyDied from proxy 502) so they don't
// crash the entire Manager process as unhandled EventEmitter errors.
manager.on('shardCreate', (shard) => {
  shard.on('error', (err) => {
    logger.error(err, `Shard ${shard.id} encountered an error`);
  });
});

const MAX_START_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 5_000;

start().catch(async (e) => {
  logger.fatal(e, 'Manager failed to start after all retries');
  await fct.sleep(500);
  process.exit();
});

async function start() {
  for (let attempt = 1; attempt <= MAX_START_RETRIES; attempt++) {
    try {
      await manager.spawn({ delay: 10000, timeout: 120000 });
      await scheduler.start(manager);
      return; // success
    } catch (e) {
      const delay = INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1); // 5s, 10s, 20s, 40s, 80s
      logger.error(
        e,
        `Manager start attempt ${attempt}/${MAX_START_RETRIES} failed. ${attempt < MAX_START_RETRIES ? `Retrying in ${delay / 1000}s...` : 'No retries left.'}`,
      );

      if (attempt === MAX_START_RETRIES) throw e;

      // Clean up any partially spawned shards before retrying to avoid
      // ShardingAlreadySpawned errors and orphaned processes
      for (const shard of manager.shards.values()) {
        try {
          shard.kill();
        } catch {
          // ignore cleanup errors on dead shards
        }
      }
      manager.shards.clear();

      await fct.sleep(delay);
    }
  }
}

// Process Exit
process.on('SIGINT', () => {
  logger.warn('SIGINT signal received in Manager');
  process.exit();
});

process.on('SIGTERM', () => {
  logger.warn('SIGTERM signal received in Manager');
  process.exit();
});

import { serve } from '@hono/node-server';
import { createRouter } from './router.ts';

serve({ fetch: createRouter(manager).fetch, port: exposedPort });
logger.info(`Server listening on port ${exposedPort}`);
logger.info(`[http://0.0.0.0:${exposedPort}]`);

import type pino from 'pino';
import type { StatFlushCache } from '#bot/statFlushCache.ts';
import type { XpFlushCache } from '#bot/xpFlushCache.ts';

declare module 'discord.js' {
  export interface Client {
    logger: pino.Logger;
    statFlushCache: Record<string, StatFlushCache>;
    xpFlushCache: Record<string, XpFlushCache>;
    botShardStat: { commandsTotal: number; textMessagesTotal: number };
  }
}
