# Industropolis Futsal League 2026 — Website

Live score, jadwal, klasemen, line up, top scorer, top assist, dan kiper terbaik.
Hosting: **Netlify** (situs statis, tanpa build). Database & login admin: **Firebase** (Firestore + Authentication).

## Struktur folder

```
ifl-website/
├─ README.md             panduan ini
├─ netlify.toml          pengaturan Netlify + header keamanan (jangan diubah)
├─ firestore.rules       aturan database + keamanan, ditempel ke Firebase
└─ public/               ← satu-satunya folder yang tayang di Netlify
   ├─ templates/         contoh file Excel/CSV untuk impor tim, pemain, dan jadwal
   ├─ index.html         website publik
   ├─ admin/index.html   panel admin (alamat: /admin/)
   ├─ css/               style.css (publik), admin.css (admin)
   ├─ js/
   │   ├─ firebase.js    konfigurasi Firebase
   │   ├─ app.js         tampilan website publik
   │   ├─ admin.js       panel admin
   │   ├─ store.js       pengambilan data realtime
   │   └─ util.js        hitungan klasemen, statistik, jam laga
   └─ assets/            ← GAMBAR YANG BOLEH KAMU GANTI
       ├─ logo.png             logo IFL (header, favicon). Belum ada: taruh file Anda di sini
       ├─ bg-arena.jpg         background stadion
       ├─ logo-industropolis.png  logo penyelenggara
       ├─ logo-sez.png            logo penyelenggara
       └─ logo-danantara.png      logo penyelenggara
```

### Banner geser di beranda
Muncul di antara statistik dan daftar penyelenggara, berpindah sendiri tiap 5 detik, bisa digeser (HP) atau pakai panah/titik (desktop), dan bisa diketuk untuk diperbesar.
Untuk mengganti isinya, timpa `banner-1.jpg` sampai `banner-3.jpg` (disarankan rasio sekitar 2,1 : 1, mis. 1200 x 570 px). Menambah slide: tambah satu baris di daftar `BANNERS` pada `js/app.js`.

### Mengganti gambar
Timpa file di `public/assets/` dengan **nama file yang sama**, lalu unggah ulang ke GitHub. Tidak perlu mengubah kode.
Rekomendasi: logo format PNG latar transparan, lebar sekitar 600–1600 px.

### Logo tim
Tidak lewat folder. Buka **Admin → Tim & Pemain → Daftar tim → ketuk tim → Logo tim → pilih gambar**.
Gambar otomatis dikecilkan dan langsung tampil di website (klasemen, daftar tim, detail laga) tanpa deploy ulang.
Tim yang belum punya logo menampilkan lingkaran berisi singkatan nama tim.

**Pustaka logo klub (14 logo)**: file ada di `public/assets/logos/` (PNG transparan, 192 x 192 px, sekitar 2–18 KB per logo). Nama file jangan diganti: alamatnya tersimpan di data tim. Bila menambah logo baru, kecilkan dulu ke sekitar 192 px agar halaman klasemen tetap ringan. Di halaman tim, buka **Logo tim → Pilih dari pustaka logo klub** lalu ketuk logonya.

## Langkah pasang (urut)

### 1. Pasang aturan keamanan Firestore
1. Buat akun admin di Firebase Authentication (Email/Password). Salin **User UID**-nya (Authentication → Users), lalu di `firestore.rules` ganti `GANTI_DENGAN_UID_ADMIN` dengan UID itu. UID dipakai, bukan email, supaya email admin tidak terlihat di repositori publik.
2. Firebase Console → **Firestore Database → Rules** → hapus isi lama → tempel seluruh isi file → **Publish**.

Tanpa langkah ini, website publik tidak bisa membaca data dan admin tidak bisa menyimpan.

### 2. Unggah ke GitHub
Buat repositori kosong, lalu unggah **seluruh isi** folder ini (folder `public`, `firestore.rules`, `netlify.toml`, `README.md`).

