-- AlterTable
-- v1.6: Dynamic Numbering Profile Builder.
-- Letter.fieldValues: JSON { [fieldKey]: optionId } — pilihan Dropdown operator
-- pada profil v2. Kolom direction (v1) dipertahankan sebagai LEGACY beku:
-- surat lama/import tetap terbaca, surat baru memakai fieldValues.
-- Konfigurasi Dropdown tersimpan terstruktur di NumberingProfileVersion.dsl
-- (DSL JSON v2) — tidak ada tabel baru, tidak ada data produksi diubah.
ALTER TABLE "Letter" ADD COLUMN "fieldValues" TEXT;
