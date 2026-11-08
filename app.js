'use strict';
/* Database Pimpinan Wilayah VIII Tapak Suci Sumatera Utara
   Data dibaca dari data/*.json (repo GitHub). Admin dapat mengedit dan
   menyimpan (commit) langsung ke GitHub memakai Personal Access Token. */

const FILES = {
  pengurus: 'data/pengurus.json',
  pimda: 'data/pimda.json',
  anggota: 'data/anggota.json',
  config: 'data/config.json'
};
const D = { pengurus: [], pimda: [], anggota: [], config: { tingkatan: [], status: ['Aktif', 'Tidak Aktif'], jumlah_pimda_target: 23 } };
const dirty = new Set();
const PHOTOS = {};
const PAGE = 25;
const S = { q: '', jenjang: '', pimda: '', tingkatan: '', status: '', page: 1 };

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GH = () => { if (window.DEMO) return window.DEMO.admin ? { owner: 'demo', repo: 'demo', branch: 'main', token: 'demo' } : null; try { return JSON.parse(localStorage.getItem('ts_gh') || 'null'); } catch { return null; } };
const isAdmin = () => !!(GH() && GH().token);
const uid = k => k[0] + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const TK = () => (D.config.jenjang || []).flatMap(g => g.tingkatan.map(t => ({ ...t, jenjang: g.nama })));
const tkOpts = () => TK().length ? TK().map(t => [t.nama, t.nama + (t.singkatan ? ` (${t.singkatan})` : '')]) : (D.config.tingkatan || []);
const tkInfo = n => TK().find(t => t.nama === n);
const jenjangOf = n => (tkInfo(n) || {}).jenjang || '';
const tkLabel = n => { const t = tkInfo(n); return t ? t.nama + (t.alias ? ' / ' + t.alias : '') + (t.singkatan ? ` (${t.singkatan})` : '') : (n || ''); };
const tkCell = n => { const t = tkInfo(n); return esc(n || '-') + (t && t.singkatan ? ` <span class="tag">${esc(t.singkatan)}</span>` : ''); };
const normTk = v => { v = (v || '').trim(); const l = v.toLowerCase(); const t = TK().find(t => [t.nama, t.alias, t.singkatan].some(x => x && x.toLowerCase() === l)); return t ? t.nama : v; };
function tkCounts(a) {
  const known = TK().map(t => t.nama), rows = known.map(n => [n, a.filter(x => x.tingkatan === n).length]);
  count(a.filter(x => !known.includes(x.tingkatan)), x => x.tingkatan).forEach(r => rows.push(r));
  return rows;
}
const pimdaName = id => (D.pimda.find(p => p.id === id) || {}).nama || '-';

/* ---------- Form definitions ---------- */
const FIELDS = {
  pengurus: [
    { k: 'nama', l: 'Nama lengkap', req: 1 },
    { k: 'jabatan', l: 'Jabatan', req: 1 },
    { k: 'bidang', l: 'Bidang / Divisi' },
    { k: 'hp', l: 'No. HP' },
    { k: 'urut', l: 'Nomor urut tampil', type: 'number' }
  ],
  pimda: [
    { k: 'nama', l: 'Nama Pimda', req: 1, full: 1 },
    { k: 'wilayah', l: 'Kab./Kota cakupan' },
    { k: 'ketua', l: 'Ketua' },
    { k: 'sekretaris', l: 'Sekretaris' },
    { k: 'hp', l: 'No. HP' },
    { k: 'alamat', l: 'Alamat sekretariat', type: 'textarea', full: 1 }
  ],
  anggota: [
    { k: 'nama', l: 'Nama lengkap', req: 1, full: 1 },
    { k: 'nia', l: 'No. Induk Anggota (NIA)' },
    { k: 'jk', l: 'Jenis kelamin', type: 'select', opts: () => ['L', 'P'] },
    { k: 'tempat_lahir', l: 'Tempat lahir' },
    { k: 'tgl_lahir', l: 'Tanggal lahir', type: 'date' },
    { k: 'pimda_id', l: 'Pimpinan Daerah', type: 'select', req: 1, opts: () => D.pimda.map(p => [p.id, p.nama]) },
    { k: 'tingkatan', l: 'Tingkatan', type: 'select', opts: tkOpts },
    { k: 'status', l: 'Status', type: 'select', opts: () => D.config.status || ['Aktif', 'Tidak Aktif'] },
    { k: 'tahun_bergabung', l: 'Tahun bergabung', type: 'number' },
    { k: 'hp', l: 'No. HP' },
    { k: 'alamat', l: 'Alamat', type: 'textarea', full: 1 }
  ]
};
const TITLES = { pengurus: 'Pengurus', pimda: 'Pimpinan Daerah', anggota: 'Anggota' };

