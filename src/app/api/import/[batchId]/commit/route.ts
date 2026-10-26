import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { normalize, mapDirection, ParsedRow } from '@/lib/import-service'

const commitSchema = z.object({
  rowIds: z.array(z.string()).min(1),
  targetUnitId: z.string().min(1),
  setHighWater: z.boolean().default(false),
})

/**
 * POST /api/import/:batchId/commit — commit terkontrol (transaksional, selektif).
 * Blueprint 16.4: hanya baris terpilih; histori TIDAK mengambil nomor baru;
 * raw_number dipertahankan persis; imported_at wajib; issued_at tidak ditebak.
 * setHighWater=true → counter disetel minimal max sequence terimpor (tidak menurunkan).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('import.manage')
    if ('error' in r) return r.error
    const { batchId } = await params

    const parsed = commitSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data commit tidak valid', { issues: parsed.error.issues })
    const { rowIds, targetUnitId, setHighWater } = parsed.data

    const batch = await db.importBatch.findUnique({ where: { id: batchId } })
    if (!batch) return fail(404, 'NOT_FOUND', 'Batch import tidak ditemukan')
    if (batch.status === 'COMMITTED') return fail(409, 'ALREADY_COMMITTED', 'Batch sudah di-commit')

    const unit = await db.unit.findUnique({ where: { id: targetUnitId } })
    if (!unit) return fail(404, 'NOT_FOUND', 'Unit target tidak ditemukan')

    const rows = await db.importRow.findMany({ where: { id: { in: rowIds }, batchId } })

    const result = await db.$transaction(async (tx) => {
      const accepted: string[] = []
      const skipped: { rowId: string; reason: string }[] = []
      let maxSeq = 0

      for (const row of rows) {
        if (row.status === 'PRAISI') {
          skipped.push({ rowId: row.id, reason: 'Baris praisi tidak dapat diimpor sebagai surat terbit' })
          continue
        }
        if (row.status === 'ERROR') {
          skipped.push({ rowId: row.id, reason: `Baris bermasalah: ${row.issues ?? ''}` })
          continue
        }
        const data = JSON.parse(row.data) as ParsedRow
        if (!data.letterDate || !data.fullNumberRaw || !data.seq) {
          skipped.push({ rowId: row.id, reason: 'Data tidak lengkap (tanggal/nomor/urutan)' })
          continue
        }

        const normalized = normalize(data.fullNumberRaw)
        // Business duplicate: nomor sama sudah ada di letters (termasuk import sebelumnya)
        const dupLetter = await tx.letter.findFirst({ where: { normalizedNumber: normalized } })
        if (dupLetter) {
          skipped.push({ rowId: row.id, reason: `Nomor ${data.fullNumberRaw} sudah ada (${dupLetter.officialNumber})` })
          await tx.importRow.update({ where: { id: row.id }, data: { status: 'SKIPPED' } })
          continue
        }

        // Jenis surat: cocokkan nama D → LetterType master (boleh null bila tidak ketemu)
        let letterTypeId: string | null = null
        if (data.letterTypeName) {
          const byName = await tx.letterType.findFirst({ where: { name: data.letterTypeName } })
          const byCode = byName ?? (data.letterTypeCode
            ? await tx.letterType.findFirst({ where: { code: data.letterTypeCode } })
            : null)
          letterTypeId = byCode?.id ?? null
        }

        const seqNum = parseInt(data.seq.trim(), 10)
        if (!Number.isNaN(seqNum) && seqNum > maxSeq) maxSeq = seqNum

        const letter = await tx.letter.create({
          data: {
            issuingUnitId: targetUnitId,
            status: 'ISSUED',
            letterDate: data.letterDate,
            direction: mapDirection(data.directionRaw),
            letterTypeId,
            recipient: data.recipient,
            subject: data.subject,
            officialNumber: data.fullNumberRaw, // raw number dipertahankan PERSIS
            normalizedNumber: normalized,
            legacyNumber: data.fullNumberRaw,
            sequence: seqNum,
            isImported: true,
            importedAt: new Date(),
            sourceRef: `${row.sourceHash}/${row.sheet}/${row.rowIndex}`,
            numberSnapshot: JSON.stringify({
              source: 'excel-import',
              rawNumber: data.fullNumberRaw,
              formula: data.fullNumberFormula,
              components: {
                seq: data.seq, directionCode: data.directionCode,
                letterTypeCode: data.letterTypeCode, monthRoman: data.monthRoman, year: data.year,
              },
            }),
          },
        })
        await tx.importRow.update({
          where: { id: row.id },
          data: { status: 'IMPORTED', letterId: letter.id },
        })
        accepted.push(row.id)
      }

      // High-water: setel counter minimal max sequence terimpor — TIDAK menurunkan yang sudah lebih tinggi
      if (setHighWater && maxSeq > 0) {
        const ns = await tx.counterNamespace.findFirst({
          where: { unitId: targetUnitId, committeeId: null },
        })
        if (ns) {
          await tx.counter.upsert({
            where: { namespaceId_periodKey: { namespaceId: ns.id, periodKey: 'ALL' } },
            create: { namespaceId: ns.id, periodKey: 'ALL', lastValue: maxSeq },
            update: { lastValue: Math.max(maxSeq, (await tx.counter.findUnique({
              where: { namespaceId_periodKey: { namespaceId: ns.id, periodKey: 'ALL' } },
            }))?.lastValue ?? 0) },
          })
        }
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: 'COMMITTED', committedAt: new Date() },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'import.commit', entityType: 'importBatch', entityId: batchId,
        correlationId: r.correlationId,
        metadata: {
          accepted: accepted.length, skipped: skipped.length,
          targetUnit: unit.code, setHighWater, maxSeq: setHighWater ? maxSeq : null,
        },
      })
      return { accepted, skipped }
    })

    return ok(result)
  })
}
