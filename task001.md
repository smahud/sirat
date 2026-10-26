# MASTER PROMPT LANJUTAN SIRAT
## Audit Arsitektur, Penyempurnaan Role & Scope, Backup–Restore Terbatas, Master Data, Penomoran Permanen, Referensi Antar-Surat, dan UI/UX

### 0. KONTEKS PEKERJAAN

Anda bertindak sebagai **Senior Full-Stack Engineer, Software Architect, Database Architect, Security Engineer, dan UI/UX Engineer** untuk proyek SIRAT (Sistem Informasi Persuratan).

**PENTING: Prompt pengembangan sebelumnya sudah dieksekusi.**

Repository aplikasi berada di lingkungan lokal yang dapat Anda akses sebagai agent pengembang.

Anda bertugas melakukan audit terhadap hasil implementasi sebelumnya, memperbaiki kekurangan, dan mengembangkan fitur lanjutan berdasarkan seluruh persyaratan di bawah ini.

Jangan mengasumsikan struktur kode, tabel, role, permission, maupun fitur tertentu sebelum benar-benar memeriksa repository.

Prinsip utama:

1. Pertahankan fitur existing yang telah berfungsi dengan benar.
2. Jangan membangun ulang aplikasi tanpa alasan kuat.
3. Utamakan keamanan, integritas database, dan kejelasan kewenangan.
4. Gunakan struktur modular dan hindari duplikasi logika.
5. Gunakan prinsip least privilege dan deny by default.
6. Pastikan perubahan redaksi tidak merusak hubungan database.
7. Pastikan data dan nomor surat yang sudah final tidak berubah.
8. Semua perubahan harus diuji sebelum dinyatakan selesai.
9. Jangan melakukan operasi destruktif terhadap production atau deployment tanpa persetujuan.

**Perhatian khusus:** Audit role, assignment scope, dan permission merupakan prioritas utama. Jangan hanya menambahkan fitur baru di atas model authorization yang belum terverifikasi.

---

# A. AUDIT ULANG ROLE, PERMISSION, DAN ASSIGNMENT SCOPE

## A.1. Tujuan audit

Periksa kembali seluruh konsep autentikasi dan otorisasi yang telah diimplementasikan.

Pastikan sistem benar-benar membedakan:

- Role pengguna.
- Hak akses atau permission.
- Unit/Departemen yang ditugaskan.
- Kepanitiaan yang ditugaskan.
- Scope sumber daya yang dapat diakses.
- Kewenangan melihat, membuat, mengedit, menyetujui, membatalkan, menghapus, melakukan backup, dan melakukan restore.

Jangan menganggap pengguna memiliki kewenangan tertentu hanya karena nama role, nama jabatan, atau karena berada di unit induk dari suatu kepanitiaan.

**Assignment bukan permission. Permission bukan role. Dan role tidak boleh otomatis membuka seluruh scope.**

Audit harus mencakup skema database, authorization middleware, endpoint API, session/JWT, service layer, query filter, dan seluruh conditional rendering di frontend.

## A.2. Penyederhanaan role

Apabila role existing terlalu banyak, memiliki fungsi tumpang tindih, atau membuat pengguna bingung, sederhanakan dengan tetap menjaga seluruh kebutuhan kewenangan.

Sebagai referensi, prioritaskan tiga kelompok role utama:

### 1. Super Admin

Merupakan pengelola sistem tingkat tertinggi.

Kewenangan utama:
- Mengelola konfigurasi sistem.
- Mengelola seluruh Unit/Departemen dan kepanitiaan.
- Mengelola seluruh pengguna, role, assignment, dan permission.
- Mengelola seluruh jenis surat.
- Melakukan backup dan restore keseluruhan sistem.
- Melakukan backup dan restore berdasarkan unit tertentu jika diperlukan.
- Mengakses fungsi administrasi global yang memang menjadi tanggung jawab Super Admin.

Hak administratif Super Admin harus tetap memiliki perlindungan untuk tindakan berisiko tinggi, seperti restore database dan perubahan kewenangan.

### 2. Admin Unit / Pengelola Unit

Merupakan pengguna yang diberi tanggung jawab administrasi pada satu atau lebih Unit/Departemen.

Contoh:
- Admin MI saja.
- Admin MTs saja.
- Admin MI dan MTs sekaligus.

Kewenangan tidak boleh otomatis global.

Admin Unit hanya dapat mengelola pengguna, surat, kepanitiaan, backup/restore, dan sumber daya lain pada scope yang secara eksplisit diberikan kepadanya, serta hanya untuk tindakan yang diizinkan.

Memegang role Admin Unit tidak otomatis berarti:
- Berhak melakukan restore.
- Berhak melakukan backup.
- Berhak mengakses semua kepanitiaan.
- Berhak mengubah permission milik pengguna lain.
- Berhak mengelola unit lain.

Hak-hak tersebut tetap harus dievaluasi berdasarkan permission dan assignment scope.

### 3. Operator / Petugas

Merupakan pengguna operasional yang melaksanakan tugas sesuai penugasan.

Contoh:
- Operator persuratan Unit MI.
- Sekretaris Panitia A.
- Sekretaris Panitia B.
- Petugas dengan penugasan pada lebih dari satu unit atau kepanitiaan.

Istilah sekretaris, petugas, atau anggota kepanitiaan tidak harus dijadikan role sistem baru.

Jabatan tersebut dapat menjadi atribut penugasan, sedangkan kewenangan aktual ditentukan oleh permission.

Pengguna dengan role Operator dapat memiliki satu atau beberapa assignment scope dengan permission yang berbeda.

Contoh:
- Membuat surat Unit MI.
- Hanya melihat surat Unit MTs.
- Membuat surat Panitia A.
- Tidak memiliki izin terhadap Panitia B.

Jika aplikasi memerlukan akses baca-saja, gunakan permission read/view pada role yang sesuai. Tidak perlu membuat role tambahan apabila fungsi yang sama dapat direpresentasikan secara sederhana.

**Tiga kelompok role tersebut merupakan rekomendasi awal, bukan kewajiban migrasi.**

Jika struktur existing lebih sederhana dan sudah benar, pertahankan. Jika terdapat role tambahan yang memiliki fungsi bisnis unik, dokumentasikan dan pertahankan seperlunya.

