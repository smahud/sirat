// Tests format backup (master prompt lanjutan K.2 keamanan restore):
// manifest validation, nama entry aman, zip-bomb, kripto roundtrip, nama file.
import { describe, it, expect } from 'vitest'
import {
  validateManifest, isSafeEntryName, checkZipSafety, backupFileName,
  checkSchemaFingerprint, BACKUP_FORMAT, BACKUP_VERSION, BackupManifest,
} from '@/lib/backup/format'
import { encryptBuffer, decryptBuffer, isEncryptedContainer, BackupCryptoError } from '@/lib/backup/crypto'

function manifestFixture(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind: 'SCOPED',
    createdAt: new Date().toISOString(),
    createdBy: { id: 'u1', username: 'admin', fullName: 'Admin' },
    appVersion: BACKUP_VERSION,
    schemaFingerprint: 'a'.repeat(64),
    scope: { unitIds: ['unit-1'], committeeIds: [] },
    scopeLabels: ['MI'],
    counts: { Letter: 3 },
    entries: [{ name: 'data/Letter.json', sha256: 'b'.repeat(64), size: 100 }],
    encrypted: false,
    includesPasswordHash: false,
    filesMissing: [],
    ...overrides,
  }
}

describe('B.5/B.8 — validasi manifest', () => {
  it('manifest SCOPED valid diterima', () => {
    const r = validateManifest(manifestFixture())
    expect(r.ok).toBe(true)
  })
  it('manifest FULL valid diterima (scope kosong)', () => {
    const r = validateManifest(manifestFixture({ kind: 'FULL', scope: { unitIds: [], committeeIds: [] } }))
    expect(r.ok).toBe(true)
  })
  it('FULL dengan scope ditolak (inkonsistensi cakupan)', () => {
    const r = validateManifest(manifestFixture({ kind: 'FULL' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('FULL')
  })
  it('SCOPED tanpa scope ditolak', () => {
    const r = validateManifest(manifestFixture({ scope: { unitIds: [], committeeIds: [] } }))
    expect(r.ok).toBe(false)
  })
  it('format salah ditolak', () => {
    const r = validateManifest({ ...manifestFixture(), format: 'EVIL' })
    expect(r.ok).toBe(false)
  })
  it('sidik jari skema salah panjang ditolak', () => {
    const r = validateManifest(manifestFixture({ schemaFingerprint: 'abc' }))
    expect(r.ok).toBe(false)
  })
})

describe('B.9 — proteksi path traversal', () => {
  it('nama entry sah diterima', () => {
    expect(isSafeEntryName('manifest.json')).toBe(true)
    expect(isSafeEntryName('meta/app.json')).toBe(true)
    expect(isSafeEntryName('data/Letter.json')).toBe(true)
    expect(isSafeEntryName('files/mi/letters/2026/10/l1/f1/v1/blob')).toBe(true)
  })
  it('traversal ditolak', () => {
    expect(isSafeEntryName('../etc/passwd')).toBe(false)
    expect(isSafeEntryName('data/../../etc.json')).toBe(false)
    expect(isSafeEntryName('/abs/path.json')).toBe(false)
    expect(isSafeEntryName('data//double.json')).toBe(false)
    expect(isSafeEntryName('evil/manifest.json')).toBe(false)
    expect(isSafeEntryName('data/Letter.xlsx')).toBe(false)
    expect(isSafeEntryName('a\\b.json')).toBe(false)
  })
  it('nama terlalu panjang ditolak', () => {
    expect(isSafeEntryName(`data/${'x'.repeat(300)}.json`)).toBe(false)
  })
})

describe('B.9 — proteksi zip bomb', () => {
  const e = (name: string, u: number, c: number) => ({ name, uncompressedSize: u, compressedSize: c })
  it('arsip wajar lolos', () => {
    expect(checkZipSafety([e('manifest.json', 500, 200), e('data/Letter.json', 5000, 1500)]).ok).toBe(true)
  })
  it('arsip kosong ditolak', () => {
    expect(checkZipSafety([]).ok).toBe(false)
  })
  it('terlalu banyak entry ditolak', () => {
    const entries = Array.from({ length: 5001 }, (_, i) => e(`data/T${i}.json`, 10, 5))
    expect(checkZipSafety(entries).ok).toBe(false)
  })
  it('entry raksasa ditolak', () => {
    expect(checkZipSafety([e('data/BIG.json', 2 * 1024 ** 3 + 1, 1000)]).ok).toBe(false)
  })
  it('rasio kompresi mencurigakan ditolak', () => {
    expect(checkZipSafety([e('data/bomb.json', 100_000_000, 1000)]).ok).toBe(false)
  })
  it('nama berbahaya ditolak oleh pemeriksaan keamanan', () => {
    expect(checkZipSafety([e('../evil.json', 10, 5)].map(x => ({ ...x, name: x.name }))).ok).toBe(false)
  })
})

describe('B.5 — enkripsi terautentikasi (AES-256-GCM + scrypt)', () => {
  it('roundtrip enkripsi/dekripsi mengembalikan isi asli', () => {
    const plain = Buffer.from(JSON.stringify({ secret: 'sirat', n: 42 }))
    const enc = encryptBuffer(plain, 'passphrase-amat-kuat')
    expect(isEncryptedContainer(enc)).toBe(true)
    expect(enc.equals(plain)).toBe(false)
    const dec = decryptBuffer(enc, 'passphrase-amat-kuat')
    expect(dec.equals(plain)).toBe(true)
  })
  it('passphrase salah → gagal (integritas terautentikasi)', () => {
    const enc = encryptBuffer(Buffer.from('rahasia'), 'passphrase-benar')
    expect(() => decryptBuffer(enc, 'passphrase-salah')).toThrow(BackupCryptoError)
  })
  it('ciphertext yang dimodifikasi → gagal (tamper detection)', () => {
    const enc = encryptBuffer(Buffer.from('rahasia'), 'passphrase-benar')
    enc[enc.length - 1] ^= 0xff
    expect(() => decryptBuffer(enc, 'passphrase-benar')).toThrow(BackupCryptoError)
  })
  it('passphrase terlalu pendek ditolak', () => {
    expect(() => encryptBuffer(Buffer.from('x'), 'short')).toThrow(BackupCryptoError)
  })
  it('buffer acak tanpa magic ditolak saat dekripsi', () => {
    expect(() => decryptBuffer(Buffer.from('bukan-archive'), 'pw')).toThrow(BackupCryptoError)
  })
})

describe('B.5 — penamaan file backup', () => {
  it('nama FULL terenkripsi', () => {
    const d = new Date(2026, 9, 26, 14, 5, 9)
    expect(backupFileName('FULL', [], d, true)).toBe('SIRAT_FULL_BACKUP_20261026_140509.zip.enc')
  })
  it('nama scoped berlabel unit (sanitasi input)', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5)
    expect(backupFileName('SCOPED', ['MI', 'MTs'], d, false)).toBe('SIRAT_MI-MTs_BACKUP_20260102_030405.zip')
  })
  it('label berbahaya disanitasi (bukan input mentah)', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5)
    const name = backupFileName('SCOPED', ['../../etc'], d, false)
    expect(name).not.toContain('..')
    expect(name).not.toContain('/')
  })
})

describe('J — kompatibilitas skema', () => {
  it('sidik jari cocok lolos', () => {
    expect(checkSchemaFingerprint(manifestFixture(), 'a'.repeat(64)).ok).toBe(true)
  })
  it('sidik jari beda ditolak dengan alasan', () => {
    const r = checkSchemaFingerprint(manifestFixture(), 'b'.repeat(64))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('tidak kompatibel')
  })
})
