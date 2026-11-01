import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';

// __dirname = dist/apps/api/src/cli → up 7 levels to the repo root (same .env as main.ts)
config({ path: resolve(__dirname, '../../../../../../../.env') });

import { createInterface } from 'node:readline';
import { prisma } from '@app/db';

import { hashPassword } from '../modules/auth/auth.crypto';

/**
 * Server-side account admin — the only way to create accounts or recover one
 * now that sign-up and the master password are gone. Run over SSH:
 *
 *   pnpm --filter api auth:cli list
 *   pnpm --filter api auth:cli create-user <email> <name>
 *   pnpm --filter api auth:cli set-password <email> [--temp]
 *   pnpm --filter api auth:cli reset-2fa <email>
 *   pnpm --filter api auth:cli logout-all <email>
 *
 * Passwords are read from a hidden prompt (or stdin when piped), never argv.
 * `--temp` makes the next login demand a new password.
 */
const USAGE = `usage: auth:cli <list | create-user <email> <name> | set-password <email> [--temp] | reset-2fa <email> | logout-all <email>>`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const email = args[0]?.trim().toLowerCase();

  switch (command) {
    case 'list': {
      const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
      for (const u of users) {
        const sessions = await prisma.session.count({ where: { userId: u.id, expiresAt: { gt: new Date() } } });
        console.log(
          `${u.email}  name=${u.name}  2fa=${u.totpEnabledAt ? 'on' : 'off'}  mustChangePassword=${u.mustChangePassword}  activeSessions=${sessions}`
        );
      }
      return;
    }
    case 'create-user': {
      const name = args.slice(1).join(' ').trim();
      if (!email || !name) throw new Error(USAGE);
      const password = await readNewPassword();
      await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(password), mustChangePassword: true } });
      console.log(`created ${email} — the first login asks for a new password, then 2FA setup`);
      return;
    }
    case 'set-password': {
      const user = await requireUser(email);
      const temp = args.includes('--temp');
      const password = await readNewPassword();
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), mustChangePassword: temp, passwordChangedAt: new Date() }
      });
      const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
      console.log(`password set for ${user.email}${temp ? ' (temporary — must change on next login)' : ''}; ${count} session(s) logged out`);
      return;
    }
    case 'reset-2fa': {
      const user = await requireUser(email);
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } }),
        prisma.authBackupCode.deleteMany({ where: { userId: user.id } }),
        prisma.trustedDevice.deleteMany({ where: { userId: user.id } }),
        prisma.session.deleteMany({ where: { userId: user.id } })
      ]);
      console.log(`2FA reset for ${user.email} — the next login sets it up again`);
      return;
    }
    case 'logout-all': {
      const user = await requireUser(email);
      const sessions = await prisma.session.deleteMany({ where: { userId: user.id } });
      const devices = await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });
      console.log(`${user.email}: ${sessions.count} session(s) and ${devices.count} trusted device(s) removed`);
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

async function requireUser(email: string | undefined) {
  if (!email) throw new Error(USAGE);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no user with email ${email}`);
  return user;
}

async function readNewPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const piped = (await readAll()).replace(/\r?\n$/, '');
    if (piped.length < 8) throw new Error('password from stdin must be at least 8 characters');
    return piped;
  }
  const first = await promptHidden('New password: ');
  if (first.length < 10) throw new Error('password must be at least 10 characters');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('passwords do not match');
  return first;
}

function readAll(): Promise<string> {
  return new Promise((done) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => done(data));
  });
}

/** Prompt whose answer is not echoed. */
function promptHidden(question: string): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    output._writeToOutput = (s: string) => {
      if (!prompted) {
        prompted = true;
        output.output.write(s);
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      done(answer);
    });
  });
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
