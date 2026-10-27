# SIRAT — Jenis Surat

> Dokumentasi wajib master prompt lanjutan **M.3/D.7** — ditulis untuk administrator
> non-teknis. Implementasi: menu **Jenis Surat** (`letter-types-view.tsx`) +
> `/api/letter-types` + model `LetterType`.

## 1. Apa itu jenis surat?

Jenis surat adalah **klasifikasi dokumen** yang menjadi komponen nomor surat resmi.
Contoh: `SK` = Surat Keputusan, `UND` = undangan. Setiap surat wajib memilih satu jenis.
Nama tampilan di UI: **Jenis Surat**, dikelola Super Admin (menu tersendiri sejak v1.2).

## 2. Jenis ≠ klasifikasi ≠ pola penomoran ≠ unit penerbit

Empat konsep berbeda yang **tidak disamakan**:

| Konsep | Arti | Diatur di |
|---|---|---|
| **Jenis surat** | Klasifikasi dokumen (kode ikut nomor) | Menu *Jenis Surat* (`LetterType`) |
| **Kode/komponen nomor** | Kode jenis + kode unit + urutan, dsb. | Ditentukan profil penomoran |
| **Pola/format nomor** | Susunan komponen (`001/SK/MI/X/2026`) | Menu *Profil Nomor* (`NumberingProfile`, DSL) |
| **Unit penerbit** | Siapa yang menerbitkan (unit/panitia) | Menu *Unit & Panitia* |

Satu jenis surat bisa dipakai unit mana pun, dan satu unit bisa memakai banyak jenis —
hubungan **banyak-ke-banyak** via surat, bukan konfigurasi langsung. Format nomor berada
di profil penomoran; jenis surat hanya menyumbang **kode** sebagai salah satu komponen.

## 3. Field yang dikelola (semua editable, tersimpan di DB — tidak hardcode)

| Field | Contoh |
|---|---|
| Kode | `SK` |
| Nama jenis | `SURAT KEPUTUSAN` |
| **Kategori** (v1.4) | `Kebijakan & Keputusan` |
| Deskripsi | Surat yang menetapkan sesuatu secara final oleh pihak berwenang |
| Fungsi/tujuan | Memberi dasar resmi atas penetapan jabatan, tugas struktural, … |
| Contoh penggunaan (per baris) | SK pengangkatan guru · SK penugasan wali kelas · SK panitia |
| Catatan/petunjuk | Berorientasi jabatan; penugasan sesaat gunakan ST |
| Status aktif | Ya/Tidak |

### Kategori (default config v1.4)

Kategori adalah **kelompok navigasi** — dipakai untuk mengurutkan daftar jenis surat
serta mengelompokkan pilihan pada dropdown form Buat Surat, sehingga pengguna baru
langsung menemukan jenis yang tepat tanpa harus menghafal kode. Lima kategori standar
(bukan paksaan — lembaga boleh menulis kategorinya sendiri):

1. **Kebijakan & Keputusan** — menetapkan/mengatur (SE, SK)
2. **Tugas & Penugasan** — menugaskan orang (ST)
3. **Komunikasi & Koordinasi** — menyampaikan informasi (UND, SPB, ND, SPG)
4. **Administrasi & Layanan** — layanan sehari-hari (SPR, SR, SKET, SKA)
5. **Pertanggungjawaban & Dokumentasi** — merekam/menjadi bukti (SPT, BA)

## 3a. Katalog default (default config v1.4)

Instalasi baru otomatis mendapat **13 jenis surat lengkap dengan panduannya**
(sumber: `scripts/letter-types-defaults.json` — silakan disesuaikan kebutuhan lembaga;
8 kode berasal dari lampiran workbook YAPSI + 5 jenis umum tambahan):

