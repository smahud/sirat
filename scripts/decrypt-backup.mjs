#!/usr/bin/env node
/**
 * Dekripsi arsip backup SIRAT yang memakai kunci server (safety backup).
 * Membaca SESSION_SECRET dari .env — arsip hanya bisa dibuka di server
 * dengan .env yang sama (lihat docs/BACKUP-RESTORE.md §7).
 *
 * Usage: node scripts/decrypt-backup.mjs <file.zip.enc> <output.zip>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { scryptSync, createDecipheriv } from 'node:crypto'
import path from 'node:path'

const [,, input, output] = process.argv
if (!input || !output) {
  console.error('Usage: node scripts/decrypt-backup.mjs <file.zip.enc> <output.zip>')
  process.exit(1)
}
if (!existsSync(input)) {
  console.error(`File tidak ditemukan: ${input}`)
  process.exit(1)
}

// Baca SESSION_SECRET dari .env (sederhana, tanpa dependensi)
let secret = process.env.SESSION_SECRET
if (!secret) {
  const envPath = path.join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*SESSION_SECRET\s*=\s*(.+)\s*$/)
      if (m) { secret = m[1].replace(/^["']|["']$/g, ''); break }
    }
  }
}
if (!secret || secret.length < 32) {
  console.error('SESSION_SECRET tidak ditemukan / kurang dari 32 karakter (cek .env)')
  process.exit(1)
}

const enc = readFileSync(input)
const MAGIC = Buffer.from('SIRENC1\0', 'binary')
if (!enc.subarray(0, MAGIC.length).equals(MAGIC)) {
  console.error('Bukan arsip terenkripsi SIRAT')
  process.exit(1)
}
let off = MAGIC.length
const version = enc.readUInt8(off); off += 1
if (version !== 1) { console.error(`Versi enkripsi tidak dikenal: ${version}`); process.exit(1) }
const SALT_LEN = 16, NONCE_LEN = 12, TAG_LEN = 16, KEY_LEN = 32
const salt = enc.subarray(off, off + SALT_LEN); off += SALT_LEN
const nonce = enc.subarray(off, off + NONCE_LEN); off += NONCE_LEN
const tag = enc.subarray(off, off + TAG_LEN); off += TAG_LEN
const ct = enc.subarray(off)

const passphrase = `sirat-safety::${secret}`
const key = scryptSync(passphrase, salt, KEY_LEN, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
try {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ct), decipher.final()])
  writeFileSync(output, plain)
  console.log(`OK: ${input} → ${output} (${plain.length} bytes)`)
} catch {
  console.error('Dekripsi gagal: SESSION_SECRET berbeda dengan yang dipakai saat backup, atau arsip rusak.')
  process.exit(1)
}
