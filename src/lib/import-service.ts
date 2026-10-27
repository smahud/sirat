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
  // raw:true — pada CSV, nilai teks TIDAK dikonversi paksa jadi angka
  // (mempertahankan "001" dengan nol di depan; tanggal teks diparse oleh
  // parseDateCellString). Pada XLSX/XLS opsi ini tidak berpengaruh karena
  // tipe sel sudah tersimpan eksplisit dalam berkas.
  const wb = XLSX.read(buffer, { cellFormula: true, cellText: false, cellDates: true, raw: true })
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

/**
 * Alamat sel A1 (mis. r=0,c=0 → "A1") tanpa objek — reimplementation
 * XLSX.utils.encode_cell. ALASAN: minifier SWC (Next.js production build)
 * salah meng-inline fungsi kecil yang memakai shorthand object ({r, c}) —
 * nilai shorthand tidak tersubstitusi argumen pemanggil, menghasilkan
 * ReferenceError "r is not defined" SAAT RUNTIME (build produksi saja;
 * vitest tidak terkena). Tanpa object literal, bug inliner mustahil kambuh.
 */
function cellAddr(r: number, c: number): string {
  let col = ''
  let n = c + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    col = String.fromCharCode(65 + rem) + col
    n = Math.floor((n - 1) / 26)
  }
  return col + (r + 1)
}

function cell(ws: XLSX.WorkSheet, r: number, c: number): XLSX.CellObject | undefined {
  return ws[cellAddr(r, c)] as XLSX.CellObject | undefined
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
  // CSV / sel teks: coba parse format tanggal umum (v1.5 — dukungan import CSV)
  if (cl.t === 's' && typeof cl.v === 'string') {
    return parseDateCellString(cl.v)
  }
  return null
}

// Nama bulan Indonesia + Inggris (lengkap & singkatan) — urutan = nilai bulan.
const MONTH_NAMES: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2, pebruari: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, augustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  des: 12, dec: 12, desember: 12, december: 12,
}

/**
 * Parse tanggal dari teks — mendukung format yang wajar untuk pengguna Indonesia:
 * - ISO:            2026-01-15, 2026/1/5
 * - Indonesia:      15/01/2026, 15-1-2026, 5/12/26 (DD/MM/YY, tahun 2 digit → 20YY)
 * - Nama bulan:     15 Jan 2026, 15-Januari-2026, 15 January 26
 * Asumsi DD/MM (bukan MM/DD) sesuai konvensi Indonesia. Mengembalikan null bila
 * bukan tanggal yang valid — baris tetap diproses sebagai praisi/tanpa tanggal.
 */
export function parseDateCellString(s: string): Date | null {
  const t = s.trim()
  if (!t) return null

  // ISO: YYYY-MM-DD atau YYYY/MM/DD
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) return makeDate(Number(m[1]), Number(m[2]), Number(m[3]))

  // DD/MM/YYYY atau DD-MM-YYYY (konvensi Indonesia)
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (m) return makeDate(Number(m[3]), Number(m[2]), Number(m[1]))

  // DD/MM/YY (tahun 2 digit → 20YY)
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/)
  if (m) return makeDate(2000 + Number(m[3]), Number(m[2]), Number(m[1]))

  // 15 Jan 2026 / 15-Januari-2026 / 15 January 26
  m = t.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})$/)
  if (m) {
    const mon = MONTH_NAMES[m[2].toLowerCase()]
    if (mon) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      return makeDate(y, mon, Number(m[1]))
    }
  }
  return null
}

function makeDate(y: number, mon: number, day: number): Date | null {
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || y < 1900 || y > 2100) return null
  const d = new Date(Date.UTC(y, mon - 1, day))
  // guard rollover (mis. 31/02/2026 → Maret)
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mon - 1 || d.getUTCDate() !== day) return null
  return d
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

// ===================== Template Import (v1.5) =====================
// Template dapat diunduh dalam 3 format agar pengguna baru tidak menebak-nebak
// struktur kolom. Kolom A–K identik dengan parser (parseWorkbook) — satu-satunya
// sumber kebenaran struktur adalah daftar ini.

