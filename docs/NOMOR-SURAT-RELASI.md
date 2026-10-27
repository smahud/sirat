# SIRAT — Nomor Surat Final, Referensi, dan Surat Terkait

> Dokumentasi wajib master prompt lanjutan **M.4**. Implementasi:
> `letter-service.ts` (alokasi nomor), `references.ts`/`reference-logic.ts` (referensi),
> `/api/letters/[id]/related` (surat terkait).

## 1. Draft vs Final

| Status | Nomor | Boleh diubah |
|---|---|---|
| `DRAFT` | Belum dialokasi; preview hanya **perkiraan** (bukan reservasi) | Semua komponen (arah/jenis/tanggal/panitia) + referensi |
| `ISSUED` | Nomor resmi **terkunci** | Hanya metadata non-komponen (penerima/perihal/catatan) via permission `letter.cancel` |
| `CANCELLED` | Nomor **tetap tersimpan**, tidak dipakai ulang | — (fakta selesai) |

Mencetak/melihat preview draft **tidak** memfinalisasi apa pun — alokasi hanya terjadi
di `POST /api/letters/[id]/issue`.

## 2. Finalisasi & integritas

1. Trigger: satu-satunya jalan = endpoint issue (dengan `Idempotency-Key`).
2. Transaksi tunggal: baca counter → naikkan → tulis surat + registry → commit (atomic; deadlock retry).
3. Keunikan dijamin **triple**: `normalizedNumber` unik global (registry + kolom), `@@unique([namespaceId, periodKey, sequence])`, dan constraint namespace.
4. Finalisasi paralel aman: request bersamaan mendapat nomor berbeda (uji regresi numbering 23 skenario).
5. Idempoten: `Idempotency-Key` sama → hasil sama, tanpa nomor ganda.

## 3. Snapshot historis (E.2)

Saat terbit, tersimpan permanen: `officialNumber` utuh, `numberSnapshot` (JSON komponen,
input, kode unit & kode jenis **saat itu**), `periodKey`, `issuedAt`, identitas penerbit.
Contoh: unit `KB` berubah jadi `KB-RA` → surat lama tetap `…/KB/…`, surat baru `…/KB-RA/…`.
Mengubah master (kode unit/jenis) **tidak pernah** membentuk ulang nomor lama.

## 4. Pembatalan (F)

`POST /api/letters/[id]/cancel` — wajib alasan (≥5 karakter), mencatat siapa & kapan,
status menjadi `CANCELLED`, nomor & registry **tetap ada** dan tidak dipakai ulang.
Pembatalan ≠ penghapusan: surat batal tetap bisa ditelusuri sesuai hak akses.

## 5. Referensi surat sebelumnya (G)

### 5.1 Input
Field **Referensi Surat Sebelumnya** pada form Buat Surat: ketik nomor →
autocomplete (debounce 300 ms, min 2 karakter, max 8 hasil) menampilkan nomor, unit,
status, perihal — **hanya surat dalam scope user** (`/api/letters/search`, filter backend).
Bisa juga menyimpan **teks manual** (surat eksternal/lama, mis. `001/SK/YAYASAN/2023`).

### 5.2 Exact match (G.4) — dievaluasi backend
Teks yang cocok 100% dengan **satu** `normalizedNumber` berizin → otomatis jadi relasi internal.
Cocok dengan satu nomor legacy → juga dihubungkan. Cocok dengan **beberapa** (legacy ganda) →
tetap teks (user harus memilih eksplisit). Tidak pernah menghubungkan berdasarkan pencocokan
parsial, tidak pernah ke surat di luar scope, tidak pernah ke diri sendiri.

### 5.3 Model relasi (G.5)
`LetterReference(letterId → refLetterId?, refNumberText, isAutoLinked)`.
Relasi memakai **internal ID** (bukan nomor); teks nomor disimpan sebagai snapshot historis.
Satu surat bisa banyak referensi (tabel khusus, siap berkembang).

### 5.4 Konsistensi historis (G.6)
Referensi bisa diedit **hanya saat DRAFT** (PATCH menolak `IMMUTABLE_REFERENCES` setelah final).
Setelah terbit, referensi adalah fakta penerbitan; koreksi memerlukan mekanisme terotorisasi + audit trail.

## 6. Surat Terkait (H)

Halaman detail surat menampilkan kartu **Referensi & Surat Terkait**:

- **Mengacu pada** — referensi keluar (internal terhubung / manual).
- **Dirujuk oleh** — surat yang merujuk ke surat ini.
- **Rangkaian terkait** — rantai dua arah (mis. A → B → C) via BFS berkedalaman & berbatas node (maks 4 hop / 30 node, bebas siklus).

**Isolasi otorisasi per node**: setiap surat dalam hasil diperiksa scope-nya secara independen —
surat di luar hak akses **tidak dikirim ke frontend sama sekali** (bukan sekadar disembunyikan);
jumlah "dirujuk dari luar scope" boleh tampak sebagai angka tanpa membocorkan nomor/judul.
Hak melihat satu surat tidak otomatis membuka surat terkaitnya.

## 7. Migrasi surat historis (E.5)

Surat impor ditandai `isImported` + `legacyNumber` (nomor persis hasil import) dan tidak
diasumsikan final tanpa dasar; penomoran baru tidak menyentuhnya. Belum ada mekanisme
massal mengubah statusnya — bila diperlukan, harus lewat import ulang/restore terkendali.
