# SIRAT — Role, Permission, dan Assignment Scope

> Dokumentasi wajib master prompt lanjutan **M.1**. Menggambarkan implementasi aktual
> (bukan teori): `src/lib/rbac.ts` (permission & scope), `src/lib/role-docs.ts`
> (dokumentasi role yang juga tampil di UI Pengguna), `prisma/schema.prisma` (model data).

## 1. Model otorisasi

```
USER → ROLE → ASSIGNMENT SCOPE → PERMISSION → RESOURCE → ACTION
```

Tiga lapis yang TIDAK saling menggantikan:

| Lapis | Arti | Disimpan di |
|---|---|---|
| **Role** | Profil kewenangan dasar (7 role, lihat §2) | `User.role` |
| **Assignment scope** | Ruang lingkup: unit / kepanitiaan mana | `AccessAssignment` (unitId / committeeId / includeCommittees) |
| **Permission** | Tindakan apa yang diizinkan | `ROLE_PERMISSIONS` (role→permission) + `BackupGrant` (backup per scope) |

Prinsip yang dipatok di kode (deny by default):

1. **Assignment ≠ permission.** Ditugaskan di unit MI tidak otomatis boleh membuat surat MI bila role tidak memiliki `letter.create`; tidak otomatis membuka MTs; tidak otomatis membuka kepanitiaan mana pun.
2. **Permission ≠ role.** Nama role tidak dipakai untuk cek akses data; setiap endpoint memanggil `requirePermission(perm)` + pemeriksaan scope per request.
3. **Role tidak membuka seluruh scope otomatis.** Hanya 3 role global (SYSTEM_ADMIN, ORG_ADMIN, AUDITOR) yang lolos filter scope; sisanya difilter per assignment.
4. **Kepanitiaan tidak mewarisi akses unit.** Surat kepanitiaan WAJIB akses committee (assignment langsung atau `includeCommittees=true` pada assignment unit — intervensi eksplisit, dapat dicabut).
5. **Unit tidak mewarisi akses kepanitiaan.** Admin MI tidak otomatis melihat surat panitia di bawah MI kecuali flag eksplisit.
6. **Pencabutan langsung efektif.** Scope & permission di-resolve **per request** dari DB (`resolveScope`, `resolveBackupCapabilities`) — JWT hanya membawa identitas, bukan kewenangan. Menonaktifkan user langsung memutus sesi di `/api/auth/me`.

## 2. Daftar role final

Tujuh role dipertahankan (master prompt lanjutan A.2: penyederhanaan bersifat rekomendasi; struktur existing sudah benar dan tiap role punya fungsi bisnis unik). Dokumentasi lengkap per role — deskripsi, fungsi, lingkup, yang tidak otomatis dimiliki, hubungan unit/kepanitiaan, batas delegasi, contoh — tersedia **langsung di UI** (menu Pengguna → *Panduan Role & Hak Akses*) bersumber dari `src/lib/role-docs.ts`.

| Role | Label UI | Scope | Inti kewenangan |
|---|---|---|---|
| `SYSTEM_ADMIN` | Administrator Sistem (Super Admin) | Global | Semua permission (`*`), termasuk Full Backup & **Full Restore** |
| `ORG_ADMIN` | Admin Organisasi | Global | Master data + Full Backup; **tanpa** restore |
| `UNIT_ADMIN` | Admin Unit / Departemen | Unit yang di-assign | Kelola user/panitia di unitnya; surat unitnya; **profil penomoran dikelola pusat sejak v1.5** |
| `COMMITTEE_ADMIN` | Admin Kepanitiaan | Panitia yang di-assign | Kelola user panitianya; surat panitianya |
| `OPERATOR` | Operator / Petugas | Sesuai assignment | Buat/terbit surat, unggah arsip |
| `VIEWER` | Pengamat | Sesuai assignment | Baca-saja + unduh arsip |
| `AUDITOR` | Auditor | Global (baca) | Baca semua surat + audit trail |

### 2.1 Yang TIDAK otomatis dimiliki Admin Unit (anti-asumsi)