export interface TemplateColumn {
  col: string                // huruf kolom Excel
  header: string             // judul di baris 1
  required: boolean
  example: string
  description: string        // penjelasan di sheet "Petunjuk"
}

export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  { col: 'A', header: 'Urutan', required: true, example: '001',
    description: 'Nomor urut surat (angka saja, boleh berawalan nol). Dipakai untuk menyetel batas counter bila opsi high-water dicentang.' },
  { col: 'B', header: 'Arah', required: true, example: 'Internal',
    description: 'Arah surat: tuliskan "Internal" atau "Eksternal" (huruf besar/kecil bebas). Kolom ini yang dibaca sistem.' },
  { col: 'C', header: 'Kode Arah', required: false, example: 'A',
    description: 'Kode arah pada nomor (mis. A=internal, B=eksternal). Hanya catatan — tidak dipakai sistem, nomor lengkap tetap dari kolom I.' },
  { col: 'D', header: 'Nama Jenis Surat', required: false, example: 'Surat Keputusan',
    description: 'Nama jenis surat persis seperti di menu Jenis Surat (mis. "Surat Keputusan"). Dicocokkan otomatis ke data induk; tidak cocok = jenis kosong (bisa diedit setelahnya).' },
  { col: 'E', header: 'Kode Jenis Surat', required: false, example: 'SK',
    description: 'Kode jenis surat (mis. SK, ST, SE). Cadangan pencocokan bila nama tidak ketemu.' },
  { col: 'F', header: 'Bulan (Romawi)', required: false, example: 'I',
    description: 'Bulan romawi sesuai nomor (I–XII). Hanya catatan — tidak dipakai sistem.' },
  { col: 'G', header: 'Tahun', required: false, example: '2026',
    description: 'Tahun sesuai nomor. Hanya catatan — tidak dipakai sistem.' },
  { col: 'H', header: 'Tanggal Surat', required: true, example: '2026-01-15',
    description: 'Tanggal surat. Format yang diterima: 2026-01-15, 15/01/2026, 15-01-2026, atau 15 Jan 2026. WAJIB diisi — baris TANPA tanggal dianggap praisi (nomor cadangan) dan tidak diimpor sebagai surat terbit.' },
  { col: 'I', header: 'Nomor Lengkap', required: true, example: '001/A/SK/YAPSI-DS/I/2026',
    description: 'Nomor surat LENGKAP persis seperti tertulis (teks apa adanya). Inilah yang disimpan sistem — jangan memakai rumus; bila di Excel ada rumus, salin-has-kan menjadi teks. Duplikat dalam file akan ditandai sebagai error.' },
  { col: 'J', header: 'Penerima', required: false, example: 'Dinas Pendidikan Kabupaten',
    description: 'Tujuan/penerima surat. Disarankan diisi agar histori mudah dicari.' },
  { col: 'K', header: 'Perihal', required: false, example: 'Undangan rapat koordinasi',
    description: 'Perihal ringkas surat. Disarankan diisi.' },
]

const TEMPLATE_EXAMPLE_ROWS: string[][] = [
  ['001', 'Internal', 'A', 'Surat Keputusan', 'SK', 'I', '2026', '2026-01-15', '001/A/SK/YAPSI-DS/I/2026', 'Kepala MTs Darussalam', 'Penetapan pembina ekstrakurikuler semester genap'],
  ['002', 'Eksternal', 'B', 'Surat Tugas', 'ST', 'I', '2026', '2026-01-20', '002/B/ST/YAPSI-DS/I/2026', 'Dinas Pendidikan Kabupaten', 'Undangan rapat koordinasi'],
]

