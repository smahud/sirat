import { describe, it, expect } from 'vitest'
import {
  buildTemplate, parseWorkbook, classifyRows, detectMajorYear,
  parseDateCellString, TEMPLATE_COLUMNS, TEMPLATE_FILENAME,
} from '@/lib/import-service'

/**
 * v1.5 — Template Import Data.
 * Kontrak terpenting: berkas yang DIHASILKAN buildTemplate harus bisa dibaca
 * kembali oleh parseWorkbook (roundtrip). Jika ini patah, pengguna baru yang
 * mengunduh template resmi akan gagal import — regresi kritis.
 */
describe('Import template — roundtrip format', () => {
  for (const format of ['csv', 'xlsx', 'xls'] as const) {
    it(`template ${format} terbaca kembali oleh parser: 2 kandidat, nomor persis`, () => {
      const buf = buildTemplate(format)
      expect(buf.length).toBeGreaterThan(50)

      const parsed = parseWorkbook(buf)
      // 2 baris contoh pada template
      expect(parsed.rows).toHaveLength(2)

      const r1 = parsed.rows[0]
      expect(r1.seq).toBe('001')
      expect(r1.directionRaw).toMatch(/internal/i)
      expect(r1.letterTypeName).toBe('Surat Keputusan')
      expect(r1.letterTypeCode).toBe('SK')
      expect(r1.fullNumberRaw).toBe('001/A/SK/YAPSI-DS/I/2026')
      expect(r1.letterDate).not.toBeNull()
      expect(r1.letterDate!.getUTCFullYear()).toBe(2026)
      expect(r1.letterDate!.getUTCMonth()).toBe(0) // Januari
      expect(r1.letterDate!.getUTCDate()).toBe(15)
      expect(r1.recipient).toContain('Darussalam')
      expect(r1.subject).toBeTruthy()

      const r2 = parsed.rows[1]
      expect(r2.seq).toBe('002')
      expect(r2.fullNumberRaw).toBe('002/B/ST/YAPSI-DS/I/2026')

      // Klasifikasi: kedua baris contoh = kandidat bersih (tanpa error)
      const cls = classifyRows(parsed.rows, detectMajorYear(parsed.rows))
      expect(cls.candidates).toBe(2)
      expect(cls.errors).toBe(0)
      expect(cls.praisi).toBe(0)
    })
  }

  it('CSV: BOM UTF-8 + pemisah titik-koma (Excel Indonesia) + CRLF', () => {
    const buf = buildTemplate('csv')
    expect(buf[0]).toBe(0xEF)
    expect(buf[1]).toBe(0xBB)
    expect(buf[2]).toBe(0xBF)
    const text = buf.toString('utf-8').replace(/^\uFEFF/, '')
    expect(text).toContain('\r\n')
    const firstLine = text.split('\r\n')[0]
    expect(firstLine.split(';')).toHaveLength(TEMPLATE_COLUMNS.length)
    expect(firstLine).toContain('Nomor Lengkap')
  })

  it('XLSX: punya sheet Petunjuk berisi panduan kolom', () => {
    const XLSX = require('xlsx')
    const wb = XLSX.read(buildTemplate('xlsx'), { type: 'buffer' })
    expect(wb.SheetNames).toContain('Nomor Surat')
    expect(wb.SheetNames).toContain('Petunjuk')
    const guide = XLSX.utils.sheet_to_csv(wb.Sheets['Petunjuk'], { FS: ';' })
    for (const c of TEMPLATE_COLUMNS) {
      expect(guide).toContain(c.header)
      expect(guide).toContain(`Kolom ${c.col}`)
    }
  })

  it('nama berkas template konsisten dan jelas', () => {
    expect(TEMPLATE_FILENAME.csv).toBe('template-import-sirat.csv')
    expect(TEMPLATE_FILENAME.xlsx).toBe('template-import-sirat.xlsx')
    expect(TEMPLATE_FILENAME.xls).toBe('template-import-sirat.xls')
  })

  it('spesifikasi kolom = 11 kolom A-K, kolom wajib terdefinisi', () => {
    expect(TEMPLATE_COLUMNS).toHaveLength(11)
    expect(TEMPLATE_COLUMNS.map(c => c.col)).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'])
    const required = TEMPLATE_COLUMNS.filter(c => c.required).map(c => c.col)
    expect(required).toEqual(['A', 'B', 'H', 'I'])
    // deskripsi cukup panjang untuk panduan (>= 40 karakter)
    for (const c of TEMPLATE_COLUMNS) {
      expect(c.description.length).toBeGreaterThanOrEqual(40)
    }
  })
})

