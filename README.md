# Database Pimpinan Wilayah VIII Tapak Suci Sumatera Utara

Aplikasi web statis (tanpa server) yang menampilkan struktur pengurus, 23 Pimpinan Daerah, dan seluruh data anggota.
Data disimpan sebagai file JSON di folder `data/` pada repo GitHub ini, dan situs diterbitkan lewat GitHub Pages.

## Cara memasang online

1. Buat akun GitHub, lalu buat repo baru (mis. `database-pimwil8`).
2. Unggah semua file dan folder ini ke repo (tombol **Add file → Upload files**).
3. Buka **Settings → Pages**, pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu Save.
4. Setelah ±1 menit, situs aktif di `https://USERNAME.github.io/NAMA-REPO/`.

## Cara mengisi dan mengubah data

**Lewat aplikasi (disarankan)**
1. Buat token: GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Pilih hanya repo ini, izin **Contents: Read and write**.
2. Di situs, klik **Admin**, isi username, nama repo, branch (`main`), dan token.
3. Tombol Tambah / Ubah / Hapus akan muncul. Setelah selesai mengedit, klik **Simpan ke GitHub**. Situs online ikut berubah dalam ±1 menit.
4. Untuk anggota dalam jumlah besar: siapkan Excel, simpan sebagai CSV (format di `contoh-impor-anggota.csv`), lalu klik **Impor CSV**. Kolom `pimda` harus sama persis dengan nama Pimda.

**Lewat GitHub langsung:** edit file `data/*.json` di GitHub.

## Fitur tambahan

- **Pencarian publik:** di Beranda ada kolom pencarian besar. Pengunjung cukup mengetik nama atau NIA, hasilnya langsung muncul, dan klik hasilnya untuk melihat detail dan kartu anggota.
- **Foto anggota:** di form tambah/ubah anggota, pilih berkas foto. Foto otomatis dikecilkan (300x400 px) dan diunggah ke folder `foto/` saat Anda klik **Simpan ke GitHub**.
- **Riwayat tingkatan:** buka detail anggota (klik barisnya), lalu **+ Naik tingkat**. Tingkatan anggota ikut diperbarui dan riwayatnya tercatat bertanggal.
- **Kartu anggota:** di detail anggota klik **Kartu anggota**, lalu **Cetak** (ukuran kartu ±86 mm). Bisa juga disimpan sebagai PDF dari jendela cetak.

## Yang perlu Anda lengkapi

- `data/pimda.json`: ganti 23 nama placeholder dengan nama Pimda sebenarnya, plus ketua dan sekretaris.
- `data/pengurus.json`: isi nama pengurus dan sesuaikan jabatan.
- `data/anggota.json`: hapus 3 data CONTOH, lalu isi atau impor data anggota.
- `data/config.json`: berisi 3 jenjang (Siswa, Kader, Pendekar) beserta tingkatan, nama sabuk, dan singkatannya. Ubah di sini bila ada penyesuaian.

## Penting: privasi data

Jika repo bersifat **publik**, seluruh isi `data/*.json` dapat dibaca siapa saja, termasuk kolom No. HP dan Alamat. Tampilan aplikasi hanya menyembunyikan kolom itu dari pengunjung biasa, bukan dari file JSON-nya. Pilihannya:

- Jangan mengisi HP dan alamat anggota (kolom itu opsional), atau
- Pakai repo privat. GitHub Pages dari repo privat memerlukan paket berbayar.

Foto anggota juga ikut menjadi publik di repo publik, jadi pastikan anggota (atau orang tua/wali bagi yang di bawah umur) setuju. Jangan menyimpan NIK atau dokumen pribadi di repo publik. Terutama untuk anggota di bawah umur, sebaiknya minta persetujuan orang tua/wali.

## Uji di komputer sendiri

```
python -m http.server 8000
```
Lalu buka http://localhost:8000. Membuka `index.html` langsung dengan klik ganda tidak akan memuat data.
