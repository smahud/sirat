// Enkripsi arsip backup terautentikasi (B.5): AES-256-GCM, kunci diturunkan
// scrypt dari passphrase. Format container:
//   "SIRENC1\0" | versi(1) | salt(16) | nonce(12) | tag(16) | ciphertext
// Enkripsi GCM menjamin confidentiality + integrity (tamper → gagal dekripsi).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ENC_VERSION = 1
const SALT_LEN = 16
const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupCryptoError'
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, SCRYPT_OPTS)
}

/** Apakah buffer diawali header container terenkripsi SIRAT? */
export function isEncryptedContainer(buf: Buffer): boolean {
  if (buf.length < 13) return false
  const magic = ENC_MAGIC_PLACEHOLDER()
  return buf.subarray(0, magic.length).equals(magic)
}

function ENC_MAGIC_PLACEHOLDER(): Buffer {
  // Hindari impor melingkar: magic didefinisikan lokal identik dgn format.ts
  return Buffer.from('SIRENC1\0', 'binary')
}

/** Enkripsi seluruh buffer → container terautentikasi. */
export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  if (!passphrase || passphrase.length < 8) {
    throw new BackupCryptoError('Passphrase minimal 8 karakter')
  }
  const salt = randomBytes(SALT_LEN)
  const nonce = randomBytes(NONCE_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ct = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([
    ENC_MAGIC_PLACEHOLDER(),
    Buffer.from([ENC_VERSION]),
    salt,
    nonce,
    tag,
    ct,
  ])
}

/** Dekripsi container; melempar BackupCryptoError bila passphrase salah/rusak. */
export function decryptBuffer(enc: Buffer, passphrase: string): Buffer {
  const magic = ENC_MAGIC_PLACEHOLDER()
  let off = 0
  if (!enc.subarray(0, magic.length).equals(magic)) {
    throw new BackupCryptoError('Bukan arsip terenkripsi SIRAT')
  }
  off = magic.length
  const version = enc.readUInt8(off); off += 1
  if (version !== ENC_VERSION) throw new BackupCryptoError(`Versi enkripsi tidak dikenal: ${version}`)
  const salt = enc.subarray(off, off + SALT_LEN); off += SALT_LEN
  const nonce = enc.subarray(off, off + NONCE_LEN); off += NONCE_LEN
  const tag = enc.subarray(off, off + TAG_LEN); off += TAG_LEN
  const ct = enc.subarray(off)
  const key = deriveKey(passphrase, salt)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()])
  } catch {
    throw new BackupCryptoError('Passphrase salah atau arsip rusak (verifikasi integritas gagal)')
  }
}

/**
 * Kunci server untuk safety backup (B.9 langkah 9): diturunkan dari
 * SESSION_SECRET — tidak perlu menyimpan passphrase di database. Pemulihan
 * membutuhkan .env yang sama (didokumentasikan di RUNBOOK).
 */
export function serverSafetyPassphrase(sessionSecret: string): string {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new BackupCryptoError('SESSION_SECRET wajib diisi (min 32 karakter) untuk safety backup')
  }
  return `sirat-safety::${sessionSecret}`
}