### 3. Hubungkan ke Netlify
Add new site → Import from Git → pilih repositori. Isian build biarkan kosong; `netlify.toml` sudah mengatur folder `public`. Klik Deploy.

### 4. Izinkan domain Netlify untuk login (Firebase)
Firebase Console → **Authentication → Settings → Authorized domains → Add domain** → isi alamat `namasitus.netlify.app`.
Tanpa ini, login admin akan gagal di situs yang sudah online.

### 5. Isi data lewat admin
Buka `https://namasitus.netlify.app/admin/`, login, lalu:
1. **Tim & Pemain → Tambah tim**: impor Excel/CSV, atau tempel daftar tim (`nama | grup`). Pemain tiap tim ditambah di **Daftar tim → ketuk tim**.
2. **Pertandingan → Tambah pertandingan → Tempel banyak**: tempel jadwal (`2026-11-09 19:00 | A | 1 | Tim A1 | Tim A2`).
3. **Pengaturan → Pengumuman**: pengumuman beranda.

## Menu admin
Sidebar kiri bercabang (di HP: tiga menu di bawah layar, cabangnya berupa tombol bulat di atas halaman):
- **Pertandingan**: Semua pertandingan, Tambah pertandingan
- **Tim & Pemain**: Daftar tim (ketuk tim untuk ubah info, logo, pemain, official), Tambah tim
- **Pengaturan**: Pengumuman, Durasi pertandingan, Kiper terbaik, Hapus data (hapus semua pertandingan / hapus semua tim, dengan konfirmasi mengetik HAPUS; tim baru bisa dihapus semua setelah semua pertandingan dihapus)

## Saat pertandingan berlangsung (sistem kasir)
Admin → Pertandingan → Semua pertandingan → **Kelola** laga. Urutannya sengaja dikunci:
1. **Isi line up dulu** (buka bagian Line up). Ketuk pemain: sekali = Inti, dua kali = Cadangan, tiga kali = batal. Inti wajib **5 pemain dan ada kiper** untuk tiap tim. Tombol **Mulai laga** baru aktif setelah kedua tim lengkap; di daftar laga tertulis "Siap dimulai" atau "Line up kurang".
2. **Mulai laga** → jam babak 1 berjalan otomatis di layar penonton. Tidak ada input menit manual: menit setiap kejadian diambil dari jam laga.
3. **Catat kejadian**: ketuk kotak pemain, pilih Gol / Gol penalti / Kartu kuning / Kartu merah / Gol bunuh diri. Untuk gol, ketuk pemain yang assist atau "Tanpa assist". Hanya pemain di line up yang bisa dipilih. Salah catat → **Batalkan** di Riwayat kejadian, skor ikut menyesuaikan.
4. **Fase laga**: satu tombol utama berubah mengikuti fase (lihat bagian di bawah). Gunakan **Jeda darurat** bila jam harus berhenti.
5. **Selesai (FT)** → hasil masuk klasemen. Pilih **Man of the Match** dari pemain di line up.
6. Salah setelah FT? **Buka kembali untuk koreksi**, perbaiki, lalu Selesai (FT) lagi.

## Fase laga dan jam
| Fase | Tombol utama |
|---|---|
| Babak 1 | Akhiri babak 1 |
| Istirahat (hitung mundur) | Mulai babak 2 |
| Babak 2 | Selesai (FT). Di babak gugur yang seri: **Lanjut perpanjangan waktu** atau **Langsung adu penalti** |
| ET1, istirahat ET, ET2 | Akhiri ET1, Mulai ET2, lalu Selesai (FT) (atau Lanjut adu penalti bila masih seri) |
| Adu penalti | Catat tiap tendangan (Gol / Gagal), pemenang terisi otomatis, lalu Selesai (FT) |