Jangan melakukan pengurangan role yang menyebabkan hilangnya kewenangan bisnis yang sah.

## A.3. Dokumentasi role wajib detail

Buat penjelasan detail mengenai seluruh role yang benar-benar digunakan sistem.

Penjelasan harus tersedia dalam dokumentasi teknis dan, jika relevan, pada halaman pengelolaan pengguna/role melalui teks bantuan atau panel informasi.

Setiap role harus mempunyai informasi:

1. Nama role.
2. Deskripsi dan tujuan role.
3. Fungsi utama.
4. Lingkup kewenangan.
5. Permission yang dapat diberikan.
6. Permission yang tidak dimiliki secara otomatis.
7. Hubungan dengan Unit/Departemen.
8. Hubungan dengan kepanitiaan.
9. Batasan pemberian hak akses.
10. Contoh penggunaan atau skenario penugasan.

Jangan hanya menampilkan istilah seperti `ADMIN_UNIT`, `OPERATOR`, atau `SUPER_ADMIN` tanpa penjelasan yang mudah dipahami.

Bedakan dengan jelas antara **role sebagai profil kewenangan dasar** dan **permission efektif yang diberikan pada scope tertentu**.

## A.4. Model assignment scope

Audit apakah sistem mendukung pengguna dengan beberapa assignment sekaligus.

Contoh:

Pengguna A:
- Unit MI: izin membuat dan melihat surat.
- Unit MTs: izin melihat surat.
- Panitia A: izin membuat surat panitia.
- Panitia B: tidak ada akses.

Pengguna B:
- Unit KB-RA: izin melihat dan membuat surat.
- Tidak memiliki assignment lain.

Pastikan assignment tidak disimpan dalam bentuk yang menyebabkan satu pengguna secara otomatis mewarisi seluruh kewenangan dari unit atau kepanitiaan lain.

Model konseptual yang dapat digunakan:

`user + role + scope_type + scope_id + permissions`

Ini hanya referensi desain. Gunakan struktur existing apabila mampu memenuhi kebutuhan dengan aman dan efisien.

## A.5. Evaluasi permission efektif

Setiap tindakan terhadap sumber daya harus mempertimbangkan:

- Status akun pengguna.
- Role pengguna.
- Assignment scope.
- Permission tindakan.
- Status dan kepemilikan sumber daya.
- Batasan workflow yang berlaku.

Contoh:

Pengguna memiliki assignment MI tetapi tidak memiliki `letters.create` untuk MI.

Hasil: pengguna tidak boleh membuat surat MI.

Pengguna memiliki `letters.create` untuk Panitia A, tetapi tidak untuk Panitia B.

Hasil: pengguna tidak boleh membuat surat Panitia B.

Pengguna memiliki hak melihat surat MI, tetapi tidak memiliki izin backup MI.

Hasil: pengguna tidak boleh mengunduh backup MI.

Jangan menggunakan satu boolean permission global yang mengabaikan `scope_id`.

## A.6. Unit dan kepanitiaan tidak boleh mewariskan akses secara otomatis

Kepanitiaan dapat berkaitan secara organisatoris dengan unit tertentu.

Namun, hubungan organisatoris tidak otomatis menjadi pewarisan hak akses.

Contoh:

Unit MI mempunyai:
- Panitia A.
- Panitia B.

Sekretaris Panitia A tidak otomatis memperoleh akses ke:
- Surat internal MI.
- Panitia B.

Admin Unit MI juga tidak otomatis mendapatkan seluruh kewenangan operasional pada Panitia A dan B, kecuali aturan permission memang memberikan izin spesifik tersebut.

Jika diperlukan kemampuan intervensi unit terhadap kepanitiaan, berikan izin eksplisit dengan scope kepanitiaan yang tepat.

## A.7. Pengelolaan permission dan delegasi

Pastikan pengelola unit yang diberikan izin administrasi dapat membuat atau menugaskan pengguna hanya dalam kewenangannya.

Tidak boleh terjadi privilege escalation.

Contoh:

Admin MI memiliki izin mengelola pengguna MI, tetapi tidak berhak memberikan permission Super Admin.

Admin MI yang tidak memiliki izin restore MI tidak boleh dapat memberikan sendiri permission restore MI melalui form edit pengguna.

Pemberian permission harus diperiksa pada backend berdasarkan kewenangan pemberi.

Pastikan terdapat mekanisme pencabutan permission yang langsung efektif, termasuk terhadap sesi pengguna yang masih aktif sesuai strategi session invalidation sistem.

## A.8. Antarmuka manajemen role dan scope

Audit menu Pengguna & Akses.

Pastikan UI menjelaskan:

- Role yang dipilih.
- Unit/Departemen yang ditugaskan.
- Kepanitiaan yang ditugaskan.
- Permission pada masing-masing scope.
- Ringkasan hak akses efektif pengguna.

Jangan menampilkan satu daftar permission global apabila permission sebenarnya memiliki scope yang berbeda.

Pengguna dengan beberapa unit harus dapat memiliki permission berbeda per unit.

Jika diperlukan, gunakan tabel atau matriks assignment yang mudah dipahami.

---

# B. BACKUP & RESTORE BERBASIS ROLE, PERMISSION, DAN SCOPE

## B.1. Prinsip baru

**Menu Backup & Restore tidak eksklusif untuk Super Admin.**

Fitur tersebut juga dapat diberikan kepada pengguna lain yang memiliki role, permission, dan assignment scope yang sesuai.

Namun, akses backup dan restore harus dibedakan secara eksplisit.

Minimal terdapat dua permission berbeda:

- `backup.export`
- `backup.restore`

Nama teknis menyesuaikan standar proyek.

Jangan menganggap pengguna yang dapat melakukan backup otomatis berhak melakukan restore.

Jangan menganggap Admin Unit otomatis mendapatkan kedua permission tersebut.

## B.2. Jenis backup

Sistem harus mendukung dua kategori backup.

### 1. Full System Backup

Hanya untuk Super Admin atau otoritas sistem global yang secara eksplisit ditetapkan.

