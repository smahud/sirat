import { describe, it, expect } from 'vitest'
import { dslSchema, presetYapsiDsl, parseDsl } from '@/lib/numbering/dsl'
import { renderNumber, requiredInputs } from '@/lib/numbering/render'
import { validateDslForActivation, periodKeyFor } from '@/lib/numbering/validate'
import { padSequence, romanMonth, normalizeNumber, sanitizeSegment } from '@/lib/constants'

const BASE = presetYapsiDsl()

describe('DSL schema', () => {
  it('menerima preset YAPSI', () => {
    expect(() => dslSchema.parse(BASE)).not.toThrow()
  })
  it('menolak komponen tidak dikenal (anti eval/executable)', () => {
    expect(() => dslSchema.parse({
      version: 1, separator: '/',
      components: [{ type: 'javascript', code: 'process.exit(1)' }],
    })).toThrow()
  })
  it('menolak separator di luar whitelist', () => {
    expect(() => dslSchema.parse({ version: 1, separator: ';', components: [{ type: 'literal', value: 'X' }] })).toThrow()
  })
  it('menolak mapping arah tidak lengkap', () => {
    const bad = structuredClone(BASE)
    ;(bad.components[1] as { mapping: Record<string, string> }).mapping = { INTERNAL: 'A' }
    expect(() => dslSchema.parse(bad)).toThrow()
  })
})

describe('render nomor', () => {
  it('merender contoh workbook: 066/A/SPR/YAPSI-DS/X/2026 (A = Internal)', () => {
    const r = renderNumber(BASE, {
      seq: 66, direction: 'INTERNAL', letterTypeCode: 'SPR',
      unitCode: 'YAPSI', letterDate: new Date('2026-10-13T00:00:00Z'),
    })
    expect(r.text).toBe('066/A/SPR/YAPSI-DS/X/2026')
  })
  it('padding minimum 3; 1000 tetap 1000', () => {
    const r = renderNumber(BASE, {
      seq: 1000, direction: 'INTERNAL', letterTypeCode: 'SPR',
      unitCode: 'YAPSI', letterDate: new Date('2026-01-01T00:00:00Z'),
    })
    expect(r.text.startsWith('1000/')).toBe(true)
  })
  it('eksternal → B, internal → A', () => {
    const mk = (d: string) => renderNumber(BASE, {
      seq: 5, direction: d as never, letterTypeCode: 'SPR',
      unitCode: 'YAPSI', letterDate: new Date('2026-05-01T00:00:00Z'),
    }).text
    expect(mk('INTERNAL').split('/')[1]).toBe('A')
    expect(mk('EXTERNAL').split('/')[1]).toBe('B')
  })
  it('preview tanpa seq → placeholder # tanpa reservasi', () => {
    const r = renderNumber(BASE, {
      direction: 'INTERNAL', letterTypeCode: 'SPR',
      unitCode: 'YAPSI', letterDate: new Date('2026-05-01T00:00:00Z'),
    })
    expect(r.text.startsWith('###/')).toBe(true)
  })
  it('menolak render bila komponen wajib kosong (bukan string kosong diam-diam)', () => {
    expect(() => renderNumber(BASE, { unitCode: 'X' })).toThrow(/Arah surat/)
    expect(() => renderNumber(BASE, { direction: 'INTERNAL', unitCode: 'X' })).toThrow(/Jenis surat/)
    expect(() => renderNumber(BASE, { direction: 'INTERNAL', letterTypeCode: 'SPR', unitCode: 'X' })).toThrow(/Tanggal surat/)
  })
  it('committeeCode wajib ada untuk surat panitia', () => {
    const dsl = { ...BASE, components: [{ type: 'committeeCode' as const }] }
    expect(() => renderNumber(dsl, { unitCode: 'X' })).toThrow(/kepanitiaan/)
  })
  it('requiredInputs mengembalikan field dinamis yang dibutuhkan', () => {
    expect(requiredInputs(BASE).sort()).toEqual(['direction', 'letterDate', 'letterTypeId'])
  })
})

describe('validasi aktivasi (FR-006/007)', () => {
  it('preset valid untuk diaktifkan', () => {
    const v = validateDslForActivation(BASE)
    expect(v.ok).toBe(true)
    expect(v.example).toBe('001/A/SPR/YAPSI-DS/I/2026')
  })
  it('profil tanpa sequence tidak bisa aktif', () => {
    const v = validateDslForActivation({ ...BASE, components: BASE.components.filter(c => c.type !== 'sequence') })
    expect(v.ok).toBe(false)
    expect(v.errors[0]).toMatch(/satu komponen urutan/)
  })
  it('mapping arah duplikat nilai → warning', () => {
    const d = structuredClone(BASE)
    ;(d.components[1] as { mapping: Record<string, string> }).mapping = { INTERNAL: 'A', EXTERNAL: 'A' }
    const v = validateDslForActivation(d)
    expect(v.ok).toBe(true)
    expect(v.warnings.some(w => w.includes('nilai sama'))).toBe(true)
  })
})

describe('period key counter (blueprint 16.1)', () => {
  it('ALL → selalu ALL', () => {
    expect(periodKeyFor('ALL', 'LETTER_DATE', new Date('2026-10-13T00:00:00Z'), null)).toBe('ALL')
  })
  it('YEARLY → tahun dari sumber tanggal', () => {
    expect(periodKeyFor('YEARLY', 'LETTER_DATE', new Date('2026-10-13T00:00:00Z'), null)).toBe('2026')
    expect(periodKeyFor('YEARLY', 'LETTER_DATE', new Date('2025-05-13T00:00:00Z'), null)).toBe('2025')
  })
  it('MONTHLY → YYYY-MM', () => {
    expect(periodKeyFor('MONTHLY', 'LETTER_DATE', new Date('2026-01-05T00:00:00Z'), null)).toBe('2026-01')
  })
  it('ISSUE_DATE memakai waktu terbit bila dipilih', () => {
    expect(periodKeyFor('YEARLY', 'ISSUE_DATE', new Date('2020-01-01T00:00:00Z'), new Date('2026-10-26T00:00:00Z'))).toBe('2026')
  })
})

describe('utilitas domain', () => {
  it('romanMonth benar untuk 12 bulan', () => {
    expect(romanMonth(10)).toBe('X')
    expect(romanMonth(12)).toBe('XII')
    expect(romanMonth(1)).toBe('I')
  })
  it('padSequence minimum padding', () => {
    expect(padSequence(7, 3)).toBe('007')
    expect(padSequence(1234, 3)).toBe('1234')
  })
  it('normalizeNumber untuk deteksi konflik', () => {
    expect(normalizeNumber(' 066/a/spr/yapsi-ds/x/2026 ')).toBe('066/A/SPR/YAPSI-DS/X/2026')
  })
  it('sanitizeSegment memblokir traversal', () => {
    expect(sanitizeSegment('../../etc/passwd')).not.toContain('/')
    expect(sanitizeSegment('a/b\\c')).toBe('a_b_c')
  })
  it('parseDsl roundtrip', () => {
    expect(parseDsl(JSON.stringify(BASE))).toEqual(BASE)
  })
})
