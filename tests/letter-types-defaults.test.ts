// Test katalog default jenis surat (default config v1.4).
// Memastikan scripts/letter-types-defaults.json selalu valid terhadap batas kolom DB
// (description<=500, purpose<=500, usageExamples<=1000, notes<=500, category<=80)
// dan API (code<=24, name<=120) — sehingga seed/backfill tidak pernah gagal validasi.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULTS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'letter-types-defaults.json'), 'utf8'),
)

describe('katalog default jenis surat (letter-types-defaults.json)', () => {
  it('memuat kategori standar dan katalog jenis surat', () => {
    expect(Array.isArray(DEFAULTS.categories)).toBe(true)
    expect(DEFAULTS.categories.length).toBeGreaterThanOrEqual(5)
    expect(Array.isArray(DEFAULTS.letterTypes)).toBe(true)
    expect(DEFAULTS.letterTypes.length).toBeGreaterThanOrEqual(13)
  })

  it('semua kode unik, uppercase, dan tidak kosong', () => {
    const codes = DEFAULTS.letterTypes.map((t: { code: string }) => t.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const t of DEFAULTS.letterTypes) {
      expect(t.code.length).toBeGreaterThan(0)
      expect(t.code.length).toBeLessThanOrEqual(24)
      expect(t.code).toBe(t.code.toUpperCase())
    }
  })

  it('kode workbook YAPSI tetap terwakili (8 kode lampiran)', () => {
    const codes = new Set(DEFAULTS.letterTypes.map((t: { code: string }) => t.code))
    for (const c of ['SR', 'SE', 'SK', 'SPB', 'UND', 'SPR', 'SPT', 'BA']) {
      expect(codes.has(c)).toBe(true)
    }
  })

  it('setiap jenis punya kategori valid dan keterangan lengkap (panduan user baru)', () => {
    const cats = new Set(DEFAULTS.categories)
    for (const t of DEFAULTS.letterTypes) {
      expect(t.category, `${t.code}.category`).toBeTruthy()
      expect(cats.has(t.category)).toBe(true)
      expect(t.name.length, `${t.code}.name`).toBeGreaterThan(0)
      expect(t.name.length).toBeLessThanOrEqual(120)
      expect(t.description, `${t.code}.description`).toBeTruthy()
      expect(t.purpose, `${t.code}.purpose`).toBeTruthy()
      expect(t.notes, `${t.code}.notes`).toBeTruthy()
    }
  })

  it('semua field memenuhi batas panjang kolom DB', () => {
    for (const t of DEFAULTS.letterTypes) {
      expect(t.category.length, `${t.code}.category`).toBeLessThanOrEqual(80)
      expect(t.description.length, `${t.code}.description`).toBeLessThanOrEqual(500)
      expect(t.purpose.length, `${t.code}.purpose`).toBeLessThanOrEqual(500)
      expect(t.usageExamples.length, `${t.code}.usageExamples`).toBeLessThanOrEqual(1000)
      expect(t.notes.length, `${t.code}.notes`).toBeLessThanOrEqual(500)
    }
  })

  it('contoh penggunaan berisi minimal 3 baris non-kosong (informatif bagi user pertama kali)', () => {
    for (const t of DEFAULTS.letterTypes) {
      const lines = String(t.usageExamples).split('\n').map((s: string) => s.trim()).filter(Boolean)
      expect(lines.length, `${t.code}.usageExamples`).toBeGreaterThanOrEqual(3)
    }
  })

  it('setiap kategori standar dipakai minimal satu jenis (navigasi lengkap)', () => {
    const used = new Set(DEFAULTS.letterTypes.map((t: { category: string }) => t.category))
    for (const c of DEFAULTS.categories) {
      expect(used.has(c), `kategori "${c}" tidak dipakai`).toBe(true)
    }
  })
})
