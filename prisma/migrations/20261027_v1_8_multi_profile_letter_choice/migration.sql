-- v1.8: Multi-profil penomoran + pilihan profil eksplisit per surat.
--
-- Latar: satu organisasi dapat memiliki beberapa profil surat resmi yang
-- membedakan cara penggunaannya (mis. profil "surat dinas biasa" vs "surat
-- kepanitiaan"). Sebelumnya sistem memaksakan satu profil per unit/kepanitiaan
-- (unique committeeId + cek duplikat di POST /api/numbering-profiles +
-- aktivasi memensiunkan semua versi aktif se-konteks).
--
-- Perubahan:
-- 1) Unique committeeId pada NumberingProfile dihapus — kepanitiaan (dan unit)
--    boleh memiliki lebih dari satu profil; masing-masing profil memlihara
--    paling banyak SATU versi ACTIVE.
-- 2) Letter.numberingProfileId — profil yang dipilih operator saat membuat
--    draft. Saat terbit, versi ACTIVE profil itulah yang dipakai; surat lama
--    (null) tetap memakai resolusi lama (profil kepanitiaan → profil unit).

-- DropIndex
DROP INDEX "NumberingProfile_committeeId_key";

-- AlterTable
ALTER TABLE "Letter" ADD COLUMN "numberingProfileId" TEXT;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_numberingProfileId_fkey" FOREIGN KEY ("numberingProfileId") REFERENCES "NumberingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
