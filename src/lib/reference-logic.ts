// Logika resolusi referensi surat — murni (tanpa I/O / tanpa 'server-only')
// agar dapat diuji unit. Wrapper DB ada di references.ts.
import { normalizeNumber } from '@/lib/constants'

export interface ReferenceInput {
  letterId?: string | null // surat internal yang dipilih via autocomplete
  refNumberText: string    // teks nomor (snapshot historis)
}

export interface ResolvedReference extends ReferenceInput {
  isAutoLinked: boolean
  note?: string
}

/** Finder ter-injeksi agar logika resolusi murni & teruji unit (tanpa koneksi DB). */
export interface RefFinders {
  findByNormalizedNumber(norm: string): Promise<{ id: string } | null>
  findByLegacyNumber(raw: string): Promise<{ id: string }[]>
  inScope(id: string): Promise<boolean>
}

/**
 * Resolusi teks referensi (master prompt lanjutan G.4):
 * 1) cocok 100% dengan normalizedNumber unik → relasi internal;
 * 2) cocok legacyNumber tepat & unik → relasi internal;
 * 3) legacyNumber cocok >1 → ambigu, simpan teks saja (user harus memilih eksplisit);
 * 4) tidak cocok → teks manual (surat eksternal).
 * Semua kandidat tetap melewati scope user — nomor di luar scope tidak dihubungkan.
 */
export async function resolveReference(text: string, finders: RefFinders): Promise<ResolvedReference> {
  const raw = text.trim()
  if (!raw) throw new Error('Teks referensi kosong')

  const norm = normalizeNumber(raw)
  const byNorm = await finders.findByNormalizedNumber(norm)
  if (byNorm && (await finders.inScope(byNorm.id))) {
    return { letterId: byNorm.id, refNumberText: raw, isAutoLinked: true }
  }
  const byLegacy = await finders.findByLegacyNumber(raw)
  const scoped: { id: string }[] = []
  for (const c of byLegacy) {
    if (await finders.inScope(c.id)) scoped.push(c)
  }
  if (scoped.length === 1) {
    return { letterId: scoped[0].id, refNumberText: raw, isAutoLinked: true, note: 'Dipadankan dari nomor lama (legacy)' }
  }
  if (scoped.length > 1) {
    return { letterId: null, refNumberText: raw, isAutoLinked: false, note: 'Nomor cocok dengan beberapa surat — pilih salah satu untuk menghubungkan' }
  }
  return { letterId: null, refNumberText: raw, isAutoLinked: false, note: 'Tersimpan sebagai referensi manual (surat eksternal/tidak ditemukan)' }
}
