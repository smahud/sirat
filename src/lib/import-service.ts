// Layanan import Excel — dua representasi (raw + cached), TIDAK mengeksekusi formula.
// Blueprint 16.4 + baseline 1.1: 66 kandidat bertanggal, 33 praisi, anomali H21 (2025),
// baris 2 tanpa penerima/perihal, dedup hash+row + business number.
import * as XLSX from 'xlsx'
import { createHash } from 'crypto'

export interface ParsedRow {
  rowIndex: number          // baris Excel (2-based)
  seq: string | null       // kolom A (teks apa adanya)
  directionRaw: string | null // kolom B
  directionCode: string | null // kolom C
  letterTypeName: string | null // kolom D
  letterTypeCode: string | null // kolom E
  monthRoman: string | null   // kolom F
  year: string | null         // kolom G
  letterDate: Date | null      // kolom H
  fullNumberRaw: string | null // kolom I — teks cache apa adanya
  fullNumberFormula: string | null // formula kolom I
  recipient: string | null     // kolom J
  subject: string | null       // kolom K
}

export interface ClassifyResult {
  sheet: string
  rows: ParsedRow[]
  candidates: number
  praisi: number
  errors: number
  needsReview: number
  issues: Record<number, string[]> // per rowIndex
}

const DIRECTION_MAP: Record<string, 'INTERNAL' | 'EXTERNAL'> = {
  'INTERNAL': 'INTERNAL', 'Eksternal': 'EXTERNAL', 'EKSTERNAL': 'EXTERNAL',
  'internal': 'INTERNAL', 'eksternal': 'EXTERNAL', 'Internal': 'INTERNAL',
}

export function parseWorkbook(buffer: Buffer): { sheet: string; rows: ParsedRow[]; sourceHash: string } {
  const sourceHash = createHash('sha256').update(buffer).digest('hex')
  const wb = XLSX.read(buffer, { cellFormula: true, cellText: false, cellDates: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error('Worksheet tidak ditemukan')

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:K1')
  const rows: ParsedRow[] = []

  for (let r = 1; r <= range.e.r; r++) { // baris 0 = header
    const row: ParsedRow = {
      rowIndex: r + 1,
      seq: cellText(ws, r, 0), directionRaw: cellText(ws, r, 1), directionCode: cellText(ws, r, 2),
      letterTypeName: cellText(ws, r, 3), letterTypeCode: cellText(ws, r, 4),
      monthRoman: cellText(ws, r, 5), year: cellText(ws, r, 6),
      letterDate: cellDate(ws, r, 7), fullNumberRaw: cellText(ws, r, 8),
      fullNumberFormula: cellFormula(ws, r, 8),
      recipient: cellText(ws, r, 9), subject: cellText(ws, r, 10),
    }
    // Lewati baris yang benar-benar kosong
    if (Object.values(row).every(v => v === null || v === '')) continue
    rows.push(row)
  }
  return { sheet: sheetName, rows, sourceHash }
}

function cell(ws: XLSX.WorkSheet, r: number, c: number): XLSX.CellObject | undefined {
  const addr = XLSX.utils.encode_cell({ r, c })
  return ws[addr] as XLSX.CellObject | undefined
}

function cellText(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const cl = cell(ws, r, c)
  if (!cl) return null
  if (cl.t === 's' && typeof cl.v === 'string') return cl.v
  if (cl.t === 'n' && typeof cl.v === 'number') return String(cl.v)
  if (cl.t === 'b' && typeof cl.v === 'boolean') return String(cl.v)
  if (cl.w) return cl.w // formatted text cache
  return cl.v != null ? String(cl.v) : null
}

function cellDate(ws: XLSX.WorkSheet, r: number, c: number): Date | null {
  const cl = cell(ws, r, c)
  if (!cl) return null
  if (cl.t === 'd' && cl.v instanceof Date) {
    const d = cl.v
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  }
  if (cl.t === 'n' && typeof cl.v === 'number') {
    const d = XLSX.SSF.parse_date_code(cl.v)
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d))
  }
  return null
}

