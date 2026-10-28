// Copies every table of the local database to a JSON file and back, through Prisma.
// Used to move a local database to a new cluster, e.g. a WIN1252 one to UTF-8:
//
//   node --env-file=.env scripts/db-copy.mjs export backup.json
//   (recreate .pgdata, then npm run db:start and npx prisma migrate deploy)
//   node --env-file=.env scripts/db-copy.mjs import backup.json
import fs from 'node:fs';
import { PrismaClient, Prisma } from '@prisma/client';

const [mode, file] = process.argv.slice(2);
if (!['export', 'import'].includes(mode) || !file) {
  console.error('Usage: node --env-file=.env scripts/db-copy.mjs export|import <file.json>');
  process.exit(1);
}

const db = new PrismaClient();
const models = Prisma.dmmf.datamodel.models;
const delegate = (name) => db[name[0].toLowerCase() + name.slice(1)];

if (mode === 'export') {
  const data = {};
  for (const model of models) data[model.name] = await delegate(model.name).findMany();
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  for (const [name, rows] of Object.entries(data)) if (rows.length) console.log(`${name}: ${rows.length}`);
  console.log(`Exported to ${file}`);
} else {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Rows go in with foreign-key checks off (replica mode), so table order doesn't matter.
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      for (const model of models) {
        const rows = data[model.name] ?? [];
        if (!rows.length) continue;
        // A null in an optional Json column has to be left out (Prisma needs JsonNull, not null).
        const jsonFields = model.fields.filter((f) => f.type === 'Json').map((f) => f.name);
        const clean = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => !(v === null && jsonFields.includes(k)))));
        await tx[model.name[0].toLowerCase() + model.name.slice(1)].createMany({ data: clean });
        console.log(`${model.name}: ${rows.length}`);
      }
    },
    { timeout: 120_000 }
  );
  console.log(`Imported ${file}`);
}
await db.$disconnect();
