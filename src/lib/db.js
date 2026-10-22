import { PrismaClient } from '@prisma/client';

// Reuse one client across hot reloads in development so we don't exhaust connections.
const globalForPrisma = globalThis;

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