/* ---------- Load ---------- */
async function load() {
  for (const k of Object.keys(FILES)) {
    try {
      const r = await fetch(FILES[k] + '?t=' + Date.now());
      if (!r.ok) throw new Error(r.status);
      D[k] = await r.json();
    } catch (e) {
      console.warn('Gagal memuat', k, e);
      if (location.protocol === 'file:') toast('Buka lewat GitHub Pages atau server lokal (python -m http.server), bukan file langsung.', true);
    }
  }
  $('#lastUpdate').textContent = D.config.diperbarui || '-';
}

/* ---------- Helpers UI ---------- */
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), err ? 6000 : 3000);
}
function bars(rows, max) {
  max = max || Math.max(1, ...rows.map(r => r[1]));
  return rows.map(([l, n]) => `<div class="bar-row"><span class="lbl" title="${esc(l)}">${esc(l)}</span><div class="bar"><i style="width:${(n / max) * 100}%"></i></div><span class="n">${n}</span></div>`).join('') || '<div class="empty">Belum ada data</div>';
}
function count(arr, fn) { const m = {}; arr.forEach(x => { const k = fn(x) || '(kosong)'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m); }
function markDirty(k) {
  dirty.add(k); D.config.diperbarui = new Date().toLocaleString('id-ID'); dirty.add('config');
  refreshPublish();
}
function refreshPublish() {
  const b = $('#btnPublish');
  if (isAdmin() && dirty.size) { b.textContent = 'Simpan ke GitHub (' + [...dirty].filter(x => x !== 'config').length + ' berkas diubah)'; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
  $('#btnAdmin').textContent = window.DEMO ? (isAdmin() ? 'Mode: Admin ✓ (klik → publik)' : 'Mode: Publik (klik → admin)') : (isAdmin() ? 'Admin ✓' : 'Admin');
}
window.addEventListener('beforeunload', e => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Views ---------- */
function renderBeranda() {
  const a = D.anggota, aktif = a.filter(x => x.status === 'Aktif').length;
  const target = D.config.jumlah_pimda_target || 23;
  const perPimda = D.pimda.map(p => [p.nama, a.filter(x => x.pimda_id === p.id).length]).sort((x, y) => y[1] - x[1]);
  $('#v-beranda').innerHTML = `
    <div class="hero"><img src="logo.png" alt="Logo Tapak Suci"><div><h2>Database Pimpinan Wilayah VIII</h2><p>Tapak Suci Putera Muhammadiyah &middot; Provinsi Sumatera Utara</p></div></div>
    <div class="searchbox"><input type="search" id="hq" placeholder="🔍 Cari nama atau NIA anggota..." autocomplete="off" aria-label="Cari anggota"><div id="hres"></div></div>
    <div class="grid stats">
      <div class="stat"><b>${a.length}</b><span>Total anggota</span></div>
      <div class="stat"><b>${aktif}</b><span>Anggota aktif</span></div>
      <div class="stat"><b>${D.pimda.length}<small style="font-size:1rem;color:var(--mute)"> / ${target}</small></b><span>Pimpinan Daerah</span></div>
      <div class="stat"><b>${D.pengurus.length}</b><span>Pengurus Pimwil</span></div>
    </div>
    <div class="grid two">
      <div class="card"><h3>Anggota per Pimpinan Daerah</h3>${bars(perPimda)}</div>
      <div>
        <div class="card" style="margin-bottom:14px"><h3>Anggota per Jenjang</h3>${bars((D.config.jenjang || []).map(g => [g.nama, a.filter(x => jenjangOf(x.tingkatan) === g.nama).length]))}</div>
        <div class="card" style="margin-bottom:14px"><h3>Anggota per Tingkatan</h3>${bars(tkCounts(a))}</div>
        <div class="card"><h3>Jenis Kelamin</h3>${bars(count(a, x => ({ L: 'Laki-laki', P: 'Perempuan' }[x.jk] || '')))}</div>
      </div>
    </div>`;
}

function renderPengurus() {
  const list = [...D.pengurus].sort((x, y) => (x.urut || 999) - (y.urut || 999));
  const adm = isAdmin();
  $('#v-pengurus').innerHTML = `
    <div class="head-row"><div><h2>Struktur Pengurus</h2><p class="sub">Susunan pengurus Pimpinan Wilayah VIII</p></div>
    ${adm ? '<button class="btn primary" data-add="pengurus">+ Tambah pengurus</button>' : ''}</div>
    <div class="grid cards">${list.map(p => `
      <div class="person ${(p.urut || 99) <= 6 ? 'core' : ''}">
        <span class="role">${esc(p.jabatan)}</span>
        <h4>${esc(p.nama)}</h4>
        <div class="meta">${esc(p.bidang || '')}</div>
        ${adm && p.hp ? `<div class="meta">📞 ${esc(p.hp)}</div>` : ''}
        ${adm ? `<div class="acts"><button class="btn sm" data-edit="pengurus" data-id="${p.id}">Ubah</button><button class="btn sm danger" data-del="pengurus" data-id="${p.id}">Hapus</button></div>` : ''}
      </div>`).join('') || '<div class="empty">Belum ada data pengurus</div>'}</div>`;
}

function renderPimda() {
  const adm = isAdmin();
  $('#v-pimda').innerHTML = `
    <div class="head-row"><div><h2>Pimpinan Daerah</h2><p class="sub">${D.pimda.length} Pimpinan Daerah di bawah Pimwil VIII Sumatera Utara</p></div>
    ${adm ? '<button class="btn primary" data-add="pimda">+ Tambah Pimda</button>' : ''}</div>
    <div class="grid cards">${D.pimda.map((p, i) => {
      const n = D.anggota.filter(x => x.pimda_id === p.id).length;
      return `<div class="person pimda-card"><span class="no">${String(i + 1).padStart(2, '0')}</span>
        <h4>${esc(p.nama)}</h4>
        <div class="meta">${esc(p.wilayah || '')}</div>
        <div class="meta">Ketua: ${esc(p.ketua || '-')}</div>
        <div class="meta">Sekretaris: ${esc(p.sekretaris || '-')}</div>
        ${adm && p.hp ? `<div class="meta">📞 ${esc(p.hp)}</div>` : ''}
        ${p.alamat ? `<div class="meta">📍 ${esc(p.alamat)}</div>` : ''}
        <div class="cnt"><b>${n}</b> anggota <a href="#anggota" data-filterpimda="${p.id}" style="margin-left:6px;font-size:.82rem">lihat daftar →</a></div>
        ${adm ? `<div class="acts"><button class="btn sm" data-edit="pimda" data-id="${p.id}">Ubah</button><button class="btn sm danger" data-del="pimda" data-id="${p.id}">Hapus</button></div>` : ''}
      </div>`;
    }).join('') || '<div class="empty">Belum ada data Pimda</div>'}</div>`;
}

function filtered() {
  const q = S.q.toLowerCase();
  return D.anggota.filter(x =>
    (!S.pimda || x.pimda_id === S.pimda) && (!S.jenjang || jenjangOf(x.tingkatan) === S.jenjang) && (!S.tingkatan || x.tingkatan === S.tingkatan) && (!S.status || x.status === S.status) &&
    (!q || (x.nama || '').toLowerCase().includes(q) || (x.nia || '').toLowerCase().includes(q)));
}
function renderAnggota() {
  const adm = isAdmin();
  const opt = (arr, cur) => arr.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
  $('#v-anggota').innerHTML = `
    <div class="head-row"><div><h2>Data Anggota</h2><p class="sub">Seluruh anggota Tapak Suci di bawah Pimwil VIII Sumatera Utara</p></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn" id="btnCsv">Unduh CSV</button>
      ${adm ? '<button class="btn" id="btnImport">Impor CSV</button><button class="btn primary" data-add="anggota">+ Tambah anggota</button>' : ''}
    </div></div>
    <div class="toolbar">
      <input type="search" id="fq" placeholder="Cari nama atau NIA..." value="${esc(S.q)}">
      <select id="fj"><option value="">Semua jenjang</option>${opt((D.config.jenjang || []).map(g => g.nama), S.jenjang)}</select>
      <select id="fp"><option value="">Semua Pimda</option>${opt(D.pimda.map(p => [p.id, p.nama]), S.pimda)}</select>
      <select id="ft"><option value="">Semua tingkatan</option>${opt(tkOpts(), S.tingkatan)}</select>
      <select id="fs"><option value="">Semua status</option>${opt(D.config.status || [], S.status)}</select>
    </div>
    <div id="anggotaTable"></div>`;
  $('#fq').oninput = e => { S.q = e.target.value; S.page = 1; renderAnggotaTable(); };
  $('#fj').onchange = e => { S.jenjang = e.target.value; S.page = 1; renderAnggotaTable(); };
  $('#fp').onchange = e => { S.pimda = e.target.value; S.page = 1; renderAnggotaTable(); };
  $('#ft').onchange = e => { S.tingkatan = e.target.value; S.page = 1; renderAnggotaTable(); };
  $('#fs').onchange = e => { S.status = e.target.value; S.page = 1; renderAnggotaTable(); };
  $('#btnCsv').onclick = exportCsv;
  if (adm) $('#btnImport').onclick = importCsv;
  renderAnggotaTable();
}
function renderAnggotaTable() {
  const list = filtered(), adm = isAdmin();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  if (S.page > pages) S.page = pages;
  const rows = list.slice((S.page - 1) * PAGE, S.page * PAGE);
  $('#anggotaTable').innerHTML = `
    <div class="tbl-wrap"><table><thead><tr><th>No</th><th>Nama</th><th>NIA</th><th>L/P</th><th>Pimda</th><th>Tingkatan</th><th>Status</th>${adm ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map((x, i) => `<tr data-detail="${x.id}"><td>${(S.page - 1) * PAGE + i + 1}</td><td><span class="nm">${avatar(x, 28, true)}<b>${esc(x.nama)}</b></span></td><td>${esc(x.nia || '-')}</td><td>${esc(x.jk || '')}</td><td>${esc(pimdaName(x.pimda_id))}</td><td>${tkCell(x.tingkatan)}</td>
    <td><span class="tag ${x.status === 'Aktif' ? 'ok' : 'off'}">${esc(x.status || '-')}</span></td>
    ${adm ? `<td><button class="btn sm" data-edit="anggota" data-id="${x.id}">Ubah</button> <button class="btn sm danger" data-del="anggota" data-id="${x.id}">Hapus</button></td>` : ''}</tr>`).join('')}
    </tbody></table>${rows.length ? '' : '<div class="empty">Tidak ada data yang cocok</div>'}</div>
    <div class="pager"><span>${list.length} anggota ditemukan</span><div>
      <button class="btn sm" id="pp" ${S.page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button><span>Hal. ${S.page} / ${pages}</span>
      <button class="btn sm" id="pn" ${S.page >= pages ? 'disabled' : ''}>Berikutnya ›</button></div></div>`;
  $('#pp').onclick = () => { S.page--; renderAnggotaTable(); };
  $('#pn').onclick = () => { S.page++; renderAnggotaTable(); };
}

function wireSearch() {
  const inp = $('#hq'); if (!inp) return;
  const box = $('#hres');
  const run = () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2) { box.innerHTML = '<p class="hint">Ketik minimal 2 huruf nama atau NIA untuk mencari anggota.</p>'; return; }
    const m = D.anggota.filter(x => (x.nama || '').toLowerCase().includes(q) || (x.nia || '').toLowerCase().includes(q));
    if (!m.length) { box.innerHTML = '<div class="empty">Tidak ditemukan. Coba ejaan lain.</div>'; return; }
    box.innerHTML = `<div class="hres-list">${m.slice(0, 8).map(x => `<div class="hr-item" data-detail="${x.id}">${avatar(x, 40, true)}<div class="hr-main"><b>${esc(x.nama)}</b><span>${esc(pimdaName(x.pimda_id))} · ${esc(x.tingkatan || '-')}</span></div><span class="tag ${x.status === 'Aktif' ? 'ok' : 'off'}">${esc(x.status || '-')}</span></div>`).join('')}</div>
      <div class="pager"><span>${m.length} hasil ditemukan</span>${m.length > 8 ? '<button class="btn sm" id="hmore">Lihat semua hasil →</button>' : ''}</div>`;
    const mb = $('#hmore'); if (mb) mb.onclick = () => { S.q = inp.value.trim(); S.page = 1; location.hash = '#anggota'; };
  };
  inp.oninput = run; run();
}
const RENDER = { beranda: renderBeranda, pengurus: renderPengurus, pimda: renderPimda, anggota: renderAnggota };
function show(v) {
  if (!RENDER[v]) v = 'beranda';
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + v));
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.v === v));
  RENDER[v]();
  if (v === 'beranda') wireSearch();
}
const rerender = () => show((location.hash || '#beranda').slice(1));