Mencakup seluruh data persisten aplikasi, termasuk:
- Pengguna.
- Username dan identitas pengguna.
- Password hash dan metadata autentikasi yang diperlukan.
- Role, permission, assignment.
- Unit dan kepanitiaan.
- Jenis surat.
- Surat dan nomor final.
- Draft.
- Surat batal.
- Referensi antar-surat.
- Audit dan histori.
- Lampiran.
- Data dan konfigurasi persisten lain yang diperlukan.

Backup sistem harus dapat digunakan untuk pemulihan sistem secara menyeluruh.

### 2. Scoped Backup / Backup Per Unit

Diberikan kepada pengguna yang memiliki permission backup pada unit tertentu.

Contoh:

Pengguna A:
- `backup.export` untuk MI.
- `backup.export` untuk MTs.

Saat membuka menu Backup, pengguna dapat memilih:
- MI.
- MTs.
- MI dan MTs sekaligus, jika sistem mendukung backup multi-unit dalam satu arsip.

Pengguna tidak boleh melihat atau memilih unit lain.

Pengguna B:
- `backup.export` hanya untuk KB-RA.

Saat membuka menu Backup:
- Unit otomatis ditetapkan KB-RA.
- Tidak perlu dropdown pemilihan unit jika hanya ada satu pilihan.
- Unit tidak dapat diubah melalui manipulasi request.

Apabila pengguna tidak memiliki permission backup pada unit mana pun, fungsi backup tidak boleh tersedia.

## B.3. Backup kepanitiaan

Periksa apakah kepanitiaan merupakan scope mandiri di dalam unit.

Jika iya, aturan backup harus menghormati isolasi scope kepanitiaan.

Hak backup untuk unit induk tidak boleh sembarangan mencakup data kepanitiaan yang secara kebijakan tidak boleh diakses pengguna.

Tentukan dan dokumentasikan apakah suatu permission backup mencakup:
- Surat internal unit saja.
- Kepanitiaan tertentu.
- Keseluruhan data unit dan seluruh kepanitiaannya.

Jika diperlukan hak backup seluruh unit beserta seluruh kepanitiaannya, representasikan sebagai izin administratif yang eksplisit, bukan pewarisan diam-diam.

Jangan membocorkan surat atau data kepanitiaan yang tidak termasuk lingkup backup yang sah.

## B.4. Backup seluruh data yang relevan

Untuk Full System Backup, sertakan semua data yang diperlukan untuk pemulihan keseluruhan sistem.

Untuk Scoped Backup, sertakan seluruh data yang berada dalam batas otorisasi backup tersebut dan diperlukan untuk pemulihan data scope secara konsisten.

Perhatikan bahwa akun pengguna, identitas login, dan master data tertentu dapat digunakan bersama oleh beberapa unit.

Karena itu:

- Jangan sembarangan mengekspor password hash pengguna global ke backup unit.
- Jangan memperlakukan akun multi-unit sebagai milik eksklusif satu unit.
- Simpan referensi pengguna serta metadata penugasan yang relevan.
- Sertakan snapshot identitas yang diperlukan untuk pembacaan data historis.
- Data global bersama harus diperlakukan sebagai dependensi yang aman, bukan sebagai data yang bebas ditimpa.
- Jangan sampai backup unit lain ikut terbawa hanya karena memiliki referensi relasi.

**Full backup dan scoped backup harus memiliki format manifest yang membedakan cakupan dan otoritas pemulihannya.**

## B.5. Format backup

Hasil backup berupa ZIP yang dapat diunduh.

Contoh nama:

`SIRAT_FULL_BACKUP_YYYYMMDD_HHMMSS.zip`

`SIRAT_MI_BACKUP_YYYYMMDD_HHMMSS.zip`

`SIRAT_MI-MTS_BACKUP_YYYYMMDD_HHMMSS.zip`

Nama file harus dibentuk secara aman dan tidak mengandalkan input mentah pengguna.

Isi backup mencakup manifest, metadata versi, data/database export, serta file yang relevan.

Terapkan:
- Konsistensi data.
- Checksum/integrity verification.
- Enkripsi terautentikasi yang kuat untuk arsip sensitif.
- Pengelolaan kunci/password yang aman.
- Download terotorisasi.
- Logging tindakan backup.
- Validasi isi backup sebelum pemulihan.

Jangan menempatkan plaintext password atau rahasia lingkungan yang tidak perlu dalam ZIP.

## B.6. Restore berdasarkan scope

**Permission restore harus dievaluasi secara terpisah dari permission backup.**

Contoh:

Pengguna A:
- `backup.restore` untuk MI.
- `backup.restore` untuk MTs.

Pengguna tersebut dapat memilih restore:
- MI saja.
- MTs saja.
- Keduanya jika memang diizinkan dan didukung.

Pengguna B:
- `backup.restore` hanya untuk KB-RA.

Saat melakukan restore:
- Target otomatis ditetapkan KB-RA.
- Tidak boleh restore MI atau MTs.
- Tidak boleh melakukan Full System Restore.
- Tidak boleh mengubah target restore melalui manipulasi API.

Pengguna C:
- `backup.export` untuk MI.
- Tidak memiliki `backup.restore`.

Pengguna C boleh mengunduh backup MI, tetapi tidak boleh menjalankan restore MI.

Jika tidak memiliki permission restore sama sekali, fungsi Restore harus disembunyikan atau dinonaktifkan dan tetap ditolak oleh backend.

## B.7. Full Restore dan Scoped Restore harus berbeda

### Full System Restore
- Khusus otoritas global.
- Memulihkan keseluruhan keadaan sistem.
- Dapat memulihkan data akun dan password hash.
- Memerlukan validasi dan mekanisme recovery menyeluruh.

### Scoped Restore
- Hanya memulihkan data unit atau scope yang diizinkan.
- Tidak boleh menimpa data unit lain.
- Tidak boleh melakukan perubahan terhadap role atau akun global di luar kewenangan.
- Tidak boleh mengubah password pengguna global.
- Tidak boleh memodifikasi jenis surat global atau konfigurasi global secara tidak sah.
- Tidak boleh merusak relasi lintas scope.
- Harus dapat menangani shared references dengan aman.
- Tidak boleh membuat duplikasi nomor final atau mengacaukan sequence penomoran.

