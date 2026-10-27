# SIRAT — Backup & Restore

> Dokumentasi wajib master prompt lanjutan **M.2**. Implementasi:
> `src/lib/backup/*` (format, crypto, collect, build, restore, registry) +
> `/api/backup/*` + `src/components/sirat/backup-view.tsx`.

## 1. Konsep dasar

| Konsep | Aturan |
|---|---|
| **Backup ≠ Restore** | Dua permission terpisah: `backup.export` dan `backup.restore`. Bisa backup tanpa boleh restore. |
| **Full vs Per Scope** | Full System Backup = seluruh data (termasuk hash password → wajib terenkripsi). Scoped Backup = data unit/kepanitiaan saja (tanpa hash password akun). |
| **Siapa boleh apa** | Lihat §2. |
| **Manifest = sumber kebenaran** | Restore membaca manifest di dalam arsip — **bukan** nama file, **bukan** payload FE. |

## 2. Siapa boleh apa

| Aktor | Full Backup | Full Restore | Scoped Backup | Scoped Restore |
|---|---|---|---|---|
| `SYSTEM_ADMIN` | ✅ | ✅ | ✅ (semua scope) | ✅ (semua scope) |
| `ORG_ADMIN` | ✅ | ❌ | ✅ | ❌ (kecuali diberi grant) |
| `UNIT_ADMIN` / `COMMITTEE_ADMIN` / lainnya | ❌ | ❌ | **hanya via BackupGrant** | **hanya via BackupGrant** |
| Tanpa grant sama sekali | ❌ | ❌ | ❌ menu disembunyikan & API menolak | ❌ |

**BackupGrant** (`prisma BackupGrant`): `userId + (unitId | committeeId) + canExport + canRestore`.
Grant bersifat izin administratif eksplisit per scope; dicabut → langsung efektif (di-resolve per request).

### 2.1 Makna scope (B.3 — eksplisit, bukan pewarisan diam-diam)

- **Scope unit** mencakup surat reguler unit **dan seluruh surat kepanitiaan di bawah unit itu**.
- **Scope kepanitiaan** hanya surat kepanitiaan tersebut (tidak menyentuh surat reguler unit induk, tidak menyentuh panitia lain).
- User dengan **satu** scope melihat target terkunci otomatis di UI; manipulasi `unitIds`/`committeeIds` lewat API tetap ditolak backend (`assertBackupTargets`).

## 3. Isi backup

### 3.1 Full System Backup (`SIRAT_FULL_BACKUP_YYYYMMDD_HHMMSS.zip.enc`)

Seluruh tabel: AppIdentity, User (dengan passwordHash), Unit, Committee, AccessAssignment,
LetterType, NumberingProfile(+Version), CounterNamespace, Counter, Letter, NumberRegistry,
LetterReference, ArchiveFile, ArchiveVersion, AuditEvent, StorageBackend, ImportBatch,
ImportRow, **BackupGrant**. Tidak termasuk: IdempotencyKey (transien) dan BackupEvent
(riwayat operasi backup itu sendiri — bukan data sistem).
Blob arsip ikut sebagai `files/<objectKey>`.

### 3.2 Scoped Backup (`SIRAT_<UNIT>_BACKUP_….zip`)

Surat dalam scope + NumberRegistry + referensi keluarnya + ArchiveFile/Version terkait +
profil/namespace/counter yang dipakai. **Data global bersama** (B.4) hanya sebagai
**snapshot referensi**: identitas pengguna (id/username/nama — **tanpa passwordHash**),
unit/kepanitiaan/jenis surat yang dirujuk. Akun multi-unit tidak diperlakukan milik satu unit.
Referensi MASUK dari surat luar scope tidak ikut (didokumentasikan; backup FULL yang memuat relasi lengkap).

## 4. Format arsip

```
manifest.json          ← format, versi, kind, createdBy, schemaFingerprint,
                         scope, counts, entries[+sha256+size], encrypted, includesPasswordHash
meta/app.json          ← versi aplikasi, waktu, node
data/<Model>.json      ← baris per tabel
files/<objectKey>      ← blob arsip versi
```

- **Checksum**: setiap entry tercatat sha256 di manifest dan diverifikasi ulang saat restore; entry hilang/ekstra → ditolak.
- **Enkripsi** (arsip sensitif): container `SIRENC1` = AES-256-GCM, kunci scrypt(N=16384) dari passphrase. Full backup **wajib** terenkripsi (memuat hash password). Scoped backup: passphrase opsional. GCM = *authenticated encryption* — passphrase salah atau arsip diubah satu byte pun → gagal.
- **Zip bomb**: max 5000 entry, 2 GiB total terurai, 1 GiB per entry, rasio kompresi >200× ditolak, ukuran aktual dipantau saat ekstraksi.
- **Path traversal**: nama entry di-whitelist `manifest.json|meta/app.json|data/*.json|files/**`, tanpa `..`/absolut/backslash; penulisan file staging lewat `safeJoin`.
- **Skema**: `schemaFingerprint` = sha256 dari DMMF Prisma runtime; restore menolak arsip lintas versi skema.