- **Jam per babak mulai dari 0.** Skor, gol, dan kartu berlanjut. Menit kejadian babak 1 dan 2 berurutan: dengan 2 × 10 menit, babak 2 dihitung 11', 12', ... (babak gugur 2 × 15: 16', 17', ...). **Perpanjangan waktu dihitung per babak**: tampil `ET1 3'`, `ET2 2'`, dan tambahan waktu `ET1 5+1'`.
- **Tambahan waktu**: jam tidak berhenti paksa di akhir babak. Setelah batas tampil `10+1'`, `10+2'`, dan admin menekan Akhiri saat wasit meniup peluit. Admin juga bisa mengatur pengingat "Tambahan waktu +2'" di layar penonton (tombol − / +).
- **Jeda darurat**: alasan Cedera, Gangguan lapangan, Time-out (pilih tim), atau Lainnya (keterangan bebas). Jam berhenti dan penonton melihat misalnya "JEDA · Cedera"; tercatat juga di jalannya laga. Time-out mengikuti aturan futsal (1 per tim per babak, tidak ada di perpanjangan waktu); pelanggarannya hanya peringatan, tidak memblokir.
- **Durasi** diatur di Admin → Pengaturan → Durasi pertandingan. Bawaan: grup 2 × 10 menit (bisa diubah ke 1 babak non-stop), gugur 2 × 15, perpanjangan 2 × 5, istirahat 5 menit, istirahat ET 1 menit. Nilai dibekukan saat laga dimulai.
- **Kartu**: kuning kedua pada pemain yang sama otomatis menjadi merah. Pemain yang sudah merah tidak bisa dikartu lagi. Gol tidak bisa dicatat saat istirahat atau adu penalti; gol adu penalti tidak dicatat (skor tetap seri, pemenang dipilih manual).
- Pelanggaran akumulatif (kartu 6 pelanggaran) dan pergantian pemain tidak dicatat.

### Adu penalti (babak gugur yang masih seri setelah waktu normal / perpanjangan)
1. Tekan **Lanjut adu penalti** (dari ET2) atau **Langsung adu penalti** (dari babak 2). Papan adu penalti muncul di halaman Kelola laga.
2. Catat tiap tendangan: **Gol** atau **Gagal** di bawah nama tim yang menendang. Tombol hanya aktif untuk tim yang gilirannya (tim yang menendang lebih sedikit).
3. **Pemenang dihitung otomatis**: 5 tendangan per tim, berhenti lebih awal bila salah satu tim sudah tidak terkejar, lalu sudden death bila masih sama setelah 5 tendangan. Tombol Selesai (FT) aktif setelah pemenang pasti.
4. Salah catat: **Batalkan tendangan terakhir**. Cadangan bila perlu: pilih pemenang manual (ini mengosongkan tendangan yang sudah dicatat).
5. Tendangan adu penalti **tidak dicatat sebagai gol**: tidak masuk top scorer, skor laga tetap seri (mis. `2 – 2`, ditulis `(pen 4–3)`), dan tidak menambah kebobolan kiper. Di website tampil sebagai kartu Adu penalti dengan titik hasil tiap tendangan.
6. Gol penalti **di dalam permainan** (tombol Gol penalti) tetap dihitung sebagai gol biasa dengan tanda **P**, jadi masuk top scorer dan skor laga.

### Menang WO (tim lawan tidak hadir)
Admin → Pertandingan → ketuk laga terjadwal → buka **Menang WO**. Pilih pemenang dan skor (bawaan 3 – 0), lalu Tetapkan. Laga langsung selesai tanpa line up, hasilnya masuk klasemen, tampil berlabel **WO**, dan tidak memengaruhi top scorer maupun statistik kiper. Salah tetapkan: buka laganya lalu **Buka kembali untuk koreksi** (WO dibatalkan, laga kembali Terjadwal).

Skor selalu dihitung ulang dari daftar kejadian (bukan ditambah-kurangi), jadi tidak bisa menyimpang. "Koreksi skor" (misalnya menang WO) disimpan sebagai selisih, dan tetap berlaku bila ada gol baru.

