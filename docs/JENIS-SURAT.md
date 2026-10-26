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
| Deskripsi/kategori | Dokumen keputusan resmi yang ditetapkan pihak berwenang |
| Fungsi/tujuan | Menetapkan kebijakan, pengangkatan, penugasan, keputusan administratif |
| Contoh penggunaan (per baris) | SK Pengangkatan · SK Perpanjangan Jabatan · SK Penetapan Panitia |
| Catatan/petunjuk | Wajib mencantumkan dasar hukum |
| Status aktif | Ya/Tidak |

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

- Hanya jenis **aktif** yang bisa dipilih.
- Ikon **ⓘ** di samping label "Jenis surat" menampilkan keterangan lengkap dari master data:
  kode, nama/klasifikasi, deskripsi, fungsi, contoh penggunaan, catatan, jumlah pemakaian.
  Mendukung hover (desktop), tap (layar sentuh), dan keyboard (fokus + Enter/Space).
- Keterangan selalu diambil dari DB — saat Super Admin mengubah master, seluruh UI langsung memakai data terbaru.
