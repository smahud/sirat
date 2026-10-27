// Validasi profil penomoran (FR-006/007: profil tidak valid tidak bisa diaktifkan).
// v1.6: aturan Dropdown generik — label/kode kosong, duplikasi key, duplikasi
// kode dalam field yang sama, karakter terlarang, referensi fieldRef, default.
import { NumberingDSL, findField, fieldUsedInNumber } from './dsl'
import { renderNumber } from './render'

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  example?: string
}

/** Karakter yang tidak boleh ada pada kode/literal: whitespace + semua separator. */
const FORBIDDEN_CODE_CHARS = /[\/\s\-.]/ // '/' '-' '.' ' ' — bergantung separator aktif, tapi semua dicegah demi aman

export function validateDslForActivation(dsl: NumberingDSL): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const seqs = dsl.components.filter(c => c.type === 'sequence')
  if (seqs.length === 0) errors.push('Profil harus memiliki tepat satu komponen urutan (sequence)')
  if (seqs.length > 1) errors.push('Profil hanya boleh memiliki satu komponen urutan')

  // ===== Validasi fields (Dropdown) — E.3 =====
  const seenKeys = new Set<string>()
  for (const f of dsl.fields) {
    if (seenKeys.has(f.key)) errors.push(`Kunci variabel duplikat: "${f.key}" — setiap Dropdown harus memiliki kunci unik`)
    seenKeys.add(f.key)

    if (!f.label.trim()) errors.push(`Dropdown "${f.key}" memiliki label kosong`)
    if (f.options.length === 0) errors.push(`Dropdown "${f.label}" harus memiliki minimal satu pilihan`)

    const seenOptIds = new Set<string>()
    const seenCodes = new Map<string, string>()
    for (const o of f.options) {
      if (seenOptIds.has(o.id)) errors.push(`Dropdown "${f.label}" memiliki identifier pilihan duplikat: "${o.id}"`)
      seenOptIds.add(o.id)
      if (!o.label.trim()) errors.push(`Dropdown "${f.label}" memiliki pilihan dengan label kosong (id: ${o.id})`)
      if (!o.code.trim()) errors.push(`Dropdown "${f.label}" memiliki pilihan dengan kode kosong (label: ${o.label || o.id})`)
      if (FORBIDDEN_CODE_CHARS.test(o.code)) {
        errors.push(`Kode "${o.code}" pada Dropdown "${f.label}" mengandung karakter terlarang (spasi, "/", "-", ".")`)
      }
      const dup = seenCodes.get(o.code)
      if (dup) {
        warnings.push(`Dropdown "${f.label}": pilihan "${dup}" dan "${o.label}" memakai kode sama "${o.code}" — nomor tetap unik lewat urutan, tetapi segmen ini tidak membedakan keduanya`)
      } else {
        seenCodes.set(o.code, o.label)
      }
    }
    if (f.defaultOptionId && !f.options.some(o => o.id === f.defaultOptionId)) {
      errors.push(`Pilihan default Dropdown "${f.label}" tidak ada dalam daftar pilihan`)
    }
    if (f.defaultOptionId) {
      const def = f.options.find(o => o.id === f.defaultOptionId)
      if (def && !def.active) {
        errors.push(`Pilihan default Dropdown "${f.label}" ("${def.label}") tidak aktif — pilih default yang aktif`)
      }
    }
    if (f.required && !f.defaultOptionId && f.options.every(o => !o.active)) {
      errors.push(`Dropdown wajib "${f.label}" tidak memiliki pilihan aktif`)
    }
    // Field opsional yang ikut nomor tanpa default → segmen bisa gagal saat terbit
    if (fieldUsedInNumber(dsl, f.key) && !f.required && !f.defaultOptionId) {
      warnings.push(`Dropdown "${f.label}" opsional tetapi dipakai dalam nomor tanpa pilihan default — penerbitan gagal bila operator tidak memilih`)
    }
  }

  // ===== Validasi komponen =====
  for (const c of dsl.components) {
    if (c.type === 'fieldRef') {
      const f = findField(dsl, c.field)
      if (!f) {
        errors.push(`Komponen nomor merujuk Dropdown yang tidak didefinisikan: "${c.field}"`)
      }
    }
    if (c.type === 'literal') {
      if (/[\/]/.test(c.value)) errors.push(`Nilai statis tidak boleh mengandung separator "/": "${c.value}"`)
    }
    if (c.type === 'committeeCode') {
      warnings.push('Profil ini hanya bisa dipakai untuk surat kepanitiaan (membutuhkan kode panitia)')
    }
    if (c.type === 'issueDate') {
      warnings.push('Komponen tanggal penerbitan membuat nomor bergantung waktu terbit, bukan tanggal surat')
    }
  }
  // Dropdown tak terpakai (metadata saja) — bukan error, tapi diberi tahu
  for (const f of dsl.fields) {
    if (!fieldUsedInNumber(dsl, f.key)) {
      warnings.push(`Dropdown "${f.label}" hanya metadata — kode tidak masuk nomor surat`)
    }
  }
  if (dsl.fields.length > 0 && !dsl.separator) {
    errors.push('Separator tidak valid')
  }

  // Contoh render dengan nilai contoh — memastikan semua komponen resolvable.
  // Gunakan default/opsi pertama aktif per field (F.4: perubahan pilihan langsung terlihat).
  const exampleValues: Record<string, string> = {}
  for (const f of dsl.fields) {
    const pick = f.options.find(o => o.active && o.id === f.defaultOptionId)
      ?? f.options.find(o => o.active)
    if (pick) exampleValues[f.key] = pick.id
  }
  let example: string | undefined
  try {
    const r = renderNumber(dsl, {
      seq: 1,
      fieldValues: exampleValues,
      letterTypeCode: 'SPR',
      unitCode: 'EXAMPLE',
      committeeCode: 'PAN-EXAMPLE',
      letterDate: new Date('2026-01-15T00:00:00Z'),
      issueDate: new Date('2026-01-16T00:00:00Z'),
    })
    example = r.text
    if (r.text.trim() === '') errors.push('Contoh render menghasilkan nomor kosong')
  } catch (e) {
    errors.push(`Contoh render gagal: ${(e as Error).message}`)
  }

  return { ok: errors.length === 0, errors, warnings, example }
}

/** Nilai contoh default untuk preview builder (per field: default atau opsi aktif pertama). */
export function exampleFieldValues(dsl: NumberingDSL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of dsl.fields) {
    const pick = f.options.find(o => o.active && o.id === f.defaultOptionId)
      ?? f.options.find(o => o.active)
    if (pick) out[f.key] = pick.id
  }
  return out
}

/** period_key counter menurut kebijakan reset & sumber tanggal (Blueprint 16.1). */
export function periodKeyFor(
  resetPolicy: 'ALL' | 'YEARLY' | 'MONTHLY',
  dateSource: 'LETTER_DATE' | 'ISSUE_DATE',
  letterDate: Date | null | undefined,
  issueDate: Date | null | undefined,
): string {
  if (resetPolicy === 'ALL') return 'ALL'
  const d = dateSource === 'ISSUE_DATE' ? issueDate : letterDate
  if (!d) return 'ALL' // fallback aman; issue wajib punya tanggal sesuai profil
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return resetPolicy === 'YEARLY' ? String(y) : `${y}-${String(m).padStart(2, '0')}`
}
