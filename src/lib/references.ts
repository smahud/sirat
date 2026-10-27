// Referensi surat sebelumnya (master prompt lanjutan G) — wrapper DB.
// Logika murni (resolveReference + tipe) ada di reference-logic.ts (teruji unit).
// - Autocomplete scope-filtered; otorisasi diperiksa backend (G.2).
// - Exact match unik → relasi internal otomatis (G.4); ambigu → teks saja.
// - Teks manual tetap tersimpan (surat eksternal/lama) (G.3).
import 'server-only'
import { db } from '@/lib/db'
import { letterScopeFilter, ResolvedUser } from '@/lib/rbac'
import { ReferenceInput, ResolvedReference, RefFinders, resolveReference } from '@/lib/reference-logic'

export type { ReferenceInput, ResolvedReference, RefFinders }
export { resolveReference }

export interface RefSearchRow {
  id: string
  officialNumber: string | null
  legacyNumber: string | null
  subject: string | null
  letterDate: string | null
  status: string
  unitCode: string
}

/** Pencarian autocomplete (G.2): hanya surat bernomor final dalam scope user. */
export async function searchReferencableLetters(user: ResolvedUser, q: string, limit = 10, excludeLetterId?: string): Promise<RefSearchRow[]> {
  const term = q.trim()
  if (term.length < 2) return []
  const scope = letterScopeFilter(user)
  const letters = await db.letter.findMany({
    where: {
      status: { in: ['ISSUED', 'CANCELLED'] }, // nomor final saja
      AND: [
        { OR: [{ officialNumber: { contains: term } }, { legacyNumber: { contains: term } }] },
        ...(scope ? [scope] : []),
      ],
      ...(excludeLetterId ? { id: { not: excludeLetterId } } : {}),
    },
    select: {
      id: true, officialNumber: true, legacyNumber: true, subject: true,
      letterDate: true, status: true, issuingUnit: { select: { code: true } },
    },
    orderBy: [{ issuedAt: 'desc' }],
    take: Math.min(25, Math.max(1, limit)),
  })
  return letters.map(l => ({
    id: l.id,
    officialNumber: l.officialNumber,
    legacyNumber: l.legacyNumber,
    subject: l.subject,
    letterDate: l.letterDate ? l.letterDate.toISOString().slice(0, 10) : null,
    status: l.status,
    unitCode: l.issuingUnit.code,
  }))
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

function txFinders(tx: Tx, user: ResolvedUser): RefFinders {
  const scope = letterScopeFilter(user)
  return {
    findByNormalizedNumber: async (norm) => {
      return tx.letter.findFirst({ where: { normalizedNumber: norm }, select: { id: true } })
    },
    findByLegacyNumber: async (raw) => {
      return tx.letter.findMany({ where: { legacyNumber: raw }, select: { id: true } })
    },
    inScope: async (id) => {
      const l = await tx.letter.findFirst({ where: { id, ...(scope ?? {}) }, select: { id: true } })
      return !!l
    },
  }
}

/**
 * Sinkronkan referensi surat (hanya untuk DRAFT — G.6: setelah final, referensi
 * adalah fakta penerbitan yang tidak boleh berubah diam-diam).
 * Semantik replace-set; validasi: target ada, dalam scope, bukan diri sendiri.
 * Referensi teks yang cocok 100% dengan satu nomor final berizin otomatis
 * dihubungkan internal (G.4, dievaluasi di backend — tidak bisa dipalsukan FE).
 */
export async function syncLetterReferences(
  tx: Tx,
  user: ResolvedUser,
  letterId: string,
  refs: ReferenceInput[],
): Promise<void> {
  const finders = txFinders(tx, user)
  const seen = new Set<string>()
  const seenText = new Set<string>()
  await tx.letterReference.deleteMany({ where: { letterId } })
  for (const r of refs.slice(0, 20)) { // batasi jumlah referensi per surat
    const text = r.refNumberText?.trim()
    if (!text || text.length > 240) continue

    let targetId: string | null = null
    let isAuto = false
    if (r.letterId) {
      // Pilihan eksplisit dari autocomplete — verifikasi scope di backend
      if (r.letterId === letterId) continue // G.4: jangan menghubungkan ke diri sendiri
      const ok = await finders.inScope(r.letterId)
      if (!ok) continue // di luar scope → tolak senyap (FE seharusnya tidak menawarkan)
      targetId = r.letterId
    } else {
      // Teks manual: coba exact match otomatis (G.4)
      const resolved = await resolveReference(text, finders)
      targetId = resolved.letterId ?? null
      isAuto = resolved.isAutoLinked
    }

    if (targetId) {
      const key = `id:${targetId}`
      if (seen.has(key)) continue
      seen.add(key)
      const target = await tx.letter.findUnique({
        where: { id: targetId },
        select: { officialNumber: true, legacyNumber: true },
      })
      await tx.letterReference.create({
        data: {
          letterId,
          refLetterId: targetId,
          refNumberText: target?.officialNumber ?? target?.legacyNumber ?? text,
          isAutoLinked: isAuto,
          createdBy: user.id,
        },
      })
    } else {
      const key = `text:${text.toUpperCase()}`
      if (seenText.has(key)) continue
      seenText.add(key)
      await tx.letterReference.create({
        data: { letterId, refLetterId: null, refNumberText: text, isAutoLinked: false, createdBy: user.id },
      })
    }
  }
}
