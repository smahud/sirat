// Numbering DSL v2 — Dynamic Numbering Profile Builder (revisi v1.6).
// Blueprint 16.2 + instruksi revisi: komponen literal, sequence, fieldRef
// (Dropdown generik dgn mapping label→kode), kode unit/panitia/jenis,
// date formatter. Rule terbatas, JSON tervalidasi, tanpa eval/executable code.
//
// PERUBAHAN v1 → v2 (E.10):
// - Komponen 'direction' (hardcoded INTERNAL/EXTERNAL) DIHAPUS dari schema.
// - Diganti 'fields' (definisi Dropdown bebas) + komponen 'fieldRef' yang
//   merujuk field tersebut pada posisi template nomor.
// - Migrasi v1→v2 otomatis di parseDsl(): arah lama menjadi field
//   'arah_surat' ekuivalen (kode A/B tetap) — nomor historis tidak berubah.
import { z } from 'zod'
import { DATE_FORMATS, SEPARATORS, RESET_POLICIES, DATE_SOURCES } from '@/lib/constants'

// ===== Opsi dropdown: label visual (operator) vs kode keluaran (nomor) =====
const optionSchema = z.object({
  id: z.string().min(1).max(64),                    // identifier stabil, terpisah dari label/kode
  label: z.string().trim().min(1).max(64),          // teks yang dilihat operator
  code: z.string().trim().min(1).max(16),           // kode yang masuk nomor surat
  active: z.boolean().default(true),                // opsi nonaktif: tersembunyi utk pilihan baru, histori tetap
  legacyKey: z.string().optional(),                 // HANYA diisi konverter migrasi v1 (INTERNAL/EXTERNAL)
})
export type DropdownOption = z.infer<typeof optionSchema>

// ===== Definisi field Dropdown (B.2) =====
const fieldKeyRegex = /^[a-z][a-z0-9_]{1,31}$/
const dropdownFieldSchema = z.object({
  type: z.literal('dropdown'),
  key: z.string().regex(fieldKeyRegex, 'Kunci variabel harus snake_case, diawali huruf, 2-32 karakter'),
  label: z.string().trim().min(1).max(64),
  placeholder: z.string().trim().max(64).optional().nullable(),
  helperText: z.string().trim().max(200).optional().nullable(),
  options: z.array(optionSchema).min(1).max(60),
  defaultOptionId: z.string().optional().nullable(),
  required: z.boolean().default(true),
  order: z.number().int().min(0).max(999).optional(), // urutan tampilan pada formulir operator
})
export type DropdownField = z.infer<typeof dropdownFieldSchema>

// ===== Komponen template nomor =====
const literalComp = z.object({
  type: z.literal('literal'),
  value: z.string().min(1).max(32),
})

const sequenceComp = z.object({
  type: z.literal('sequence'),
  padding: z.number().int().min(1).max(10),
})

const fieldRefComp = z.object({
  type: z.literal('fieldRef'),
  field: z.string().min(1).max(32), // merujuk fields[].key
})
export type FieldRefComponent = z.infer<typeof fieldRefComp>

const letterTypeCodeComp = z.object({ type: z.literal('letterTypeCode') })
const unitCodeComp = z.object({ type: z.literal('unitCode') })
const committeeCodeComp = z.object({ type: z.literal('committeeCode') })

const dateComp = z.object({
  type: z.enum(['letterDate', 'issueDate']),
  format: z.enum(DATE_FORMATS),
})

export const componentSchema = z.discriminatedUnion('type', [
  literalComp, sequenceComp, fieldRefComp, letterTypeCodeComp,
  unitCodeComp, committeeCodeComp, dateComp,
])
export type DSLComponent = z.infer<typeof componentSchema>

// ===== Kebijakan counter (saran default; dikonfirmasi eksplisit saat aktivasi) =====
const policySchema = z.object({
  resetPolicy: z.enum(RESET_POLICIES).optional(),
  dateSource: z.enum(DATE_SOURCES).optional(),
  // v1.9: nomor urut pertama profil ini (default 1). Dipakai saat counter BARU
  // dibuat (namespace/periode baru) — memungkinkan nomor terusan dari sistem lama
  // (mis. penomoran kertas berhenti di 024 → startCounter 25).
  startCounter: z.number().int().min(1).max(9_999_999).optional(),
})
export type NumberingPolicy = z.infer<typeof policySchema>

export const dslSchema = z.object({
  version: z.literal(2),
  separator: z.enum(SEPARATORS),
  fields: z.array(dropdownFieldSchema).default([]),
  components: z.array(componentSchema).min(1),
  policy: policySchema.optional(),
})
export type NumberingDSL = z.infer<typeof dslSchema>

// ===== DSL v1 (legacy) — hanya untuk migrasi baca =====
const v1DirectionComp = z.object({
  type: z.literal('direction'),
  mapping: z.record(z.string(), z.string().min(1).max(16)),
})
const v1ComponentSchema = z.discriminatedUnion('type', [
  literalComp, sequenceComp, v1DirectionComp, letterTypeCodeComp,
  unitCodeComp, committeeCodeComp, dateComp,
])
const dslV1Schema = z.object({
  version: z.literal(1),
  separator: z.enum(SEPARATORS),
  components: z.array(v1ComponentSchema).min(1),
})
type NumberingDSLV1 = z.infer<typeof dslV1Schema>