Jika sebuah backup memiliki data dari MI dan MTs, sedangkan pengguna hanya berhak restore MI, sistem harus membatasi pemulihan hanya pada MI apabila format dan strategi restore mendukungnya.

Jika tidak dapat dilakukan secara aman, tolak restore dan berikan penjelasan. Jangan melakukan restore parsial secara sembarangan.

## B.8. Pemeriksaan permission file backup

Ketika file ZIP diunggah, jangan mempercayai informasi scope yang berasal dari frontend atau nama file.

Backend wajib membaca dan memvalidasi manifest backup.

Periksa:
1. Tipe backup.
2. Scope sumber.
3. Scope target.
4. Identitas dan versi skema.
5. Hak akses pengguna yang melakukan restore.
6. Kompatibilitas struktur database.
7. Integritas file.
8. Dampak pada data existing.
9. Referensi lintas unit dan kepanitiaan.
10. Kebijakan terhadap data yang sudah final.

Pengguna hanya boleh memulihkan scope yang secara eksplisit diizinkan.

Tidak boleh terdapat privilege escalation melalui upload ZIP yang dimodifikasi.

## B.9. Alur restore yang aman

1. Pengguna membuka Restore.
2. Sistem menampilkan unit yang diizinkan.
3. Jika hanya satu unit, pilih secara otomatis dan kunci target.
4. Pengguna mengunggah ZIP.
5. Sistem memvalidasi file, manifest, dan permission.
6. Sistem menampilkan preview data yang akan dipulihkan.
7. Sistem menjelaskan data yang akan diganti, dipertahankan, atau ditolak.
8. Pengguna melakukan konfirmasi kuat dan autentikasi ulang.
9. Sistem membuat safety backup.
10. Restore dijalankan secara terkendali.
11. Sistem memvalidasi hasilnya.
12. Audit log merekam tindakan dan hasil restore.

Pastikan terdapat perlindungan terhadap:
- ZIP bomb.
- Path traversal.
- Data corruption.
- Restore paralel.
- Incompatible schema.
- Foreign key conflict.
- Privilege escalation.
- Overwrite lintas unit.
- Counter/nomor surat yang tidak konsisten.
- Kegagalan restore di tengah proses.

Gunakan transaksi, staging, dan rollback/recovery yang sesuai dengan teknologi proyek.

Jangan melakukan restore nyata pada production tanpa persetujuan eksplisit.

## B.10. Penjelasan UI Backup & Restore

Menu Backup & Restore harus memberi informasi yang mudah dipahami pengguna.

Minimal jelaskan:
- Perbedaan backup dan restore.
- Perbedaan Full Backup dan Backup Per Unit.
- Unit mana yang boleh dikelola.
- Apa saja yang termasuk dalam backup.
- Risiko restore.
- Apa yang tidak dapat dipulihkan oleh Scoped Restore.
- Waktu, versi, dan identitas backup.

Jangan membuat tampilan yang memunculkan asumsi bahwa pengguna dapat memulihkan semua data hanya karena dia memiliki akses ke satu unit.

---

# C. MASTER DATA UNIT / DEPARTEMEN DAN KEPANITIAAN

## C.1. Penyesuaian redaksi

Ubah label tampilan:

`Unit Permanen`

menjadi:

`Unit / Departemen`

Pastikan redaksi konsisten pada seluruh halaman terkait.

Jangan mengganti nama internal database atau endpoint secara tidak perlu hanya karena perubahan label.

## C.2. Fitur edit

Tambahkan fungsi Edit untuk Unit/Departemen dan kepanitiaan.

Minimal mendukung:
- Nama tampilan.
- Kode tampilan.
- Keterangan.
- Status aktif/nonaktif jika digunakan.

Contoh:

Sebelum:
- Internal ID: 12.
- Kode: KB.
- Nama: Kelompok Bermain.

Sesudah:
- Internal ID: 12.
- Kode: KB-RA.
- Nama: KB-RA Darussalam.

Relasi database harus tetap menggunakan internal ID yang stabil.

## C.3. Relasi internal database

Pastikan nama atau kode tampilan bukan satu-satunya identitas relasional.

Gunakan immutable internal ID, idealnya numeric ID jika sesuai struktur existing.

Perubahan kode tampilan tidak boleh merusak:
- Assignment pengguna.
- Permission.
- Relasi kepanitiaan.
- Surat.
- Nomor final.
- Referensi surat.
- Histori aktivitas.

Jika database existing menggunakan kode teks sebagai foreign key, evaluasi migrasi terkontrol.

Jangan langsung mengubah primary key tanpa pemeriksaan dependensi dan migrasi aman.

## C.4. Opsi hapus

Tambahkan aksi Hapus untuk:
- Unit/Departemen.
- Kepanitiaan.
- Jenis Surat.

Jika suatu entitas belum memiliki dependensi, penghapusan fisik dapat dilakukan dengan otorisasi dan konfirmasi.

Jika sudah digunakan dalam surat, permission, pengguna, atau histori, gunakan mekanisme archive, soft delete, atau status nonaktif.

Jangan melakukan cascade delete terhadap data historis.

Entitas nonaktif tidak boleh dipakai untuk penerbitan baru jika kebijakan tidak mengizinkan, tetapi tetap tersedia untuk membaca histori sesuai permission.

## C.5. Perbaikan layout

Perbaiki ketidaksejajaran kolom:

`Ubah Status`

dan:

`Aksi`

dengan elemen pada baris di bawahnya.

Pastikan header, isi, kontrol status, dan tombol aksi sejajar serta responsif.

Jangan menggunakan posisi absolut atau margin arbitrer sebagai solusi utama.

---

# D. MANAJEMEN JENIS SURAT DAN PENJELASAN DETAIL

## D.1. Menu Jenis Surat

Pastikan tersedia menu **Jenis Surat**.

Master data jenis surat dikelola oleh Super Admin sesuai kebijakan sistem.

Minimal tersedia:
- Tambah.
- Edit.
- Hapus atau Arsipkan.
- Aktifkan/Nonaktifkan.
- Lihat detail.
- Pengelolaan keterangan atau deskripsi jenis surat.

## D.2. Informasi jenis surat harus lengkap

Setiap jenis surat sebaiknya memiliki:

