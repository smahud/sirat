-- AlterTable
-- v1.5: relasi ImportBatch → Unit target import (riwayat import per unit).
-- Kolom targetUnitId sudah ada sejak awal (selalu NULL di v1.2-v1.4);
-- kini diisi saat commit dan di-join untuk riwayat. Data lama aman (NULL lolos FK).
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_targetUnitId_fkey" FOREIGN KEY ("targetUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
