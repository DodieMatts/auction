import "dotenv/config";
import * as argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { UserRole, UserStatus } from "../src/generated/prisma/enums";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(name: string, email: string): string {
  const normalizedEmail = normalizeEmail(email);

  if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 320) {
    throw new Error(`${name} must be a valid email address`);
  }

  return normalizedEmail;
}

function validatePassword(name: string, password: string): string {
  if (password.length < 8 || password.length > 128) {
    throw new Error(`${name} must be between 8 and 128 characters`);
  }

  return password;
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seeding is blocked in production");
  }

  const databaseUrl = requireEnv("DATABASE_URL");
  const adminEmail = validateEmail("DEV_ADMIN_EMAIL", requireEnv("DEV_ADMIN_EMAIL"));
  const bidderEmail = validateEmail(
    "DEV_BIDDER_EMAIL",
    requireEnv("DEV_BIDDER_EMAIL"),
  );
  const adminPassword = validatePassword(
    "DEV_ADMIN_PASSWORD",
    requireEnv("DEV_ADMIN_PASSWORD"),
  );
  const bidderPassword = validatePassword(
    "DEV_BIDDER_PASSWORD",
    requireEnv("DEV_BIDDER_PASSWORD"),
  );

  if (adminEmail === bidderEmail) {
    throw new Error("Development administrator and bidder emails must differ");
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.user.upsert({
      where: {
        email: adminEmail,
      },
      update: {
        passwordHash: await hashPassword(adminPassword),
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
      create: {
        email: adminEmail,
        passwordHash: await hashPassword(adminPassword),
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    await prisma.user.upsert({
      where: {
        email: bidderEmail,
      },
      update: {
        passwordHash: await hashPassword(bidderPassword),
        role: UserRole.BIDDER,
        status: UserStatus.ACTIVE,
      },
      create: {
        email: bidderEmail,
        passwordHash: await hashPassword(bidderPassword),
        role: UserRole.BIDDER,
        status: UserStatus.ACTIVE,
      },
    });

    console.log(`Seeded development administrator: ${adminEmail}`);
    console.log(`Seeded development bidder: ${bidderEmail}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Development seed failed";
  console.error(message);
  process.exit(1);
});
