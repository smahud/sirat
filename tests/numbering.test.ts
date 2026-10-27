import { describe, it, expect } from 'vitest'
import {
  dslSchema, dslInputSchema, presetYapsiDsl, parseDsl, migrateV1ToV2,
  freshFieldKey, freshOptionId, fieldUsedInNumber,
} from '@/lib/numbering/dsl'
import { renderNumber, requiredInputs, formFields, RenderError } from '@/lib/numbering/render'
import { validateDslForActivation, periodKeyFor, exampleFieldValues } from '@/lib/numbering/validate'
import { resolveFieldValues, resolveFieldValuesForPreview, unresolvedNumberFields, FieldResolutionError } from '@/lib/numbering/fields'
import { padSequence, romanMonth, normalizeNumber, sanitizeSegment } from '@/lib/constants'
import type { NumberingDSL } from '@/lib/numbering/dsl'

const BASE = presetYapsiDsl()
const CTX = {
  fieldValues: { arah_surat: 'internal' },
  letterTypeCode: 'SPR',
  unitCode: 'YAPSI',
  letterDate: new Date('2026-10-13T00:00:00Z'),
}

/** DSL v1 persis seperti tersimpan di produksi sebelum v1.6. */
function legacyV1Dsl() {
  return {
    version: 1 as const,
    separator: '/' as const,
    components: [
      { type: 'sequence' as const, padding: 3 },
      { type: 'direction' as const, mapping: { INTERNAL: 'A', EXTERNAL: 'B' } },
      { type: 'letterTypeCode' as const },
      { type: 'literal' as const, value: 'YAPSI-DS' },
      { type: 'letterDate' as const, format: 'MONTH_ROMAN' as const },
      { type: 'letterDate' as const, format: 'YEAR_4' as const },
    ],
  }
}

describe('DSL v2 schema', () => {
  it('menerima preset YAPSI v2', () => {
    expect(() => dslSchema.parse(BASE)).not.toThrow()
  })
  it('menolak komponen tidak dikenal (anti eval/executable)', () => {
    expect(() => dslSchema.parse({
      version: 2, separator: '/', fields: [],
      components: [{ type: 'javascript', code: 'process.exit(1)' }],
    })).toThrow()
  })
  it('menolak separator di luar whitelist', () => {
    expect(() => dslSchema.parse({ version: 2, separator: ';', fields: [], components: [{ type: 'literal', value: 'X' }] })).toThrow()
  })
  it('menolak fieldRef merujuk field yang tidak ada (tertangkap validasi aktivasi)', () => {
    const d = structuredClone(BASE)
    d.components[1] = { type: 'fieldRef', field: 'tidak_ada' }
    expect(() => dslSchema.parse(d)).not.toThrow() // schema: string bebas
    expect(validateDslForActivation(d).ok).toBe(false) // validasi domain yang menolak
  })
  it('menolak kunci field tidak snake_case', () => {
    const d = structuredClone(BASE)
    d.fields[0].key = 'Arah Surat'
    expect(() => dslSchema.parse(d)).toThrow()
  })
  it('menolak opsi tanpa label/kode', () => {
    const d = structuredClone(BASE)
    d.fields[0].options[0] = { id: 'x', label: '', code: 'A', active: true }
    expect(() => dslSchema.parse(d)).toThrow()
  })
})

describe('migrasi v1 → v2 (E.10)', () => {
  it('parseDsl meng-upgrade v1 tersimpan menjadi v2 ekuivalen', () => {
    const dsl = parseDsl(JSON.stringify(legacyV1Dsl()))
    expect(dsl.version).toBe(2)
    expect(dsl.fields).toHaveLength(1)
    expect(dsl.fields[0].key).toBe('arah_surat')
    expect(dsl.fields[0].options.map(o => [o.label, o.code])).toEqual([['Internal', 'A'], ['Eksternal', 'B']])
    expect(dsl.fields[0].options.map(o => o.legacyKey)).toEqual(['INTERNAL', 'EXTERNAL'])
    expect(dsl.components[1]).toEqual({ type: 'fieldRef', field: 'arah_surat' })
  })
  it('render hasil migrasi IDENTIK dengan v1 — nomor historis kompatibel (F.8)', () => {
    const v2 = migrateV1ToV2(legacyV1Dsl())
    const r = renderNumber(v2, { ...CTX, seq: 66 })
    expect(r.text).toBe('066/A/SPR/YAPSI-DS/X/2026')
    // eksternal → B (id opsi hasil migrasi = slugify dari enum v1: 'external')
    const r2 = renderNumber(v2, { ...CTX, seq: 66, fieldValues: { arah_surat: 'external' } })
    expect(r2.text.split('/')[1]).toBe('B')
  })
  it('dslInputSchema menerima v1 dari API lama dan menormalisasi ke v2', () => {
    const out = dslInputSchema.parse(legacyV1Dsl())
    expect(out.version).toBe(2)
  })
  it('draft lama dengan direction INTERNAL tetap bisa resolve lewat legacyKey', () => {
    const v2 = migrateV1ToV2(legacyV1Dsl())
    const resolved = resolveFieldValues(v2, null, 'INTERNAL')
    expect(resolved.arah_surat).toEqual({ optionId: 'internal', label: 'Internal', code: 'A' })
    const r = renderNumber(v2, { ...CTX, fieldValues: { arah_surat: resolved.arah_surat.optionId } })
    expect(r.text.split('/')[1]).toBe('A')
  })
})

