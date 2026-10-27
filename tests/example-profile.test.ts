// Uji profil penomoran CONTOH (v1.7) — memastikan definisi di
// scripts/example-numbering-profile.json valid secara penuh:
// lolos schema DSL v2, lolos validasi aktivasi (E.3), dan merender
// nomor contoh yang dijanjikan: 001/A/N/UND/MI/X/2026.
// Sumber kebenaran tunggal: file JSON yang sama dipakai seed & script produksi.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { dslInputSchema, parseDsl } from '@/lib/numbering/dsl'
import { renderNumber } from '@/lib/numbering/render'
import { validateDslForActivation, exampleFieldValues } from '@/lib/numbering/validate'

const spec = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'example-numbering-profile.json'),
  'utf8',
))

const CTX_BASE = {
  letterTypeCode: 'UND',
  unitCode: 'MI',
  letterDate: new Date('2026-10-13T00:00:00Z'), // bulan X (Oktober) romawi
}

describe('Contoh profil penomoran (example-numbering-profile.json)', () => {
  it('lolos schema DSL v2 (dslInputSchema → NumberingDSL)', () => {
    const dsl = dslInputSchema.parse(spec.dsl)
    expect(dsl.version).toBe(2)
    expect(dsl.fields.map(f => f.key)).toEqual(['arah_surat', 'klasifikasi', 'sifat_surat'])
  })

  it('parseDsl menerima JSON string dari DB tanpa error', () => {
    const dsl = parseDsl(JSON.stringify(spec.dsl))
    expect(dsl.fields.length).toBe(3)
  })

  it('lolos validasi aktivasi penuh — 0 error', () => {
    const dsl = parseDsl(JSON.stringify(spec.dsl))
    const result = validateDslForActivation(dsl)
    expect(result.errors).toEqual([])
  })

  it('merender contoh nomor yang dijanjikan: 001/A/N/UND/MI/X/2026', () => {
    const dsl = parseDsl(JSON.stringify(spec.dsl))
    const r = renderNumber(dsl, {
      ...CTX_BASE,
      seq: 1,
      fieldValues: {
        arah_surat: 'internal',   // kode A
        klasifikasi: 'biasa',     // kode N
        sifat_surat: 'biasa',     // metadata — tidak masuk nomor
      },
    })
    expect(r.text).toBe('001/A/N/UND/MI/X/2026')
  })

  it('pilihan lain menghasilkan segmen berbeda (B/R) — mapping kode bekerja', () => {
    const dsl = parseDsl(JSON.stringify(spec.dsl))
    const r = renderNumber(dsl, {
      ...CTX_BASE,
      seq: 1,
      fieldValues: { arah_surat: 'eksternal', klasifikasi: 'rahasia' },
    })
    expect(r.text).toBe('001/B/R/UND/MI/X/2026')
  })

  it('field metadata sifat_surat tidak dipakai dalam nomor', () => {
    const dsl = parseDsl(JSON.stringify(spec.dsl))
    const used = dsl.components
      .filter((c): c is Extract<typeof c, { type: 'fieldRef' }> => c.type === 'fieldRef')
      .map(c => c.field)
    expect(used).toContain('arah_surat')
    expect(used).toContain('klasifikasi')
    expect(used).not.toContain('sifat_surat')
  })

  it('default klasifikasi=biasa terisi dan aktif (aturan E.3 default valid)', () => {
    const dsl = parseDsl(JSON.stringify(spec.dsl))
    const klas = dsl.fields.find(f => f.key === 'klasifikasi')!
    expect(klas.defaultOptionId).toBe('biasa')
    expect(klas.options.find(o => o.id === 'biasa')?.active).toBe(true)
  })

  it('fallback contoh field menghasilkan nilai utk semua field', () => {
    const dsl = parseDsl(JSON.stringify(spec.dsl))
    const fv = exampleFieldValues(dsl)
    expect(Object.keys(fv).sort()).toEqual(['arah_surat', 'klasifikasi', 'sifat_surat'])
  })
})