describe('Import CSV/teks — parse tanggal konvensi Indonesia', () => {
  it('ISO YYYY-MM-DD', () => {
    expect(parseDateCellString('2026-01-15')?.toISOString().slice(0, 10)).toBe('2026-01-15')
    expect(parseDateCellString('2026-1-5')?.toISOString().slice(0, 10)).toBe('2026-01-05')
  })
  it('DD/MM/YYYY dan DD-MM-YYYY (konvensi Indonesia — bukan MM/DD)', () => {
    expect(parseDateCellString('15/01/2026')?.toISOString().slice(0, 10)).toBe('2026-01-15')
    expect(parseDateCellString('5-12-2026')?.toISOString().slice(0, 10)).toBe('2026-12-05')
  })
  it('DD/MM/YY → 20YY', () => {
    expect(parseDateCellString('15/01/26')?.toISOString().slice(0, 10)).toBe('2026-01-15')
  })
  it('Nama bulan Indonesia & Inggris, lengkap/singkat, spasi/strip', () => {
    expect(parseDateCellString('15 Jan 2026')?.toISOString().slice(0, 10)).toBe('2026-01-15')
    expect(parseDateCellString('15-Januari-2026')?.toISOString().slice(0, 10)).toBe('2026-01-15')
    expect(parseDateCellString('15 September 26')?.toISOString().slice(0, 10)).toBe('2026-09-15')
    expect(parseDateCellString('15 Agu 2026')?.toISOString().slice(0, 10)).toBe('2026-08-15')
  })
  it('tanggal tak valid → null (bukan lempar error)', () => {
    expect(parseDateCellString('31/02/2026')).toBeNull()   // rollover Februari
    expect(parseDateCellString('bukan tanggal')).toBeNull()
    expect(parseDateCellString('')).toBeNull()
    expect(parseDateCellString('99/99/9999')).toBeNull()
    expect(parseDateCellString('2026-13-01')).toBeNull()
  })

  it('CSV penuh via parseWorkbook: tanggal teks + nomor persis + praisi', () => {
    const csv = [
      'Urutan;Arah;Kode Arah;Nama Jenis Surat;Kode Jenis Surat;Bulan (Romawi);Tahun;Tanggal Surat;Nomor Lengkap;Penerima;Perihal',
      '001;Internal;A;Surat Keputusan;SK;I;2026;15/01/2026;001/A/SK/YAPSI-DS/I/2026;Kepala MTs;Pembina ekskul',
      '002;Eksternal;B;Surat Tugas;ST;I;2026;20 Jan 2026;002/B/ST/YAPSI-DS/I/2026;Dinas Pendidikan;Undangan',
      '003;;;;;;;;;;', // praisi: tanpa tanggal
    ].join('\r\n')
    const parsed = parseWorkbook(Buffer.from('\uFEFF' + csv, 'utf-8'))
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.rows[0].letterDate?.getUTCDate()).toBe(15)
    expect(parsed.rows[1].letterDate?.getUTCDate()).toBe(20)
    expect(parsed.rows[2].letterDate).toBeNull()
    expect(parsed.rows[0].fullNumberRaw).toBe('001/A/SK/YAPSI-DS/I/2026')

    const cls = classifyRows(parsed.rows, 2026)
    expect(cls.candidates).toBe(2)
    expect(cls.praisi).toBe(1)
    expect(cls.errors).toBe(0)
  })

  it('CSV dengan pemisah koma (dari aplikasi lain) juga terbaca', () => {
    const csv = 'Urutan,Arah,Kode Arah,Nama Jenis Surat,Kode Jenis Surat,Bulan (Romawi),Tahun,Tanggal Surat,Nomor Lengkap,Penerima,Perihal\r\n' +
      '001,Internal,A,Surat Edaran,SE,I,2026,2026-01-15,001/A/SE/YAPSI-DS/I/2026,Semua Guru,Pelaksanaan SOP'
    const parsed = parseWorkbook(Buffer.from(csv, 'utf-8'))
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].letterTypeName).toBe('Surat Edaran')
    expect(parsed.rows[0].letterDate?.toISOString().slice(0, 10)).toBe('2026-01-15')
  })
})
