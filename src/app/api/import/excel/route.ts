import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { parseWorkbook, classifyRows, detectMajorYear, mapDirection } from '@/lib/import-service'

/**
 * POST /api/import/excel — dry-run (form field "file", atau body raw).
 * Blueprint 16.4: dry-run default TIDAK menulis letter/counter.
 * v1.5: menerima .csv, .xls, dan .xlsx (tanggal teks di CSV diparse oleh
 * import-service — konvensi Indonesia DD/MM/YYYY didukung).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('import.manage')
    if ('error' in r) return r.error

    const ct = req.headers.get('content-type') ?? ''
    let buffer: Buffer | null = null
    let fileName = 'upload'
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (file instanceof File) {
        const ab = await file.arrayBuffer()
        buffer = Buffer.from(ab)
        fileName = file.name || 'upload'
      }
    } else {
      const ab = await req.arrayBuffer()
      buffer = Buffer.from(ab)
    }
    if (!buffer || buffer.length === 0) return fail(400, 'VALIDATION', 'Berkas tidak diterima — unggah berkas .csv, .xls, atau .xlsx')
    if (buffer.length > 20 * 1024 * 1024) return fail(413, 'TOO_LARGE', 'Berkas terlalu besar (maks 20 MiB)')

    let parsed: ReturnType<typeof parseWorkbook>
    try {
      parsed = parseWorkbook(buffer)
    } catch (e) {
      return fail(422, 'UNPARSEABLE', `Gagal membaca berkas: ${(e as Error).message} — pastikan memakai template resmi dari menu Import Data`)
    }

    const majorYear = detectMajorYear(parsed.rows)
    const classification = classifyRows(parsed.rows, majorYear)

    // Reimport identik: ImportRow punya unique global [sourceHash, sheet, rowIndex] —
    // berkas yang sama hanya boleh tercatat sekali. (v1.5: dulu variabel ini
    // diambil tapi tidak dipakai → unggah ulang berkas sama selalu 409 P2002
    // dengan pesan generik. Kini ditangani eksplisit & idempoten.)
    const existingBatch = await db.importBatch.findFirst({
      where: { sourceHash: parsed.sourceHash, sheet: parsed.sheet },
      orderBy: { createdAt: 'desc' },
    })
    if (existingBatch?.status === 'COMMITTED') {
      const when = existingBatch.committedAt?.toISOString().slice(0, 10) ?? 'sebelumnya'
      return fail(409, 'ALREADY_IMPORTED',
        `Berkas identik sudah pernah di-commit (${when}). Unggah berkas yang berbeda — nomor yang sama juga akan ditolak sebagai duplikat oleh pemeriksaan nomor surat.`)
    }
    if (existingBatch) {
      // Batch DRY_RUN untuk berkas ini sudah ada → kembalikan batch itu
      // (idempoten: meninjau ulang, bukan menduplikasi baris).
      const rowRecords = await db.importRow.findMany({ where: { batchId: existingBatch.id } })
      const rowIdByIndex = new Map(rowRecords.map(r => [r.rowIndex, r.id]))
      const rowsOut = parsed.rows.map(row => ({
        rowId: rowIdByIndex.get(row.rowIndex) ?? null,
        rowIndex: row.rowIndex,
        seq: row.seq,
        direction: mapDirection(row.directionRaw),
        directionRaw: row.directionRaw,
        letterTypeName: row.letterTypeName,
        letterTypeCode: row.letterTypeCode,
        letterDate: row.letterDate?.toISOString().slice(0, 10) ?? null,
        fullNumberRaw: row.fullNumberRaw,
        recipient: row.recipient,
        subject: row.subject,
        status: !row.letterDate ? 'PRAISI'
          : (classification.issues[row.rowIndex] ?? []).some(i => /duplikat|tidak numerik|cache \(I\) kosong/.test(i)) ? 'ERROR'
          : (classification.issues[row.rowIndex] ?? []).some(i => i.includes('perlu keputusan pemilik')) ? 'NEEDS_REVIEW'
          : 'CANDIDATE',
        issues: classification.issues[row.rowIndex] ?? [],
      }))
      const report = JSON.parse(existingBatch.report ?? '{}') as Record<string, number>
      await writeAudit(db, {
        actorId: r.user.id, action: 'import.dry-run.revisit', entityType: 'importBatch', entityId: existingBatch.id,
        correlationId: r.correlationId,
        metadata: { sourceHash: parsed.sourceHash, sheet: parsed.sheet, rows: parsed.rows.length },
      })
      return ok({
        batchId: existingBatch.id,
        sheet: parsed.sheet,
        sourceHash: parsed.sourceHash,
        majorYear: report.majorYear ?? majorYear,
        counts: {
          total: parsed.rows.length,
          candidates: report.candidates ?? classification.candidates,
          praisi: report.praisi ?? classification.praisi,
          errors: report.errors ?? classification.errors,
          needsReview: report.needsReview ?? classification.needsReview,
        },
        note: 'Berkas ini sudah pernah diuji (dry-run) — batch yang sama ditampilkan kembali. Baris yang sudah di-commit tidak akan terimpor ulang.',
        rows: rowsOut,
      })
    }

    const batch = await db.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          sourceHash: parsed.sourceHash,
          fileName,
          sheet: parsed.sheet,
          status: 'DRY_RUN',
          createdBy: r.user.id,
          report: JSON.stringify({
            majorYear, candidates: classification.candidates, praisi: classification.praisi,
            errors: classification.errors, needsReview: classification.needsReview,
          }),
        },
      })
      for (const row of parsed.rows) {
        const rowIssues = classification.issues[row.rowIndex] ?? []
        let status: string
        if (!row.letterDate) status = 'PRAISI'
        else if (rowIssues.some(i => i.includes('duplikat') || i.includes('tidak numerik') || i.includes('cache (I) kosong'))) status = 'ERROR'
        else if (rowIssues.some(i => i.includes('perlu keputusan pemilik'))) status = 'NEEDS_REVIEW'
        else status = 'CANDIDATE'

        await tx.importRow.create({
          data: {
            batchId: batch.id,
            sheet: parsed.sheet,
            rowIndex: row.rowIndex,
            sourceHash: parsed.sourceHash,
            rawNumber: row.fullNumberRaw,
            status,
            data: JSON.stringify(row),
            issues: rowIssues.length > 0 ? JSON.stringify(rowIssues) : null,
          },
        })
      }
      await writeAudit(tx, {
        actorId: r.user.id, action: 'import.dry-run', entityType: 'importBatch', entityId: batch.id,
        correlationId: r.correlationId,
        metadata: { sourceHash: parsed.sourceHash, sheet: parsed.sheet, rows: parsed.rows.length },
      })
      return batch
    })

    const rowRecords = await db.importRow.findMany({ where: { batchId: batch.id } })
    const rowIdByIndex = new Map(rowRecords.map(r => [r.rowIndex, r.id]))

    const rowsOut = parsed.rows.map(row => ({
      rowId: rowIdByIndex.get(row.rowIndex) ?? null,
      rowIndex: row.rowIndex,
      seq: row.seq,
      direction: mapDirection(row.directionRaw),
      directionRaw: row.directionRaw,
      letterTypeName: row.letterTypeName,
      letterTypeCode: row.letterTypeCode,
      letterDate: row.letterDate?.toISOString().slice(0, 10) ?? null,
      fullNumberRaw: row.fullNumberRaw,
      recipient: row.recipient,
      subject: row.subject,
      status: !row.letterDate ? 'PRAISI'
        : (classification.issues[row.rowIndex] ?? []).some(i => /duplikat|tidak numerik|cache \(I\) kosong/.test(i)) ? 'ERROR'
        : (classification.issues[row.rowIndex] ?? []).some(i => i.includes('perlu keputusan pemilik')) ? 'NEEDS_REVIEW'
        : 'CANDIDATE',
      issues: classification.issues[row.rowIndex] ?? [],
    }))

    return ok({
      batchId: batch.id,
      sheet: parsed.sheet,
      sourceHash: parsed.sourceHash,
      majorYear,
      counts: {
        total: parsed.rows.length,
        candidates: classification.candidates,
        praisi: classification.praisi,
        errors: classification.errors,
        needsReview: classification.needsReview,
      },
      note: null,
      rows: rowsOut,
    }, 201)
  })
}
