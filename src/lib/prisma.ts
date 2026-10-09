import { PrismaClient } from '@prisma/client';

// Import the PrismaPg adapter using require to avoid ESM/CJS interop issues when Next.js bundles server code.
// This mirrors how scripts in the repo use require('{ PrismaPg }').
let PrismaPg: any;
try {
  const mod = require('@prisma/adapter-pg');
  PrismaPg = mod?.PrismaPg ?? mod?.default ?? mod;
} catch (e) {
  // If adapter cannot be loaded, rethrow a clear error — runtime will fail if DATABASE_URL requires adapter
  throw new Error('Failed to load @prisma/adapter-pg: ' + String((e as any)?.message ?? e));
}

declare global {
  // allow global prisma in dev to avoid exhausting connections from HMR
  // eslint-disable-next-line no-var
  // eslint-disable-next-line no-unused-vars
  var prisma: PrismaClient | undefined;
}

// Construct adapter and PrismaClient. We intentionally avoid top-level dynamic import to keep behavior consistent.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = global.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;