describe('render nomor v2', () => {
  it('merender contoh workbook: 066/A/SPR/YAPSI-DS/X/2026 (Internal → kode A)', () => {
    const r = renderNumber(BASE, { ...CTX, seq: 66 })
    expect(r.text).toBe('066/A/SPR/YAPSI-DS/X/2026')
  })
  it('operator memilih label, nomor memakai kode (F.3)', () => {
    const r = renderNumber(BASE, { ...CTX, seq: 5, fieldValues: { arah_surat: 'eksternal' } })
    expect(r.text.startsWith('005/B/')).toBe(true)
    const part = r.parts.find(p => p.componentType === 'fieldRef')!
    expect(part.source).toContain('Eksternal → B')
  })
  it('padding minimum 3; 1000 tetap 1000', () => {
    const r = renderNumber(BASE, { ...CTX, seq: 1000 })
    expect(r.text.startsWith('1000/')).toBe(true)
  })
  it('preview tanpa seq → placeholder # tanpa reservasi', () => {
    const r = renderNumber(BASE, CTX)
    expect(r.text.startsWith('###/')).toBe(true)
  })
  it('default option dipakai bila operator belum memilih', () => {
    const d = structuredClone(BASE)
    d.fields[0].defaultOptionId = 'eksternal'
    const r = renderNumber(d, { ...CTX, fieldValues: {} })
    expect(r.text.split('/')[1]).toBe('B')
  })
  it('menolak render bila komponen wajib kosong (bukan string kosong diam-diam)', () => {
    expect(() => renderNumber(BASE, { ...CTX, fieldValues: {} })).toThrow(RenderError)
    expect(() => renderNumber(BASE, { ...CTX, fieldValues: {}, letterTypeCode: undefined })).toThrow(/Arah Surat/)
    expect(() => renderNumber(BASE, { ...CTX, letterTypeCode: undefined, fieldValues: { arah_surat: 'internal' } })).toThrow(/Jenis surat/)
    expect(() => renderNumber(BASE, { ...CTX, letterTypeCode: 'SPR', unitCode: 'YAPSI', fieldValues: { arah_surat: 'internal' }, letterDate: undefined })).toThrow(/Tanggal surat/)
  })
  it('fieldRef merujuk field hilang → error eksplisit', () => {
    const d: NumberingDSL = { ...BASE, components: [{ type: 'fieldRef', field: 'hantu' }] }
    expect(() => renderNumber(d, {})).toThrow(/tidak didefinisikan/)
  })
  it('committeeCode wajib ada untuk surat panitia', () => {
    const dsl = { ...BASE, components: [{ type: 'committeeCode' as const }] }
    expect(() => renderNumber(dsl, { unitCode: 'X' })).toThrow(/kepanitiaan/)
  })
})