/* ---------- Dialog CRUD ---------- */
function dialog(html) { const d = $('#dlg'); d.innerHTML = `<div class="dlg">${html}</div>`; if (!d.open) d.showModal(); return d; }
function closeDlg() { $('#dlg').close(); }

function openForm(kind, id) {
  const item = id ? D[kind].find(x => x.id === id) : {};
  const F = FIELDS[kind];
  const field = f => {
    const v = item[f.k] ?? '';
    let input;
    if (f.type === 'select') {
      const o = f.opts().map(x => { const [val, lab] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`; }).join('');
      input = `<select name="${f.k}" ${f.req ? 'required' : ''}><option value="">-- pilih --</option>${o}</select>`;
    } else if (f.type === 'textarea') input = `<textarea name="${f.k}" rows="2">${esc(v)}</textarea>`;
    else input = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.req ? 'required' : ''}>`;
    return `<label class="${f.full ? 'full' : ''}">${f.l}${f.req ? ' *' : ''}${input}</label>`;
  };
  const d = dialog(`<h3>${id ? 'Ubah' : 'Tambah'} ${TITLES[kind]}</h3>
    <form id="frm" class="frm">${F.map(field).join('')}${kind === 'anggota' ? '<label class="full">Foto (opsional, JPG/PNG)<input type="file" name="fotofile" accept="image/*"></label>' : ''}
      <div class="dlg-actions full" style="grid-column:1/-1"><button type="button" class="btn" id="cx">Batal</button><button class="btn primary">Simpan</button></div></form>`);
  $('#cx').onclick = closeDlg;
  $('#frm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), obj = id ? item : { id: uid(kind) };
    F.forEach(f => { let v = (fd.get(f.k) || '').toString().trim(); if (f.type === 'number' && v !== '') v = Number(v); obj[f.k] = v; });
    const ff = fd.get('fotofile');
    if (kind === 'anggota' && ff && ff.size) {
      try { PHOTOS[obj.id] = await resizePhoto(ff); obj.foto = `foto/${obj.id}.jpg`; dirty.add('foto'); }
      catch (err) { toast(err.message, true); return; }
    }
    if (!id) D[kind].push(obj);
    markDirty(kind); closeDlg(); rerender(); toast('Tersimpan di draf. Klik "Simpan ke GitHub" agar tampil online.');
  };
}
function delItem(kind, id) {
  const it = D[kind].find(x => x.id === id);
  if (!confirm(`Hapus "${it.nama}"?`)) return;
  if (kind === 'pimda' && D.anggota.some(a => a.pimda_id === id)) { alert('Pimda ini masih memiliki anggota. Pindahkan atau hapus anggotanya dulu.'); return; }
  D[kind] = D[kind].filter(x => x.id !== id);
  markDirty(kind); rerender();
}
/* ---------- Foto, detail, riwayat, kartu ---------- */
function resizePhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const W = 300, H = 400, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'), k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.onerror = () => rej(new Error('Foto tidak dapat dibaca'));
    img.src = URL.createObjectURL(file);
  });
}
const fotoSrc = x => PHOTOS[x.id] ? 'data:image/jpeg;base64,' + PHOTOS[x.id] : (x.foto ? x.foto + '?v=' + encodeURIComponent(D.config.diperbarui || '') : '');
function avatar(x, s, round, cls = '') {
  const st = `width:${s}px;height:${round ? s : Math.round(s * 4 / 3)}px;border-radius:${round ? '50%' : '8px'}`;
  const src = fotoSrc(x);
  if (src) return `<img class="av ${cls}" style="${st}" src="${esc(src)}" alt="" loading="lazy">`;
  const ini = (x.nama || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<span class="av ph ${cls}" style="${st};font-size:${Math.round(s / 3)}px">${esc(ini)}</span>`;
}
function openDetail(id) {
  const x = D.anggota.find(a => a.id === id); if (!x) return;
  const adm = isAdmin();
  const rows = [['Nama', x.nama], ['NIA', x.nia], ['Jenis kelamin', { L: 'Laki-laki', P: 'Perempuan' }[x.jk]], ['Tempat, tgl lahir', [x.tempat_lahir, x.tgl_lahir].filter(Boolean).join(', ')],
    ['Pimpinan Daerah', pimdaName(x.pimda_id)], ['Jenjang', jenjangOf(x.tingkatan)], ['Tingkatan', tkLabel(x.tingkatan)], ['Status', x.status], ['Tahun bergabung', x.tahun_bergabung]];
  if (adm) rows.push(['No. HP', x.hp], ['Alamat', x.alamat]);
  const rw = [...(x.riwayat || [])].sort((p, q) => (p.tanggal || '').localeCompare(q.tanggal || ''));
  dialog(`<h3>Detail Anggota</h3>
    <div style="display:flex;gap:16px;flex-wrap:wrap"><div>${avatar(x, 96, false)}</div>
    <dl class="kv" style="flex:1;min-width:240px">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || '-')}</dd>`).join('')}</dl></div>
    <h4 class="hh">Riwayat tingkatan</h4>
    ${rw.length ? `<ul class="hist">${rw.map(r => `<li><b>${esc(r.tingkatan)}</b><span>${esc(r.tanggal || '-')}${r.catatan ? ' · ' + esc(r.catatan) : ''}</span></li>`).join('')}</ul>` : '<p class="sub">Belum ada riwayat kenaikan tingkat.</p>'}
    <div class="dlg-actions">${adm ? '<button class="btn" id="up">+ Naik tingkat</button>' : ''}<button class="btn" id="cd">Kartu anggota</button><button class="btn primary" id="cx">Tutup</button></div>`);
  $('#cx').onclick = closeDlg;
  $('#cd').onclick = () => openCard(id);
  if (adm) $('#up').onclick = () => openPromote(id);
}
function openPromote(id) {
  const x = D.anggota.find(a => a.id === id); if (!x) return;
  dialog(`<h3>Naik tingkat: ${esc(x.nama)}</h3>
    <form id="frm" class="frm">
      <label class="full">Tingkatan baru *<select name="tingkatan" required><option value="">-- pilih --</option>${tkOpts().map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === x.tingkatan ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>
      <label>Tanggal kenaikan<input type="date" name="tanggal" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Catatan<input name="catatan" placeholder="mis. UKT Nov 2026"></label>
      <div class="dlg-actions" style="grid-column:1/-1"><button type="button" class="btn" id="cx">Batal</button><button class="btn primary">Simpan</button></div>
    </form>`);
  $('#cx').onclick = () => openDetail(id);
  $('#frm').onsubmit = e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    x.riwayat = [...(x.riwayat || []), { tingkatan: o.tingkatan, tanggal: o.tanggal, catatan: (o.catatan || '').trim() }];
    x.tingkatan = o.tingkatan;
    markDirty('anggota'); rerender(); openDetail(id); toast('Tingkatan diperbarui di draf.');
  };
}
function openCard(id) {
  const x = D.anggota.find(a => a.id === id); if (!x) return;
  const tgl = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  dialog(`<h3>Kartu Anggota</h3>
    <div class="idcard">
      <div class="ic-head"><img src="logo.png" alt=""><div><b>TAPAK SUCI PUTERA MUHAMMADIYAH</b><span>Pimpinan Wilayah VIII Sumatera Utara</span></div></div>
      <div class="ic-body">${avatar(x, 96, false, 'ic-photo')}
        <dl><dt>Nama</dt><dd><b>${esc(x.nama)}</b></dd><dt>NIA</dt><dd>${esc(x.nia || '-')}</dd>
        <dt>Tingkatan</dt><dd>${esc(tkLabel(x.tingkatan) || '-')}</dd><dt>Pimda</dt><dd>${esc(pimdaName(x.pimda_id))}</dd>
        <dt>Status</dt><dd>${esc(x.status || '-')}</dd></dl></div>
      <div class="ic-foot">Dicetak ${tgl}</div>
    </div>
    <p class="sub" style="margin-top:12px">Tips: pada jendela cetak pilih ukuran kertas A4 dan nonaktifkan "Headers and footers".</p>
    <div class="dlg-actions"><button class="btn" id="cx">Kembali</button><button class="btn primary" id="pr">Cetak</button></div>`);
  $('#cx').onclick = () => openDetail(id);
  $('#pr').onclick = () => { document.body.classList.add('pc'); window.print(); };
}

