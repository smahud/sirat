import { db } from '@/lib/db'
import { ok, handle } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { testStorage, ARCHIVE_ROOT } from '@/lib/storage/local-disk'

/** FR-023: health — database, storage, kapasitas, jumlah data. */
export async function GET() {
  return handle(async () => {
    const r = await requirePermission('health.view')
    if ('error' in r) return r.error

    const started = Date.now()
    await db.$queryRaw`SELECT 1`
    const dbLatencyMs = Date.now() - started

    const storageTest = await testStorage(ARCHIVE_ROOT)

    const [units, committees, letters, issued, cancelled, drafts, files, pendingVersions, lastAudit] =
      await Promise.all([
        db.unit.count(),
        db.committee.count(),
        db.letter.count(),
        db.letter.count({ where: { status: 'ISSUED' } }),
        db.letter.count({ where: { status: 'CANCELLED' } }),
        db.letter.count({ where: { status: 'DRAFT' } }),
        db.archiveFile.count(),
        db.archiveVersion.count({ where: { state: 'PENDING' } }),
        db.auditEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ])

    return ok({
      status: 'ok',
      db: { ok: true, latencyMs: dbLatencyMs },
      storage: {
        root: ARCHIVE_ROOT,
        ok: storageTest.ok,
        detail: storageTest.detail,
      },
      counts: { units, committees, letters, issued, cancelled, drafts, files, pendingVersions },
      pendingVersionsWarning: pendingVersions > 0
        ? `Terdapat ${pendingVersions} versi berkas berstatus PENDING — jalankan integrity scan`
        : null,
      lastAuditAt: lastAudit?.createdAt ?? null,
      time: new Date().toISOString(),
    })
  })
}
