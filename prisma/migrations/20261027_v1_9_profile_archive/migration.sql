-- v1.9: Arsip profil penomoran.
-- Profil yang pernah dipakai (memiliki histori surat) tidak bisa dihapus fisik —
-- saat "dihapus" ia disembunyikan ke arsip (archivedAt terisi) dan bisa dipulihkan.
-- Profil yang belum pernah dipakai tetap boleh dihapus permanen.
ALTER TABLE "NumberingProfile" ADD COLUMN "archivedAt" TIMESTAMP(3);