**Identitas**
- Internal ID yang stabil.
- Kode jenis surat.
- Nama jenis surat.

**Penjelasan**
- Deskripsi lengkap jenis surat.
- Fungsi atau tujuan penggunaan.
- Kapan jenis surat digunakan.
- Contoh penggunaan.
- Catatan atau petunjuk tambahan jika relevan.

**Konfigurasi**
- Status aktif/nonaktif.
- Scope penggunaan jika dibatasi.
- Hubungan dengan klasifikasi/kode penomoran jika relevan.
- Pengaturan lain yang sudah tersedia dalam desain existing.

Contoh konseptual:

Nama: Surat Keputusan (SK)

Kode: SK

Deskripsi: Dokumen keputusan resmi yang ditetapkan oleh pihak berwenang dan digunakan untuk menetapkan suatu kebijakan, pengangkatan, penugasan, atau keputusan administratif sesuai kewenangan penerbit.

Contoh penggunaan:
- SK Pengangkatan.
- SK Perpanjangan Jabatan.
- SK Penetapan Panitia.

Contoh tersebut hanya ilustrasi, bukan daftar data yang wajib di-hardcode.

## D.3. Seluruh keterangan harus editable

Super Admin harus dapat mengubah:
- Nama jenis surat.
- Kode tampilan jika diizinkan.
- Deskripsi detail.
- Fungsi.
- Contoh penggunaan.
- Petunjuk tambahan.
- Status dan konfigurasi penggunaan yang diperbolehkan.

Jangan hardcode penjelasan jenis surat langsung di komponen frontend.

Simpan dalam database sehingga ketika Super Admin mengubah keterangan, informasi di seluruh UI ikut menggunakan data terbaru.

## D.4. Bedakan jenis, klasifikasi, dan penomoran

Agent wajib memeriksa apakah sistem membedakan:

1. Jenis surat.
2. Kode atau klasifikasi surat.
3. Pola/format nomor surat.
4. Unit atau kepanitiaan penerbit.

Jangan menyamakan konsep tersebut tanpa dasar arsitektur.

Apabila satu jenis surat dapat menggunakan beberapa klasifikasi atau format sesuai konteks, representasikan dengan relasi yang tepat.

Jangan mengubah pola nomor historis hanya karena master jenis surat diedit.

## D.5. Bantuan kontekstual saat membuat surat

Pada form Buat Surat, sediakan tooltip/popover melalui ikon informasi, misalnya `ⓘ`.

Informasi dapat berupa:
- Arti kode surat.
- Nama jenis atau klasifikasi.
- Fungsi.
- Penjelasan penggunaan.
- Contoh surat.

Jika jenis surat dipilih, tampilkan keterangan terkait dari database.

Dukung hover desktop, klik/tap mobile, dan navigasi keyboard.

Informasi harus mengikuti perubahan master data, bukan hardcoded.

## D.6. Jenis surat historis

Jika kode atau nama jenis surat berubah, nomor final dan informasi historis pada surat lama tidak boleh berubah.

Simpan snapshot yang diperlukan.

Jika jenis surat sudah pernah digunakan, jangan menghapus record secara fisik sehingga referensi historis hilang.

Gunakan mekanisme arsip/nonaktif.

## D.7. Dokumentasi jenis surat

Buat penjelasan detail bagaimana menu Jenis Surat bekerja, termasuk:
- Definisi jenis surat.
- Hubungan dengan kode surat.
- Hubungan dengan penomoran.
- Siapa yang berwenang mengelola.
- Dampak perubahan master data.
- Dampak status nonaktif.
- Contoh penggunaan.
- Aturan pemilihan pada form pembuatan surat.

Penjelasan tersebut harus mudah dipahami administrator nonteknis.

---

# E. NOMOR SURAT FINAL, IMMUTABILITY, DAN HISTORI

## E.1. Aturan utama

Nomor surat yang sudah difinalisasi tidak boleh berubah.

Contoh:

Surat lama menggunakan kode unit `KB`.

Kemudian kode unit diubah menjadi `KB-RA`.

Nomor final surat lama tetap menggunakan nilai `KB`, sedangkan surat baru dapat menggunakan `KB-RA`.

Jangan membentuk ulang nomor final lama menggunakan master data terbaru.

## E.2. Identitas relasional dan snapshot

Simpan dua aspek yang berbeda:

**Identitas internal**
Digunakan untuk relasi dengan unit, kepanitiaan, jenis surat, dan sumber daya lain.

**Snapshot historis**
Digunakan untuk merekam nilai aktual saat surat difinalisasi.

Snapshot minimal mempertahankan:
- Nomor final utuh.
- Kode unit saat finalisasi.
- Kode/klasifikasi surat saat finalisasi.
- Identitas penerbit yang relevan.
- Periode/tahun penomoran.
- Waktu finalisasi.

Gunakan struktur existing jika sudah memenuhi kebutuhan.

## E.3. Status draft dan final

**Draft**
- Belum memiliki nomor final yang terkunci.
- Dapat diedit sesuai izin.
- Tidak boleh dianggap sebagai surat resmi final.

**Nomor Final**
- Nomor resmi sudah dialokasikan.
- Nomor dikunci.
- Tidak dapat digunakan ulang.

**Diterbitkan / Dicetak Resmi / Divalidasi / Disetujui**
- Nomor tetap permanen.
- Perubahan workflow tidak boleh mengubah nomor final.

**Dibatalkan**
- Nomor tetap tersimpan.
- Status berubah menjadi batal.
- Nomor tidak dikembalikan untuk digunakan ulang.

Audit state machine existing. Jangan menggandakan status yang mempunyai arti sama.

Mencetak preview draft tidak boleh tanpa sengaja memfinalisasi nomor.

## E.4. Concurrency dan integritas

Pastikan:
- Finalisasi aman terhadap request bersamaan.
- Tidak terjadi nomor ganda dalam ruang penomoran yang seharusnya unik.
- Proses finalisasi idempotent.
- Sequence/counter dijaga secara transaksional.
- Restore tidak menyebabkan duplikasi.
- Nomor yang sudah final tidak bisa ditimpa melalui endpoint biasa.

Periksa ruang keunikan nomor sesuai desain existing, misalnya berdasarkan unit, periode, atau konfigurasi lain.

