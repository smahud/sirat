// Dokumentasi role detail (master prompt lanjutan A.3/A.8).
// Sumber tunggal untuk label + penjelasan role — dipakai UI (panel bantuan,
// form pengguna) dan dokumentasi teknis. Role = profil kewenangan dasar;
// permission efektif = role + assignment scope (lihat rbac.ts).
import { Role } from '@/lib/constants'

export interface RoleDoc {
  label: string
  /** Deskripsi & tujuan role. */
  description: string
  /** Fungsi utama sehari-hari. */
  functions: string[]
  /** Ringkasan lingkup kewenangan. */
  scopeSummary: string
  /** Permission yang TIDAK dimiliki secara otomatis. */
  notGranted: string[]
  /** Hubungan dengan unit/departemen. */
  unitRelation: string
  /** Hubungan dengan kepanitiaan. */
  committeeRelation: string
  /** Batasan pemberian hak akses (delegasi). */
  delegationLimit: string
  /** Contoh skenario penugasan. */
  examples: string[]
}

export const ROLE_DOCS: Record<Role, RoleDoc> = {
  SYSTEM_ADMIN: {
    label: 'Super Admin (Administrator Sistem)',
    description:
      'Pengelola sistem tingkat tertinggi. Memiliki seluruh permission secara global dan bertanggung jawab atas konfigurasi, master data, pengguna, serta tindakan berisiko tinggi seperti Full System Backup dan Full System Restore.',
    functions: [
      'Mengelola konfigurasi sistem dan identitas aplikasi',
      'Mengelola seluruh Unit/Departemen dan kepanitiaan',
      'Mengelola seluruh pengguna, role, assignment, dan hak backup (grant)',
      'Mengelola seluruh jenis surat dan profil penomoran',
      'Melakukan Full System Backup dan Full System Restore',
      'Mengelola storage, import Excel, dan audit trail',
    ],
    scopeSummary:
      'Global — seluruh unit dan kepanitiaan, tanpa batasan scope. Tindakan berisiko tinggi (restore, perubahan kewenangan) tetap melalui konfirmasi dan re-autentikasi.',
    notGranted: [
      'Tidak ada permission yang tidak dimiliki; namun tindakan restore tetap memerlukan konfirmasi kuat + password ulang',
    ],
    unitRelation: 'Melihat dan mengelola semua unit/departemen.',
    committeeRelation: 'Melihat dan mengelola semua kepanitiaan di semua unit.',
    delegationLimit:
      'Dapat memberikan role apa pun dan hak backup per scope. Memberikan role ke pengguna lain tetap tercatat di audit trail.',
    examples: [
      'Admin yayasan yang memelihara sistem dan menunjuk admin unit',
      'Melakukan backup penuh sebelum pemeliharaan server',
    ],
  },
  ORG_ADMIN: {
    label: 'Admin Organisasi',
    description:
      'Otoritas organisasi (yayasan) dengan wewenang global untuk melihat data dan mengelola master data, namun TIDAK dapat melakukan restore dan tidak dapat membuat Super Admin.',
    functions: [
      'Mengelola unit, kepanitiaan, jenis surat, profil penomoran, pengguna',
      'Membuat Full System Backup (arsip sensitif terenkripsi)',
      'Melihat audit trail dan seluruh surat',
      'Import Excel dan export data',
    ],
    scopeSummary:
      'Global untuk pembacaan dan pengelolaan master data; tidak dapat melakukan restore (baik full maupun scoped) karena restore berisiko menimpa data.',
    notGranted: [
      'backup.restore — tidak dapat menjalankan restore',
      'Tidak dapat membuat/mengubah pengguna dengan permission di atasnya (Super Admin)',
    ],
    unitRelation: 'Melihat dan mengelola semua unit/departemen.',
    committeeRelation: 'Melihat dan mengelola semua kepanitiaan.',
    delegationLimit:
      'Dapat memberikan role yang permission-nya subset miliknya (tidak termasuk Super Admin).',
    examples: [
      'Sekretaris yayasan yang mengawasi seluruh persuratan lembaga',
    ],
  },
  UNIT_ADMIN: {
    label: 'Admin Unit / Departemen',
    description:
      'Pengelola administrasi pada unit/departemen yang secara eksplisit ditugaskan kepadanya (bisa lebih dari satu unit). Wewenangnya terbatas pada scope unit tersebut.',
    functions: [
      'Mengelola kepanitiaan di bawah unit yang dikelolanya',
      'Mengelola pengguna & assignment pada unitnya (subset permission)',
      'Membuat, menerbitkan, dan membatalkan surat pada unitnya',
      'Import data dan export data unitnya (target import dibatasi unit yang dikelolanya)',
    ],
    scopeSummary:
      'Hanya unit yang ditugaskan. Tidak otomatis global, tidak otomatis mengelola unit lain, dan tidak otomatis melihat audit trail global.',
    notGranted: [
      'unit.manage — tidak dapat membuat/mengubah unit (hanya Super Admin/Org Admin)',
      'profile.manage — profil penomoran adalah kebijakan pusat; menu Profil Nomor tidak muncul untuk Admin Unit ke bawah',
      'audit.view — trail global tidak bisa dibatasi per scope',
      'storage.manage — pengelolaan storage bersifat global',
      'backup.export / backup.restore — TIDAK otomatis; harus diberikan eksplisit per unit/kepanitiaan lewat Hak Akses Backup',
      'Tidak otomatis dapat membuat/restore backup hanya karena menjadi admin unit',
    ],
    unitRelation:
      'Hanya unit pada assignment-nya. Menjadi admin MI tidak otomatis boleh mengelola MTs.',
    committeeRelation:
      'Mengelola kepanitiaan di bawah unitnya. Dapat diberi akses surat kepanitiaan eksplisit (flag “termasuk kepanitiaan” pada assignment).',
    delegationLimit:
      'Hanya dapat membuat/mengubah pengguna dengan permission subset miliknya, dan hanya untuk assignment di scope unitnya. Tidak dapat menaikkan role melebihi wewenangnya.',
    examples: [
      'Admin MI saja: mengelola user & surat MI',
      'Admin MI + MTs sekaligus: dua assignment terpisah',
    ],
  },
  COMMITTEE_ADMIN: {
    label: 'Admin Kepanitiaan',
    description:
      'Pengelola administrasi pada kepanitiaan yang ditugaskan. Cocok untuk sekretariat panitia (HUT, panitia acara, dsb.) tanpa membuka akses surat reguler unit induk.',
    functions: [
      'Mengelola pengguna & assignment untuk kepanitiaannya',
      'Membuat, menerbitkan, dan membatalkan surat kepanitiaannya',
    ],
    scopeSummary:
      'Hanya kepanitiaan yang ditugaskan. Tidak dapat mengelola unit induk dan tidak otomatis mengakses kepanitiaan lain.',
    notGranted: [
      'unit.manage dan pengelolaan unit induk',
      'profile.manage — profil penomoran dikelola pusat; menu Profil Nomor tidak muncul',
      'audit.view, storage.manage',
      'backup.export / backup.restore — harus diberikan eksplisit per kepanitiaan',
    ],
    unitRelation:
      'Hanya sebagai konteks penerbitan surat kepanitiaan (unit parent dari panitia), bukan akses surat reguler unit.',
    committeeRelation:
      'Hanya kepanitiaan pada assignment-nya; Panitia A tidak otomatis mengakses Panitia B.',
    delegationLimit:
      'Hanya dapat menugaskan kepanitiaan yang dikelolanya, dengan permission subset miliknya.',
    examples: [
      'Sekretaris Panitia HUT RI: hanya surat panitia HUT',
      'Ketua panitia audit kegiatan: hanya surat panitia audit',
    ],
  },
  OPERATOR: {
    label: 'Operator / Petugas',
    description:
      'Pengguna operasional yang melaksanakan tugas sesuai penugasan: membuat draft, menerbitkan, dan mengunggah arsip surat pada scope yang diizinkan.',
    functions: [
      'Membuat draft surat dan menerbitkan nomor pada scope-nya',
      'Mengunggah/mengunduh arsip berkas surat',
      'Melihat surat pada scope-nya',
    ],
    scopeSummary:
      'Sesuai assignment unit/kepanitiaan; izin per tindakan tetap diperiksa per konteks surat (unit vs kepanitiaan).',
    notGranted: [
      'user.manage, lettertype.manage, profile.manage, committee.manage',
      'letter.cancel (pembatalan surat terbit memerlukan Admin Unit ke atas)',
      'import.manage, export.run, audit.view',
      'backup.export / backup.restore',
    ],
    unitRelation:
      'Bisa ditugaskan di beberapa unit sekaligus dengan izin berbeda per unit.',
    committeeRelation:
      'Bisa ditugaskan sebagai sekretaris/petugas panitia; jabatan itu atribut penugasan, bukan role sistem.',
    delegationLimit: 'Tidak dapat mengelola pengguna sama sekali.',
    examples: [
      'Operator MI: membuat & menerbitkan surat MI',
      'Sekretaris Panitia A (operator + assignment kepanitiaan): hanya surat Panitia A',
    ],
  },
  VIEWER: {
    label: 'Pengamat',
    description:
      'Akses baca-saja untuk pihak yang perlu memantau persuratan pada scope-nya tanpa dapat mengubah data.',
    functions: [
      'Melihat daftar dan detail surat pada scope-nya',
      'Mengunduh arsip berkas yang dapat dilihatnya',
    ],
    scopeSummary: 'Baca-saja pada scope assignment; tidak ada aksi tulis.',
    notGranted: [
      'Semua aksi tulis (create/issue/cancel/upload/trash)',
      'Manajemen master data dan pengguna',
      'backup.export / backup.restore',
    ],
    unitRelation: 'Sesuai assignment unit.',
    committeeRelation: 'Sesuai assignment kepanitiaan.',
    delegationLimit: 'Tidak dapat mengelola pengguna.',
    examples: [
      'Pimpinan yang memantau arsip surat lembaga',
      'Staf dokumentasi yang hanya perlu membaca',
    ],
  },
  AUDITOR: {
    label: 'Auditor',
    description:
      'Pemeriksa independen dengan akses baca surat seluruh scope dan audit trail, tanpa kemampuan mengubah data apa pun.',
    functions: [
      'Membaca seluruh surat (semua unit/kepanitiaan)',
      'Membaca audit trail lengkap (siapa melakukan apa, kapan)',
    ],
    scopeSummary: 'Baca global untuk keperluan pemeriksaan; tanpa aksi tulis.',
    notGranted: [
      'Semua aksi tulis dan manajemen',
      'backup.export / backup.restore',
    ],
    unitRelation: 'Membaca semua unit.',
    committeeRelation: 'Membaca semua kepanitiaan.',
    delegationLimit: 'Tidak dapat mengelola pengguna.',
    examples: [
      'Auditor internal yayasan memeriksa keterlacakan nomor surat',
    ],
  },
}

/** Ringkasan pendek untuk tooltip/inline. */
export function roleShort(role: string): string {
  const doc = (ROLE_DOCS as Record<string, RoleDoc | undefined>)[role]
  return doc ? doc.label : role
}
