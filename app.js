'use strict';
/* Database Pimpinan Wilayah VIII Tapak Suci Sumatera Utara : versi Supabase
   - Publik: melihat & mencari (data aman, tanpa HP/alamat/tgl lahir)
   - Operator Pimda: login, hanya dapat mengubah data Pimda sendiri
   - Admin Pimwil: login, dapat mengubah semuanya
   Pembatasan akses sesungguhnya dijaga oleh database (lihat supabase/schema.sql). */

const CFG = window.CFG || {};
const D = {
  pengurus: [], pimda: [], cabang: [], unit: [],
  stats: { total: 0, aktif: 0, per_pimda: {}, per_cabang: {}, per_unit: {}, per_tingkatan: {}, per_jk: {} },
  config: { jenjang: [], status: ['Aktif', 'Tidak Aktif'], jumlah_pimda_target: 23 }
};
const S = { q: '', jenjang: '', pimda: '', cabang: '', unit: '', tingkatan: '', status: '', page: 1 };
const PAGE = 25;
let ME = null, api = null, LIST = { rows: [], total: 0 }, reqId = 0;
const CACHE = new Map();
const cacheRows = rows => rows.forEach(r => CACHE.set(r.id, r));

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const byUrut = (a, b) => (a.urut ?? 999) - (b.urut ?? 999);
const pimdaName = id => (D.pimda.find(p => p.id === id) || {}).nama || '-';
const cabangName = id => (D.cabang.find(c => c.id === id) || {}).nama || '';
const unitName = id => (D.unit.find(u => u.id === id) || {}).nama || '';
const yearOf = r => r.tahun ?? (r.tanggal ? Number(String(r.tanggal).slice(0, 4)) || null : null);
const thisYear = () => new Date().getFullYear();
const tkGroups = cur => (D.config.jenjang || []).map(g => `<optgroup label="${esc(g.nama)}">${g.tingkatan.map(t => `<option value="${esc(t.nama)}" ${t.nama === cur ? 'selected' : ''}>${esc(t.nama + (t.alias ? ' — ' + t.alias : '') + (t.singkatan ? ` (${t.singkatan})` : ''))}</option>`).join('')}</optgroup>`).join('');

/* ---------- Hak akses di sisi tampilan (penjaga sebenarnya: database) ---------- */
const isAdmin = () => !!ME && ME.role === 'admin';
const isPimdaUser = () => !!ME && ME.role === 'pimda';
const myPimda = () => (ME && ME.pimda_id) || '';
const canPimda = id => !!id && (isAdmin() || (isPimdaUser() && myPimda() === id));
const canEditPengurus = p => p.pimda_id ? canPimda(p.pimda_id) : isAdmin();
const canAddAnggota = () => isAdmin() || isPimdaUser();
const useFull = () => isAdmin() || (isPimdaUser() && S.pimda === myPimda());

/* ---------- Jenjang & tingkatan ---------- */
const TK = () => (D.config.jenjang || []).flatMap(g => g.tingkatan.map(t => ({ ...t, jenjang: g.nama })));
const tkOpts = () => TK().map(t => [t.nama, t.nama + (t.singkatan ? ` (${t.singkatan})` : '')]);
const tkInfo = n => TK().find(t => t.nama === n);
const jenjangOf = n => (tkInfo(n) || {}).jenjang || '';
const tkLabel = n => { const t = tkInfo(n); return t ? t.nama + (t.alias ? ' / ' + t.alias : '') + (t.singkatan ? ` (${t.singkatan})` : '') : (n || ''); };
const tkCell = n => { const t = tkInfo(n); return esc(n || '-') + (t && t.singkatan ? ` <span class="tag">${esc(t.singkatan)}</span>` : ''); };
const normTk = v => { v = (v || '').trim(); const l = v.toLowerCase(); const t = TK().find(t => [t.nama, t.alias, t.singkatan].some(x => x && x.toLowerCase() === l)); return t ? t.nama : v; };

/* ---------- Lapisan data: Supabase ---------- */
function makeSupabaseApi() {
  if (!window.supabase || !CFG.SUPABASE_URL || /XXXX/.test(CFG.SUPABASE_URL) || /ISI_DENGAN/.test(CFG.SUPABASE_ANON_KEY || '')) return null;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const clean = s => String(s || '').replace(/[,()%*\\]/g, ' ').trim();
  const ANG_PUB = 'id,nama,nia,jk,pimda_id,cabang_id,unit_id,tingkatan,status,tahun_bergabung,foto_path,riwayat,updated_at';
  const strip = o => { const { id, updated_at, ...rest } = o; return [id, rest]; };
  return {
    async profile() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const r = await sb.from('profiles').select('role,pimda_id,nama').eq('user_id', session.user.id).maybeSingle();
      must(r);
      return r.data ? { ...r.data, email: session.user.email } : { role: 'none', email: session.user.email };
    },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async changePassword(pw) { must(await sb.auth.updateUser({ password: pw })); },
    async stats() { return must(await sb.rpc('statistik')); },

    async listPimda() { return must(await sb.from('pimda_publik').select('*').order('urut')); },
    async getPimda(id) { return must(await sb.from('pimda').select('*').eq('id', id).single()); },
    async savePimda(o, isNew) {
      if (isNew) must(await sb.from('pimda').insert(o));
      else { const [id, rest] = strip(o); must(await sb.from('pimda').update(rest).eq('id', id)); }
    },
    async deletePimda(id) { must(await sb.from('pimda').delete().eq('id', id)); },

    async listPengurus(loggedIn) {
      const pub = must(await sb.from('pengurus_publik').select('*').order('urut'));
      if (!loggedIn) return pub;
      const full = must(await sb.from('pengurus').select('*'));
      const m = new Map(full.map(x => [x.id, x]));
      return pub.map(x => m.get(x.id) || x);
    },
    async savePengurus(o, isNew) {
      if (isNew) must(await sb.from('pengurus').insert(o));
      else { const [id, rest] = strip(o); must(await sb.from('pengurus').update(rest).eq('id', id)); }
    },
    async deletePengurus(id) { must(await sb.from('pengurus').delete().eq('id', id)); },

    async listCabang(loggedIn) {
      const pub = must(await sb.from('cabang_publik').select('*').order('urut').order('nama'));
      if (!loggedIn) return pub;
      const full = must(await sb.from('cabang').select('*'));
      const m = new Map(full.map(x => [x.id, x])); return pub.map(x => m.get(x.id) || x);
    },
    async saveCabang(o, isNew) {
      if (isNew) must(await sb.from('cabang').insert(o));
      else { const [id, rest] = strip(o); must(await sb.from('cabang').update(rest).eq('id', id)); }
    },
    async deleteCabang(id) { must(await sb.from('cabang').delete().eq('id', id)); },
    async listUnit(loggedIn) {
      const pub = must(await sb.from('unit_publik').select('*').order('urut').order('nama'));
      if (!loggedIn) return pub;
      const full = must(await sb.from('unit_latihan').select('*'));
      const m = new Map(full.map(x => [x.id, x])); return pub.map(x => m.get(x.id) || x);
    },
    async saveUnit(o, isNew) {
      if (isNew) must(await sb.from('unit_latihan').insert(o));
      else { const [id, rest] = strip(o); must(await sb.from('unit_latihan').update(rest).eq('id', id)); }
    },
    async deleteUnit(id) { must(await sb.from('unit_latihan').delete().eq('id', id)); },

    async listAnggota(p) {
      let q = sb.from(p.full ? 'anggota' : 'anggota_publik').select(p.full ? '*' : ANG_PUB, { count: 'exact' });
      if (p.pimda) q = q.eq('pimda_id', p.pimda);
      if (p.cabang) q = q.eq('cabang_id', p.cabang);
      if (p.unit) q = q.eq('unit_id', p.unit);
      if (p.tingkatan) q = q.eq('tingkatan', p.tingkatan);
      else if (p.jenjangNames) q = q.in('tingkatan', p.jenjangNames);
      if (p.status) q = q.eq('status', p.status);
      const s = clean(p.q);
      if (s) q = q.or(`nama.ilike.%${s}%,nia.ilike.%${s}%`);
      const from = (p.page - 1) * p.size;
      const r = await q.order('nama').range(from, from + p.size - 1);
      if (r.error) throw new Error(r.error.message);
      return { rows: r.data, total: r.count || 0 };
    },
    async getAnggota(id, full) {
      return must(await sb.from(full ? 'anggota' : 'anggota_publik').select(full ? '*' : ANG_PUB).eq('id', id).single());
    },
    async saveAnggota(o, isNew, blob) {
      if (blob) {
        const path = `${o.pimda_id}/${o.id}.jpg`;
        must(await sb.storage.from('foto').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }));
        o.foto_path = path;
      }
      if (isNew) must(await sb.from('anggota').insert(o));
      else { const [id, rest] = strip(o); must(await sb.from('anggota').update(rest).eq('id', id)); }
    },
    async deleteAnggota(row) {
      must(await sb.from('anggota').delete().eq('id', row.id));
      if (row.foto_path) { try { await sb.storage.from('foto').remove([row.foto_path]); } catch { /* abaikan */ } }
    },
    async importAnggota(rows) {
      for (let i = 0; i < rows.length; i += 200) must(await sb.from('anggota').insert(rows.slice(i, i + 200)));
    },
    fotoUrl(x) {
      if (!x.foto_path) return '';
      return sb.storage.from('foto').getPublicUrl(x.foto_path).data.publicUrl + '?v=' + encodeURIComponent(x.updated_at || '');
    }
  };
}

