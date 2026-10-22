// Deletes EVERY row from the local development database (users, projects, audit log, all of it).
// Tables and migrations are kept. Refuses to run without --yes, or when NODE_ENV is production.
//
//   npm run db:wipe -- --yes
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to wipe a production database.');
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.error('This deletes all data. Run again with --yes to confirm:  npm run db:wipe -- --yes');
  process.exit(1);
}

const prisma = new PrismaClient();

// Children before parents so foreign keys never block a delete.
const MODELS = [
  'passwordToken', 'comment', 'approval', 'cIFailure', 'cIRun', 'workflowCheckpoint', 'workflowRun',
  'testCase', 'requirement', 'projectMember', 'auditEvent', 'project', 'user',
];

try {
  for (const model of MODELS) {
    const { count } = await prisma[model].deleteMany();
    console.log(`${model}: removed ${count}`);
  }
  console.log('Database is empty.');
} finally {
  await prisma.$disconnect();
}
