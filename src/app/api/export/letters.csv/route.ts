import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handle } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter } from '@/lib/rbac'
import { csvCell } from '@/lib/constants'

/**
 * Kolom "Arah/Atribut" (v1.6): label Dropdown dari snapshot penerbitan →
 * fallback direction legacy (surat lama/import) → kunci fieldValues (draft).
 */
function atributSurat(l: { numberSnapshot: string | null; fieldValues: string | null; direction: string | null }): string {
  try {
    const fv = JSON.parse(l.numberSnapshot ?? 'null')?.inputs?.fieldValues as Record<string, { label?: string }> | undefined
    if (fv && Object.keys(fv).length > 0) {
      return Object.values(fv).map(v => v?.label ?? '').filter(Boolean).join('; ')
    }
  } catch { /* snapshot rusak → fallback */ }
  if (l.direction) return l.direction === 'INTERNAL' ? 'Internal' : l.direction === 'EXTERNAL' ? 'Eksternal' : l.direction
  try {
    const fv = JSON.parse(l.fieldValues ?? 'null')
    if (fv && typeof fv === 'object' && Object.keys(fv).length > 0) {
      return Object.entries(fv).map(([k, v]) => `${k}=${v}`).join('; ')
    }
  } catch { /* abaikan */ }
  return ''
}

/** GET /api/export/letters.csv — FR-025: export menghormati scope permission. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePermission('export.run')
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const unitId = url.searchParams.get('unitId') ?? ''
    const status = url.searchParams.get('status') ?? ''

    const where: Record<string, unknown> = {}
    const scope = letterScopeFilter(r.user)
    if (scope) Object.assign(where, scope)
    if (unitId) where.issuingUnitId = unitId
    if (status) where.status = status

    const letters = await db.letter.findMany({
      where,
      include: {
        issuingUnit: { select: { code: true, name: true } },
        committee: { select: { code: true, name: true } },
        letterType: { select: { code: true, name: true } },
        issuer: { select: { fullName: true } },
      },
      orderBy: [{ letterDate: 'asc' }, { createdAt: 'asc' }],
    })

    const header = ['Nomor Resmi', 'Tanggal Surat', 'Unit', 'Kepanitiaan', 'Arah/Atribut', 'Jenis', 'Kode Jenis',
      'Penerima', 'Perihal', 'Status', 'Diterbitkan Oleh', 'Waktu Terbit', 'Nomor Legacy']
    const rows = letters.map(l => [
      l.officialNumber ?? l.legacyNumber ?? '',
      l.letterDate ? l.letterDate.toISOString().slice(0, 10) : '',
      l.issuingUnit.code,
      l.committee?.code ?? '',
      atributSurat(l),
      l.letterType?.name ?? '',
      l.letterType?.code ?? '',
      l.recipient ?? '',
      l.subject ?? '',
      l.status,
      l.issuer?.fullName ?? '',
      l.issuedAt ? l.issuedAt.toISOString() : '',
      l.isImported ? (l.legacyNumber ?? '') : '',
    ].map(csvCell)) // formula-injection sanitize per sel

    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    await writeAudit(db, {
      actorId: r.user.id, action: 'export.letters.csv', entityType: 'letter', entityId: '-',
      metadata: { count: letters.length, filters: { unitId, status } },
    })

    return new NextResponse('\uFEFF' + csv, { // BOM agar Excel membaca UTF-8
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sirat-surat-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  })
}
