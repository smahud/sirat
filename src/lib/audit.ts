// Audit trail append-only (Blueprint 10). Tidak menyimpan secret.
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient | typeof db

export interface AuditInput {
  actorId?: string | null
  action: string
  entityType?: string
  entityId?: string
  outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED'
  correlationId?: string | null
  metadata?: Record<string, unknown>
}

/** Tulis audit event. Metadata disaring dari secret. */
export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      outcome: input.outcome ?? 'SUCCESS',
      correlationId: input.correlationId ?? null,
      metadata: input.metadata ? safeJson(input.metadata) : null,
    },
  })
}

function safeJson(obj: Record<string, unknown>): string {
  const redacted: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (/password|secret|token|hash|authorization/i.test(k)) {
      redacted[k] = '[REDACTED]'
    } else if (v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      redacted[k] = JSON.parse(safeJson(v as Record<string, unknown>))
    } else {
      redacted[k] = v
    }
  }
  return JSON.stringify(redacted)
}