## Aturan klasemen
Menang 3, seri 1, kalah 0. Urutan: poin → gol memasukkan (GM) → head to head → selisih gol → poin kartu (kuning 1, merah 3; lebih sedikit lebih baik) → urutan manual panitia (hasil adu penalti/undian). Tim yang masih seri penuh ditandai `*` dan panitia mengisi urutannya di Admin → Pertandingan.
Hanya laga **grup** berstatus FT yang dihitung. Yang lolos adalah 2 teratas tiap grup (mengikuti bagan 4 grup x 2 tim).

## Kuota Firestore
Setiap pengunjung membaca seluruh data (tim, pemain, laga, kejadian), kira-kira 500 dokumen per kunjungan. Paket gratis (Spark) dibatasi 50.000 baca per hari, sehingga bisa habis oleh sekitar 100 kunjungan dan situs menampilkan galat. Sebelum turnamen: (1) naikkan ke paket **Blaze** dan pasang **budget alert** di Google Cloud; (2) cache lokal browser sudah diaktifkan di `js/firebase.js` sehingga pengunjung yang kembali hanya membaca data yang berubah. Pantau di Firebase Console → Firestore → Usage.

## Catatan
- **Kiper terbaik** dipilih manual oleh panitia di Pengaturan → Kiper terbaik: kartu kiper urut dari nilai terbaik, ketuk kartu untuk memilih, ketuk lagi untuk membatalkan. Di halaman Statistik tampil sebagai kartu penghargaan: main, clean sheet, kebobolan, rata-rata kebobolan, gol, assist, dan posisi akhir tim (mis. "Gugur di Perempat Final", "Juara"). Ada juga Peringkat kiper. Dihitung dari kiper di susunan inti laga selesai, termasuk gol di perpanjangan waktu tetapi tanpa adu penalti.
- Jam laga memakai jam server (header `Date` dari situs sendiri), bukan jam HP masing-masing, jadi menit sama di semua perangkat. Disinkronkan tiap 5 menit.
- Jangan deploy perubahan kode saat ada laga LIVE: file JS di-cache 5 menit, sehingga sebagian pengunjung bisa sesaat memakai `app.js` baru dengan `util.js` lama.
- Nilai `firebaseConfig` di `public/js/firebase.js` memang boleh publik. Yang menjaga data adalah `firestore.rules`.

## Bagan babak gugur
- Halaman **Bagan** di website menampilkan perempat final, semifinal, dan final, mengikuti urutan jam kickoff (QF1–QF4, SF1–SF2).
- **Urutan laga bagan** diambil dari kolom **Urutan bagan** (slot) di form laga: QF1–QF4 dan SF1–SF2. Impor jadwal mengisinya otomatis menurut urutan baris. Laga tanpa slot memakai urutan jam kickoff, jadi mengubah jam tidak lagi menukar bagan bila slot sudah terisi.
- Pasangan: QF1 Juara A–Runner-up B, QF2 Juara C–Runner-up D, QF3 Juara B–Runner-up A, QF4 Juara D–Runner-up C. SF1 = pemenang QF1–QF2, SF2 = pemenang QF3–QF4.
- Buat dulu laga `qf` (4), `sf` (2), dan `final` (1) lewat Impor jadwal, tim boleh dikosongkan.
- Setelah semua laga sebuah grup selesai (FT), Admin → Pertandingan menampilkan kartu **Babak gugur siap diisi**. Tekan **Isi pasangan otomatis**. Hal yang sama berlaku untuk semifinal dan final setelah laga sebelumnya selesai.
- Laga babak gugur yang seri: lanjut ke adu penalti dan catat tendangan (lihat bagian Adu penalti). Pemenang otomatis lanjut ke babak berikutnya.
- Setelah laga dimulai, **fase dan tim di form jadwal dikunci** (jam tetap bisa diubah). Mengganti tim di laga terjadwal otomatis mengosongkan line up tim yang diganti.

