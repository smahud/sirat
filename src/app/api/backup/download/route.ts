import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { stat } from 'fs/promises'
import { fail, handle, requireUser } from '@/lib/api-helpers'
import { consumeDownload, removeDownloadFile } from '@/lib/backup/registry'

/** Unduh artefak backup via token satu kali (B.5: download terotorisasi). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const token = new URL(req.url).searchParams.get('token')
    if (!token) return fail(400, 'VALIDATION', 'Parameter token wajib')

    const rec = consumeDownload(token, r.user.id)
    if (!rec) return fail(404, 'NOT_FOUND', 'Token unduhan tidak ditemukan, bukan milik Anda, atau sudah kedaluwarsa')

    try {
      const st = await stat(rec.filePath)
      const node = createReadStream(rec.filePath)
      node.on('close', () => removeDownloadFile(rec))
      node.on('error', () => removeDownloadFile(rec))
      const stream = Readable.toWeb(node) as ReadableStream<Uint8Array>
      return new NextResponse(stream, {
        headers: {
          'Content-Type': rec.fileName.endsWith('.enc') ? 'application/octet-stream' : 'application/zip',
          'Content-Disposition': `attachment; filename="${rec.fileName}"`,
          'Content-Length': String(st.size),
          'Cache-Control': 'no-store',
        },
      })
    } catch {
      removeDownloadFile(rec)
      return fail(404, 'NOT_FOUND', 'File backup sudah tidak tersedia')
    }
  })
}