/* ---------- Util UI ---------- */
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), err ? 7000 : 3200);
}
function bars(rows, max) {
  max = max || Math.max(1, ...rows.map(r => r[1]));
  return rows.map(([l, n]) => `<div class="bar-row"><span class="lbl" title="${esc(l)}">${esc(l)}</span><div class="bar"><i style="width:${(n / max) * 100}%"></i></div><span class="n">${n}</span></div>`).join('') || '<div class="empty">Belum ada data</div>';
}
function dialog(html) { const d = $('#dlg'); d.innerHTML = `<div class="dlg">${html}</div>`; if (!d.open) d.showModal(); return d; }
function closeDlg() { const d = $('#dlg'); if (d.open) d.close(); }
function download(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function avatar(x, s, round, cls = '') {
  const st = `width:${s}px;height:${round ? s : Math.round(s * 4 / 3)}px;border-radius:${round ? '50%' : '8px'}`;
  const src = api.fotoUrl(x);
  if (src) return `<img class="av ${cls}" style="${st}" src="${esc(src)}" alt="" loading="lazy">`;
  const ini = (x.nama || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<span class="av ph ${cls}" style="${st};font-size:${Math.round(s / 3)}px">${esc(ini)}</span>`;
}
function resizePhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const W = 300, H = 400, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'), k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? res(b) : rej(new Error('Gagal memproses foto')), 'image/jpeg', 0.82);
    };
    img.onerror = () => rej(new Error('Foto tidak dapat dibaca'));
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- Muat data ---------- */
async function loadAll() {
  const [st, pimda, pengurus, cabang, unit] = await Promise.all([api.stats(), api.listPimda(), api.listPengurus(!!ME), api.listCabang(!!ME), api.listUnit(!!ME)]);
  D.stats = st; D.pimda = pimda.sort(byUrut); D.pengurus = pengurus; D.cabang = cabang; D.unit = unit;
}
async function afterChange() { await loadAll(); refreshAuth(); rerender(); }
async function syncSession() {
  ME = await api.profile();
  S.pimda = isPimdaUser() ? myPimda() : '';
  S.page = 1;
  await loadAll(); refreshAuth(); rerender();
}
function refreshAuth() {
  const b = $('#btnAuth');
  b.textContent = !ME ? 'Masuk' : '👤 ' + (isAdmin() ? 'Admin Pimwil' : isPimdaUser() ? pimdaName(ME.pimda_id) : (ME.email || 'Akun'));
}

/* ---------- Beranda ---------- */
function renderBeranda() {
  const st = D.stats, known = TK().map(t => t.nama);
  const perPimda = D.pimda.map(p => [p.nama, st.per_pimda[p.id] || 0]).sort((a, b) => b[1] - a[1]);
  const perTk = known.map(n => [n, st.per_tingkatan[n] || 0]);
  Object.entries(st.per_tingkatan).forEach(([n, c]) => { if (!known.includes(n)) perTk.push([n || '(kosong)', c]); });
  const perJen = (D.config.jenjang || []).map(g => [g.nama, g.tingkatan.reduce((s, t) => s + (st.per_tingkatan[t.nama] || 0), 0)]);
  const jk = [['Laki-laki', st.per_jk.L || 0], ['Perempuan', st.per_jk.P || 0]];
  const target = D.config.jumlah_pimda_target || 23;
  $('#v-beranda').innerHTML = `
    <div class="hero"><img src="logo.png" alt="Logo Tapak Suci"><div><h2>Database Pimpinan Wilayah VIII</h2><p>Tapak Suci Putera Muhammadiyah &middot; Provinsi Sumatera Utara</p></div></div>
    <div class="searchbox"><input type="search" id="hq" placeholder="🔍 Cari nama atau NIA anggota..." autocomplete="off" aria-label="Cari anggota"><div id="hres"></div></div>
    <div class="grid stats">
      <div class="stat"><b>${st.total}</b><span>Total anggota</span></div>
      <div class="stat"><b>${st.aktif}</b><span>Anggota aktif</span></div>
      <div class="stat"><b>${D.pimda.length}<small style="font-size:1rem;color:var(--mute)"> / ${target}</small></b><span>Pimpinan Daerah</span></div>
      <div class="stat"><b>${D.cabang.length}</b><span>Pimpinan Cabang</span></div>
      <div class="stat"><b>${D.unit.length}</b><span>Unit Latihan</span></div>
      <div class="stat"><b>${D.pengurus.filter(p => !p.pimda_id).length}</b><span>Pengurus Pimwil</span></div>
    </div>
    <div class="grid two">
      <div class="card"><h3>Anggota per Pimpinan Daerah</h3>${bars(perPimda)}</div>
      <div>
        <div class="card" style="margin-bottom:14px"><h3>Anggota per Jenjang</h3>${bars(perJen)}</div>
        <div class="card" style="margin-bottom:14px"><h3>Anggota per Tingkatan</h3>${bars(perTk)}</div>
        <div class="card"><h3>Jenis Kelamin</h3>${bars(jk)}</div>
      </div>
    </div>`;
  wireSearch();
}
function wireSearch() {
  const inp = $('#hq'); if (!inp) return;
  const box = $('#hres'); let timer, my = 0;
  const run = async () => {
    const q = inp.value.trim();
    if (q.length < 2) { box.innerHTML = '<p class="hint">Ketik minimal 2 huruf nama atau NIA untuk mencari anggota.</p>'; return; }
    const id = ++my;
    try {
      const r = await api.listAnggota({ q, page: 1, size: 8, full: false });
      if (id !== my) return;
      cacheRows(r.rows);
      if (!r.rows.length) { box.innerHTML = '<div class="empty">Tidak ditemukan. Coba ejaan lain.</div>'; return; }
      box.innerHTML = `<div class="hres-list">${r.rows.map(x => `<div class="hr-item" data-detail="${x.id}">${avatar(x, 40, true)}<div class="hr-main"><b>${esc(x.nama)}</b><span>${esc(pimdaName(x.pimda_id))} · ${esc(x.tingkatan || '-')}</span></div><span class="tag ${x.status === 'Aktif' ? 'ok' : 'off'}">${esc(x.status || '-')}</span></div>`).join('')}</div>
        <div class="pager"><span>${r.total} hasil ditemukan</span>${r.total > 8 ? '<button class="btn sm" id="hmore">Lihat semua hasil →</button>' : ''}</div>`;
      const mb = $('#hmore'); if (mb) mb.onclick = () => { S.q = q; S.page = 1; S.pimda = isPimdaUser() ? S.pimda : ''; location.hash = '#anggota'; if (location.hash === '#anggota') rerender(); };
    } catch (e) { if (id === my) box.innerHTML = `<div class="empty">Gagal mencari: ${esc(e.message)}</div>`; }
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 280); };
  run();
}

/* ---------- Struktur Pengurus (Pimwil) ---------- */
function renderPengurus() {
  const list = D.pengurus.filter(p => !p.pimda_id).sort(byUrut), adm = isAdmin();
  $('#v-pengurus').innerHTML = `
    <div class="head-row"><div><h2>Struktur Pengurus</h2><p class="sub">Susunan pengurus Pimpinan Wilayah VIII</p></div>
    ${adm ? '<button class="btn primary" data-add="pengurus">+ Tambah pengurus</button>' : ''}</div>
    <div class="grid cards">${list.map(p => `
      <div class="person ${(p.urut || 99) <= 6 ? 'core' : ''}">
        <span class="role">${esc(p.jabatan)}</span>
        <h4>${esc(p.nama)}</h4>
        <div class="meta">${esc(p.bidang || '')}</div>
        ${p.hp ? `<div class="meta">📞 ${esc(p.hp)}</div>` : ''}
        ${adm ? `<div class="acts"><button class="btn sm" data-edit="pengurus" data-id="${p.id}">Ubah</button><button class="btn sm danger" data-del="pengurus" data-id="${p.id}">Hapus</button></div>` : ''}
      </div>`).join('') || '<div class="empty">Belum ada data pengurus</div>'}</div>`;
}

/* ---------- Pimpinan Daerah ---------- */
function renderPimda() {
  const adm = isAdmin();
  $('#v-pimda').innerHTML = `
    <div class="head-row"><div><h2>Pimpinan Daerah</h2><p class="sub">${D.pimda.length} Pimpinan Daerah di bawah Pimwil VIII Sumatera Utara</p></div>
    ${adm ? '<button class="btn primary" data-add="pimda">+ Tambah Pimda</button>' : ''}</div>
    <div class="grid cards">${D.pimda.map((p, i) => {
      const n = D.stats.per_pimda[p.id] || 0, mine = canPimda(p.id);
      return `<div class="person pimda-card ${mine ? 'core' : ''}"><span class="no">${String(i + 1).padStart(2, '0')}</span>
        <h4>${esc(p.nama)}</h4>
        <div class="meta">${esc(p.wilayah || '')}</div>
        <div class="meta">Ketua: ${esc(p.ketua || '-')}</div>
        <div class="meta">Sekretaris: ${esc(p.sekretaris || '-')}</div>
        ${p.alamat ? `<div class="meta">📍 ${esc(p.alamat)}</div>` : ''}
        <div class="cnt"><b>${n}</b> anggota · ${D.cabang.filter(c => c.pimda_id === p.id).length} cabang · ${D.unit.filter(u => u.pimda_id === p.id).length} unit latihan</div>
        <div class="acts"><button class="btn sm" data-pimdadetail="${p.id}">Detail &amp; pengurus</button>
        <button class="btn sm" data-filterpimda="${p.id}">Daftar anggota</button>
        ${mine ? `<button class="btn sm" data-edit="pimda" data-id="${p.id}">Ubah</button>` : ''}
        ${adm ? `<button class="btn sm danger" data-del="pimda" data-id="${p.id}">Hapus</button>` : ''}</div>
      </div>`;
    }).join('') || '<div class="empty">Belum ada data Pimda</div>'}</div>`;
}
function cabangTree(pid, can) {
  const cs = D.cabang.filter(c => c.pimda_id === pid);
  if (!cs.length) return '<p class="sub">Belum ada data cabang.</p>';
  return `<div class="tree">${cs.map(c => {
    const us = D.unit.filter(u => u.cabang_id === c.id);
    return `<div class="tree-cab"><div class="plist-item"><div><b>${esc(c.nama)}</b><span>${c.wilayah ? esc(c.wilayah) + ' · ' : ''}Ketua: ${esc(c.ketua || '-')} · ${D.stats.per_cabang[c.id] || 0} anggota${c.hp ? ' · 📞 ' + esc(c.hp) : ''}</span></div>
      <div class="acts"><button class="btn sm" data-filtercabang="${c.id}">Anggota</button>${can ? `<button class="btn sm" data-add="unit" data-cabang="${c.id}">+ Unit</button><button class="btn sm" data-edit="cabang" data-id="${c.id}">Ubah</button><button class="btn sm danger" data-del="cabang" data-id="${c.id}">Hapus</button>` : ''}</div></div>
      ${us.map(u => `<div class="plist-item tree-unit"><div><b>↳ ${esc(u.nama)}</b><span>${[u.pelatih ? 'Pelatih: ' + esc(u.pelatih) : '', u.lokasi ? '📍 ' + esc(u.lokasi) : '', u.jadwal ? '🕒 ' + esc(u.jadwal) : ''].filter(Boolean).join(' · ') || '-'} · ${D.stats.per_unit[u.id] || 0} anggota</span></div>
        <div class="acts"><button class="btn sm" data-filterunit="${u.id}">Anggota</button>${can ? `<button class="btn sm" data-edit="unit" data-id="${u.id}">Ubah</button><button class="btn sm danger" data-del="unit" data-id="${u.id}">Hapus</button>` : ''}</div></div>`).join('')}</div>`;
  }).join('')}</div>`;
}
async function openPimdaDetail(id) {
  const p = D.pimda.find(x => x.id === id); if (!p) return;
  const can = canPimda(id); let full = p;
  if (can) { try { full = await api.getPimda(id); } catch { /* tampilkan data publik */ } }
  const pg = D.pengurus.filter(x => x.pimda_id === id).sort(byUrut);
  const rows = [['Kab./Kota', p.wilayah], ['Ketua', p.ketua], ['Sekretaris', p.sekretaris], ['Alamat', p.alamat], ['Jumlah anggota', D.stats.per_pimda[id] || 0]];
  if (full.hp !== undefined) rows.splice(3, 0, ['No. HP', full.hp]);
  dialog(`<h3>${esc(p.nama)}</h3>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || '-')}</dd>`).join('')}</dl>
    <h4 class="hh">Pengurus Pimda</h4>
    ${pg.length ? `<div class="plist">${pg.map(x => `<div class="plist-item"><div><b>${esc(x.nama)}</b><span>${esc(x.jabatan)}${x.bidang ? ' · ' + esc(x.bidang) : ''}${x.hp ? ' · 📞 ' + esc(x.hp) : ''}</span></div>
      ${can ? `<div class="acts"><button class="btn sm" data-edit="pengurus" data-id="${x.id}">Ubah</button><button class="btn sm danger" data-del="pengurus" data-id="${x.id}">Hapus</button></div>` : ''}</div>`).join('')}</div>` : '<p class="sub">Belum ada data pengurus Pimda ini.</p>'}
    <h4 class="hh">Pimpinan Cabang &amp; Unit Latihan</h4>${cabangTree(id, can)}
    <div class="dlg-actions">${can ? `<button class="btn" data-add="pengurus" data-pimda="${id}">+ Tambah pengurus</button><button class="btn" data-add="cabang" data-pimda="${id}">+ Tambah cabang</button>` : ''}
      <button class="btn" data-filterpimda="${id}">Lihat anggota</button><button class="btn primary" id="cx">Tutup</button></div>`);
  $('#cx').onclick = closeDlg;
}

