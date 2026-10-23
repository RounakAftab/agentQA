// Local development PostgreSQL, run from npm binaries (no system install needed).
// Data lives in ./.pgdata (gitignored). For production, point DATABASE_URL at any
// hosted Postgres instead and skip this script.
import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = 54329;
const DB_NAME = 'agentqa';
const dataDir = path.resolve('.pgdata');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'agentqa',
  password: 'agentqa',
  port: PORT,
  persistent: true,
  // UTF-8 regardless of the OS locale (Windows defaults to WIN1252, which rejects emoji and
  // most non-Latin text). Only applies when .pgdata is first created.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
  console.log('Initialising new database cluster in .pgdata ...');
  await pg.initialise();
}

await pg.start();

try {
  await pg.createDatabase(DB_NAME);
  console.log(`Created database "${DB_NAME}"`);
} catch (err) {
  if (!String(err.message).includes('already exists')) throw err;
}

console.log(`PostgreSQL ready: postgresql://agentqa:agentqa@localhost:${PORT}/${DB_NAME}`);
console.log('Press Ctrl+C to stop.');

const shutdown = async () => {
  console.log('\nStopping PostgreSQL ...');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
