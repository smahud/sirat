# Dynamic Numbering Profile Builder (v1.6)

Dokumen ini menjelaskan arsitektur dan aturan fitur **Tambah Profil Baru / Add New Numbering Profile** hasil refactoring v1.6: konfigurasi penomoran yang sepenuhnya berbasis konfigurasi (configuration-driven), menggantikan konsep "Arah (dengan mapping)" yang kaku.

## 1. Konsep Inti

### 1.1 Dropdown generik menggantikan "Arah"
Sebelum v1.6, komponen `direction` pada DSL penomoran di-hardcode untuk dua nilai (`INTERNAL`/`EXTERNAL`) dengan mapping kode tetap. Sejak v1.6:

- Tidak ada lagi field khusus bernama "Arah (dengan mapping)".
- Yang ada adalah tipe komponen umum **Dropdown** yang dapat ditambahkan satu atau lebih secara independen dalam satu profil.
- Setiap Dropdown dikonfigurasi melalui builder UI — tanpa menyentuh source code.

### 1.2 Label visual vs kode nomor
Operator memilih **label** yang mudah dipahami ("Internal"); numbering engine memakai **kode** yang sudah dipetakan ("A"). Contoh preset YAPSI:

```
Template : {SEQ:3}/{arah_surat}/{JENIS}/YAPSI-DS/{TGL_SURAT:MONTH_ROMAN}/{TGL_SURAT:YEAR_4}
Contoh   : 067/A/SPR/YAPSI-DS/X/2026
```

### 1.3 Mapping tidak pernah di-hardcode
Sistem tidak melakukan pencocokan berdasarkan nama field, label, atau nilai tertentu. Semua resolusi label→kode murni dari konfigurasi yang tersimpan pada profil. Satu-satunya pengecualian adalah **konverter migrasi v1→v2** (lihat §5) yang menerjemahkan format simpan lama — bukan semantik bisnis.

## 2. Struktur Data (DSL v2)

Konfigurasi tersimpan sebagai JSON tervalidasi (zod) pada `NumberingProfileVersion.dsl`:

```jsonc
{
  "version": 2,
  "separator": "/",
  "fields": [                          // definisi Dropdown (formulir)
    {
      "type": "dropdown",
      "key": "arah_surat",             // identifier stabil, snake_case, unik
      "label": "Arah Surat",           // label tampilan operator
      "placeholder": "Pilih arah",
      "helperText": null,
      "options": [
        { "id": "internal",  "label": "Internal",  "code": "A", "active": true },
        { "id": "eksternal", "label": "Eksternal", "code": "B", "active": true }
      ],
      "defaultOptionId": null,         // opsional
      "required": true,                // wajib/opsional
      "order": 0                       // urutan tampilan formulir
    }
  ],
  "components": [                      // template nomor (kiri → kanan)
    { "type": "sequence", "padding": 3 },
    { "type": "fieldRef", "field": "arah_surat" },   // merujuk fields[].key
    { "type": "letterTypeCode" },
    { "type": "literal", "value": "YAPSI-DS" },
    { "type": "letterDate", "format": "MONTH_ROMAN" },
    { "type": "letterDate", "format": "YEAR_4" }
  ],
  "policy": {                          // saran kebijakan counter (dikonfirmasi saat aktivasi)
    "resetPolicy": "ALL",
    "dateSource": "LETTER_DATE"
  }
}
```

Prinsip penting:
- **Identifier stabil terpisah dari label dan kode.** Mengubah label/kode tidak memutus referensi (fieldRef memakai `key`; histori memakai snapshot).
- **Dropdown bisa masuk nomor atau hanya metadata.** Field yang dirujuk `fieldRef` ikut nomor; field tanpa referensi hanya dikumpulkan sebagai data surat.
- **Opsi dapat dinonaktifkan** (`active: false`) — tersembunyi dari pilihan baru, tetapi histori tetap terbaca lewat snapshot.

## 3. Aturan Validasi (FE + BE)

Ditolak sebagai **error** (profil tidak bisa disimpan/diaktifkan):
- Label atau kode kosong.
- Kunci variabel duplikat antar-Dropdown dalam satu profil, atau tidak snake_case (2–32 karakter).
- Identifier opsi duplikat dalam satu Dropdown.
- Kode mengandung karakter terlarang: spasi, `/`, `-`, `.` ( Ambigu terhadap separator).
- `defaultOptionId` menunjuk opsi yang tidak ada / tidak aktif.
- `fieldRef` merujuk field yang tidak didefinisikan.
- Jumlah komponen sequence ≠ 1.