/* ---------- CSV ---------- */
const CSV_COLS = ['nama', 'nia', 'jk', 'tempat_lahir', 'tgl_lahir', 'pimda', 'tingkatan', 'status', 'tahun_bergabung', 'hp', 'alamat'];
function exportCsv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = filtered().map(x => CSV_COLS.map(c => q(c === 'pimda' ? pimdaName(x.pimda_id) : x[c])).join(','));
  download('anggota-tapaksuci-sumut.csv', '\ufeff' + [CSV_COLS.join(','), ...rows].join('\r\n'), 'text/csv');
}
function parseCsv(t) {
  const out = []; let row = [], cur = '', inq = false;
  t = t.replace(/^\ufeff/, '');
  const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inq) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c; }
    else if (c === '"') inq = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim())) out.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim())) out.push(row);
  return out;
}
function importCsv() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
  inp.onchange = async () => {
    const rows = parseCsv(await inp.files[0].text());
    const head = rows.shift().map(h => h.trim().toLowerCase());
    let ok = 0, skip = [];
    rows.forEach((r, i) => {
      const o = {}; head.forEach((h, j) => o[h] = (r[j] || '').trim());
      if (!o.nama) return;
      const p = D.pimda.find(p => p.id === o.pimda || p.nama.toLowerCase() === (o.pimda || '').toLowerCase());
      if (!p) { skip.push(`baris ${i + 2} (${o.nama}): Pimda "${o.pimda}" tidak dikenal`); return; }
      D.anggota.push({ id: uid('anggota'), nama: o.nama, nia: o.nia, jk: (o.jk || '').toUpperCase().slice(0, 1), tempat_lahir: o.tempat_lahir, tgl_lahir: o.tgl_lahir, pimda_id: p.id,
        tingkatan: normTk(o.tingkatan), status: o.status || 'Aktif', tahun_bergabung: o.tahun_bergabung ? Number(o.tahun_bergabung) : '', hp: o.hp, alamat: o.alamat });
      ok++;
    });
    if (ok) markDirty('anggota');
    rerender();
    alert(`${ok} anggota diimpor.` + (skip.length ? `\n\nDilewati (${skip.length}):\n` + skip.slice(0, 15).join('\n') : ''));
  };
  inp.click();
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- Admin & GitHub ---------- */
function openAdmin() {
  if (window.DEMO) { window.DEMO.admin = !window.DEMO.admin; refreshPublish(); rerender(); toast(window.DEMO.admin ? 'Mode ADMIN aktif (pratinjau)' : 'Mode PENGUNJUNG PUBLIK (pratinjau)'); return; }
  const g = GH() || {};
  const dl = ['pengurus', 'pimda', 'anggota'].map(k => `<button class="btn sm" data-dl="${k}">Unduh ${k}.json</button>`).join(' ');
  dialog(`<h3>Admin &amp; Sambungan GitHub</h3>
    <p style="font-size:.88rem;color:var(--mute);margin-top:0">Isi sekali. Token hanya tersimpan di browser ini (localStorage) dan dikirim langsung ke api.github.com.</p>
    <form id="frm" class="frm">
      <label>Pemilik repo (username/org)<input name="owner" value="${esc(g.owner || '')}" required placeholder="mis. pimwil8-tapaksuci"></label>
      <label>Nama repo<input name="repo" value="${esc(g.repo || '')}" required placeholder="mis. database-pimwil8"></label>
      <label>Branch<input name="branch" value="${esc(g.branch || 'main')}" required></label>
      <label>Personal Access Token<input name="token" type="password" value="${esc(g.token || '')}" required placeholder="github_pat_..."></label>
      <div class="dlg-actions" style="grid-column:1/-1">
        ${g.token ? '<button type="button" class="btn danger" id="out">Keluar</button>' : ''}
        <button type="button" class="btn" id="cx">Tutup</button><button class="btn primary">Simpan &amp; masuk</button></div>
    </form>
    <div class="note">Buat token di GitHub: Settings → Developer settings → Fine-grained tokens. Pilih hanya repo ini, izin <b>Contents: Read and write</b>. Siapa pun yang memegang token dapat mengubah data, jadi jangan dibagikan.</div>
    <p style="font-size:.85rem;margin:8px 0 4px">Cadangan manual (tanpa token):</p><div>${dl}</div>`);
  $('#cx').onclick = closeDlg;
  if ($('#out')) $('#out').onclick = () => { localStorage.removeItem('ts_gh'); closeDlg(); refreshPublish(); rerender(); toast('Keluar dari mode admin'); };
  $('#frm').onsubmit = async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target)); Object.keys(o).forEach(k => o[k] = o[k].trim());
    try {
      const r = await fetch(`https://api.github.com/repos/${o.owner}/${o.repo}`, { headers: hdr(o.token) });
      if (!r.ok) throw new Error('Repo tidak dapat diakses (' + r.status + '). Periksa nama repo dan token.');
      const j = await r.json();
      if (j.permissions && !j.permissions.push) throw new Error('Token tidak punya izin menulis ke repo ini.');
      localStorage.setItem('ts_gh', JSON.stringify(o)); closeDlg(); refreshPublish(); rerender(); toast('Mode admin aktif');
    } catch (err) { toast(err.message, true); }
  };
}
const hdr = t => ({ Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' });
const b64 = s => btoa(unescape(encodeURIComponent(s)));

async function publish() {
  if (window.DEMO) { dirty.clear(); refreshPublish(); toast('Pratinjau: perubahan TIDAK dikirim ke GitHub. Di situs asli, tombol ini menyimpan ke repo.'); return; }
  const g = GH(); if (!g) return openAdmin();
  const btn = $('#btnPublish'); btn.disabled = true;
  try {
    for (const k of [...dirty]) {
      btn.textContent = 'Menyimpan ' + k + '...';
      if (k === 'foto') {
        for (const [pid, b] of Object.entries(PHOTOS)) { await putB64(g, `foto/${pid}.jpg`, b, 'Unggah foto anggota'); delete PHOTOS[pid]; }
        dirty.delete(k); continue;
      }
      const url = `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${FILES[k]}`;
      let sha; const r = await fetch(url + '?ref=' + encodeURIComponent(g.branch), { headers: hdr(g.token) });
      if (r.ok) sha = (await r.json()).sha; else if (r.status !== 404) throw new Error('Gagal membaca ' + FILES[k] + ' (' + r.status + ')');
      const body = { message: `Perbarui ${k} via aplikasi database`, content: b64(JSON.stringify(D[k], null, 2) + '\n'), branch: g.branch };
      if (sha) body.sha = sha;
      const w = await fetch(url, { method: 'PUT', headers: { ...hdr(g.token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!w.ok) throw new Error('Gagal menyimpan ' + FILES[k] + ': ' + ((await w.json()).message || w.status));
      dirty.delete(k);
    }
    toast('Berhasil disimpan ke GitHub. Situs online diperbarui dalam ±1 menit.');
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; refreshPublish();
}

async function putB64(g, path, b64content, msg) {
  const url = `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${path}`;
  let sha; const r = await fetch(url + '?ref=' + encodeURIComponent(g.branch), { headers: hdr(g.token) });
  if (r.ok) sha = (await r.json()).sha; else if (r.status !== 404) throw new Error('Gagal membaca ' + path + ' (' + r.status + ')');
  const body = { message: msg, content: b64content, branch: g.branch }; if (sha) body.sha = sha;
  const w = await fetch(url, { method: 'PUT', headers: { ...hdr(g.token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!w.ok) throw new Error('Gagal menyimpan ' + path + ': ' + ((await w.json()).message || w.status));
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-add],[data-edit],[data-del],[data-detail],[data-dl],[data-filterpimda]'); if (!t) return;
  if (t.dataset.add) openForm(t.dataset.add);
  else if (t.dataset.edit) { e.stopPropagation(); openForm(t.dataset.edit, t.dataset.id); }
  else if (t.dataset.del) { e.stopPropagation(); delItem(t.dataset.del, t.dataset.id); }
  else if (t.dataset.dl) download(t.dataset.dl + '.json', JSON.stringify(D[t.dataset.dl], null, 2));
  else if (t.dataset.filterpimda) { S.pimda = t.dataset.filterpimda; S.page = 1; }
  else if (t.dataset.detail) openDetail(t.dataset.detail);
});
$('#btnAdmin').onclick = openAdmin;
$('#btnPublish').onclick = publish;
window.addEventListener('hashchange', rerender);
load().then(() => { refreshPublish(); rerender(); });
window.addEventListener('afterprint', () => document.body.classList.remove('pc'));