## Keamanan
- Penulisan data hanya untuk UID admin (`firestore.rules`). Pasang aturan di Firebase, jangan biarkan Firestore dalam "test mode".
- `netlify.toml` memasang Content-Security-Policy, anti-clickjacking, HSTS, dan melarang cache halaman admin. Setelah deploy, buka website + login admin sambil melihat Console browser; bila ada pesan "Refused to ... Content Security Policy", laporkan baris itu.
- Di Google Cloud Console → APIs & Services → Credentials, batasi API key Firebase ke **HTTP referrers**: `localhost`, `*.netlify.app/*`, dan domain situs kalian.
- Di Firebase Console → Authentication → Settings → User actions, nonaktifkan **pembuatan akun baru (sign-up)** bila opsinya ada. Kunci API itu publik, jadi tanpa ini orang luar bisa membuat akun (tetap tidak bisa menulis data karena aturan Firestore memakai UID admin).
- Gunakan password admin yang panjang dan unik. Sebaiknya jadikan repositori GitHub **Private** (Netlify tetap bisa memakainya).

## Impor tim, pemain, dan official dari Excel / CSV
Admin → **Tim & Pemain → Tambah tim → Impor Excel / CSV**. Contoh file ada di `public/templates/` (juga bisa diunduh dari panel itu).

Satu baris = satu orang, kolom: **Tim, Grup, Peran, No, Nama** (urutan bebas, baris pertama = judul).
- **Peran**: Pemain, Kiper, atau Official (kosong = Pemain). **No**: nomor punggung 0–99, wajib untuk pemain/kiper, tidak boleh kembar dalam satu tim; kosongkan untuk official.
- Ketentuan liga: maksimal 10 pemain dan 2 official per tim, 16 tim. Pelanggaran hanya jadi peringatan; no kembar, no kosong, dan nama kosong menghalangi impor sampai file diperbaiki.
- Ada pratinjau sebelum data disimpan. Impor aman diulang: tim dicocokkan lewat nama, pemain lewat no punggung. Opsi **Ganti total** menghapus pemain lama yang tidak ada di file.
- Excel `.xlsx` dan CSV (pemisah koma, titik koma, atau tab) didukung. Untuk `.xls` lama, simpan dulu sebagai `.xlsx`.
- Jangan menaruh NIK/nomor telepon di file: kolom lain diabaikan dan tidak disimpan, karena data website dapat dibaca publik.

## Navbar dan pendaftaran
- Layar ≥ 900 px: menu horizontal di atas. Di bawah itu (HP, tablet portrait): tombol hamburger. Esc, klik di luar menu, atau memilih menu menutupnya.
- Tombol **Daftar tim** (Google Form) diatur di `REGISTRATION` pada `public/js/util.js`: berubah menjadi "Pendaftaran dibuka 9 Nov" sebelum 9 Nov, "Daftar tim" sampai 15 Nov 15.00 WIB, lalu hilang otomatis.

## Tampilan (pembaruan)
- **Navbar**: Beranda, Bagan, dan cabang **Info** (Tim, Jadwal, Klasemen, Statistik). Di HP, buka hamburger lalu ketuk Info. Tanpa ikon. Diatur di `NAV` pada `public/js/app.js`.
- **Beranda**: banner geser otomatis (sambutan, laga LIVE/berikutnya, pendaftaran), menu cepat, ringkasan turnamen (tanggal, lokasi, peserta, format), lalu data laga, klasemen, dan statistik. Teks tanggal/lokasi ada di `dateRange` dan `TOURNAMENT`.
- **Admin**: sidebar kiri di desktop; di HP berubah menjadi bilah menu di bawah layar (mudah dijangkau jempol). Font: Barlow & Barlow Condensed (Google Fonts).
- **Data contoh 16 tim**: `public/templates/data-16-tim-ifl-2026.xlsx` (dan `.csv`). Nama tim dan pemain fiktif; ganti sebelum impor.
- **Jadwal 31 laga**: `public/templates/jadwal-ifl-2026.txt` (tempel di Admin → Pertandingan → Tambah pertandingan → Tempel banyak; impor dulu data 16 tim) dan `.xlsx` untuk dibaca/dicetak. Waktu yang belum ditentukan ditulis `TBD` (contoh: final) dan tampil sebagai "Waktu akan ditentukan"; jamnya bisa diisi nanti lewat Kelola laga.
