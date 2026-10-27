// Konstanta domain SIRAT

export const ROLES = [
  'SYSTEM_ADMIN',
  'ORG_ADMIN',
  'UNIT_ADMIN',
  'COMMITTEE_ADMIN',
  'OPERATOR',
  'VIEWER',
  'AUDITOR',
] as const
export type Role = (typeof ROLES)[number]

export const UNIT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const
export const COMMITTEE_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'] as const
export const LETTER_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const
export const DIRECTIONS = ['INTERNAL', 'EXTERNAL'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const RESET_POLICIES = ['ALL', 'YEARLY', 'MONTHLY'] as const
export const DATE_SOURCES = ['LETTER_DATE', 'ISSUE_DATE'] as const

export const PROFILE_VERSION_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const
export const ARCHIVE_VERSION_STATES = ['PENDING', 'READY', 'FAILED'] as const
export const ARCHIVE_FILE_STATES = ['ACTIVE', 'TRASHED'] as const
export const IMPORT_ROW_STATUSES = [
  'CANDIDATE', 'NEEDS_REVIEW', 'ACCEPTED', 'PRAISI', 'ERROR', 'IMPORTED', 'SKIPPED',
] as const

// Allowlist upload (Blueprint 16.3): PDF/JPEG/PNG/DOCX/XLSX/TXT, default 25 MiB
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'] as const
export const MAX_FILE_BYTES = Number(process.env.SIRAT_MAX_FILE_BYTES || 25 * 1024 * 1024)

export const SEPARATORS = ['/', '-', '.', ' '] as const
export const DATE_FORMATS = ['MONTH_ROMAN', 'MONTH_2', 'MONTH_NAME', 'YEAR_4', 'YEAR_2', 'DATE_ISO'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const APP_TZ = 'Asia/Jakarta'

export function romanMonth(month1to12: number): string {
  const table = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  return table[month1to12 - 1] ?? 'ERROR'
}

export function monthNameId(month1to12: number): string {
  const table = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  return table[month1to12 - 1] ?? 'ERROR'
}

/** Normalisasi nomor: trim + uppercase (untuk deteksi konflik saja, bukan mengubah data). */
export function normalizeNumber(n: string): string {
  return n.trim().toUpperCase()
}

/** Sanitasi label folder: hanya alfanumerik, strip, underscore, titik. */
export function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9\-_.]/g, '_').slice(0, 80)
}

/**
 * Sanitasi sel CSV (formula injection / CSV injection): nilai yang diawali
 * = + - @ tab atau CR di-prefix apostrof agar Excel/LibreOffice tidak
  * mengeksekusinya sebagai formula (audit minor).
 */
export function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

/** Kode surat dengan padding minimum n digit (1000 tetap 1000). */
export function padSequence(seq: number, padding: number): string {
  const s = String(Math.max(0, Math.floor(seq)))
  return s.length >= padding ? s : s.padStart(padding, '0')
}
