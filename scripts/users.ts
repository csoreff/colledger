/**
 * Account management from the command line, for the things a web form
 * shouldn't do: minting the first admin, resetting a forgotten password, and
 * claiming the ledger that existed before this app had logins.
 *
 *   npm run users -- list
 *   npm run users -- create --email me@example.com --password '…' [--name 'Me'] [--admin]
 *   npm run users -- password --email me@example.com --password '…'
 *   npm run users -- claim --email me@example.com [--password '…']
 *   npm run users -- role --email me@example.com --role ADMIN|USER
 *
 * `claim` is the one to reach for after upgrading an existing database. The
 * multi-user migration parked every pre-existing row on a placeholder account;
 * claiming either renames that placeholder to you (when the email is new) or
 * moves its rows onto the account you already registered.
 */
import { PrismaClient, type UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const LEGACY_ID = "legacy-owner";
const MIN_PASSWORD_LENGTH = 10;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function requireEmail(): string {
  const email = arg("email")?.trim().toLowerCase();
  if (!email) fail("Pass --email.");
  return email;
}

function requirePassword(): string {
  const password = arg("password");
  if (!password) fail("Pass --password.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

const hash = (plaintext: string) => bcrypt.hash(plaintext, 12);

async function list(): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { items: true, purchases: true, sales: true, apiKeys: true } },
    },
  });

  if (users.length === 0) {
    console.log("\n  No accounts yet. Register one in the app, or use `create`.\n");
    return;
  }

  console.log("");
  for (const user of users) {
    const marks = [
      user.role,
      user.isActive ? null : "INACTIVE",
      user.passwordHash ? null : "NO PASSWORD",
      // Claiming renames the placeholder in place, so its id stays
      // `legacy-owner` forever. What actually distinguishes an unclaimed
      // ledger is that nobody has set a password on it yet.
      user.id === LEGACY_ID && !user.passwordHash ? "UNCLAIMED LEGACY LEDGER" : null,
    ].filter(Boolean);

    console.log(`  ${user.email}  [${marks.join(", ")}]`);
    console.log(
      `    ${user._count.items} items · ${user._count.purchases} purchases · ` +
        `${user._count.sales} sales · ${user._count.apiKeys} API keys`,
    );
  }
  console.log("");
}

async function create(): Promise<void> {
  const email = requireEmail();
  const password = requirePassword();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) fail(`${email} already has an account. Use \`password\` to reset it.`);

  const user = await prisma.user.create({
    data: {
      email,
      name: arg("name") ?? null,
      passwordHash: await hash(password),
      role: flag("admin") ? "ADMIN" : "USER",
    },
  });
  console.log(`\n  Created ${user.email} as ${user.role}.\n`);
}

async function setPassword(): Promise<void> {
  const email = requireEmail();
  const password = requirePassword();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) fail(`No account for ${email}.`);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(password) },
  });
  console.log(`\n  Password updated for ${email}.\n`);
}

async function setRole(): Promise<void> {
  const email = requireEmail();
  const role = (arg("role") ?? "").toUpperCase() as UserRole;
  if (role !== "ADMIN" && role !== "USER") fail("Pass --role ADMIN or --role USER.");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) fail(`No account for ${email}.`);

  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log(`\n  ${email} is now ${role}.\n`);
}

/**
 * Hands the pre-login ledger to a real account.
 *
 * When the email is not yet in use this renames the placeholder in place, which
 * moves no rows at all. When you have already registered, the rows are
 * repointed at that account instead and the placeholder is dropped.
 */
async function claim(): Promise<void> {
  const email = requireEmail();

  const legacy = await prisma.user.findUnique({
    where: { id: LEGACY_ID },
    include: { _count: { select: { items: true, expenses: true } } },
  });
  if (!legacy) {
    fail("There is no unclaimed legacy ledger — nothing to claim.");
  }

  // A claimed ledger keeps the `legacy-owner` id, so without this check a
  // second `claim` would quietly hand somebody's entire collection to a
  // different account.
  if (legacy.passwordHash) {
    fail(
      `The legacy ledger has already been claimed by ${legacy.email}. ` +
        "Use `password` to reset that account's password instead.",
    );
  }

  const target = await prisma.user.findUnique({ where: { email } });

  if (!target) {
    const password = requirePassword();
    await prisma.user.update({
      where: { id: LEGACY_ID },
      data: {
        email,
        name: arg("name") ?? null,
        passwordHash: await hash(password),
        role: "ADMIN",
      },
    });
    console.log(
      `\n  ${email} now owns the original ledger ` +
        `(${legacy._count.items} items, ${legacy._count.expenses} expenses). ` +
        "No rows were moved.\n",
    );
    return;
  }

  if (target.id === LEGACY_ID) fail(`${email} already owns the legacy ledger.`);

  // Moving rows between accounts: do it in one transaction so a failure
  // part-way can't leave the ledger split across two owners.
  const moved = await prisma.$transaction(async (tx) => {
    const counts = {
      items: (await tx.item.updateMany({
        where: { userId: LEGACY_ID },
        data: { userId: target.id },
      })).count,
      purchases: (await tx.purchase.updateMany({
        where: { userId: LEGACY_ID },
        data: { userId: target.id },
      })).count,
      expenses: (await tx.expense.updateMany({
        where: { userId: LEGACY_ID },
        data: { userId: target.id },
      })).count,
      sales: (await tx.sale.updateMany({
        where: { userId: LEGACY_ID },
        data: { userId: target.id },
      })).count,
    };

    // Comp searches are cached per user and keyed by (userId, cacheKey). If the
    // claiming account has already run the same search, moving would collide on
    // that unique index, so drop the duplicate rather than fail the claim.
    const existingKeys = new Set(
      (
        await tx.compSearch.findMany({
          where: { userId: target.id },
          select: { cacheKey: true },
        })
      ).map((s) => s.cacheKey),
    );
    const legacySearches = await tx.compSearch.findMany({
      where: { userId: LEGACY_ID },
      select: { id: true, cacheKey: true },
    });

    let searches = 0;
    for (const search of legacySearches) {
      if (existingKeys.has(search.cacheKey)) {
        await tx.compSearch.delete({ where: { id: search.id } });
      } else {
        await tx.compSearch.update({
          where: { id: search.id },
          data: { userId: target.id },
        });
        searches += 1;
      }
    }

    await tx.user.delete({ where: { id: LEGACY_ID } });
    return { ...counts, searches };
  });

  console.log(
    `\n  Moved to ${email}: ${moved.items} items, ${moved.purchases} purchases, ` +
      `${moved.expenses} expenses, ${moved.sales} sales, ${moved.searches} comp searches.`,
  );

  // Deliberately not promoted automatically: moving data is not a reason to
  // hand out admin rights. Say so rather than leave it to be discovered when
  // an admin-scoped API key can't be created.
  if (target.role !== "ADMIN") {
    console.log(
      `\n  Note: ${email} is a regular user. Admin rights are needed to mint\n` +
        `  API keys that reach other accounts — grant them with:\n` +
        `    npm run users -- role --email ${email} --role ADMIN`,
    );
  }
  console.log("");
}

const COMMANDS: Record<string, () => Promise<void>> = {
  list,
  create,
  password: setPassword,
  role: setRole,
  claim,
};

async function main(): Promise<void> {
  const command = process.argv[2];
  const run = command ? COMMANDS[command] : undefined;
  if (!run) {
    fail(`Usage: npm run users -- <${Object.keys(COMMANDS).join("|")}> [options]`);
  }
  await run();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
