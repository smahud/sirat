// Tests resolusi referensi surat (master prompt lanjutan K.6):
// exact match, ambigu, scope filter, manual text — logika murni dengan finder ter-injeksi.
import { describe, it, expect } from 'vitest'
import { resolveReference, RefFinders } from '@/lib/reference-logic'

function makeFinders(opts: {
  byNorm?: Record<string, string>       // normalizedNumber → letterId
  byLegacy?: Record<string, string[]>   // legacyNumber → letterIds
  scopeIds?: string[] | 'ALL'           // id yang terlihat user
}): RefFinders {
  return {
    findByNormalizedNumber: async (norm) => {
      const id = opts.byNorm?.[norm]
      return id ? { id } : null
    },
    findByLegacyNumber: async (raw) => {
      const ids = opts.byLegacy?.[raw] ?? []
      return ids.map(id => ({ id }))
    },
    inScope: async (id) => opts.scopeIds === 'ALL' ? true : (opts.scopeIds ?? []).includes(id),
  }
}

describe('G.4 — exact match otomatis', () => {
  it('cocok 100% normalizedNumber unik & berizin → relasi internal', async () => {
    const f = makeFinders({ byNorm: { '001/SK/MI/2026': 'L1' }, scopeIds: ['L1'] })
    const r = await resolveReference('001/SK/mi/2026', f) // beda kapital → ternormalisasi sama
    expect(r.letterId).toBe('L1')
    expect(r.isAutoLinked).toBe(true)
  })
  it('nomor valid tapi di luar scope user → TIDAK dihubungkan (tidak bocor)', async () => {
    const f = makeFinders({ byNorm: { '001/SK/MTS/2026': 'L9' }, scopeIds: ['L1'] })
    const r = await resolveReference('001/SK/MTS/2026', f)
    expect(r.letterId).toBeNull()
    expect(r.note).toContain('manual')
  })
  it('legacyNumber unik & berizin → relasi internal', async () => {
    const f = makeFinders({ byLegacy: { '001/OLD/2023': ['L2'] }, scopeIds: ['L2'] })
    const r = await resolveReference('001/OLD/2023', f)
    expect(r.letterId).toBe('L2')
    expect(r.isAutoLinked).toBe(true)
    expect(r.note).toContain('legacy')
  })
  it('legacyNumber ganda → ambigu, teks saja (tidak menghubungkan sembarangan)', async () => {
    const f = makeFinders({ byLegacy: { '001/X': ['L1', 'L2'] }, scopeIds: ['L1', 'L2'] })
    const r = await resolveReference('001/X', f)
    expect(r.letterId).toBeNull()
    expect(r.note).toContain('beberapa')
  })
  it('tidak cocok apapun → referensi manual (G.3)', async () => {
    const f = makeFinders({ scopeIds: 'ALL' })
    const r = await resolveReference('999/EXT/YAYASAN/2019', f)
    expect(r.letterId).toBeNull()
    expect(r.isAutoLinked).toBe(false)
  })
  it('legacy ganda tapi hanya satu dalam scope → hanya yang berizin yang dihubungkan', async () => {
    const f = makeFinders({ byLegacy: { '001/Y': ['L1', 'L2'] }, scopeIds: ['L2'] })
    const r = await resolveReference('001/Y', f)
    expect(r.letterId).toBe('L2')
  })
  it('teks kosong → error', async () => {
    const f = makeFinders({ scopeIds: 'ALL' })
    await expect(resolveReference('   ', f)).rejects.toThrow('kosong')
  })
})