/* ---------- Anggota ---------- */
function listParams() {
  const g = S.jenjang ? (D.config.jenjang || []).find(x => x.nama === S.jenjang) : null;
  return { q: S.q, pimda: S.pimda, cabang: S.cabang, unit: S.unit, tingkatan: S.tingkatan, status: S.status, jenjangNames: g ? g.tingkatan.map(t => t.nama) : null, page: S.page, size: PAGE, full: useFull() };
}
function renderAnggota() {
  const opt = (arr, cur) => arr.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
  const editor = canAddAnggota();
  $('#v-anggota').innerHTML = `
    <div class="head-row"><div><h2>Data Anggota</h2><p class="sub">${isPimdaUser() ? 'Anda masuk sebagai operator ' + esc(pimdaName(myPimda())) + '. Anda dapat mengubah data Pimda Anda saja.' : 'Seluruh anggota Tapak Suci di bawah Pimwil VIII Sumatera Utara'}</p></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn" id="btnCsv">Unduh CSV</button>
      ${editor ? '<button class="btn" id="btnTpl">Template CSV</button><button class="btn" id="btnImport">Impor CSV</button><button class="btn primary" data-add="anggota">+ Tambah anggota</button>' : ''}
    </div></div>
    <div class="toolbar">
      <input type="search" id="fq" placeholder="Cari nama atau NIA..." value="${esc(S.q)}">
      <select id="fj"><option value="">Semua jenjang</option>${opt((D.config.jenjang || []).map(g => g.nama), S.jenjang)}</select>
      <select id="fp"><option value="">Semua Pimda</option>${opt(D.pimda.map(p => [p.id, p.nama]), S.pimda)}</select>
      ${S.pimda ? `<select id="fc"><option value="">Semua cabang</option>${opt(D.cabang.filter(c => c.pimda_id === S.pimda).map(c => [c.id, c.nama]), S.cabang)}</select>` : ''}
      ${S.cabang ? `<select id="fu"><option value="">Semua unit latihan</option>${opt(D.unit.filter(u => u.cabang_id === S.cabang).map(u => [u.id, u.nama]), S.unit)}</select>` : ''}
      <select id="ft"><option value="">Semua tingkatan</option>${tkGroups(S.tingkatan)}</select>
      <select id="fs"><option value="">Semua status</option>${opt(D.config.status || [], S.status)}</select>
    </div>
    <div id="anggotaTable"></div>`;
  let timer;
  $('#fq').oninput = e => { S.q = e.target.value; S.page = 1; clearTimeout(timer); timer = setTimeout(loadAnggota, 300); };
  $('#fj').onchange = e => { S.jenjang = e.target.value; S.page = 1; loadAnggota(); };
  $('#fp').onchange = e => { S.pimda = e.target.value; S.cabang = ''; S.unit = ''; S.page = 1; renderAnggota(); };
  if ($('#fc')) $('#fc').onchange = e => { S.cabang = e.target.value; S.unit = ''; S.page = 1; renderAnggota(); };
  if ($('#fu')) $('#fu').onchange = e => { S.unit = e.target.value; S.page = 1; loadAnggota(); };
  $('#ft').onchange = e => { S.tingkatan = e.target.value; S.page = 1; loadAnggota(); };
  $('#fs').onchange = e => { S.status = e.target.value; S.page = 1; loadAnggota(); };
  $('#btnCsv').onclick = exportCsv;
  if (editor) { $('#btnTpl').onclick = downloadTemplate; $('#btnImport').onclick = importCsv; }
  loadAnggota();
}
async function loadAnggota() {
  const box = $('#anggotaTable'); if (!box) return;
  const my = ++reqId;
  box.innerHTML = '<div class="empty">Memuat data...</div>';
  try {
    const r = await api.listAnggota(listParams());
    if (my !== reqId) return;
    LIST = r; cacheRows(r.rows); drawAnggotaTable();
  } catch (e) { if (my === reqId) box.innerHTML = `<div class="empty">Gagal memuat data: ${esc(e.message)}</div>`; }
}
function drawAnggotaTable() {
  const box = $('#anggotaTable'); if (!box) return;
  const pages = Math.max(1, Math.ceil(LIST.total / PAGE));
  box.innerHTML = `
    <div class="tbl-wrap"><table><thead><tr><th>No</th><th>Nama</th><th>NIA</th><th>L/P</th><th>Pimda</th><th>Cabang / Unit</th><th>Tingkatan</th><th>Status</th><th></th></tr></thead><tbody>
    ${LIST.rows.map((x, i) => `<tr data-detail="${x.id}"><td>${(S.page - 1) * PAGE + i + 1}</td><td><span class="nm">${avatar(x, 28, true)}<b>${esc(x.nama)}</b></span></td><td>${esc(x.nia || '-')}</td><td>${esc(x.jk || '')}</td><td>${esc(pimdaName(x.pimda_id))}</td><td>${esc([cabangName(x.cabang_id), unitName(x.unit_id)].filter(Boolean).join(' / ') || '-')}</td><td>${tkCell(x.tingkatan)}</td>
    <td><span class="tag ${x.status === 'Aktif' ? 'ok' : 'off'}">${esc(x.status || '-')}</span></td>
    <td>${canPimda(x.pimda_id) ? `<button class="btn sm" data-edit="anggota" data-id="${x.id}">Ubah</button> <button class="btn sm danger" data-del="anggota" data-id="${x.id}">Hapus</button>` : ''}</td></tr>`).join('')}
    </tbody></table>${LIST.rows.length ? '' : '<div class="empty">Tidak ada data yang cocok</div>'}</div>
    <div class="pager"><span>${LIST.total} anggota ditemukan</span><div>
      <button class="btn sm" id="pp" ${S.page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button><span>Hal. ${S.page} / ${pages}</span>
      <button class="btn sm" id="pn" ${S.page >= pages ? 'disabled' : ''}>Berikutnya ›</button></div></div>`;
  $('#pp').onclick = () => { S.page--; loadAnggota(); };
  $('#pn').onclick = () => { S.page++; loadAnggota(); };
}

