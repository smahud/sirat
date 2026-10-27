import { db } from '@/lib/db'
import { ok, handle } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { statObject, sha256File, ARCHIVE_ROOT, STAGING_ROOT, safeJoin } from '@/lib/storage/local-disk'
import fs from 'fs/promises'
import path from 'path'

interface ScanResult {
  scanned: number
  ok: number
  missing: { versionId: string; objectKey: string; letterId: string }[]
  sizeMismatch: { versionId: string; objectKey: string; expected: number; actual: number }[]
  hashMismatch: { versionId: string; objectKey: string; expected: string; actual: string }[]
  pendingWithoutFile: { versionId: string; objectKey: string }[]
  orphans: string[] // file di disk yang tidak direferensikan DB — dilaporkan, TIDAK dihapus
  stagingFiles: number
  scannedAt: string
}

/**
 * POST /api/health/integrity-scan — FR/NFR-003 + blueprint 16.3 reconciler:
 * deteksi berkas hilang/berubah/orphan/pending. Tidak menghapus apa pun otomatis.
 */
export async function POST() {
  return handle(async () => {
    const r = await requirePermission('health.view')
    if ('error' in r) return r.error

    const result: ScanResult = {
      scanned: 0, ok: 0, missing: [], sizeMismatch: [], hashMismatch: [],
      pendingWithoutFile: [], orphans: [], stagingFiles: 0, scannedAt: new Date().toISOString(),
    }

    const versions = await db.archiveVersion.findMany({
      include: { archiveFile: { include: { letter: { select: { id: true } } } } },
    })

    for (const v of versions) {
      if (v.state === 'PENDING') {
        const st = await statObject(v.objectKey)
        if (!st.exists) result.pendingWithoutFile.push({ versionId: v.id, objectKey: v.objectKey })
        continue
      }
      if (v.state !== 'READY') continue
      result.scanned++
      const st = await statObject(v.objectKey)
      if (!st.exists) {
        result.missing.push({ versionId: v.id, objectKey: v.objectKey, letterId: v.archiveFile.letter.id })
        continue
      }
      if (st.size !== v.sizeBytes) {
        result.sizeMismatch.push({ versionId: v.id, objectKey: v.objectKey, expected: v.sizeBytes, actual: st.size })
      }
      const actualHash = await sha256File(v.objectKey)
      if (actualHash !== v.sha256) {
        result.hashMismatch.push({ versionId: v.id, objectKey: v.objectKey, expected: v.sha256, actual: actualHash })
      }
      if (st.exists && st.size === v.sizeBytes && actualHash === v.sha256) result.ok++
    }

    // Deteksi orphan: file fisik di archive root yang tidak direferensikan DB
    const referenced = new Set(versions.filter(v => v.state === 'READY' || v.state === 'PENDING').map(v => path.resolve(safeJoin(ARCHIVE_ROOT, v.objectKey))))
    try {
      await walkFiles(ARCHIVE_ROOT, async (p) => {
        if (p.endsWith('.json')) return // manifest bukan blob
        if (!referenced.has(path.resolve(p))) result.orphans.push(path.relative(ARCHIVE_ROOT, p))
      })
    } catch { /* root belum ada — abaikan */ }

    // Staging bersangkutan
    try {
      const stagingEntries = await fs.readdir(STAGING_ROOT)
      result.stagingFiles = stagingEntries.filter(f => f.endsWith('.part')).length
    } catch { /* belum ada */ }

    await writeAudit(db, {
      actorId: r.user.id, action: 'health.integrity-scan', entityType: 'system', entityId: 'archive',
      metadata: {
        scanned: result.scanned, ok: result.ok, missing: result.missing.length,
        sizeMismatch: result.sizeMismatch.length, hashMismatch: result.hashMismatch.length,
        orphans: result.orphans.length, pendingWithoutFile: result.pendingWithoutFile.length,
      },
    })

    return ok(result)
  })
}

async function walkFiles(root: string, cb: (p: string) => Promise<void>): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const e of entries) {
    const p = path.join(root, e.name)
    if (e.isDirectory()) await walkFiles(p, cb)
    else if (e.isFile()) await cb(p)
  }
}