| Kode | Nama | Kategori | Inti panduan |
|---|---|---|---|
| SE | SURAT EDARAN | Kebijakan & Keputusan | Menyosialisasikan SOP/kebijakan internal secara seragam & mengikat |
| SK | SURAT KEPUTUSAN | Kebijakan & Keputusan | Menetapkan secara final — orientasi **jabatan** guru/karyawan |
| ST | SURAT TUGAS | Tugas & Penugasan | Penugasan **sesaat** dengan rentang waktu; dasar pertanggungjawaban |
| UND | UNDANGAN | Komunikasi & Koordinasi | Menghadirkan pihak pada rapat/acara (waktu-tempat-agenda) |
| SPB | PEMBERITAHUAN | Komunikasi & Koordinasi | Memberi tahu tanpa menuntut kehadiran (≠ UND, ≠ SE) |
| ND | NOTA DINAS | Komunikasi & Koordinasi | Komunikasi internal antar unit — ringkas, tetap terdokumentasi |
| SPG | SURAT PENGANTAR | Komunikasi & Koordinasi | Sampul pengiriman berkas/dokumen dengan rincian isi |
| SPR | PERMOHONAN | Administrasi & Layanan | Pengajuan izin/bantuan/fasilitas agar diproses & dilacak |
| SR | REKOMENDASI | Administrasi & Layanan | Dukungan resmi atas kelayakan seseorang/lembaga (bukan opini pribadi) |
| SKET | SURAT KETERANGAN | Administrasi & Layanan | Menerangkan **fakta** dari catatan lembaga (≠ rekomendasi) |
| SKA | SURAT KUASA | Administrasi & Layanan | Memberi kuasa tindakan tertentu, spesifik & berbatas waktu |
| SPT | PERNYATAAN | Pertanggungjawaban & Dokumentasi | Mengikat penandatangan atas kesanggupan/kebenaran data |
| BA | BERITA ACARA | Pertanggungjawaban & Dokumentasi | Merekam peristiwa nyata; ditandatangani seluruh pihak terlibat |

Penerapan pada instalasi yang sudah berjalan: `node scripts/backfill-letter-types.mjs`
(isi field kosong saja — tidak menimpa edit manual; `--force` untuk kanonikalisasi,
`--dry-run` untuk pratinjau). Instalasi baru cukup `node scripts/seed.mjs`.

## 4. Siapa yang mengelola & dampak perubahan

- **Super Admin / Org Admin** (permission `lettertype.manage`); Admin Unit tidak bisa mengubah master global ini.
- Mengubah kode/nama/deskripsi → **hanya berlaku untuk terbitan baru**. Nomor final surat lama
  memakai **snapshot** kode saat surat diterbitkan (`officialNumber` + `numberSnapshot` JSON) —
  nomor historis **tidak pernah dibentuk ulang**.
- Jumlah surat yang memakai jenis tercatat di audit metadata setiap perubahan.
- **Nonaktifkan** → jenis tidak muncul di form Buat Surat (backend juga menolak `LETTER_TYPE_INACTIVE`),
  tetapi surat lama tetap bisa ditelusuri.

## 5. Hapus vs arsip (D.6)

- **Belum pernah dipakai surat** → boleh hapus fisik (dengan konfirmasi).
- **Sudah dipakai** → hapus fisik **ditolak** (`HAS_HISTORY`); tombol beralih ke *Nonaktifkan (arsipkan)*
  agar referensi historis dan keabsahan nomor surat terbit tetap sah.

## 6. Perilaku di form Buat Surat (D.5)

- Hanya jenis **aktif** yang bisa dipilih; daftar **dikelompokkan per kategori** agar mudah dinavigasi.
- Ikon **ⓘ** di samping label "Jenis surat" menampilkan keterangan lengkap dari master data:
  kode, kategori, nama/klasifikasi, deskripsi, fungsi, contoh penggunaan, catatan, jumlah pemakaian.
  Mendukung hover (desktop), tap (layar sentuh), dan keyboard (fokus + Enter/Space).
- Keterangan selalu diambil dari DB — saat Super Admin mengubah master, seluruh UI langsung memakai data terbaru.
