# SIRAT — Import Data (Histori Surat)

> Menu **Import Data** (dulu "Import Excel", diubah v1.5 agar tidak menyesatkan —
> format yang diterima bukan hanya Excel). Dokumen ini menjelaskan konsep,
> alur, hak akses, struktur template, dan jaminan keamanan.

## 1. Untuk apa & kapan dipakai

Import Data adalah alat **cutover sekali jalan**: memindahkan daftar surat lama
yang selama ini dicatat manual di Excel/CSV ke SIRAT, dengan nomor asli yang
dipertahankan persis. Setelah cutover, seluruh pencatatan berpindah ke SIRAT
(menu Surat → Buat Surat) dan berkas Excel dibekukan sebagai arsip.

Yang diimpor adalah **histori surat terbit** — bukan draft, bukan surat baru.
Surat hasil import ditandai `isImported=true` dan `importedAt`, sehingga tetap
bisa dibedakan dari surat yang diterbitkan lewat SIRAT.

## 2. Hak akses & scope target (v1.5)

Menu hanya muncul bagi pemegang `import.manage`: SYSTEM_ADMIN, ORG_ADMIN,
UNIT_ADMIN, COMMITTEE_ADMIN. OPERATOR/VIEWER/AUDITOR tidak melihat menu ini.

Semakin tinggi hak akses, semakin bebas memilih target — dan **backend selalu
memvalidasi ulang** (`canManageUnit`), karena filtering frontend bukan batas
keamanan:

| Role | Unit target yang boleh | Catatan |
|---|---|---|
| SYSTEM_ADMIN / ORG_ADMIN | Semua unit/departemen | Dropdown menampilkan seluruh unit |
| UNIT_ADMIN | Hanya unit pada assignment-nya | Melanggar via API langsung → **403 FORBIDDEN** |
| COMMITTEE_ADMIN | — (kecuali punya assignment unit) | Surat import = surat reguler unit, bukan surat panitia |

## 3. Alur kerja (dry-run → review → commit)

1. **Unduh template** — tiga format berisi kolom yang identik:
   - `.xlsx` (Excel modern, dengan sheet *Petunjuk*)
   - `.xls` (Excel 1997–2003, dengan sheet *Petunjuk*)
   - `.csv` (pemisah `;` + BOM UTF-8 — langsung rapi dibuka Excel Indonesia)
2. **Isi data** — salin data lama ke sheet *Nomor Surat*; ganti baris contoh.
3. **Unggah** → sistem menjalankan **dry-run**: berkas dibaca, setiap baris
   diklasifikasi, hasilnya ditampilkan. *Tidak ada data yang disimpan.*
4. **Tinjau**:
   - `CANDIDATE` (hijau) — siap disimpan.
   - `NEEDS_REVIEW` (kuning) — perlu keputusan (mis. tahun berbeda dari mayoritas).
   - `ERROR` (merah) — bermasalah (nomor duplikat dalam file / urutan bukan angka /
     nomor kosong); tidak bisa disimpan.
   - `PRAISI` (abu) — tanpa tanggal = nomor cadangan; bukan surat terbit, tidak diimpor.
5. **Commit** — pilih baris, pilih unit tujuan, (opsional) centang *high-water*,
   konfirmasi. Hanya baris terpilih yang disimpan, dalam satu transaksi.

### Riwayat Import

Setiap unggahan (dry-run) dan commit tercatat di tabel **Riwayat Import**:
berkas, sheet, jumlah baris, rincian kandidat/review/error, unit tujuan, status
(DRY-RUN / TERSIMPAN). Riwayat di-scope: admin unit hanya melihat aktivitasnya
sendiri dan batch yang menargetkan unitnya.

## 4. Struktur template (kolom A–K)

Sumber kebenaran struktur: `TEMPLATE_COLUMNS` di `src/lib/import-service.ts`
(dipakai baik oleh generator template maupun parser — tidak mungkin beda).

| Kolom | Judul | Wajib | Contoh | Keterangan |
|---|---|---|---|---|
| A | Urutan | ✅ | `001` | Angka urut; dipakai untuk setel high-water |
| B | Arah | ✅ | `Internal` | `Internal` / `Eksternal` — inilah yang dibaca sistem |
| C | Kode Arah | — | `A` | Catatan saja |
| D | Nama Jenis Surat | — | `Surat Keputusan` | Dicocokkan ke master Jenis Surat |
| E | Kode Jenis Surat | — | `SK` | Cadangan pencocokan |
| F | Bulan (Romawi) | — | `I` | Catatan saja |
| G | Tahun | — | `2026` | Catatan saja |
| H | Tanggal Surat | ✅ | `2026-01-15` | `2026-01-15`, `15/01/2026`, `15-01-2026`, `15 Jan 2026`, `15/01/26` |
| I | Nomor Lengkap | ✅ | `001/A/SK/YAPSI-DS/I/2026` | Teks persis seperti tertulis — jangan rumus |
| J | Penerima | — | `Dinas Pendidikan` | Disarankan |
| K | Perihal | — | `Undangan rapat` | Disarankan |

Catatan teknis parsing:

- **Formula tidak dieksekusi.** XLSX dibaca dua representasi (raw + cached
  value); yang dipakai adalah *cached text* kolom I. Sel bernomor pun dibaca
  sebagai teks apa adanya.
- **CSV tidak kehilangan nol di depan**: parser memakai mode raw (`raw: true`)
  sehingga `001` tetap `001`, bukan `1`.
- **Tanggal teks** didukung konvensi Indonesia (DD/MM/YYYY dianggap hari-dulu,
  bukan MM/DD) beserta nama bulan id/en.
- Duplikat dalam file (normalisasi uppercase-trim) → ERROR; duplikat dengan
  surat yang sudah ada → otomatis dilewati saat commit (SKIPPED + alasan).
- Batas ukuran berkas 20 MiB; sheet pertama yang dibaca.

## 5. High-water counter

Opsi *Setel counter high-water* hanya untuk situasi: **seluruh** histori nomor
unit tersebut ada di dalam berkas ini. Counter sequence unit disetel ke minimal
nomor terbesar yang diimpor (tidak pernah menurunkan counter yang sudah lebih
tinggi). Bila ragu — jangan dicentang; nomor baru bisa saja melompati beberapa
angka, yang aman dibandingkan tabrakan nomor.

## 6. Endpoint API

| Endpoint | Permission | Fungsi |
|---|---|---|
| `GET /api/import/template?format=csv\|xlsx\|xls` | `import.manage` | Unduh template (tercatat di audit) |
| `POST /api/import/excel` | `import.manage` | Dry-run (multipart `file` / body raw) |
| `POST /api/import/:batchId/commit` | `import.manage` + `canManageUnit(targetUnitId)` | Commit selektif transaksional |
| `GET /api/import/batches` | `import.manage` | Riwayat (scope-filtered) |

Audit trail: `import.template.download`, `import.dry-run`, `import.commit`.

## 7. Checklist cutover (untuk admin)

1. Bekukan pencatatan Excel sejak tanggal putus.
2. Unduh template, isi data, periksa kolom H (tanggal) dan I (nomor lengkap).
3. Upload → pastikan tidak ada ERROR; putuskan baris NEEDS_REVIEW secara sadar.
4. Commit per unit; centang high-water hanya bila berkas memuat seluruh histori unit.
5. Setelah commit: verifikasi beberapa nomor di menu Surat, lalu arsipkan berkas Excel.
