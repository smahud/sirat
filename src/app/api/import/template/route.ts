import { NextRequest, NextResponse } from 'next/server'
import { fail, handle, requirePermission } from '@/lib/api-helpers'
import { buildTemplate, TEMPLATE_MIME, TEMPLATE_FILENAME, TemplateFormat } from '@/lib/import-service'
import { writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'

/**
 * GET /api/import/template?format=csv|xlsx|xls — unduh template import (v1.5).
 * Struktur kolom A–K identik dengan parser import — template inilah "kontrak
 * format" resmi, sehingga pengguna baru tidak perlu menebak struktur berkas.
 * Membutuhkan import.manage (menu Import Data pun tidak muncul tanpa izin ini).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePermission('import.manage')
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const format = (url.searchParams.get('format') ?? 'xlsx') as TemplateFormat
    if (!['csv', 'xlsx', 'xls'].includes(format)) {
      return fail(400, 'VALIDATION', 'Format template tidak dikenal — gunakan csv, xlsx, atau xls')
    }

    const buffer = buildTemplate(format)

    // Audit ringan: unduhan template dicatat untuk jejak kesiapan cutover
    await writeAudit(db, {
      actorId: r.user.id, action: 'import.template.download', entityType: 'importTemplate', entityId: format,
      correlationId: r.correlationId, metadata: { format, bytes: buffer.length },
    })

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': TEMPLATE_MIME[format],
        'Content-Disposition': `attachment; filename="${TEMPLATE_FILENAME[format]}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    })
  })
}