/* ---------- Form tambah / ubah ---------- */
const FIELDS = {
  pengurus: [
    { k: 'nama', l: 'Nama lengkap', req: 1 },
    { k: 'jabatan', l: 'Jabatan', req: 1 },
    { k: 'bidang', l: 'Bidang / Divisi' },
    { k: 'hp', l: 'No. HP' },
    { k: 'urut', l: 'Nomor urut tampil', type: 'number' }
  ],
  pimda: [
    { k: 'nama', l: 'Nama Pimda', req: 1, full: 1, adminOnly: 1 },
    { k: 'wilayah', l: 'Kab./Kota cakupan' },
    { k: 'ketua', l: 'Ketua' },
    { k: 'sekretaris', l: 'Sekretaris' },
    { k: 'hp', l: 'No. HP' },
    { k: 'urut', l: 'Nomor urut', type: 'number', adminOnly: 1 },
    { k: 'alamat', l: 'Alamat sekretariat', type: 'textarea', full: 1 }
  ],
  anggota: [
    { k: 'nama', l: 'Nama lengkap', req: 1, full: 1 },
    { k: 'nia', l: 'No. Induk Anggota (NIA)' },
    { k: 'jk', l: 'Jenis kelamin', type: 'select', opts: () => ['L', 'P'] },
    { k: 'tempat_lahir', l: 'Tempat lahir' },
    { k: 'tgl_lahir', l: 'Tanggal lahir', type: 'date' },
    { k: 'pimda_id', l: 'Pimpinan Daerah', type: 'select', req: 1, opts: () => (isAdmin() ? D.pimda : D.pimda.filter(p => p.id === myPimda())).map(p => [p.id, p.nama]) },
    { k: 'cabang_id', l: 'Pimpinan Cabang', type: 'cabang' },
    { k: 'unit_id', l: 'Unit Latihan', type: 'unit' },
    { k: 'tingkatan', l: 'Tingkatan saat ini (sabuk)', type: 'tingkatan' },
    { k: 'status', l: 'Status', type: 'select', opts: () => D.config.status || ['Aktif', 'Tidak Aktif'] },
    { k: 'tahun_bergabung', l: 'Tahun masuk Tapak Suci', type: 'number' },
    { k: 'hp', l: 'No. HP' },
    { k: 'alamat', l: 'Alamat', type: 'textarea', full: 1 }
  ]
};
FIELDS.cabang = [
  { k: 'nama', l: 'Nama Pimpinan Cabang', req: 1, full: 1 },
  { k: 'wilayah', l: 'Kecamatan / wilayah' },
  { k: 'ketua', l: 'Ketua' },
  { k: 'sekretaris', l: 'Sekretaris' },
  { k: 'hp', l: 'No. HP' },
  { k: 'urut', l: 'Nomor urut', type: 'number' },
  { k: 'alamat', l: 'Alamat sekretariat', type: 'textarea', full: 1 }
];
FIELDS.unit = [
  { k: 'nama', l: 'Nama Unit Latihan', req: 1, full: 1 },
  { k: 'pelatih', l: 'Pelatih / penanggung jawab' },
  { k: 'hp', l: 'No. HP pelatih' },
  { k: 'lokasi', l: 'Lokasi latihan', full: 1 },
  { k: 'jadwal', l: 'Jadwal latihan (mis. Selasa & Jumat 16.00)', full: 1 },
  { k: 'urut', l: 'Nomor urut', type: 'number' }
];
const TITLES = { pengurus: 'Pengurus', pimda: 'Pimpinan Daerah', anggota: 'Anggota', cabang: 'Pimpinan Cabang', unit: 'Unit Latihan' };
const RW_BOX = '<div class="full rw-box"><div class="rw-head"><b>Riwayat kenaikan tingkat</b><button type="button" class="btn sm" id="rwAdd">+ Tambah baris</button></div><div id="rwRows"></div><small>Isi tiap tingkatan yang pernah dicapai beserta tahunnya (urutan bebas). Tahun masuk Tapak Suci diisi pada kolom di atas.</small></div>';
function wireAnggotaForm(item) {
  const selP = $('select[name="pimda_id"]'), selC = $('#selCab'), selU = $('#selUnit');
  const none = '<option value="">-- tidak ada / belum diisi --</option>';
  const fillC = (pid, cur) => { selC.innerHTML = none + D.cabang.filter(c => c.pimda_id === pid).map(c => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.nama)}</option>`).join(''); };
  const fillU = (cid, cur) => { selU.innerHTML = none + D.unit.filter(u => u.cabang_id === cid).map(u => `<option value="${esc(u.id)}" ${u.id === cur ? 'selected' : ''}>${esc(u.nama)}</option>`).join(''); };
  fillC(selP.value || item.pimda_id || '', item.cabang_id); fillU(selC.value, item.unit_id);
  selP.onchange = () => { fillC(selP.value, ''); fillU('', ''); };
  selC.onchange = () => fillU(selC.value, '');
  const rows = $('#rwRows');
  const addRow = (r = {}) => {
    const d = document.createElement('div'); d.className = 'rw-row';
    d.innerHTML = `<select class="rw-tk"><option value="">-- tingkatan --</option>${tkGroups(r.tingkatan)}</select><input class="rw-th" type="number" min="1950" max="${thisYear()}" placeholder="Tahun" value="${esc(yearOf(r) ?? '')}"><input class="rw-ct" placeholder="Catatan (opsional)" value="${esc(r.catatan || '')}"><button type="button" class="btn sm danger rw-x">✕</button>`;
    d.querySelector('.rw-x').onclick = () => d.remove(); rows.appendChild(d);
  };
  [...(item.riwayat || [])].sort((a, b) => (yearOf(a) || 0) - (yearOf(b) || 0)).forEach(addRow);
  $('#rwAdd').onclick = () => addRow();
}

async function openForm(kind, id, preset = {}) {
  let item = { ...preset };
  if (id) {
    try {
      item = kind === 'anggota' ? await api.getAnggota(id, true) : kind === 'pimda' ? await api.getPimda(id) : kind === 'cabang' ? { ...D.cabang.find(x => x.id === id) } : kind === 'unit' ? { ...D.unit.find(x => x.id === id) } : { ...D.pengurus.find(x => x.id === id) };
    } catch (e) { return toast(e.message, true); }
  } else if (kind === 'anggota') {
    item = { status: 'Aktif', ...item };
  }
  const F = FIELDS[kind];
  const field = f => {
    const v = item[f.k] ?? '', dis = f.adminOnly && !isAdmin() ? 'disabled' : '';
    if (f.type === 'tingkatan') return `<label>${f.l}<select name="tingkatan"><option value="">-- pilih sabuk --</option>${tkGroups(v)}</select></label>`;
    if (f.type === 'cabang') return `<label>${f.l}<select name="cabang_id" id="selCab"></select></label>`;
    if (f.type === 'unit') return `<label>${f.l}<select name="unit_id" id="selUnit"></select></label>`;
    let input;
    if (f.type === 'select') {
      const o = f.opts().map(x => { const [val, lab] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`; }).join('');
      input = `<select name="${f.k}" ${f.req ? 'required' : ''} ${dis}><option value="">-- pilih --</option>${o}</select>`;
    } else if (f.type === 'textarea') input = `<textarea name="${f.k}" rows="2" ${dis}>${esc(v)}</textarea>`;
    else input = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.req ? 'required' : ''} ${dis}>`;
    return `<label class="${f.full ? 'full' : ''}">${f.l}${f.req ? ' *' : ''}${input}</label>`;
  };
  dialog(`<h3>${id ? 'Ubah' : 'Tambah'} ${TITLES[kind]}</h3>
    <form id="frm" class="frm">${F.map(field).join('')}${kind === 'anggota' ? RW_BOX + '<label class="full">Foto (opsional, JPG/PNG)<input type="file" name="fotofile" accept="image/*"></label>' : ''}
      <div class="dlg-actions full" style="grid-column:1/-1"><button type="button" class="btn" id="cx">Batal</button><button class="btn primary">Simpan</button></div></form>`);
  $('#cx').onclick = closeDlg;
  if (kind === 'anggota') wireAnggotaForm(item);
  $('#frm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = id ? { ...item } : { ...item, id: kind === 'pimda' ? 'pimda-' + Date.now().toString(36) : uuid() };
    F.forEach(f => {
      let v = fd.get(f.k); if (v === null) return;
      v = String(v).trim();
      obj[f.k] = v === '' ? null : (f.type === 'number' ? Number(v) : v);
    });
    if (kind === 'anggota' && !isAdmin()) obj.pimda_id = myPimda();
    if (kind === 'cabang' && !isAdmin()) obj.pimda_id = myPimda();
    if (kind === 'unit') { const c = D.cabang.find(c => c.id === obj.cabang_id); if (c) obj.pimda_id = c.pimda_id; }
    if (kind === 'anggota') {
      const rw = [...document.querySelectorAll('.rw-row')].map(d => ({ tingkatan: d.querySelector('.rw-tk').value, tahun: Number(d.querySelector('.rw-th').value) || null, catatan: d.querySelector('.rw-ct').value.trim() })).filter(r => r.tingkatan || r.tahun || r.catatan);
      for (const r of rw) {
        if (!r.tingkatan || !r.tahun) return toast('Pada riwayat, tingkatan dan tahun harus diisi keduanya (atau hapus barisnya).', true);
        if (r.tahun < 1950 || r.tahun > thisYear()) return toast('Tahun pada riwayat tidak masuk akal: ' + r.tahun, true);
        if (obj.tahun_bergabung && r.tahun < obj.tahun_bergabung) return toast(`Tahun naik tingkat (${r.tahun}) tidak boleh sebelum tahun masuk (${obj.tahun_bergabung}).`, true);
      }
      obj.riwayat = rw.sort((a, b) => a.tahun - b.tahun);
    }
    let blob = null; const ff = fd.get('fotofile');
    if (kind === 'anggota' && ff && ff.size) { try { blob = await resizePhoto(ff); } catch (err) { return toast(err.message, true); } }
    const btn = e.target.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      if (kind === 'anggota') await api.saveAnggota(obj, !id, blob);
      else if (kind === 'pimda') await api.savePimda(obj, !id);
      else if (kind === 'cabang') await api.saveCabang(obj, !id);
      else if (kind === 'unit') await api.saveUnit(obj, !id);
      else await api.savePengurus(obj, !id);
      closeDlg(); await afterChange(); toast('Tersimpan.');
      if (['cabang', 'unit', 'pengurus'].includes(kind) && obj.pimda_id && /pimda$/.test(location.hash)) openPimdaDetail(obj.pimda_id);
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Simpan'; }
  };
}
async function delItem(kind, id) {
  const row = kind === 'anggota' ? CACHE.get(id) : kind === 'pimda' ? D.pimda.find(x => x.id === id) : kind === 'cabang' ? D.cabang.find(x => x.id === id) : kind === 'unit' ? D.unit.find(x => x.id === id) : D.pengurus.find(x => x.id === id);
  const extra = kind === 'cabang' ? ' Unit latihan di bawahnya ikut terhapus; anggota tetap ada.' : kind === 'unit' ? ' Anggota tetap ada.' : '';
  if (!row || !confirm(`Hapus "${row.nama}"? Tindakan ini tidak dapat dibatalkan.${extra}`)) return;
  try {
    if (kind === 'anggota') await api.deleteAnggota(row);
    else if (kind === 'pimda') await api.deletePimda(id);
    else if (kind === 'cabang') await api.deleteCabang(id);
    else if (kind === 'unit') await api.deleteUnit(id);
    else await api.deletePengurus(id);
    closeDlg(); await afterChange(); toast('Dihapus.');
    if (['cabang', 'unit', 'pengurus'].includes(kind) && row.pimda_id && /pimda$/.test(location.hash)) openPimdaDetail(row.pimda_id);
  } catch (e) { toast(/foreign key/i.test(e.message) ? 'Tidak bisa dihapus: Pimda ini masih memiliki anggota.' : e.message, true); }
}

/* ---------- Detail, riwayat, kartu ---------- */
async function openDetail(id) {
  let x = CACHE.get(id); if (!x) return;
  if (canPimda(x.pimda_id)) { try { x = await api.getAnggota(id, true); } catch { /* pakai data publik */ } }
  const rows = [['Nama', x.nama], ['NIA', x.nia], ['Jenis kelamin', { L: 'Laki-laki', P: 'Perempuan' }[x.jk]]];
  if (x.tempat_lahir !== undefined) rows.push(['Tempat, tgl lahir', [x.tempat_lahir, x.tgl_lahir].filter(Boolean).join(', ')]);
  rows.push(['Pimpinan Daerah', pimdaName(x.pimda_id)], ['Pimpinan Cabang', cabangName(x.cabang_id)], ['Unit Latihan', unitName(x.unit_id)], ['Jenjang', jenjangOf(x.tingkatan)], ['Tingkatan saat ini', tkLabel(x.tingkatan)], ['Status', x.status], ['Tahun masuk Tapak Suci', x.tahun_bergabung]);
  if (x.hp !== undefined) rows.push(['No. HP', x.hp], ['Alamat', x.alamat]);
  const rw = [...(x.riwayat || [])].sort((p, q) => (yearOf(p) || 0) - (yearOf(q) || 0));
  const tl = [...(x.tahun_bergabung ? [{ label: 'Masuk Tapak Suci', tahun: x.tahun_bergabung, catatan: '' }] : []), ...rw.map(r => ({ label: r.tingkatan, tahun: yearOf(r), catatan: r.catatan }))];
  const can = canPimda(x.pimda_id);
  dialog(`<h3>Detail Anggota</h3>
    <div style="display:flex;gap:16px;flex-wrap:wrap"><div>${avatar(x, 96, false)}</div>
    <dl class="kv" style="flex:1;min-width:240px">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || '-')}</dd>`).join('')}</dl></div>
    <h4 class="hh">Riwayat tahun masuk &amp; kenaikan tingkat</h4>
    ${tl.length ? `<ul class="hist">${tl.map(r => `<li><b>${esc(r.label)}</b><span>${esc(r.tahun ?? '-')}${r.catatan ? ' · ' + esc(r.catatan) : ''}</span></li>`).join('')}</ul>` : '<p class="sub">Belum ada riwayat.</p>'}
    <div class="dlg-actions">${can ? '<button class="btn" id="up">+ Naik tingkat</button>' : ''}<button class="btn" id="cd">Kartu anggota</button><button class="btn primary" id="cx">Tutup</button></div>`);
  $('#cx').onclick = closeDlg;
  $('#cd').onclick = () => openCard(x);
  if (can) $('#up').onclick = () => openPromote(x);
}
function openPromote(x) {
  dialog(`<h3>Naik tingkat: ${esc(x.nama)}</h3>
    <form id="frm" class="frm">
      <label class="full">Tingkatan baru *<select name="tingkatan" required><option value="">-- pilih --</option>${tkOpts().map(([v, l]) => `<option value="${esc(v)}" ${v === x.tingkatan ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>Tahun naik tingkat<input type="number" name="tahun" min="1950" max="${thisYear()}" value="${thisYear()}" required></label>
      <label>Catatan<input name="catatan" placeholder="mis. UKT Nov 2026"></label>
      <div class="dlg-actions" style="grid-column:1/-1"><button type="button" class="btn" id="cx">Batal</button><button class="btn primary">Simpan</button></div>
    </form>`);
  $('#cx').onclick = () => openDetail(x.id);
  $('#frm').onsubmit = async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    if (x.tahun_bergabung && Number(o.tahun) < x.tahun_bergabung) return toast(`Tahun naik tingkat tidak boleh sebelum tahun masuk (${x.tahun_bergabung}).`, true);
    const row = { ...x, tingkatan: o.tingkatan, riwayat: [...(x.riwayat || []), { tingkatan: o.tingkatan, tahun: Number(o.tahun) || thisYear(), catatan: (o.catatan || '').trim() }] };
    try { await api.saveAnggota(row, false, null); CACHE.set(row.id, row); await afterChange(); openDetail(x.id); toast('Tingkatan diperbarui.'); }
    catch (err) { toast(err.message, true); }
  };
}
function openCard(x) {
  const tgl = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  dialog(`<h3>Kartu Anggota</h3>
    <div class="idcard">
      <div class="ic-head"><img src="logo.png" alt=""><div><b>TAPAK SUCI PUTERA MUHAMMADIYAH</b><span>Pimpinan Wilayah VIII Sumatera Utara</span></div></div>
      <div class="ic-body">${avatar(x, 96, false, 'ic-photo')}
        <dl><dt>Nama</dt><dd><b>${esc(x.nama)}</b></dd><dt>NIA</dt><dd>${esc(x.nia || '-')}</dd>
        <dt>Tingkatan</dt><dd>${esc(tkLabel(x.tingkatan) || '-')}</dd><dt>Pimda</dt><dd>${esc(pimdaName(x.pimda_id))}</dd><dt>Cabang</dt><dd>${esc(cabangName(x.cabang_id) || '-')}</dd><dt>Unit</dt><dd>${esc(unitName(x.unit_id) || '-')}</dd>
        <dt>Status</dt><dd>${esc(x.status || '-')}</dd><dt>Masuk</dt><dd>${esc(x.tahun_bergabung || '-')}</dd></dl></div>
      <div class="ic-foot">Dicetak ${tgl}</div>
    </div>
    <p class="sub" style="margin-top:12px">Tips: pada jendela cetak pilih ukuran kertas A4 dan nonaktifkan "Headers and footers".</p>
    <div class="dlg-actions"><button class="btn" id="cx">Kembali</button><button class="btn primary" id="pr">Cetak</button></div>`);
  $('#cx').onclick = () => openDetail(x.id);
  $('#pr').onclick = () => { document.body.classList.add('pc'); window.print(); };
}

/* ---------- CSV ---------- */
const CSV_COLS = ['nama', 'nia', 'jk', 'tempat_lahir', 'tgl_lahir', 'pimda', 'cabang', 'unit_latihan', 'tingkatan', 'status', 'tahun_masuk', 'riwayat', 'hp', 'alamat'];
const csvQ = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const csvVal = (c, x) => c === 'pimda' ? pimdaName(x.pimda_id) : c === 'cabang' ? cabangName(x.cabang_id) : c === 'unit_latihan' ? unitName(x.unit_id) : c === 'tahun_masuk' ? x.tahun_bergabung : c === 'riwayat' ? (x.riwayat || []).map(r => `${r.tingkatan}:${yearOf(r) ?? ''}`).join(';') : x[c];
async function exportCsv() {
  try {
    toast('Menyiapkan CSV...');
    const all = [];
    for (let pg = 1; ; pg++) { const r = await api.listAnggota({ ...listParams(), page: pg, size: 1000 }); all.push(...r.rows); if (r.rows.length < 1000) break; }
    const rows = all.map(x => CSV_COLS.map(c => csvQ(csvVal(c, x))).join(','));
    download('anggota-tapaksuci-sumut.csv', '﻿' + [CSV_COLS.join(','), ...rows].join('\r\n'));
  } catch (e) { toast(e.message, true); }
}
function downloadTemplate() {
  const pn = isPimdaUser() ? pimdaName(myPimda()) : (D.pimda[0] || {}).nama || 'Nama Pimda';
  download('template-anggota.csv', '﻿' + CSV_COLS.join(',') + '\r\n' + ['Contoh Nama', 'TS-0001', 'L', 'Medan', '2009-03-15', pn, '(nama cabang)', '(nama unit latihan)', 'Siswa Satu', 'Aktif', '2022', 'Siswa Dasar:2022;Siswa Satu:2024', '', ''].map(csvQ).join(',') + '\r\n');
}
function parseCsv(t) {
  const out = []; let row = [], cur = '', inq = false;
  t = t.replace(/^﻿/, '');
  const first = t.split('\n')[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
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
function isoDate(v) {
  v = (v || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
function importCsv() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
  inp.onchange = async () => {
    const rows = parseCsv(await inp.files[0].text());
    if (rows.length < 2) return toast('File CSV kosong atau formatnya salah.', true);
    const head = rows.shift().map(h => h.trim().toLowerCase());
    const out = [], skip = [], warn = [];
    rows.forEach((r, i) => {
      const o = {}; head.forEach((h, j) => o[h] = (r[j] || '').trim());
      if (!o.nama) return;
      let pid;
      if (!isAdmin()) pid = myPimda();
      else {
        const p = D.pimda.find(p => p.id === o.pimda || p.nama.toLowerCase() === (o.pimda || '').toLowerCase());
        if (!p) { skip.push(`baris ${i + 2} (${o.nama}): Pimda "${o.pimda}" tidak dikenal`); return; }
        pid = p.id;
      }
      const cab = o.cabang ? D.cabang.find(c => c.pimda_id === pid && c.nama.toLowerCase() === o.cabang.toLowerCase()) : null;
      const unt = cab && o.unit_latihan ? D.unit.find(u => u.cabang_id === cab.id && u.nama.toLowerCase() === o.unit_latihan.toLowerCase()) : null;
      if (o.cabang && !cab) warn.push(`baris ${i + 2} (${o.nama}): cabang "${o.cabang}" tidak dikenal, diimpor tanpa cabang`);
      else if (o.unit_latihan && !unt) warn.push(`baris ${i + 2} (${o.nama}): unit "${o.unit_latihan}" tidak dikenal, diimpor tanpa unit`);
      const rw = (o.riwayat || '').split(';').map(t => t.trim()).filter(Boolean).map(t => { const [n, y] = t.split(':'); return { tingkatan: normTk(n), tahun: Number(y) || null, catatan: '' }; }).filter(r => r.tingkatan && r.tahun);
      out.push({ id: uuid(), nama: o.nama, nia: o.nia || null, jk: (o.jk || '').toUpperCase().slice(0, 1) || null, tempat_lahir: o.tempat_lahir || null, tgl_lahir: isoDate(o.tgl_lahir), pimda_id: pid,
        cabang_id: cab ? cab.id : null, unit_id: unt ? unt.id : null, tingkatan: normTk(o.tingkatan) || null, status: o.status || 'Aktif',
        tahun_bergabung: Number(o.tahun_masuk || o.tahun_bergabung) || null, riwayat: rw, hp: o.hp || null, alamat: o.alamat || null });
    });
    if (!out.length) return alert('Tidak ada baris yang bisa diimpor.' + (skip.length ? '\n\n' + skip.slice(0, 15).join('\n') : ''));
    if (!confirm(`Impor ${out.length} anggota${skip.length ? ` (${skip.length} baris dilewati)` : ''}?${isAdmin() ? '' : '\nSemua akan masuk ke ' + pimdaName(myPimda()) + '.'}`)) return;
    try { await api.importAnggota(out); await afterChange(); }
    catch (e) { return toast('Impor gagal: ' + e.message, true); }
    alert(`${out.length} anggota berhasil diimpor.` + (skip.length ? `\n\nDilewati (${skip.length}):\n` + skip.slice(0, 15).join('\n') : '') + (warn.length ? `\n\nPerhatian (${warn.length}):\n` + warn.slice(0, 15).join('\n') : ''));
  };
  inp.click();
}

/* ---------- Masuk / akun ---------- */
function openLogin() {
  dialog(`<h3>Masuk</h3>
    <p class="sub" style="margin-top:0">Khusus admin Pimwil dan operator Pimda. Pengunjung umum tidak perlu masuk untuk melihat dan mencari data.</p>
    <form id="frm" class="frm">
      <label class="full">Email<input name="email" type="email" required autocomplete="username"></label>
      <label class="full">Kata sandi<input name="password" type="password" required autocomplete="current-password"></label>
      <div class="dlg-actions" style="grid-column:1/-1"><button type="button" class="btn" id="cx">Batal</button><button class="btn primary">Masuk</button></div>
    </form>
    <div class="note">Belum punya akun? Hubungi admin Pimwil. Akun dibuat oleh admin, tidak ada pendaftaran mandiri.</div>`);
  $('#cx').onclick = closeDlg;
  $('#frm').onsubmit = async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Memeriksa...';
    try {
      await api.signIn(o.email.trim(), o.password);
      await syncSession(); closeDlg();
      if (ME && ME.role === 'none') toast('Akun berhasil masuk, tetapi belum dihubungkan ke Pimda. Hubungi admin Pimwil.', true);
      else toast('Berhasil masuk.');
    } catch (err) { toast(/invalid login/i.test(err.message) ? 'Email atau kata sandi salah.' : err.message, true); btn.disabled = false; btn.textContent = 'Masuk'; }
  };
}
function openAccount() {
  const peran = isAdmin() ? 'Admin Pimwil (akses penuh)' : isPimdaUser() ? 'Operator ' + pimdaName(myPimda()) : 'Belum dihubungkan ke Pimda';
  dialog(`<h3>Akun Saya</h3>
    <dl class="kv"><dt>Email</dt><dd>${esc(ME.email || '-')}</dd><dt>Peran</dt><dd>${esc(peran)}</dd></dl>
    <h4 class="hh">Ganti kata sandi</h4>
    <form id="frm" class="frm">
      <label class="full">Kata sandi baru (minimal 8 karakter)<input name="pw" type="password" minlength="8" required autocomplete="new-password"></label>
      <div class="dlg-actions" style="grid-column:1/-1"><button class="btn">Simpan kata sandi</button></div>
    </form>
    <div class="dlg-actions"><button class="btn danger" id="out">Keluar</button><button class="btn primary" id="cx">Tutup</button></div>`);
  $('#cx').onclick = closeDlg;
  $('#out').onclick = async () => { await api.signOut(); ME = null; await syncSession(); closeDlg(); toast('Anda telah keluar.'); };
  $('#frm').onsubmit = async e => {
    e.preventDefault();
    try { await api.changePassword(new FormData(e.target).get('pw')); toast('Kata sandi diperbarui.'); e.target.reset(); }
    catch (err) { toast(err.message, true); }
  };
}

/* ---------- Navigasi & event ---------- */
const RENDER = { beranda: renderBeranda, pengurus: renderPengurus, pimda: renderPimda, anggota: renderAnggota };
function show(v) {
  if (!RENDER[v]) v = 'beranda';
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + v));
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.v === v));
  RENDER[v]();
}
const rerender = () => { if (api) show((location.hash || '#beranda').slice(1)); };

document.addEventListener('click', e => {
  const t = e.target.closest('[data-add],[data-edit],[data-del],[data-detail],[data-pimdadetail],[data-filterpimda],[data-filtercabang],[data-filterunit]'); if (!t) return;
  const d = t.dataset;
  if (d.add) openForm(d.add, null, d.add === 'pengurus' ? { pimda_id: d.pimda || null } : d.add === 'cabang' ? { pimda_id: d.pimda } : d.add === 'unit' ? { cabang_id: d.cabang } : d.add === 'anggota' ? { pimda_id: isAdmin() ? S.pimda : myPimda(), cabang_id: S.cabang || null, unit_id: S.unit || null } : {});
  else if (d.edit) openForm(d.edit, d.id);
  else if (d.del) delItem(d.del, d.id);
  else if (d.pimdadetail) openPimdaDetail(d.pimdadetail);
  else if (d.filterpimda) { S.pimda = d.filterpimda; S.cabang = ''; S.unit = ''; S.q = ''; S.page = 1; closeDlg(); if (location.hash === '#anggota') rerender(); else location.hash = '#anggota'; }
  else if (d.filtercabang) { const c = D.cabang.find(x => x.id === d.filtercabang); S.pimda = c.pimda_id; S.cabang = c.id; S.unit = ''; S.q = ''; S.page = 1; closeDlg(); if (location.hash === '#anggota') rerender(); else location.hash = '#anggota'; }
  else if (d.filterunit) { const u = D.unit.find(x => x.id === d.filterunit); S.pimda = u.pimda_id; S.cabang = u.cabang_id; S.unit = u.id; S.q = ''; S.page = 1; closeDlg(); if (location.hash === '#anggota') rerender(); else location.hash = '#anggota'; }
  else if (d.detail) openDetail(d.detail);
});
$('#btnAuth').onclick = () => (ME ? openAccount() : openLogin());
window.addEventListener('hashchange', rerender);
window.addEventListener('afterprint', () => document.body.classList.remove('pc'));
window.APP = { syncSession };

function showSetup() {
  $('#v-beranda').classList.add('active');
  $('#v-beranda').innerHTML = `<div class="card"><h2>Aplikasi belum tersambung ke Supabase</h2>
    <p>Buka berkas <b>config.js</b> lalu isi <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code> sesuai proyek Supabase Anda. Langkah lengkap ada di <b>README.md</b>.</p></div>`;
}
async function boot() {
  try { D.config = { ...D.config, ...(await (await fetch('tingkatan.json?t=' + Date.now())).json()) }; } catch { /* pakai bawaan */ }
  api = window.API_OVERRIDE || makeSupabaseApi();
  if (!api) return showSetup();
  try { ME = await api.profile(); } catch (e) { toast('Gagal memeriksa sesi: ' + e.message, true); }
  if (isPimdaUser()) S.pimda = myPimda();
  try { await loadAll(); }
  catch (e) { toast('Gagal memuat data: ' + e.message + '. Periksa config.js dan pastikan schema.sql sudah dijalankan.', true); }
  refreshAuth(); rerender();
}
boot();