Ditandai sebagai **warning** (tetap bisa aktif, dengan penjelasan):
- Kode sama untuk beberapa opsi dalam satu Dropdown (nomor tetap unik lewat urutan — segmen tidak membedakan).
- Dropdown opsional dipakai dalam nomor tanpa default (penerbitan gagal bila operator tidak memilih).
- Dropdown hanya metadata (kode tidak masuk nomor).

## 4. Alur Penerbitan (Integritas)

1. Operator mengisi formulir dinamis — field dirender dari profil aktif (`GET /api/letters/preview` mengembalikan `fields`).
2. Draft menyimpan pilihan sebagai `Letter.fieldValues` (JSON `{ fieldKey: optionId }`), divalidasi dini terhadap profil aktif (opsi harus dikenal & aktif).
3. Saat **terbit**, `issueLetter` melakukan **re-validasi** terhadap versi profil AKTIF saat itu (E.5): opsi harus ada dan aktif pada versi terkait; field wajib harus terisi (E.4).
4. Nomor dirender; counter atomik dan cek keunikan registry tetap berjalan (E.9) — perubahan mapping tidak pernah mengubah kebijakan counter.
5. **Snapshot** penerbitan menyimpan label, pilihan, kode, dan versi mapping (E.7) pada `numberSnapshot.inputs.fieldValues` — mengubah konfigurasi Dropdown di kemudian hari tidak mengubah tampilan surat historis (E.8).

## 5. Migrasi v1 → v2 (E.10)

- **Baca transparan**: `parseDsl()` di `src/lib/numbering/dsl.ts` otomatis meng-upgrade DSL v1 menjadi v2 di memori. Kode keluaran dijamin identik (INTERNAL→mapping.INTERNAL) sehingga render nomor historis 100% kompatibel.
- **Draft tertulis**: skrip `scripts/migrate-dsl-v2.mjs` menulis ulang versi DRAFT ke format v2 (`--dry-run` tersedia). Versi ACTIVE/RETIRED tidak diubah (immutable).
- **Draft lama ber-direction**: opsi hasil migrasi membawa `legacyKey`; penerbitan draft v1 lama tetap berhasil tanpa kehilangan nilai.
- Kolom `Letter.direction` dipertahankan sebagai **legacy beku** untuk surat lama dan hasil import; surat baru memakai `fieldValues`.

## 6. Builder UI (Profil Nomor)

Halaman *Profil Baru / Edit Draft / Versi Baru* kini builder halaman penuh dua kolom (desktop): editor di kiri, live preview di kanan; satu kolom di layar kecil. Bagian:

1. **Identitas Profil** — nama, unit/kepanitiaan, prioritas resolusi (profil panitia > profil unit), status.
2. **Builder Komponen Nomor** — daftar komponen yang dapat diurutkan ulang (↑↓), dikonfigurasi, diduplikasi, dihapus dengan aman terhadap dependensi; tombol "+ komponen" untuk Sequence, Dropdown, Teks Statis, Kode Unit/Jenis/Panitia, tanggal; editor Dropdown memisahkan label visual dan kode nomor; daftar terpisah untuk field metadata.
3. **Pengaturan Penomoran** — separator, padding, saran kebijakan counter (dikonfirmasi eksplisit saat aktivasi — mengubah Dropdown tidak pernah menyentuh counter).
4. **Preview & Validasi** — pratinjau real-time dengan nilai contoh (memilih opsi lain langsung mengubah nomor); urutan menempel hanya pada nomor resmi saat terbit (preview tidak pernah mengalokasikan nomor).
5. **Simpan & Aktivasi** — simpan draft terpisah dari aktivasi; aktivasi hanya terbuka bila validasi lolos dan draft tersimpan.

## 7. Hak Akses

Menu *Profil Nomor* tetap **khusus pusat** (`profile.manage`: SYSTEM_ADMIN/ORG_ADMIN) sejak v1.5 — admin unit ke bawah tidak melihat menu dan ditolak API-nya. Operator hanya berinteraksi dengan hasil konfigurasi (formulir dinamis + preview).