describe('multiple dropdown independen (F.1/F.2)', () => {
  function multiDdl(): NumberingDSL {
    return {
      version: 2,
      separator: '/',
      fields: [
        { type: 'dropdown', key: 'arah_surat', label: 'Arah Surat', placeholder: null, helperText: null,
          options: [
            { id: 'int', label: 'Internal', code: 'A', active: true },
            { id: 'eks', label: 'Eksternal', code: 'B', active: true },
          ], defaultOptionId: null, required: true, order: 0 },
        { type: 'dropdown', key: 'klasifikasi', label: 'Klasifikasi', placeholder: null, helperText: null,
          options: [
            { id: 'biasa', label: 'Biasa', code: 'N', active: true },
            { id: 'rahasia', label: 'Rahasia', code: 'R', active: true },
            { id: 'sangat_rahasia', label: 'Sangat Rahasia', code: 'SR', active: true },
          ], defaultOptionId: 'biasa', required: false, order: 1 },
        { type: 'dropdown', key: 'sifat', label: 'Sifat Surat', placeholder: null, helperText: null,
          options: [
            { id: 'penting', label: 'Penting', code: 'P', active: true },
          ], defaultOptionId: null, required: true, order: 2 }, // metadata saja (tanpa fieldRef)
      ],
      components: [
        { type: 'sequence', padding: 3 },
        { type: 'fieldRef', field: 'arah_surat' },
        { type: 'fieldRef', field: 'klasifikasi' },
        { type: 'letterTypeCode' },
      ],
    }
  }
  it('dua dropdown dalam satu profil dirender independen', () => {
    const r = renderNumber(multiDdl(), {
      seq: 12,
      fieldValues: { arah_surat: 'eks', klasifikasi: 'rahasia' },
      letterTypeCode: 'SK',
    })
    expect(r.text).toBe('012/B/R/SK')
  })
  it('requiredInputs: field wajib tanpa default dilaporkan; yang ber-default tidak', () => {
    const req = requiredInputs(multiDdl())
    expect(req).toContain('field:arah_surat')
    expect(req).not.toContain('field:klasifikasi') // ada default
    expect(req).toContain('field:sifat')           // wajib meski metadata
    expect(req).toContain('letterTypeId')
  })
  it('formFields: urutan formulir + hanya opsi aktif + tanda ikut nomor', () => {
    const d = multiDdl()
    d.fields[0].options[1].active = false // Eksternal dinonaktifkan
    const specs = formFields(d)
    expect(specs.map(s => s.key)).toEqual(['arah_surat', 'klasifikasi', 'sifat'])
    expect(specs[0].options.map(o => o.id)).toEqual(['int']) // eks hilang
    expect(specs[0].inNumber).toBe(true)
    expect(specs[2].inNumber).toBe(false)
    expect(specs[1].defaultOptionId).toBe('biasa')
  })
  it('contoh nilai: default/opsi pertama aktif dipakai utk preview', () => {
    const ex = exampleFieldValues(multiDdl())
    expect(ex.arah_surat).toBe('int')
    expect(ex.klasifikasi).toBe('biasa')
  })
})

describe('resolusi & validasi pilihan operator (E.4/E.5)', () => {
  it('opsi tidak dikenal → error jelas (profil berganti versi)', () => {
    expect(() => resolveFieldValues(BASE, { arah_surat: 'hantu' }))
      .toThrow(FieldResolutionError)
    try {
      resolveFieldValues(BASE, { arah_surat: 'hantu' })
    } catch (e) {
      expect((e as FieldResolutionError).code).toBe('UNKNOWN_OPTION')
      expect((e as Error).message).toMatch(/Arah Surat/)
    }
  })
  it('opsi nonaktif ditolak (E.5)', () => {
    const d = structuredClone(BASE)
    d.fields[0].options[0].active = false
    expect(() => resolveFieldValues(d, { arah_surat: 'internal' })).toThrow(/tidak aktif/)
  })
  it('field wajib kosong → MISSING_REQUIRED (E.4)', () => {
    expect(() => resolveFieldValues(BASE, {})).toThrow(/belum diisi/)
    try { resolveFieldValues(BASE, {}) } catch (e) {
      expect((e as FieldResolutionError).code).toBe('MISSING_REQUIRED')
    }
  })
  it('field opsional boleh absen; default dipakai bila ada', () => {
    const d = structuredClone(BASE)
    d.fields[0].required = false
    d.fields[0].defaultOptionId = 'internal'
    const r = resolveFieldValues(d, {})
    expect(r.arah_surat.code).toBe('A')
    d.fields[0].defaultOptionId = null
    expect(resolveFieldValues(d, {})).toEqual({})
  })
  it('kunci tak dikenal diabaikan (profil boleh berganti setelah draft dibuat)', () => {
    const r = resolveFieldValues(BASE, { arah_surat: 'internal', lapuk: 'x' })
    expect(r.arah_surat.optionId).toBe('internal')
    expect(r.lapuk).toBeUndefined()
  })
  it('versi preview: field wajib kosong dilaporkan, bukan throw', () => {
    const { values, missingRequired } = resolveFieldValuesForPreview(BASE, {})
    expect(values).toEqual({})
    expect(missingRequired).toEqual(['Arah Surat'])
  })
  it('unresolvedNumberFields menampilkan label field dalam nomor yang belum terisi', () => {
    const { values } = resolveFieldValuesForPreview(BASE, {})
    expect(unresolvedNumberFields(BASE, values)).toEqual(['Arah Surat'])
  })
})

