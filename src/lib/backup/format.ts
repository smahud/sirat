// Format backup SIRAT — tipe, manifest, dan pemeriksaan keamanan (murni, tanpa I/O).
// Master prompt lanjutan B.5/B.8/B.9: manifest membedakan cakupan & otoritas,
// validasi tipe/scope/integritas sebelum pemulihan, proteksi zip-bomb & traversal.
import { z } from 'zod'

export const BACKUP_FORMAT = 'SIRAT-BACKUP' as const
export const BACKUP_VERSION = '1.3' as const

/** Enkripsi container terautentikasi (AES-256-GCM + scrypt). */
export const ENC_MAGIC = Buffer.from('SIRENC1\0', 'binary')

// ==== Batas keamanan (zip bomb / ukuran) ====
export const ZIP_LIMITS = {
  maxEntries: 5000,            // jumlah entry maksimum dalam satu arsip
  maxTotalUncompressed: 2 * 1024 * 1024 * 1024, // 2 GiB total
  maxSingleUncompressed: 1 * 1024 * 1024 * 1024, // 1 GiB per entry
  maxCompressionRatio: 200,    // rasio kompresi mencurigakan
  maxEntryNameLength: 240,
} as const

// ==== Manifest ====
export const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.string().min(1),
  kind: z.enum(['FULL', 'SCOPED', 'SAFETY']),
  createdAt: z.string(),
  createdBy: z.object({
    id: z.string(),
    username: z.string(),
    fullName: z.string(),
  }),
  appVersion: z.string().min(1),
  schemaFingerprint: z.string().length(64),
  scope: z.object({
    unitIds: z.array(z.string()),
    committeeIds: z.array(z.string()),
  }),
  scopeLabels: z.array(z.string()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  entries: z.array(z.object({
    name: z.string().min(1),
    sha256: z.string().length(64),
    size: z.number().int().nonnegative(),
  })),
  encrypted: z.boolean().default(false),
  includesPasswordHash: z.boolean().default(false),
  filesMissing: z.array(z.string()).default([]),
  notes: z.string().optional(),
})
export type BackupManifest = z.infer<typeof manifestSchema>

export interface ManifestCheck {
  ok: boolean
  reason?: string
  manifest?: BackupManifest
}

/** Validasi objek manifest mentah. */
export function validateManifest(obj: unknown): ManifestCheck {
  const parsed = manifestSchema.safeParse(obj)
  if (!parsed.success) {
    return { ok: false, reason: `Manifest tidak valid: ${parsed.error.issues.map(i => `${i.path.join('.')} (${i.message})`).join('; ')}` }
  }
  const m = parsed.data
  if (m.kind === 'FULL' && (m.scope.unitIds.length > 0 || m.scope.committeeIds.length > 0)) {
    return { ok: false, reason: 'Backup FULL tidak boleh membawa scope unit/kepanitiaan' }
  }
  if (m.kind === 'SCOPED' && m.scope.unitIds.length === 0 && m.scope.committeeIds.length === 0) {
    return { ok: false, reason: 'Backup SCOPED wajib membawa scope unit/kepanitiaan' }
  }
  return { ok: true, manifest: m }
}

// ==== Nama entry aman (anti path-traversal) ====
const SAFE_NAME_RE = /^(manifest\.json|meta\/app\.json|data\/[A-Za-z0-9][A-Za-z0-9_.\-]*\.json|files\/[A-Za-z0-9][A-Za-z0-9_./\-]*)$/

/** Nama entry hanya boleh manifest/meta/data/files, tanpa `..`, tanpa absolut. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > ZIP_LIMITS.maxEntryNameLength) return false
  if (name.includes('\\')) return false
  if (name.startsWith('/') || name.includes('//')) return false
  const segs = name.split('/')
  if (segs.some(s => s === '' || s === '.' || s === '..')) return false
  return SAFE_NAME_RE.test(name)
}

export interface ZipSafetyEntry {
  name: string
  uncompressedSize: number
  compressedSize: number
}

export interface ZipSafetyResult {
  ok: boolean
  reason?: string
}

/** Pemeriksaan zip-bomb: jumlah entry, total ukuran, rasio per entry, nama aman. */
export function checkZipSafety(entries: ZipSafetyEntry[]): ZipSafetyResult {
  if (entries.length === 0) return { ok: false, reason: 'Arsip kosong' }
  if (entries.length > ZIP_LIMITS.maxEntries) {
    return { ok: false, reason: `Terlalu banyak entry (${entries.length} > ${ZIP_LIMITS.maxEntries})` }
  }
  let total = 0
  for (const e of entries) {
    if (!isSafeEntryName(e.name)) {
      return { ok: false, reason: `Nama entry tidak aman: ${e.name}` }
    }
    if (e.uncompressedSize > ZIP_LIMITS.maxSingleUncompressed) {
      return { ok: false, reason: `Entry terlalu besar: ${e.name}` }
    }
    total += e.uncompressedSize
    if (total > ZIP_LIMITS.maxTotalUncompressed) {
      return { ok: false, reason: 'Total ukuran terurai melebihi batas' }
    }
    if (e.uncompressedSize > 0 && e.compressedSize > 0) {
      const ratio = e.uncompressedSize / e.compressedSize
      if (ratio > ZIP_LIMITS.maxCompressionRatio) {
        return { ok: false, reason: `Rasio kompresi mencurigakan (${ratio.toFixed(0)}x): ${e.name}` }
      }
    }
  }
  return { ok: true }
}

/** Nama file backup yang aman dari input terkendali (B.5 — bukan input mentah user). */
export function backupFileName(kind: 'FULL' | 'SCOPED' | 'SAFETY', labels: string[], date: Date, encrypted: boolean): string {
  const ts = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`
  const safeLabels = labels.map(l => l.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)).filter(Boolean).join('-')
  const scopePart = kind === 'FULL' ? 'FULL' : safeLabels || 'SCOPED'
  return `SIRAT_${scopePart}_BACKUP_${ts}${encrypted ? '.zip.enc' : '.zip'}`
}

/** Cek kompatibilitas sidik jari skema (J: incompatible schema ditolak). */
export function checkSchemaFingerprint(manifest: BackupManifest, current: string): { ok: true } | { ok: false; reason: string } {
  if (manifest.schemaFingerprint !== current) {
    return {
      ok: false,
      reason:
        `Skema database tidak kompatibel (backup: ${manifest.schemaFingerprint.slice(0, 12)}…, saat ini: ${current.slice(0, 12)}…). ` +
        'Restore ditolak demi integritas data.',
    }
  }
  return { ok: true }
}
