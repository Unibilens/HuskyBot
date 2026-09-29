import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  console.log('[migrate] Starting database migration...');

  // Load keys from env or file
  let keys;
  if (process.env.KEYS_JSON) {
    keys = JSON.parse(process.env.KEYS_JSON);
  } else {
    const keysPath = path.join(__dirname, 'config', 'keys.json');
    keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  }

  const dbConfig = {
    host: keys.managerHost,
    user: keys.managerDb.dbUser,
    password: keys.managerDb.dbPassword,
    database: keys.managerDb.dbName,
    port: 3306,
    multipleStatements: true,
  };

  console.log(`[migrate] Connecting to ${dbConfig.host}:${dbConfig.port}...`);
  let connection;
  try {
    connection = await createConnection(dbConfig);
    console.log('[migrate] Connected!');
  } catch (err) {
    console.error('[migrate] Connection failed:', err.message);
    process.exit(1);
  }

  const migrationFiles = [
    path.join(__dirname, 'packages', 'database', 'migrations', 'manager', '001-init.up.sql'),
    path.join(__dirname, 'packages', 'database', 'migrations', 'shard', '001-init.up.sql'),
    path.join(__dirname, 'packages', 'database', 'migrations', 'shard', '002-leaderboard.up.sql'),
    path.join(__dirname, 'packages', 'database', 'migrations', 'shard', '003-guildtag.up.sql'),
    path.join(__dirname, 'packages', 'database', 'migrations', 'shard', '004-guildtag-message.up.sql'),
    path.join(__dirname, 'packages', 'database', 'migrations', 'shard', '005-gift.up.sql'),
    path.join(__dirname, 'packages', 'database', 'migrations', 'shard', '006-notifyvoicesessiondm.up.sql'),
  ];

  for (const filePath of migrationFiles) {
    const sql = fs.readFileSync(filePath, 'utf8');

    // Remove CREATE DATABASE and USE statements - Railway uses one shared DB
    const cleanedSql = sql
      .split('\n')
      .filter((line) => {
        const upper = line.trim().toUpperCase();
        return !upper.startsWith('CREATE DATABASE') && !upper.startsWith('USE ');
      })
      .join('\n');

    const statements = cleanedSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await connection.query(stmt);
      } catch (err) {
        // Ignore "table already exists" and duplicate column errors
        if (err.code !== 'ER_TABLE_EXISTS_ERROR' && err.code !== 'ER_DUP_FIELDNAME') {
          console.warn(`[migrate] Warning on: ${stmt.substring(0, 60)}...`, err.message);
        }
      }
    }
    console.log(`[migrate] Applied: ${path.basename(filePath)}`);
  }

  // Also insert a default dbShard row that the bot needs, using the correct host
  try {
    await connection.query(
      'INSERT INTO `dbShard` (`id`, `hostExtern`, `hostIntern`, `host`) VALUES (0, ?, ?, ?) ON DUPLICATE KEY UPDATE `hostExtern`=VALUES(`hostExtern`), `hostIntern`=VALUES(`hostIntern`), `host`=VALUES(`host`)',
      [dbConfig.host, dbConfig.host, dbConfig.host],
    );
    console.log('[migrate] Inserted/Updated default dbShard row with host:', dbConfig.host);
  } catch (err) {
    console.warn('[migrate] dbShard insert warning:', err.message);
  }

  console.log('[migrate] Migration complete!');
  await connection.end();
}

runMigrations().catch((err) => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