## E.5. Migrasi surat historis

Jika terdapat surat lama yang belum memiliki snapshot, evaluasi migrasi berdasarkan data aktual.

Jangan menebak bahwa seluruh surat lama otomatis final tanpa memeriksa status dan alur pembentukan nomornya.

Jangan mengubah nomor final yang sudah tersimpan.

---

# F. PEMBATALAN NOMOR SURAT

Tambahkan fungsi **Batalkan Nomor Surat** atau **Batalkan Surat** sesuai model existing.

Syarat:
- Dilakukan oleh pengguna berwenang.
- Memerlukan konfirmasi.
- Wajib mencatat alasan.
- Mencatat siapa dan kapan pembatalan.
- Nomor final tetap tersimpan.
- Nomor tidak digunakan ulang.
- Status batal terlihat di daftar dan detail surat.
- Data historis tidak terhapus.

Pembatalan berbeda dari penghapusan.

Surat yang dibatalkan tetap dapat ditelusuri sesuai hak akses.

Jangan membuat fungsi pembatalan sebagai penghapusan nomor dari database.

---

# G. REFERENSI SURAT SEBELUMNYA

## G.1. Input referensi

Tambahkan field:

`Referensi Surat Sebelumnya`

pada form Buat Surat.

Field harus mendukung:
- Input manual.
- Pencarian surat existing.
- Autocomplete.
- Pemilihan hasil pencarian.
- Penyimpanan hubungan internal jika surat yang dirujuk tersedia.

## G.2. Autocomplete

Jika pengguna mengetik `001`, sistem dapat menampilkan kandidat surat yang nomornya relevan.

Dropdown dapat menampilkan:
- Nomor final.
- Perihal.
- Tanggal.
- Unit penerbit.
- Status surat.

Hanya tampilkan surat yang boleh diketahui atau diakses pengguna sesuai kebijakan permission.

Lakukan validasi otorisasi pada backend, bukan sekadar filter frontend.

Gunakan debounce dan limit hasil pencarian.

## G.3. Referensi manual

Jika surat tidak tersedia, pengguna boleh tetap memasukkan nomor secara manual.

Contoh:

`001/SK/YAYASAN/2023`

Tidak wajib memilih hasil autocomplete.

Simpan teks referensi agar surat eksternal atau surat lama tetap dapat dicatat.

## G.4. Exact match otomatis

Jika input pengguna cocok 100% dengan satu nomor final yang tersedia dan berizin, sistem dapat otomatis membentuk relasi internal.

Jika terdapat beberapa surat dengan nomor identik, pengguna harus menentukan surat yang benar.

Jangan membuat relasi otomatis berdasarkan pencocokan parsial.

Jangan menghubungkan surat ke dirinya sendiri.

## G.5. Model relasi

Gunakan internal ID untuk relasi.

Contoh:

Surat baru ID `210`.

Surat referensi ID `107`.

Relasi:

`210 -> 107`

Simpan juga teks/snapshot nomor referensi sebagai informasi historis.

Pertimbangkan tabel relasi khusus agar bisa berkembang menjadi banyak referensi per surat.

## G.6. Konsistensi historis

Referensi draft dapat diedit sesuai permission.

Setelah surat final, referensi yang menjadi bagian dari fakta penerbitan harus tetap dapat ditelusuri dan tidak boleh berubah secara diam-diam.

Jika ada koreksi setelah finalisasi, wajib menggunakan mekanisme terotorisasi dan audit trail.

---

# H. FITUR SURAT TERKAIT

Tambahkan **Surat Terkait** pada halaman detail Surat.

Fitur harus memungkinkan penelusuran:
- Surat yang menjadi referensi.
- Surat yang mengacu pada surat tersebut.
- Surat lanjutan.
- Surat perubahan.
- Surat perpanjangan.
- Rangkaian surat yang saling terhubung.

Contoh:

`Surat A -> Surat B -> Surat C`

Sistem harus dapat menunjukkan relasi tersebut secara dua arah.

Minimal tampilkan:
- Nomor surat.
- Perihal.
- Tanggal.
- Status.
- Hubungan antar-surat.

Gunakan traversal yang aman, pencegahan siklus, serta batasan query agar performa tetap stabil.

**Hak melihat satu surat tidak otomatis memberikan hak melihat semua surat terkait.**

Setiap record terkait harus tetap diperiksa otorisasinya secara independen.

Jangan membocorkan nomor, judul, metadata, atau keberadaan surat yang tidak boleh diketahui pengguna.

---

# I. AUDIT UI/UX DAN RESPONSIVITAS

Lakukan pemeriksaan terhadap:
- Dashboard.
- Sidebar.
- Pengguna & Akses.
- Role dan assignment scope.
- Unit & Panitia.
- Jenis Surat.
- Buat Surat.
- Daftar Surat.
- Detail Surat.
- Surat Terkait.
- Backup & Restore.
- Seluruh modal, tabel, form, dropdown, tooltip, dan tombol aksi.

Perbaiki:
- Header tabel tidak sejajar.
- Kolom Aksi dan Ubah Status berantakan.
- Tombol bertumpuk.
- Teks terpotong.
- Modal melebihi viewport.
- Dropdown tertutup elemen lain.
- Overflow.
- Spacing tidak konsisten.
- Label sulit dipahami.
- Tampilan mobile tidak nyaman.

Gunakan UI library dan design system existing.

Jangan menambahkan framework baru jika tidak diperlukan.

Uji desktop, laptop, tablet, dan mobile.

Pastikan aksesibilitas keyboard, fokus, tooltip, dan responsivitas tetap baik.

---

# J. AUDIT DATABASE DAN MIGRASI

Audit relasi antar:
- Pengguna.
- Role.
- Permission.
- Assignment scope.
- Unit/Departemen.
- Kepanitiaan.
- Jenis Surat.
- Kode/Klasifikasi Surat.
- Surat dan Nomor Final.
- Status Surat.
- Referensi Surat.
- Lampiran.
- Backup metadata.
- Audit log.

