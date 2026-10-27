-- AlterTable
-- v1.4: kategori jenis surat — kelompok navigasi default config
-- (Kebijakan & Keputusan / Tugas & Penugasan / Komunikasi & Koordinasi /
--  Administrasi & Layanan / Pertanggungjawaban & Dokumentasi)
ALTER TABLE "LetterType" ADD COLUMN     "category" TEXT;