function cellFormula(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const cl = cell(ws, r, c)
  if (!cl) return null
  return typeof cl.f === 'string' ? cl.f : null
}

/**
 * Klasifikasi baris sesuai baseline 1.1:
 * - ada tanggal (H) → CANDIDATE; tahun != tahun mayoritas workbook → NEEDS_REVIEW (H21: 2025)
 * - tanpa tanggal → PRAISI (067–099: bukan surat terbit, tidak diimpor sebagai ISSUED)
 * - duplikat nomor cache (normalisasi) dalam file → ERROR
 * - baris 2: tanpa penerima/perihal → warning (masih bisa diimpor dengan flag)
 */
export function classifyRows(rows: ParsedRow[], majorYear: number): ClassifyResult {
  const issues: Record<number, string[]> = {}
  const addIssue = (rowIndex: number, msg: string) => {
    ;(issues[rowIndex] ??= []).push(msg)
  }

  const seenNumbers = new Map<string, number>()
  let candidates = 0, praisi = 0, errors = 0, needsReview = 0

  for (const row of rows) {
    if (row.letterDate) {
      candidates++
      const y = row.letterDate.getUTCFullYear()
      if (y !== majorYear) {
        needsReview++
        addIssue(row.rowIndex, `Tanggal surat ${row.letterDate.toISOString().slice(0, 10)} berbeda tahun mayoritas (${majorYear}) — perlu keputusan pemilik; JANGA diubah otomatis`)
      }
      if (!row.recipient && !row.subject) {
        addIssue(row.rowIndex, 'Baris tanpa penerima dan perihal — histori tidak lengkap (flag wajib bila diimpor)')
      }
      if (!row.directionRaw) {
        addIssue(row.rowIndex, 'Kolom arah (B) kosong')
      }
      if (!row.fullNumberRaw) {
        addIssue(row.rowIndex, 'Nomor cache (I) kosong — cached value wajib; formula tidak dieksekusi')
        errors++
      }
      if (row.fullNumberRaw) {
        const normalized = normalize(row.fullNumberRaw)
        if (seenNumbers.has(normalized)) {
          addIssue(row.rowIndex, `Nomor duplikat dengan baris ${seenNumbers.get(normalized)}: ${row.fullNumberRaw}`)
          errors++
        } else {
          seenNumbers.set(normalized, row.rowIndex)
        }
      }
      if (!row.seq || !/^\d+$/.test(row.seq.trim())) {
        addIssue(row.rowIndex, `Kolom urutan (A) tidak numerik: "${row.seq ?? ''}"`)
        errors++
      }
    } else {
      praisi++
      addIssue(row.rowIndex, 'Baris praisi tanpa tanggal — bukan surat terbit; tidak diimpor sebagai ISSUED')
    }
  }

  return { sheet: '', rows, candidates, praisi, errors, needsReview, issues }
}

export function normalize(n: string): string {
  return n.trim().toUpperCase()
}

/** Mapping arah workbook → INTERNAL/EXTERNAL. */
export function mapDirection(raw: string | null): 'INTERNAL' | 'EXTERNAL' | null {
  if (!raw) return null
  return DIRECTION_MAP[raw.trim()] ?? null
}

/** Deteksi tahun mayoritas dari tanggal-tanggal kandidat. */
export function detectMajorYear(rows: ParsedRow[]): number {
  const counts = new Map<number, number>()
  for (const r of rows) {
    if (r.letterDate) {
      const y = r.letterDate.getUTCFullYear()
      counts.set(y, (counts.get(y) ?? 0) + 1)
    }
  }
  let best = 0, bestYear = new Date().getUTCFullYear()
  for (const [y, c] of counts) {
    if (c > best) { best = c; bestYear = y }
  }
  return bestYear
}