Pastikan:
1. Primary key dan relasi stabil.
2. Permission mempunyai scope yang jelas.
3. Tidak ada privilege escalation akibat join/query yang salah.
4. Soft delete tidak memutus referensi historis.
5. Nomor final mempunyai snapshot permanen.
6. Relasi antar-surat menggunakan internal ID.
7. Scoped restore tidak memengaruhi unit lain.
8. Database migration aman dan versioned.
9. Struktur data mendukung backup/restore dengan integritas terjaga.

Jangan melakukan migration destruktif tanpa mekanisme recovery.

---

# K. ACCEPTANCE CRITERIA DAN TESTING

## K.1. Role dan Assignment Scope

Wajib menguji:

- Super Admin mempunyai kewenangan administratif global sesuai desain.
- Admin MI tidak otomatis dapat mengakses MTs.
- Admin MI dan MTs hanya mendapat permission sesuai assignment masing-masing.
- Sekretaris Panitia A tidak otomatis dapat mengakses Panitia B.
- Pengguna unit tidak otomatis memiliki semua permission kepanitiaan.
- Permission dapat berbeda per unit.
- Pengguna tidak dapat memberikan permission melebihi kewenangannya.
- Pencabutan assignment atau permission benar-benar menghentikan akses.
- Manipulasi `scope_id`, `unit_id`, dan `committee_id` pada API tidak berhasil melewati otorisasi.

## K.2. Backup & Restore

Uji skenario berikut:

**Super Admin**
- Dapat membuat Full System Backup.
- Dapat melakukan Full System Restore pada lingkungan pengujian.
- Dapat melakukan scoped backup/restore.

**Pengguna A — MI dan MTs**
- Dapat memilih MI dan MTs jika memiliki permission backup masing-masing.
- Tidak dapat memilih KB-RA tanpa permission.
- Hak backup dan restore dapat berbeda per unit.

**Pengguna B — KB-RA**
- Jika hanya memiliki izin backup KB-RA, target backup otomatis KB-RA.
- Tidak memiliki akses backup MI/MTs.
- Jika tidak mempunyai izin restore, tidak boleh restore meskipun dapat backup.

**Pengguna C — Panitia A**
- Tidak otomatis dapat melakukan backup seluruh Unit MI.
- Tidak boleh memperoleh data Panitia B melalui backup.

**Keamanan Restore**
- Scoped Restore tidak memodifikasi data unit lain.
- Tidak dapat menimpa akun atau role global tanpa izin.
- Tidak dapat mengubah password global melalui scoped restore.
- Tidak dapat menambahkan permission tersembunyi melalui file backup.
- Tidak menghasilkan duplikasi nomor final.
- Referensi tetap valid.
- Backup rusak atau tidak kompatibel ditolak.

## K.3. Jenis Surat

- Super Admin dapat menambah dan mengedit jenis surat.
- Kode, nama, deskripsi, fungsi, dan contoh penggunaan dapat diedit.
- Penjelasan tampil pada form Buat Surat.
- Perubahan keterangan tersinkron otomatis.
- Jenis surat nonaktif tidak digunakan untuk penerbitan baru jika tidak diizinkan.
- Surat historis tidak berubah saat jenis surat diedit atau diarsipkan.
- Pengguna tanpa izin tidak dapat memodifikasi master jenis surat.

## K.4. Unit & Panitia

- Kode KB dapat diubah menjadi KB-RA tanpa mengubah relasi ID.
- Penugasan pengguna tidak hilang.
- Surat lama tetap valid.
- Entitas yang memiliki histori tidak dihapus secara destruktif.
- Tombol Edit, Hapus, dan Ubah Status bekerja sesuai permission.

## K.5. Nomor Final

- Draft tidak otomatis menjadi final.
- Nomor dikunci setelah finalisasi resmi.
- Nomor lama tidak berubah akibat edit master data.
- Pembatalan tidak menghapus nomor.
- Nomor batal tidak digunakan ulang.
- Finalisasi paralel tidak menghasilkan duplikasi.

## K.6. Referensi dan Surat Terkait

- Pencarian parsial bekerja.
- Hasil autocomplete dibatasi permission.
- Input manual diterima.
- Exact match unik membentuk relasi.
- Referensi ambigu tidak dihubungkan sembarangan.
- Hubungan dua arah dapat ditelusuri.
- Surat yang tidak berizin tidak bocor melalui fitur Surat Terkait.

## K.7. UI/UX

- Penataan tabel konsisten.
- Kolom Aksi dan Ubah Status sejajar.
- Menu role dan permission mudah dipahami.
- Detail jenis surat jelas.
- Backup/restore menampilkan scope yang benar.
- Tampilan responsif pada berbagai perangkat.
- Tidak ada regresi pada fitur existing.

Gunakan automated test, integration test, dan pengujian UI yang sesuai stack repository.

---

# L. TAHAPAN EKSEKUSI

Lakukan pekerjaan dengan prioritas berikut.

### Fase 1 — Audit Arsitektur Otorisasi

Ini adalah fase wajib dan prioritas tertinggi.

- Inventarisasi role existing.
- Inventarisasi seluruh permission.
- Audit assignment scope.
- Audit pewarisan kewenangan unit dan kepanitiaan.
- Audit filtering data pada frontend/backend.
- Identifikasi celah privilege escalation.
- Identifikasi role atau permission yang redundan.
- Susun rekomendasi model paling ringkas dan konsisten.

### Fase 2 — Koreksi Role dan Permission

- Sederhanakan role jika memang diperlukan.
- Pertahankan fungsi yang sah.
- Pastikan permission dievaluasi per scope.
- Perbaiki assignment dan delegasi permission.
- Tambahkan penjelasan role pada UI dan dokumentasi.

### Fase 3 — Master Data

- Edit Unit/Departemen.
- Edit kepanitiaan.
- Edit jenis surat beserta deskripsi detail.
- Archive/soft delete bila memiliki histori.
- Stabilkan ID relasional.
- Pastikan semua permission master data benar.

### Fase 4 — Nomor Surat dan Histori

- Audit lifecycle.
- Implementasikan locking nomor final.
- Snapshot historis.
- Pembatalan nomor.
- Concurrency safety.
- Regression test.

### Fase 5 — Referensi Antar-Surat

- Autocomplete referensi.
- Exact match linking.
- Input manual.
- Surat Terkait.
- Query otorisasi dan relasi dua arah.

