import { db } from '@/lib/db'
import { ok, handle, requirePermission } from '@/lib/api-helpers'

/**
 * GET /api/import/batches — riwayat import (v1.5).
 * Scope-filtered: user non-global hanya melihat batch yang dibuatnya sendiri
 * ATAU batch yang di-commit ke unit yang dikelolanya (deny by default —
 * aktivitas import unit lain tidak bocor).
 */
export async function GET() {
  return handle(async () => {
    const r = await requirePermission('import.manage')
    if ('error' in r) return r.error

    const where = r.user.scope.all
      ? undefined
      : {
          OR: [
            { createdBy: r.user.id },
            { targetUnitId: { in: r.user.scope.unitIds } },
          ],
        }

    const batches = await db.importBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        targetUnit: { select: { code: true, name: true } },
        _count: { select: { rows: true } },
      },
    })

    const result = batches.map(b => {
      let report: Record<string, unknown> = {}
      try { report = JSON.parse(b.report ?? '{}') } catch { /* laporan rusak = kosong */ }
      return {
        id: b.id,
        status: b.status,
        sheet: b.sheet,
        fileName: b.fileName,
        createdAt: b.createdAt,
        committedAt: b.committedAt,
        targetUnit: b.targetUnit ? { code: b.targetUnit.code, name: b.targetUnit.name } : null,
        totalRows: b._count.rows,
        report: {
          majorYear: report.majorYear ?? null,
          candidates: report.candidates ?? 0,
          praisi: report.praisi ?? 0,
          errors: report.errors ?? 0,
          needsReview: report.needsReview ?? 0,
        },
      }
    })
    return ok({ batches: result })
  })
}
