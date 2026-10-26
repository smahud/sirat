// Validasi aktivasi profil penomoran (FR-006/007: profil tidak valid tidak bisa diaktifkan).
import { NumberingDSL } from './dsl'
import { renderNumber } from './render'

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  example?: string
}

export function validateDslForActivation(dsl: NumberingDSL): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const seqs = dsl.components.filter(c => c.type === 'sequence')
  if (seqs.length === 0) errors.push('Profil harus memiliki tepat satu komponen urutan (sequence)')
  if (seqs.length > 1) errors.push('Profil hanya boleh memiliki satu komponen urutan')

  for (const c of dsl.components) {
    if (c.type === 'direction') {
      const vals = Object.values(c.mapping)
      if (!c.mapping.INTERNAL || !c.mapping.EXTERNAL) {
        errors.push('Mapping arah harus mencakup INTERNAL dan EXTERNAL')
      }
      if (new Set(vals).size !== vals.length) {
        warnings.push('Mapping arah memiliki nilai sama untuk beberapa arah — nomor tetap unik lewat urutan, tetapi segmen arah tidak membedakan')
      }
      for (const v of vals) {
        if (/[\/\s]/.test(v)) errors.push(`Nilai mapping arah mengandung karakter terlarang: "${v}"`)
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

  // Contoh render dengan nilai contoh — memastikan semua komponen resolvable
  let example: string | undefined
  try {
    const r = renderNumber(dsl, {
      seq: 1,
      direction: 'INTERNAL',
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
