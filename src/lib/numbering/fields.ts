// Resolusi & validasi pilihan Dropdown operator terhadap konfigurasi profil (E.4/E.5).
// Dipakai oleh: preview API, create/patch draft, dan issueLetter (re-validasi
// per penerbitan — profil bisa berganti versi antara draft dan terbit).
import { NumberingDSL, DropdownField, fieldUsedInNumber } from './dsl'

export interface ResolvedFieldValue {
  optionId: string
  label: string
  code: string
}

export class FieldResolutionError extends Error {
  constructor(message: string, public code: string, public fieldKey?: string) {
    super(message)
    this.name = 'FieldResolutionError'
  }
}

function resolveOne(
  field: DropdownField,
  stored: Record<string, string> | null | undefined,
  legacyDirection: string | null | undefined,
): ResolvedFieldValue | null {
  let optionId = stored?.[field.key] ?? null

  // Fallback migrasi v1: draft lama menyimpan letter.direction (INTERNAL/EXTERNAL);
  // konverter v1→v2 menandai opsi ekuivalen dengan legacyKey. Bukan hardcoding
  // semantik arah — hanya menjembatani format simpan lama ke field baru.
  if (!optionId && legacyDirection) {
    const legacy = field.options.find(o => o.legacyKey === legacyDirection)
    if (legacy) optionId = legacy.id
  }

  if (!optionId && field.defaultOptionId) optionId = field.defaultOptionId
  if (!optionId) return null

  const opt = field.options.find(o => o.id === optionId)
  if (!opt) {
    throw new FieldResolutionError(
      `Pilihan pada "${field.label}" tidak dikenal oleh profil versi ini (mungkin konfigurasi telah berubah) — pilih ulang nilai`,
      'UNKNOWN_OPTION', field.key,
    )
  }
  if (!opt.active) {
    throw new FieldResolutionError(
      `Pilihan "${opt.label}" pada "${field.label}" sudah tidak aktif — pilih nilai lain`,
      'INACTIVE_OPTION', field.key,
    )
  }
  return { optionId: opt.id, label: opt.label, code: opt.code }
}

/**
 * Resolve seluruh field formulir terhadap nilai tersimpan.
 * - Melempar FieldResolutionError bila ada nilai yang tidak sah (E.5).
 * - Field wajib tanpa nilai teresolve → error eksplisit (E.4).
 * - Field opsional boleh absen dari hasil.
 * - Kunci tak dikenal diabaikan (profil boleh berganti versi setelah draft dibuat).
 */
export function resolveFieldValues(
  dsl: NumberingDSL,
  stored: Record<string, string> | null | undefined,
  legacyDirection?: string | null,
): Record<string, ResolvedFieldValue> {
  const out: Record<string, ResolvedFieldValue> = {}
  for (const field of dsl.fields) {
    const resolved = resolveOne(field, stored, legacyDirection)
    if (resolved) {
      out[field.key] = resolved
    } else if (field.required) {
      throw new FieldResolutionError(
        `Pilihan wajib "${field.label}" belum diisi`,
        'MISSING_REQUIRED', field.key,
      )
    }
  }
  return out
}

/** Versi longgar untuk preview: field wajib yang kosong tidak melempar,
 *  melainkan dilaporkan agar FE menampilkan status "belum lengkap". */
export function resolveFieldValuesForPreview(
  dsl: NumberingDSL,
  stored: Record<string, string> | null | undefined,
  legacyDirection?: string | null,
): { values: Record<string, ResolvedFieldValue>; missingRequired: string[] } {
  const values: Record<string, ResolvedFieldValue> = {}
  const missingRequired: string[] = []
  for (const field of dsl.fields) {
    let resolved: ResolvedFieldValue | null = null
    try {
      resolved = resolveOne(field, stored, legacyDirection)
    } catch {
      resolved = null // nilai tidak sah pada preview → perlakukan sebagai belum memilih
    }
    if (resolved) values[field.key] = resolved
    else if (field.required) missingRequired.push(field.label)
  }
  return { values, missingRequired }
}

/** Field dalam nomor yang nilainya belum tersedia (preview/render gagal) — labelnya. */
export function unresolvedNumberFields(
  dsl: NumberingDSL,
  resolved: Record<string, ResolvedFieldValue>,
): string[] {
  const out: string[] = []
  for (const c of dsl.components) {
    if (c.type === 'fieldRef' && !resolved[c.field]) {
      const f = dsl.fields.find(x => x.key === c.field)
      if (f) out.push(f.label)
    }
  }
  return out
}

/** Apakah field ikut nomor (ada fieldRef) — re-export util. */
export { fieldUsedInNumber }
