// Creates the first administrator, then emails them a link to choose a password.
// Does nothing when users already exist, so it is safe to run repeatedly.
//
//   npm run db:seed                       (reads ADMIN_NAME and ADMIN_EMAIL from .env)
//   npm run db:seed -- --name "Ada Lovelace" --email ada@company.com
import { PrismaClient } from '@prisma/client';
import { issueInvite } from '../src/lib/invites.js';
import { validateEmail, validateName } from '../src/lib/validation.js';

const prisma = new PrismaClient();

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rawName = arg('--name') ?? process.env.ADMIN_NAME;
  const rawEmail = arg('--email') ?? process.env.ADMIN_EMAIL;

  if ((await prisma.user.count({ where: { deletedAt: null } })) > 0) {
    // Lost the invitation email? Re-send it to any admin who has not chosen a password yet.
    const waiting = await prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null, passwordHash: null },
    });
    if (waiting.length > 0 && process.argv.includes('--resend')) {
      for (const admin of waiting) {
        const { link, delivery } = await issueInvite(admin, { inviterName: 'AgentQA setup', origin: process.env.APP_URL });
        console.log(
          delivery.mode === 'smtp'
            ? `Invitation re-sent to ${admin.email}.`
            : `No mail server configured. Set-password link for ${admin.email} (valid 48 hours): ${link}`
        );
      }
      return;
    }
    console.log(
      waiting.length > 0
        ? 'Users already exist. An admin has not set a password yet: run "npm run db:seed -- --resend" to send a new invitation.'
        : 'Users already exist, nothing to do. Add more people from Settings > Team.'
    );
    return;
  }

  const name = validateName(rawName);
  const email = validateEmail(rawEmail);
  if (name.error || email.error) {
    console.error('Set ADMIN_NAME and ADMIN_EMAIL in .env (or pass --name and --email) to create the first admin.');
    console.error([name.error && `name: ${name.error}`, email.error && `email: ${email.error}`].filter(Boolean).join('; '));
    process.exitCode = 1;
    return;
  }

  const parts = name.value.split(' ');
  const admin = await prisma.user.create({
    data: {
      name: name.value,
      email: email.value,
      role: 'ADMIN',
      avatar: ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase(),
    },
  });

  await prisma.auditEvent.create({
    data: { userId: admin.id, action: 'user.created', target: admin.name, details: 'First administrator created during setup' },
  });

  const { link, delivery } = await issueInvite(admin, {
    inviterName: 'AgentQA setup',
    origin: process.env.APP_URL,
  });

  console.log(`Created administrator ${admin.name} <${admin.email}>.`);
  if (delivery.mode === 'smtp') {
    console.log('An invitation email was sent. Open it and choose a password.');
  } else {
    console.log('No mail server is configured, so nothing was emailed. Open this one-time link to choose a password:');
  }
  console.log(`Set-password link (valid 48 hours): ${link}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