## 5. Alur backup

1. User membuka **Backup & Restore** → melihat kapabilitas (full dan/atau scope dari grant).
2. Pilih Full (wajib passphrase, konfirmasi ulang) atau scope (multi-pilih bila berhak lebih dari satu; single → terkunci).
3. `POST /api/backup/create` → server membangun ZIP di `data/backups/exports`, mencatat **BackupEvent** + audit, mengembalikan token unduhan **satu kali** (TTL 10 menit).
4. `GET /api/backup/download?token=` → stream `Content-Disposition: attachment`; file dihapus setelah terkirim (token sekali pakai, milik pembuat).

## 6. Alur restore (B.9)

1. User mengunggah arsip (`POST /api/backup/validate`, multipart, max 512 MiB) + passphrase bila terenkripsi.
2. Server: simpan staging → baca **manifest** → cek zip-safety → verifikasi checksum semua entry → cek fingerprint skema → hitung **target yang diizinkan** (FULL→fullRestore; SCOPED→irisan scope arsip × grant restore user) → kembalikan pratinjau (jenis, waktu, pembuat, isi, peringatan).
3. User membuka konfirmasi kuat: ketik `RESTORE` + **password akun** (re-autentikasi bcrypt).
4. `POST /api/backup/restore`: verifikasi ulang SEMUA permission dari DB → re-auth → **safety backup otomatis** (`SAFETY`, terenkripsi kunci server) → plan (preview final) → eksekusi dalam **transaksi** → laporan.
5. Proteksi: lock restore paralel (BackupEvent RUNNING < 2 jam; stale ditandai gagal), FK order terjaga, blob dipromosikan **setelah** commit DB (staging → `data/archive`), counter tidak pernah turun.

### 6.1 Perbedaan Full vs Scoped restore

| | Full Restore | Scoped Restore |
|---|---|---|
| Otoritas | Super Admin saja | BackupGrant `canRestore` per scope |
| Strategi | **Ganti seluruh isi** sistem dengan arsip (transaksi: hapus semua → sisipkan semua) | **Merge-amd**: data hilang ditambahkan, data ada **dipertahankan** (tidak pernah ditimpa), konflik ditolak + dilaporkan |
| Akun & role | Dipulihkan penuh (termasuk hash password) | Akun hilang hanya jadi **stub identitas nonaktif** (tanpa password, tak bisa login); akun/role/global tidak pernah diubah |
| Jenis surat/konfigurasi global | Dipulihkan | Dibuat stub hanya bila hilang (jaga FK); tidak dimodifikasi bila sudah ada |
| Nomor final | Registry dipulihkan; counter dinaikkan ke max sequence bila perlu | Duplikasi nomor **ditolak** (normalizedNumber & namespace+periode+urutan unik); counter hanya naik |
| Data unit lain | — (semua diganti) | **Tidak tersentuh**; baris luar target dilaporkan "dipertahankan tidak diproses" |

Restore parsial yang tidak aman ditolak dengan penjelasan (bukan diam-diam setengah jalan).

## 7. Safety backup & pemulihan

- Setiap restore otomatis membuat `data/backups/safety/SIRAT_FULL_BACKUP_….zip.enc` (maks. 5 terbaru, di-prune).
- Enkripsi memakai kunci turunan `SESSION_SECRET` (scrypt) — **tidak ada passphrase di database**.
- Dekripsi manual: `node scripts/decrypt-backup.mjs <file.zip.enc> <output.zip>` (membaca `SESSION_SECRET` dari `.env`).
- **PENTING**: cadangkan `.env` bersama arsip — SESSION_SECRET hilang = safety backup tidak bisa dibuka (backup penuh buatan user dengan passphrase sendiri tidak tergantung ini).

## 8. Risiko & batasan (jujur, sesuai implementasi)

- Scoped restore **tidak memulihkan** akun login, role, password, jenis surat global, konfigurasi sistem, maupun referensi MASUK dari surat luar scope.
- Scoped restore ke sistem yang masih kosong (unit dibuat ulang dengan ID berbeda) tidak cocok — gunakan Full Restore untuk disaster recovery.
- Full restore mengganti seluruh data; pelaku restore yang tidak ada di arsip akan keluar dari sistem (diperingatkan di pratinjau).
- Token unduhan & unggahan restore hidup di memori proses (single-instance systemd); restart membatalkan token (file dibersihkan TTL sweep).
- Restore ke production tetap memerlukan keputusan manusia — sistem memaksa konfirmasi + re-auth, dan **tidak pernah** dijalankan otomatis.
