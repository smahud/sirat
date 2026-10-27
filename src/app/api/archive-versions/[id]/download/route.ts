import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter } from '@/lib/rbac'
import { fileStream, statObject } from '@/lib/storage/local-disk'

/**
 * GET /api/archive-versions/:id/download — unduh berkas arsip (regresi audit #5:
 * frontend memanggil endpoint ini sejak redesign). Scope letter diperiksa,
 * hanya versi READY yang bisa diunduh, nama file di-sanitasi untuk header.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePermission('archive.download')
    if ('error' in r) return r.error
    const { id } = await params

    const version = await db.archiveVersion.findFirst({
      where: {
        id,
        archiveFile: { letter: letterScopeFilter(r.user) ?? undefined },
      },
      include: { archiveFile: { select: { id: true, letterId: true, label: true, state: true } } },
    })
    if (!version) return fail(404, 'NOT_FOUND', 'Berkas tidak ditemukan atau di luar scope akses Anda')
    if (version.state !== 'READY') {
      return fail(409, 'NOT_READY', `Versi berkas berstatus ${version.state} dan tidak dapat diunduh`)
    }
    if (version.archiveFile.state === 'TRASHED') {
      return fail(409, 'FILE_TRASHED', 'Berkas sudah dipindahkan ke trash')
    }

    const stat = await statObject(version.objectKey)
    if (!stat.exists) {
      return fail(404, 'FILE_MISSING', 'Objek fisik tidak ditemukan di storage — jalankan integrity scan')
    }

    await writeAudit(db, {
      actorId: r.user.id, action: 'archive.download', entityType: 'archiveVersion', entityId: version.id,
      correlationId: crypto.randomUUID(),
      metadata: {
        letterId: version.archiveFile.letterId, archiveFileId: version.archiveFile.id,
        versionNo: version.versionNo, originalName: version.originalName, sizeBytes: version.sizeBytes,
      },
    })

    // Sanitasi nama file untuk header (CRLF/injection guard)
    const safeName = version.originalName.replace(/[\r\n"\\]/g, '_').slice(0, 120) || 'berkas'
    return new NextResponse(fileStream(version.objectKey), {
      headers: {
        'Content-Type': version.mimeType || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(version.originalName)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
