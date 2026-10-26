// Validasi MIME via magic bytes (FR-014: ekstensi saja tidak cukup).
// PDF/JPEG/PNG/DOCX/XLSX/TXT. DOCX/XLSX adalah kontainer ZIP — cek header PK + penanda konten Office.
import 'server-only'
import fs from 'fs/promises'

export interface SniffResult {
  family: 'pdf' | 'jpeg' | 'png' | 'docx' | 'xlsx' | 'txt' | 'unknown'
  mime: string
  ok: boolean
}

const OFFICE_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function sniffFile(filePath: string): Promise<SniffResult> {
  const fh = await fs.open(filePath, 'r')
  try {
    const head = Buffer.alloc(8192)
    const { bytesRead } = await fh.read(head, 0, 8192, 0)
    const b = head.subarray(0, Math.max(bytesRead, 0))

    if (b.subarray(0, 5).toString('latin1') === '%PDF-') {
      return { family: 'pdf', mime: 'application/pdf', ok: true }
    }
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return { family: 'jpeg', mime: 'image/jpeg', ok: true }
    }
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { family: 'png', mime: 'image/png', ok: true }
    }
    if (b.subarray(0, 4).toString('latin1') === 'PK\x03\x04') {
      // Kontainer ZIP; bedakan docx (word/) vs xlsx (xl/) dari nama entry pertama
      const s = b.toString('latin1')
      if (s.includes('word/')) return { family: 'docx', mime: OFFICE_MIME.docx, ok: true }
      if (s.includes('xl/')) return { family: 'xlsx', mime: OFFICE_MIME.xlsx, ok: true }
      return { family: 'unknown', mime: 'application/zip', ok: false }
    }
    // TXT: tidak boleh mengandung NUL di awal berkas
    if (!b.includes(0)) return { family: 'txt', mime: 'text/plain', ok: true }
    return { family: 'unknown', mime: 'application/octet-stream', ok: false }
  } finally {
    await fh.close()
  }
}

/** Ekstensi harus cocok dengan family hasil sniff. */
export function extensionMatchesFamily(filename: string, family: SniffResult['family']): boolean {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const map: Record<SniffResult['family'], string[]> = {
    pdf: ['pdf'], jpeg: ['jpg', 'jpeg'], png: ['png'],
    docx: ['docx'], xlsx: ['xlsx'], txt: ['txt'],
    unknown: [],
  }
  return (map[family] || []).includes(ext)
}

/** Sanitasi nama berkas untuk metadata (bukan untuk path — path memakai ID stabil). */
export function sanitizeOriginalName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() || 'file'
  return base.replace(/[^\w.\- ()\[\]]/g, '_').slice(0, 180)
}