const GUIDE_ROWS: string[][] = [
  ['PANDUAN IMPORT DATA SIRAT', ''],
  ['', ''],
  ['Apa ini?', 'Alat untuk memindahkan histori surat dari berkas Excel/CSV lama ke SIRAT — sekali saja saat peralihan sistem (cutover).'],
  ['', ''],
  ['Alur kerja', '1. Unduh template ini dan salin data lama Anda ke sheet "Nomor Surat" (baris contoh boleh diganti).'],
  ['', '2. Unggah berkas di menu Import Data — sistem menjalankan UJI DULU (dry-run), belum ada yang disimpan.'],
  ['', '3. Tinjau hasil: baris hijau = siap, kuning = perlu keputusan Anda, merah = bermasalah.'],
  ['', '4. Pilih baris yang akan disimpan, pilih unit tujuan, lalu KONFIRMASI (commit). Hanya baris terpilih yang disimpan.'],
  ['', ''],
  ['Jaminan keamanan', '- Nomor lama disimpan PERSIS seperti tertulis — sistem tidak membuat nomor baru untuk histori.'],
  ['', '- Rumus Excel tidak pernah dijalankan; yang dibaca adalah nilai teksnya.'],
  ['', '- Duplikat nomor (dalam file maupun dengan data yang sudah ada) otomatis ditolak.'],
  ['', '- Dry-run tidak menulis surat apa pun; tidak ada risiko mencoba.'],
  ['', ''],
  ['Baris tanpa tanggal', 'Dianggap PRAISI (nomor cadangan, belum menjadi surat) dan TIDAK diimpor sebagai surat terbit.'],
  ['Batas ukuran berkas', 'Maksimal 20 MiB.'],
  ['Format yang diterima', '.csv, .xls, .xlsx — sheet pertama yang dibaca.'],
  ['', ''],
  ['Rincian kolom', ''],
]

export type TemplateFormat = 'csv' | 'xlsx' | 'xls'

export const TEMPLATE_MIME: Record<TemplateFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
}

export const TEMPLATE_FILENAME: Record<TemplateFormat, string> = {
  csv: 'template-import-sirat.csv',
  xlsx: 'template-import-sirat.xlsx',
  xls: 'template-import-sirat.xls',
}

/**
 * Bangun berkas template import.
 * - CSV: pemisah titik-koma + BOM UTF-8 + CRLF — aman dibuka langsung oleh
 *   Excel lokal Indonesia (default list separator ";").
 * - XLSX/XLS: sheet "Nomor Surat" (header + 2 baris contoh) + sheet
 *   "Petunjuk" (panduan lengkap per kolom).
 */
export function buildTemplate(format: TemplateFormat): Buffer {
  const headers = TEMPLATE_COLUMNS.map(c => c.header)
  const dataRows = TEMPLATE_EXAMPLE_ROWS

  if (format === 'csv') {
    const q = (v: string) => {
      const s = v.replace(/"/g, '""')
      return /[";\n\r]/.test(s) ? `"${s}"` : s
    }
    const lines = [headers, ...dataRows].map(row => row.map(q).join(';'))
    // BOM UTF-8 agar Excel mengenali encoding; CRLF agar Notepad/Excel rapi.
    return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8')
  }

  const wb = XLSX.utils.book_new()

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
  ws['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: Math.max(c.header.length + 4, 14) }))
  ws['!freeze'] = 'A2' // ditandai; dukungan freeze tergantung penulis format
  XLSX.utils.book_append_sheet(wb, ws, 'Nomor Surat')

  const guideBody = TEMPLATE_COLUMNS.map(c => [
    `Kolom ${c.col} — ${c.header}${c.required ? ' (WAJIB)' : ' (opsional)'}`,
    c.description,
    `Contoh: ${c.example}`,
  ])
  const guide = XLSX.utils.aoa_to_sheet([...GUIDE_ROWS, ...guideBody])
  guide['!cols'] = [{ wch: 34 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(wb, guide, 'Petunjuk')

  const bookType = format === 'xlsx' ? 'xlsx' : 'biff8'
  const out = XLSX.write(wb, { bookType, type: 'buffer' }) as Buffer
  return Buffer.from(out)
}
