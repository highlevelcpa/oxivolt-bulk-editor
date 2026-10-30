import { PrismaClient } from '@prisma/client'
import { assertDatabaseTargetAllowed } from './env-guard'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Fail closed in STAGING / development if DATABASE_URL points anywhere that is
// not explicitly allow-listed (see lib/env-guard.ts). No-op in production and
// during `next build` (no database is contacted at build time).
if (process.env.NEXT_PHASE !== 'phase-production-build') {
  assertDatabaseTargetAllowed(process.env)
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
