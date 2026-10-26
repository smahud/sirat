import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handle } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'

/** Riwayat operasi backup/restore (BackupEvent) — hanya otoritas global. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePermission('audit.view')
    if ('error' in r) return r.error
    const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get('limit') ?? 30)))
    const events = await db.backupEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, kind: true, action: true, actorId: true, fileName: true,
        sizeBytes: true, sha256: true, status: true, scopeJson: true, metadata: true,
        createdAt: true, completedAt: true,
      },
    })
    return ok({ events })
  })
}
