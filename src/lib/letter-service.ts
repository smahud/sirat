// Layanan penerbitan surat — SATU transaksi database (Blueprint 16.1):
// cek ulang assignment/state → idempotency → counter atomik → bangun nomor →
// registry unik → snapshot → audit → commit. Tanpa file/network I/O di dalam transaksi.
import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { parseDsl } from '@/lib/numbering/dsl'
import { renderNumber } from '@/lib/numbering/render'
import { periodKeyFor } from '@/lib/numbering/validate'
import { resolveFieldValues, FieldResolutionError } from '@/lib/numbering/fields'
import { normalizeNumber } from '@/lib/constants'
import { createHash } from 'crypto'
import { ResolvedUser } from '@/lib/rbac'
import { canAccessUnit, canAccessCommittee } from '@/lib/rbac'

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
  }
}

export interface IssueResult {
  letterId: string
  officialNumber: string
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/**
 * Menerbitkan nomor surat dari draft.
 * - idempotencyKey: header Idempotency-Key; key sama+payload sama → surat sama (HTTP 200)
 *   key sama+payload beda → 409. Concurrent key sama → tidak ada surat ganda.
 * - Transaksi tunggal; kegagalan sebelum commit tidak menyisakan surat setengah jadi.
 */
export async function issueLetter(params: {
  letterId: string
  actor: ResolvedUser
  idempotencyKey: string
  correlationId: string
}): Promise<IssueResult> {
  const { letterId, actor, idempotencyKey, correlationId } = params
  const OPERATION = 'letter.issue'
  const payloadHash = sha256(JSON.stringify({ letterId }))

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const now = new Date()

        // 1) Idempotency persisten
        const existing = await tx.idempotencyKey.findFirst({
          where: { actorId: actor.id, operation: OPERATION, key: idempotencyKey },
        })
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw new ServiceError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH',
              'Idempotency-Key sama dipakai dengan payload berbeda')
          }
          const letter = await tx.letter.findUnique({ where: { id: existing.letterId ?? '' } })
          if (!letter) throw new ServiceError(500, 'INTERNAL', 'Hasil idempotensi tidak konsisten')
          return { letterId: letter.id, officialNumber: letter.officialNumber ?? '' }
        }

        // 2) Muat draft + relasi
        const letter = await tx.letter.findUnique({
          where: { id: letterId },
          include: { issuingUnit: true, committee: true, letterType: true },
        })
        if (!letter) throw new ServiceError(404, 'NOT_FOUND', 'Surat tidak ditemukan')

        if (letter.status === 'ISSUED') {
          // Draft sudah diterbitkan → kembalikan hasil existing (idempotent), bukan nomor baru
          await tx.idempotencyKey.create({
            data: { actorId: actor.id, operation: OPERATION, key: idempotencyKey, payloadHash, letterId: letter.id },
          })
          return { letterId: letter.id, officialNumber: letter.officialNumber ?? '' }
        }
        if (letter.status !== 'DRAFT') {
          throw new ServiceError(400, 'NOT_DRAFT', `Surat berstatus ${letter.status} tidak dapat diterbitkan`)
        }

        // 3) Validasi ulang konteks (deaktivasi paralel tidak lolos).
        // Surat KEPANITIAAN wajib akses committee (assignment langsung / includeCommittees
        // eksplisit) — akses unit saja TIDAK cukup (Blueprint 16.5, master prompt E.2).
        if (letter.committeeId) {
          if (!canAccessCommittee(actor, { id: letter.committeeId, unitId: letter.issuingUnitId })) {
            throw new ServiceError(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke kepanitiaan penerbit surat ini')
          }
        } else if (!canAccessUnit(actor, letter.issuingUnitId)) {
          throw new ServiceError(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke konteks penerbitan surat ini')
        }
        if (letter.issuingUnit.status !== 'ACTIVE') throw new ServiceError(409, 'UNIT_INACTIVE', 'Unit penerbit tidak aktif')
        if (letter.committee) {
          if (letter.committee.unitId !== letter.issuingUnitId) throw new ServiceError(409, 'COMMITTEE_MISMATCH', 'Kepanitiaan tidak berada di bawah unit penerbit')
          if (letter.committee.status !== 'ACTIVE') throw new ServiceError(409, 'COMMITTEE_INACTIVE', 'Kepanitiaan tidak aktif')
        }
        if (!letter.letterDate) throw new ServiceError(400, 'VALIDATION', 'Tanggal surat wajib diisi sebelum penerbitan')
        if (!letter.letterType) throw new ServiceError(400, 'VALIDATION', 'Jenis surat wajib dipilih')
        if (!letter.letterType.isActive) throw new ServiceError(409, 'LETTER_TYPE_INACTIVE', 'Jenis surat tidak aktif')

        // 4) Profil aktif: khusus kepanitiaan dulu, lalu profil unit
        const activeVersion = letter.committeeId
          ? (await tx.numberingProfileVersion.findFirst({
              where: { status: 'ACTIVE', profile: { committeeId: letter.committeeId } },
              orderBy: { version: 'desc' },
              include: { profile: true },
            }))
            ?? (await tx.numberingProfileVersion.findFirst({
              where: { status: 'ACTIVE', profile: { ownerId: letter.issuingUnitId, committeeId: null } },
              orderBy: { version: 'desc' },
              include: { profile: true },
            }))
          : await tx.numberingProfileVersion.findFirst({
              where: { status: 'ACTIVE', profile: { ownerId: letter.issuingUnitId, committeeId: null } },
              orderBy: { version: 'desc' },
              include: { profile: true },
            })
        if (!activeVersion) throw new ServiceError(409, 'NO_ACTIVE_PROFILE', 'Tidak ada profil penomoran aktif untuk konteks ini')

        const dsl = parseDsl(activeVersion.dsl)

        // 4b) Validasi pilihan Dropdown operator terhadap VERSI AKTIF ini (E.4/E.5):
        // opsi harus dikenal & aktif pada konfigurasi versi terkait; field wajib
        // harus terisi. Draft lama (v1) dijembatani lewat legacyKey arah.
        let resolvedFields: Record<string, { optionId: string; label: string; code: string }>
        try {
          resolvedFields = resolveFieldValues(
            dsl,
            letter.fieldValues ? JSON.parse(letter.fieldValues) : null,
            letter.direction, // fallback migrasi v1 → v2
          )
        } catch (e) {
          if (e instanceof FieldResolutionError) {
            throw new ServiceError(400, 'FIELD_' + e.code, e.message)
          }
          throw e
        }

        // 5) Namespace counter: teknis, independen dari teks nomor
        const ns = letter.committee
          ? (letter.committee.shareParentCounter
              ? await tx.counterNamespace.findFirst({ where: { unitId: letter.issuingUnitId, committeeId: null } })
              : await tx.counterNamespace.findFirst({ where: { committeeId: letter.committeeId } }))
          : await tx.counterNamespace.findFirst({ where: { unitId: letter.issuingUnitId, committeeId: null } })
        if (!ns) throw new ServiceError(409, 'NO_NAMESPACE', 'Namespace counter belum dikonfigurasi untuk konteks ini')

        // 6) Period key sesuai kebijakan reset
        const periodKey = periodKeyFor(
          ns.resetPolicy as 'ALL' | 'YEARLY' | 'MONTHLY',
          ns.dateSource as 'LETTER_DATE' | 'ISSUE_DATE',
          letter.letterDate,
          now,
        )

        // 7) Counter atomik (upsert single-statement + unique constraint)
        const counter = await tx.counter.upsert({
          where: { namespaceId_periodKey: { namespaceId: ns.id, periodKey } },
          create: { namespaceId: ns.id, periodKey, lastValue: 1 },
          update: { lastValue: { increment: 1 } },
        })
        const seq = counter.lastValue

        // 8) Bangun nomor final
        const rendered = renderNumber(dsl, {
          seq,
          fieldValues: Object.fromEntries(Object.entries(resolvedFields).map(([k, v]) => [k, v.optionId])),
          letterTypeCode: letter.letterType.code,
          unitCode: letter.issuingUnit.code,
          committeeCode: letter.committee?.code,
          letterDate: letter.letterDate,
          issueDate: now,
        })
        const normalized = normalizeNumber(rendered.text)

        // 9) Cek keunikan sebelum insert (constraint = pertahanan terakhir)
        const regConflict = await tx.numberRegistry.findUnique({ where: { number: normalized } })
        if (regConflict) {
          throw new ServiceError(409, 'NUMBER_CONFLICT',
            `Nomor "${rendered.text}" sudah terdaftar — konflik konfigurasi namespace/format`)
        }
        const letterConflict = await tx.letter.findFirst({ where: { normalizedNumber: normalized } })
        if (letterConflict) {
          throw new ServiceError(409, 'NUMBER_CONFLICT',
            `Nomor "${rendered.text}" sama dengan surat lain — konflik konfigurasi namespace/format`)
        }

        await tx.numberRegistry.create({
          data: { number: normalized, letterId: letter.id },
        })

        // 10) Update letter dengan CAS status=DRAFT (mencegah double-issue race)
        const updated = await tx.letter.updateMany({
          where: { id: letter.id, status: 'DRAFT' },
          data: {
            status: 'ISSUED',
            sequence: seq,
            officialNumber: rendered.text,
            normalizedNumber: normalized,
            namespaceId: ns.id,
            periodKey,
            profileVersionId: activeVersion.id,
            issuedAt: now,
            issuerId: actor.id,
            numberSnapshot: JSON.stringify({
              profileId: activeVersion.profileId,
              profileVersion: activeVersion.version,
              dsl,
              parts: rendered.parts,
              inputs: {
                // E.7: snapshot label, pilihan, kode & versi mapping saat terbit —
                // perubahan konfigurasi Dropdown berikutnya tidak mengubah histori.
                fieldValues: resolvedFields,
                letterTypeId: letter.letterTypeId,
                letterDate: letter.letterDate,
                unitCode: letter.issuingUnit.code,
                committeeCode: letter.committee?.code ?? null,
              },
            }),
            fieldValues: JSON.stringify(Object.fromEntries(
              Object.entries(resolvedFields).map(([k, v]) => [k, v.optionId]),
            )),
          },
        })
        if (updated.count === 0) {
          const fresh = await tx.letter.findUnique({ where: { id: letter.id } })
          if (fresh?.status === 'ISSUED') {
            await tx.idempotencyKey.create({
              data: { actorId: actor.id, operation: OPERATION, key: idempotencyKey, payloadHash, letterId: fresh.id },
            })
            return { letterId: fresh.id, officialNumber: fresh.officialNumber ?? '' }
          }
          throw new ServiceError(409, 'RACE', 'Status surat berubah selama penerbitan')
        }

        // 11) Audit + idempotency
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'letter.issue',
          entityType: 'letter',
          entityId: letter.id,
          correlationId,
          metadata: { officialNumber: rendered.text, sequence: seq, namespaceId: ns.id, periodKey },
        })
        await tx.idempotencyKey.create({
          data: { actorId: actor.id, operation: OPERATION, key: idempotencyKey, payloadHash, letterId: letter.id },
        })

        return { letterId: letter.id, officialNumber: rendered.text }
      }, { timeout: 20000 })
    } catch (e) {
      const err = e as { name?: string; code?: string; message?: string }
      // Retry terbatas untuk konflik serialisasi/deadlock dengan key sama
      const retryable = err.code === 'P2034' ||
        /deadlock|serializ|write conflict|database is locked/i.test(err.message ?? '')
      if (retryable && attempt < 2) continue
      throw e
    }
  }
  throw new ServiceError(500, 'INTERNAL', 'Penerbitan gagal setelah beberapa percobaan')
}