/** Slug sederhana utk key opsi hasil migrasi (stabil, alfanumerik). */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'opt'
}

/**
 * Konversi DSL v1 → v2 (E.10): setiap komponen 'direction' menjadi
 * definisi Dropdown ekuivalen + fieldRef pada posisi template yang sama.
 * - Kode keluaran DIJAMIN identik (INTERNAL→mapping.INTERNAL, dst) sehingga
 *   nomor historis dan format existing 100% kompatibel (F.8).
 * - legacyKey disimpan pada opsi agar DRAFT lama yang masih menyimpan
 *   letter.direction dapat diterbitkan tanpa kehilangan nilai.
 * - Tidak ada nama/label/kode yang di-hardcode di luar konverter ini;
 *   runtime sepenuhnya konfigurasi-driven.
 */
export function migrateV1ToV2(v1: NumberingDSLV1): NumberingDSL {
  const fields: DropdownField[] = []
  const usedKeys = new Set<string>()
  const uniqueKey = (base: string): string => {
    let k = base, n = 2
    while (usedKeys.has(k)) k = `${base}_${n++}`
    usedKeys.add(k)
    return k
  }
  const components = v1.components.map(c => {
    if (c.type !== 'direction') return { ...c } as DSLComponent
    const key = uniqueKey('arah_surat')
    const entries = Object.entries(c.mapping) as [string, string][]
    const field: DropdownField = {
      type: 'dropdown',
      key,
      label: 'Arah Surat',
      placeholder: 'Pilih arah',
      helperText: null,
      options: entries.map(([enumKey, code]) => ({
        id: slugify(enumKey),
        label: enumKey === 'INTERNAL' ? 'Internal' : enumKey === 'EXTERNAL' ? 'Eksternal'
          : enumKey.charAt(0) + enumKey.slice(1).toLowerCase(),
        code,
        active: true,
        legacyKey: enumKey,
      })),
      defaultOptionId: null,
      required: true,
      order: fields.length,
    }
    fields.push(field)
    return { type: 'fieldRef', field: key } as DSLComponent
  })
  return { version: 2, separator: v1.separator, fields, components }
}

/**
 * Input schema API: terima v2 langsung, atau v1 (di-upgrade transparan).
 * Konsumen lama tetap kompatibel; penyimpanan selalu v2.
 */
export const dslInputSchema = z.union([
  dslSchema,
  dslV1Schema.transform(migrateV1ToV2),
])

/** Parse DSL tersimpan: v2 langsung, v1 otomatis dikonversi ekuivalen. */
export function parseDsl(json: string): NumberingDSL {
  const raw = JSON.parse(json)
  if (raw?.version === 1) {
    return dslSchema.parse(migrateV1ToV2(dslV1Schema.parse(raw)))
  }
  return dslSchema.parse(raw)
}

/** Preset workbook YAPSI (Blueprint baseline 1.1) dalam format v2:
 *  [SEQ:3]/[arah_surat]/[KODE_JENIS]/YAPSI-DS/[MONTH_ROMAN]/[YEAR4]
 *  Internal→A, Eksternal→B; bulan/tahun dari tanggal surat. */
export function presetYapsiDsl(): NumberingDSL {
  return {
    version: 2,
    separator: '/',
    fields: [{
      type: 'dropdown',
      key: 'arah_surat',
      label: 'Arah Surat',
      placeholder: 'Pilih arah',
      helperText: null,
      options: [
        { id: 'internal', label: 'Internal', code: 'A', active: true },
        { id: 'eksternal', label: 'Eksternal', code: 'B', active: true },
      ],
      defaultOptionId: null,
      required: true,
      order: 0,
    }],
    components: [
      { type: 'sequence', padding: 3 },
      { type: 'fieldRef', field: 'arah_surat' },
      { type: 'letterTypeCode' },
      { type: 'literal', value: 'YAPSI-DS' },
      { type: 'letterDate', format: 'MONTH_ROMAN' },
      { type: 'letterDate', format: 'YEAR_4' },
    ],
    // Saran kebijakan counter (D.3): dipakai sebagai prefill dialog aktivasi.
    // YEARLY = nomor restart tiap tahun — sesuai format yang memuat tahun.
    policy: { resetPolicy: 'YEARLY', dateSource: 'LETTER_DATE' },
  }
}

// ===== Helper domain =====

/** Field lookup by key. */
export function findField(dsl: NumberingDSL, key: string): DropdownField | undefined {
  return dsl.fields.find(f => f.key === key)
}

/** Apakah field dirujuk komponen template (ikut nomor) atau metadata saja. */
export function fieldUsedInNumber(dsl: NumberingDSL, key: string): boolean {
  return dsl.components.some(c => c.type === 'fieldRef' && c.field === key)
}

/** Key baru yang belum dipakai (untuk duplikasi field di builder). */
export function freshFieldKey(existing: string[], base: string): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '').slice(0, 28) || 'field'
  let key = slug, n = 2
  while (existing.includes(key)) key = `${slug}_${n++}`
  return key
}

/** ID opsi baru yang unik dalam field. */
export function freshOptionId(existingIds: string[]): string {
  let n = 1
  while (existingIds.includes(`opt${n}`)) n++
  return `opt${n}`
}