describe('validasi aktivasi v2 (FR-006/007, E.3)', () => {
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
  it('kunci field duplikat → error', () => {
    const d = structuredClone(BASE)
    d.fields.push({ ...structuredClone(d.fields[0]) })
    const v = validateDslForActivation(d)
    expect(v.ok).toBe(false)
    expect(v.errors.some(e => e.includes('duplikat'))).toBe(true)
  })
  it('kode duplikat dalam satu dropdown → warning (F.9: nomor tetap unik lewat urutan)', () => {
    const d = structuredClone(BASE)
    d.fields[0].options[1].code = 'A' // Internal dan Eksternal sama-sama A
    const v = validateDslForActivation(d)
    expect(v.ok).toBe(true)
    expect(v.warnings.some(w => w.includes('kode sama'))).toBe(true)
  })
  it('kode mengandung karakter terlarang → error', () => {
    const d = structuredClone(BASE)
    d.fields[0].options[0].code = 'A/B'
    const v = validateDslForActivation(d)
    expect(v.ok).toBe(false)
    expect(v.errors.some(e => e.includes('terlarang'))).toBe(true)
    d.fields[0].options[0].code = 'A B'
    expect(validateDslForActivation(d).ok).toBe(false)
    d.fields[0].options[0].code = 'A-B'
    expect(validateDslForActivation(d).ok).toBe(false)
  })
  it('default menunjuk opsi tidak ada → error', () => {
    const d = structuredClone(BASE)
    d.fields[0].defaultOptionId = 'hantu'
    expect(validateDslForActivation(d).ok).toBe(false)
  })
  it('default menunjuk opsi nonaktif → error', () => {
    const d = structuredClone(BASE)
    d.fields[0].defaultOptionId = 'internal'
    d.fields[0].options[0].active = false
    const v = validateDslForActivation(d)
    expect(v.ok).toBe(false)
    expect(v.errors.some(e => e.includes('tidak aktif'))).toBe(true)
  })
  it('field opsional dipakai nomor tanpa default → warning', () => {
    const d = structuredClone(BASE)
    d.fields[0].required = false
    const v = validateDslForActivation(d)
    expect(v.warnings.some(w => w.includes('tanpa pilihan default'))).toBe(true)
  })
  it('field metadata (tanpa nomor) → warning informatif', () => {
    const d = structuredClone(BASE)
    d.components = d.components.filter(c => c.type !== 'fieldRef')
    const v = validateDslForActivation(d)
    expect(v.warnings.some(w => w.includes('hanya metadata'))).toBe(true)
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

describe('utilitas domain & helper builder', () => {
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
    expect(normalizeNumber(' 066/a/spr ')).toBe('066/A/SPR')
  })
  it('sanitizeSegment label folder', () => {
    expect(sanitizeSegment('Unit ABC!@#')).toBe('Unit_ABC___')
  })
  it('freshFieldKey menghindari tabrakan (duplikasi builder)', () => {
    expect(freshFieldKey(['arah_surat'], 'arah_surat')).toBe('arah_surat_2')
    expect(freshFieldKey(['arah_surat', 'arah_surat_2'], 'arah_surat')).toBe('arah_surat_3')
    expect(freshFieldKey([], 'Klasifikasi Surat')).toBe('klasifikasi_surat')
  })
  it('freshOptionId unik dalam field', () => {
    expect(freshOptionId(['opt1', 'opt2'])).toBe('opt3')
    expect(freshOptionId(['opt1', 'opt3'])).toBe('opt2')
  })
  it('fieldUsedInNumber mendeteksi referensi template', () => {
    expect(fieldUsedInNumber(BASE, 'arah_surat')).toBe(true)
    const d = structuredClone(BASE)
    d.components = d.components.filter(c => c.type !== 'fieldRef')
    expect(fieldUsedInNumber(d, 'arah_surat')).toBe(false)
  })
})