### Fase 6 — Backup & Restore

- Full System Backup.
- Scoped Backup.
- Full Restore.
- Scoped Restore.
- Integrasi permission per unit.
- Pemeriksaan scope file backup.
- Validasi integritas.
- Safety backup dan recovery.
- Pengujian restore pada lingkungan terisolasi.

### Fase 7 — UI/UX dan Quality Assurance

- Audit komponen.
- Perbaikan responsivitas.
- Konsistensi teks dan layout.
- Pengujian semua acceptance criteria.
- Regression test seluruh fitur existing.

Urutan fase dapat disesuaikan jika ditemukan dependensi teknis, tetapi koreksi otorisasi harus dilakukan sebelum fitur sensitif seperti backup/restore dibuka untuk pengguna.

---

# M. DOKUMENTASI WAJIB

Buat atau perbarui dokumentasi proyek yang mencakup:

## M.1. Role dan Permission

Jelaskan secara detail:
- Daftar role final.
- Fungsi masing-masing role.
- Hak bawaan atau profil permission role.
- Apa yang tidak otomatis diizinkan oleh role.
- Model assignment scope.
- Bagaimana permission efektif dihitung.
- Bagaimana permission diberikan/dicabut.
- Bagaimana Admin Unit mengelola pengguna.
- Bagaimana hak kepanitiaan dibatasi.
- Contoh kasus lintas unit dan kepanitiaan.
- Matriks role–permission–scope.

## M.2. Backup & Restore

Jelaskan:
- Perbedaan full dan scoped backup.
- Perbedaan backup dan restore permission.
- Bagaimana pemilihan unit bekerja.
- Bagaimana data global dan data bersama ditangani.
- Data yang termasuk dan dikecualikan dari scoped backup.
- Struktur file ZIP.
- Enkripsi dan manajemen kunci.
- Restore workflow.
- Safety backup.
- Recovery plan.
- Risiko dan batasan.

## M.3. Jenis Surat

Jelaskan:
- Pengertian jenis surat.
- Kode jenis surat.
- Perbedaan jenis, klasifikasi, dan format penomoran.
- Siapa yang dapat mengelola.
- Field yang editable.
- Fungsi keterangan dan contoh penggunaan.
- Hubungan ke form Buat Surat.
- Perlakuan terhadap jenis surat historis dan nonaktif.

## M.4. Nomor Surat dan Relasi

Jelaskan:
- Draft vs final.
- Trigger finalisasi.
- Snapshot.
- Perubahan kode unit.
- Pembatalan.
- Referensi surat.
- Exact match.
- Surat Terkait.
- Integritas data.

Dokumentasi harus sesuai implementasi aktual, bukan sekadar teori.

---

# N. LAPORAN HASIL WAJIB

Setelah pekerjaan, berikan laporan:

1. **Ringkasan audit:** arsitektur dan kondisi awal yang ditemukan.
2. **Evaluasi role:** daftar role lama dan hasil penyederhanaan jika dilakukan.
3. **Matriks hak akses:** role, permission, assignment scope, dan perilaku efektif.
4. **Evaluasi keamanan:** celah yang ditemukan dan perbaikannya.
5. **Backup & Restore:** cara kerja full dan scoped backup/restore beserta bukti pengujian.
6. **Master Data:** perubahan Unit/Departemen, kepanitiaan, dan Jenis Surat.
7. **Penomoran:** mekanisme finalisasi, snapshot, dan pembatalan.
8. **Referensi:** autocomplete, linking, dan Surat Terkait.
9. **Perubahan database:** migrasi, constraint, relasi, dan kompatibilitas.
10. **Perubahan kode:** file dan modul yang dibuat atau dimodifikasi.
11. **UI/UX:** perbaikan responsivitas dan komponen.
12. **Testing:** skenario, hasil PASS/FAIL, dan bukti yang tersedia.
13. **Masalah tersisa:** fitur belum selesai dan alasan.
14. **Kesiapan deployment:** risiko serta tindakan yang perlu disetujui sebelum production.

Jangan melaporkan suatu fitur sebagai selesai apabila implementasi atau pengujiannya belum benar-benar terpenuhi.

---

# O. INSTRUKSI PENUTUP DAN PRIORITAS MUTLAK

**Prioritas utama pekerjaan ini adalah memastikan model otorisasi SIRAT benar-benar merepresentasikan kewenangan pengguna secara tepat.**

Jangan sekadar menambahkan dropdown unit pada Backup & Restore.

Pastikan seluruh alur:

`USER -> ROLE -> ASSIGNMENT SCOPE -> PERMISSION -> RESOURCE -> ACTION`

benar-benar diterapkan.

Aturan penting:

- Role harus mudah dipahami dan tidak berkembang berlebihan.
- Assignment scope menentukan ruang lingkup kewenangan.
- Permission menentukan tindakan yang diizinkan.
- Hak akses satu unit tidak otomatis berlaku pada unit lain.
- Hak akses unit tidak otomatis berlaku pada semua kepanitiaan.
- Hak akses panitia tidak otomatis berlaku pada surat unit.
- Backup dan restore merupakan dua permission terpisah.
- Pengguna dengan satu scope yang diizinkan memperoleh scope otomatis terkunci pada UI.
- Pengguna dengan beberapa scope yang diizinkan hanya dapat memilih scope tersebut.
- Backend harus memvalidasi seluruh pembatasan secara independen.
- Super Admin memiliki kewenangan global sesuai desain dengan pengamanan khusus.
- Jenis surat memiliki keterangan detail yang dapat diedit.
- Identitas internal relasi database harus stabil.
- Nomor surat final harus tetap permanen.
- Restore tidak boleh merusak histori, kewenangan, atau relasi antar-data.

Jika model role dan assignment existing ternyata tidak mencerminkan prinsip-prinsip tersebut, **jangan hanya menambal UI**.

Perbaiki arsitektur otorisasinya pada lapisan yang tepat, kemudian sesuaikan UI, endpoint, dan dokumentasi.

Lakukan audit, implementasi aman, pengujian, dan pelaporan secara menyeluruh.

**Mulai dari audit repository aktual. Jangan melakukan restore production, perubahan destruktif, atau deployment VPS tanpa persetujuan eksplisit.**