- `unit.manage` — membuat/mengubah unit hanya Super Admin/Org Admin.
- `profile.manage` — **sejak v1.5 profil penomoran dikelola pusat** (kebijakan organisasi). Menu *Profil Nomor* tidak muncul untuk Admin Unit ke bawah; `GET /api/numbering-profiles` menolak 403.
- `audit.view` — AuditEvent tidak ber-scope; menampilkannya ke admin unit = kebocoran lintas scope.
- `storage.manage` — storage bersifat global.
- `backup.export` / `backup.restore` — **dua permission terpisah**, tidak otomatis untuk role apa pun selain otoritas global; diberikan per scope lewat **Hak Akses Backup** (BackupGrant).
- Memberikan permission melebihi miliknya (cek subset di POST/PATCH `/api/users` → `ESCALATION`).

### 2.2 Contoh kasus lintas scope

| Kasus | Hasil |
|---|---|
| Admin MI membuat user dengan assignment MTs | **403 SCOPE** — hanya boleh menugaskan unit yang dikelolanya |
| Sekretaris Panitia A (operator + assignment panitia) membuat surat reguler MI | **403** — akses committee ≠ akses unit |
| Sekretaris Panitia A membuat surat Panitia B | **403** — assignment panitia tidak menyentuh panitia lain |
| Operator MI dengan `includeCommittees=false` membuat surat panitia MI | **403** — wajib flag eksplisit |
| VIEWER mengedit metadata surat via PATCH | **403** — `letter.create`/`letter.cancel` tidak dimiliki VIEWER |
| Admin MI memberi role ORG_ADMIN ke user baru | **403 ESCALATION** — bukan subset permissionnya |
| Admin MI meng-import surat ke unit MTs (API langsung) | **403 FORBIDDEN** — target import divalidasi `canManageUnit` di backend (v1.5) |
| Admin MI membuka menu/API Profil Nomor | **403 + menu tersembunyi** — `profile.manage` hanya pusat (v1.5) |

## 3. Permission efektif

```
hasPermission(user, perm)  → f(role)                    — profil dasar
canAccessUnit(user, id)    → f(assignment unit | role global)
canAccessCommittee(user,c) → f(assignment committee | includeCommittees | global)
letterScopeFilter(user)    → filter prisma untuk daftar surat yang terlihat
resolveBackupCapabilities  → f(role global) ∪ BackupGrant per scope
```

Setiap aksi data mempertimbangkan: status akun (`isActive`, dicek per request di `/api/auth/me` dan saat mutasi), role, assignment scope, permission tindakan, serta status/kepemilikan sumber daya (mis. PATCH surat: DRAFT→`letter.create`, TERBIT→`letter.cancel`).

## 4. Manajemen permission & delegasi (A.7)

- **Pembuatan/ubah user** (`/api/users`): target role wajib subset permission actor (kecuali actor Super Admin); assignment wajib dalam scope actor (`assertAssignmentsInScope`). Tidak ada jalur memberi diri sendiri permission (ubah user sendiri tetap lewat pemeriksaan subset).
- **Hak backup** (`/api/backup/grants`): hanya pemberi dengan permission global `backup.export` (Super Admin/Org Admin). Admin Unit **tidak bisa** memberi grant — mencegah "memberi diri izin restore". Revoke = hapus baris grant → langsung efektif.
- Semua pemberian/pencabutan tercatat di audit trail (`backup.grant.upsert` / `backup.grant.revoke` / `user.update`).

## 5. Matriks role–permission–scope

Lihat **PERMISSION-MATRIX.md** (tabel lengkap termasuk `backup.export`/`backup.restore`).
Aturan baca: ✅ role global berlaku semua scope; ✅* hanya scope assignment; BackupGrant kolom terpisah karena bukan bagian role.

## 6. Antarmuka manajemen (A.8)

Menu **Pengguna & Akses**:
- tabel user: username, nama, role, **ringkasan scope** (chip unit/panitia + `+panitia` untuk includeCommittees), status aktif;
- form user: pemilih role dengan **dokumentasi role live** (deskripsi, lingkup, batas delegasi) dan matriks assignment (banyak unit/panitia, flag termasuk-panitia per baris);
- panel **Panduan Role & Hak Akses**: dokumentasi 10-aspek per role (sumber `role-docs.ts`).

Menu **Backup & Restore**: kapabilitas efektif Anda (full + tabel scope dengan kolom Backup/Restore terpisah), pengelolaan grant (untuk otoritas global), riwayat operasi.
