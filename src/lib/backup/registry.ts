// Registri in-memory utk artefak backup sementara (upload restore & unduhan export).
// Token satu kali / TTL pendek; single-process systemd deployment.
// File yang telat diambil dibersihkan oleh sweep periodik saat endpoint diakses.
import 'server-only'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'

export interface UploadRecord {
  id: string
  filePath: string
  originalName: string
  uploadedById: string
  createdAt: number
  sha256: string
}

export interface DownloadRecord {
  token: string
  filePath: string
  fileName: string
  ownerId: string
  createdAt: number
  expiresAt: number
}

const UPLOADS = new Map<string, UploadRecord>()
const DOWNLOADS = new Map<string, DownloadRecord>()

const UPLOAD_TTL_MS = 30 * 60 * 1000   // 30 menit utk menyelesaikan restore
const DOWNLOAD_TTL_MS = 10 * 60 * 1000 // 10 menit utk mengambil unduhan

function sweep(): void {
  const now = Date.now()
  for (const [id, rec] of UPLOADS) {
    if (now - rec.createdAt > UPLOAD_TTL_MS) {
      UPLOADS.delete(id)
      fs.rm(rec.filePath, { force: true }).catch(() => {})
    }
  }
  for (const [token, rec] of DOWNLOADS) {
    if (now > rec.expiresAt) {
      DOWNLOADS.delete(token)
      fs.rm(rec.filePath, { force: true }).catch(() => {})
    }
  }
}

export function registerUpload(rec: Omit<UploadRecord, 'id' | 'createdAt'>): UploadRecord {
  sweep()
  const full: UploadRecord = { ...rec, id: randomUUID(), createdAt: Date.now() }
  UPLOADS.set(full.id, full)
  return full
}

export function getUpload(id: string, actorId: string): UploadRecord | null {
  sweep()
  const rec = UPLOADS.get(id)
  if (!rec) return null
  if (rec.uploadedById !== actorId) return null
  if (Date.now() - rec.createdAt > UPLOAD_TTL_MS) {
    UPLOADS.delete(id)
    return null
  }
  return rec
}

export function dropUpload(id: string): void {
  const rec = UPLOADS.get(id)
  if (rec) {
    UPLOADS.delete(id)
    fs.rm(path.dirname(rec.filePath), { recursive: true, force: true }).catch(() => {})
  }
}

export function registerDownload(rec: Omit<DownloadRecord, 'token' | 'createdAt' | 'expiresAt'>): DownloadRecord {
  sweep()
  const full: DownloadRecord = {
    ...rec,
    token: randomUUID(),
    createdAt: Date.now(),
    expiresAt: Date.now() + DOWNLOAD_TTL_MS,
  }
  DOWNLOADS.set(full.token, full)
  return full
}

/** Ambil dan HAPUS token (satu kali pakai). */
export function consumeDownload(token: string, actorId: string): DownloadRecord | null {
  sweep()
  const rec = DOWNLOADS.get(token)
  if (!rec) return null
  if (rec.ownerId !== actorId || Date.now() > rec.expiresAt) {
    DOWNLOADS.delete(token)
    return null
  }
  DOWNLOADS.delete(token)
  return rec
}

/** Hapus file unduhan setelah streaming selesai. */
export function removeDownloadFile(rec: DownloadRecord): void {
  fs.rm(rec.filePath, { force: true }).catch(() => {})
}
