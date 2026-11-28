// Bot harga emas @safehaven.assets — dipicu tiap 10 menit (cron-job.org → workflow_dispatch), menunggu sampai
// tepat menit :00/:10/:20/… WIB lalu memposting update global. Juga: harga Antam, harga toko, dan konten harian.
// Mengirim GAMBAR + keterangan ke Telegram (dan Channel WA via Whapi, opsional):
//   (1) harga Antam saat ada update baru di harga.json,
//   (2) update harga global (XAUUSD + kurs) tiap ±1 jam selama pasar buka,
//   (3) "Pasar tutup" sekali saat pasar global berhenti bergerak.
import fs from 'node:fs';

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT;
const WHAPI = process.env.WHAPI_TOKEN, WA_CH = process.env.WA_CHANNEL;
const TDKEY = (process.env.TWELVEDATA_KEY || '').trim();
const PERIODE = Math.max(5, Number(process.env.GLOBAL_MENIT) || 10);                     // update global tiap N menit (tepat di kelipatan N)
const WA_MENIT = Math.max(10, Number(process.env.WA_INTERVAL_MENIT) || (Number(process.env.WA_INTERVAL_JAM) || 1) * 60); // jarak update global ke Channel WA
const WA_AKTIF = (process.env.WA_JAM_AKTIF || '7-21').trim();                              // jam WIB update global boleh dikirim ke WA
const KONTEN = (process.env.KONTEN || 'pagi,polling,edukasi,alert,rekor,andai,testi,agenda').toLowerCase().split(/[,\s]+/);
const TELAT_MAKS = 4 * 60e3;                                                               // jadwal yang terlewat > 4 menit tidak dikirim (biar tidak telat)
const ADMINS = String(process.env.TELEGRAM_ADMIN || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean); // ID Telegram admin, pisahkan koma bila >1
let NOW = process.env.MOCK_NOW ? new Date(process.env.MOCK_NOW) : new Date();
const MOCK = !!process.env.MOCK_NOW;
let ST = {}, AK = { riwayat: [] }, ADMIN_MSG = [];
const STATE = process.env.STATE_FILE || '.tg-state/state.json';
const DRY = process.env.DRY_RUN === '1';
const OUT = process.env.OUT_DIR || '';             // simpan gambar saat uji
const QUIET = (process.env.QUIET_HOURS || '').trim();
const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '/').split('/');
const OZ = 31.1034768;
const AG = [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000];

const rp = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
const usd = n => Number(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = x => (x * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const rnd = n => Math.round(n / 1000) * 1000;
const gL = g => g >= 1000 ? g / 1000 + ' kg' : String(g).replace('.', ',') + ' gr';
const kF = n => { const a = Math.abs(n), s = n < 0 ? '-' : n > 0 ? '+' : ''; return a >= 1e6 ? s + (a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + 'jt' : a >= 1e3 ? s + (a / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + 'rb' : s + a; };
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const wib = (d = NOW) => new Date(d.getTime() + 7 * 3600e3);
const tglWIB = (d = NOW) => wib(d).toISOString().slice(0, 10);
const jamWIB = (d = NOW) => wib(d).toISOString().slice(11, 16).replace(':', '.');
const hari = t => new Date(t + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const getJSON = async u => { const r = await fetch(u, { headers: { 'cache-control': 'no-cache' } }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };

/* ---------------- data ---------------- */
async function hargaGlobal(D) {
  const G = { xau: 0, kurs: 0, at: '', kSrc: '' };
  try { const x = await getJSON('https://api.gold-api.com/price/XAU'); G.xau = +x.price; G.at = x.updatedAt || ''; } catch (e) { console.log('Gagal XAU:', e.message); }
  const src = [];
  if (TDKEY) src.push(getJSON('https://api.twelvedata.com/price?symbol=USD/IDR&apikey=' + encodeURIComponent(TDKEY)).then(j => j.price ? { k: +j.price, at: Date.now(), s: 'Twelve Data' } : null));
  src.push(getJSON('https://api.exchangerate.fun/latest?base=USD').then(j => j.rates?.IDR ? { k: +j.rates.IDR, at: (j.timestamp || 0) * 1000, s: 'exchangerate.fun' } : null));
  src.push(getJSON('https://open.er-api.com/v6/latest/USD').then(j => j.rates?.IDR ? { k: +j.rates.IDR, at: (j.time_last_update_unix || 0) * 1000, s: 'open.er-api' } : null));
  const best = (await Promise.allSettled(src)).map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean).sort((a, b) => b.at - a.at)[0];
  if (best) { G.kurs = best.k; G.kSrc = best.s; }
  else if (D?.antam?.spotRef && D.antam.xauRef) G.kurs = D.antam.spotRef * OZ / D.antam.xauRef;
  return G;
}
const spotOf = G => G.xau * G.kurs / OZ;

/* ---------------- teks ---------------- */
const refAntam = a => a.tgl === tglWIB() ? `${a.jam} WIB` : `${new Date(a.tgl + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${a.jam} WIB`;
const PAGE = D => D?.toko?.links?.web || (OWNER ? `https://${OWNER.toLowerCase()}.github.io/${REPO}/harga.html` : '');
function kaki(D, pendek) {
  const t = D?.toko || {}, L = t.links || {};
  let s = '';
  s += '\n';
  if (t.wa) s += `\n📲 Pesan: https://wa.me/${esc(t.wa)}`;
  if (L.wa) s += `\n🔔 Channel WA: ${esc(L.wa)}`;
  if (L.tg) s += `\n📢 Telegram: ${esc(L.tg)}`;
  if (PAGE(D)) s += `\n🌐 Harga live: ${esc(PAGE(D))}`;
  return s + '\n\n<i>Harga referensi, dapat berubah sewaktu-waktu. Proyeksi hanya perkiraan, bukan saran investasi.</i>';
}
function capAntam(D) {
  const a = D.antam, d = a.beli - (a.prevBeli || 0), db = a.bb - (a.prevBb || 0);
  const arah = !a.prevBeli ? '' : d < 0 ? ' · TURUN 🔴' : d > 0 ? ' · NAIK 🟢' : ' · TETAP ⚪';
  const ch = (x, p) => p ? ` (${x < 0 ? '🔻' : x > 0 ? '🔺' : '='} ${rp(Math.abs(x))} · ${pct(Math.abs(x) / p)})` : '';
  return `📊 <b>HARGA EMAS ANTAM HARI INI</b>${arah}\n🗓️ ${hari(a.tgl)} · ⏰ ${esc(a.jam)} WIB\n\n` +
    `• Beli: <b>${rp(a.beli)}</b>${ch(d, a.prevBeli)}\n• Buyback: <b>${rp(a.bb)}</b>${ch(db, a.prevBb)}\n• Selisih: ${rp(a.beli - a.bb)} (${pct((a.beli - a.bb) / a.beli)})` + teksAkurasi() + `\n\n📋 Daftar 0,5 gr – 1 kg ada di gambar.` + kaki(D, false);
}
function teksAntamLengkap(D, G) { // cadangan bila gambar gagal
  const a = D.antam, d = a.beli - (a.prevBeli || 0), off = g => Number(a.offset?.[String(g)]) || 0;
  const tabel = AG.map(g => `${gL(g).padEnd(7)} ${rp(a.beli * g + off(g)).padStart(17)}${a.prevBeli ? '  ' + kF(d * g) : ''}`).join('\n');
  return capAntam(D).split('\n\n📋')[0] + `\n\n📋 <b>Daftar Harga Emas Batangan</b>\n<pre>${tabel}</pre>` + (G.xau ? `\n🌍 XAUUSD $${usd(G.xau)} · Kurs ${rp(G.kurs)}` : '') + kaki(D, false);
}
/* harga toko yang diisi manual oleh admin di aplikasi (menu "Harga toko ke channel") */
const waktuWIB = ms => { const d = new Date(ms + 7 * 3600e3); return { tgl: d.toISOString().slice(0, 10), jam: d.toISOString().slice(11, 16).replace(':', '.') }; };
const gLb = g => g >= 1000 ? (g / 1000) + ' kg' : String(g).replace('.', ',') + ' gr';
function capToko(D) {
  const f = D.toko.info, w = waktuWIB(f.ver), J = f.kolom !== 'b', B = f.kolom !== 'j', n = v => v ? Math.round(v).toLocaleString('id-ID') : '–';
  const R = f.rows, lb = Math.max(...R.map(r => gLb(r.g).length)), lj = Math.max(4, ...R.map(r => n(r.j).length)), lbb = Math.max(7, ...R.map(r => n(r.b).length));
  const head = 'Berat'.padEnd(lb) + (J ? '  ' + 'Jual'.padStart(lj) : '') + (B ? '  ' + 'Buyback'.padStart(lbb) : '');
  const rows = R.map(r => gLb(r.g).padEnd(lb) + (J ? '  ' + n(r.j).padStart(lj) : '') + (B ? '  ' + n(r.b).padStart(lbb) : '')).join('\n');
  return `🏪 <b>${esc(String(f.judul || 'Harga Emas').toUpperCase())} HARI INI</b>\n🗓️ ${hari(w.tgl)} · ⏰ ${w.jam} WIB\n🥇 Emas ${esc(f.merek || '')} · harga per keping (Rp), berlaku hari ini\n\n<pre>${esc(head)}\n${esc(rows)}</pre>` +
    (f.catatan ? `\n📝 ${esc(f.catatan)}` : '') + kaki(D, true).replace('Proyeksi hanya perkiraan, bukan saran investasi.', 'Hubungi kami untuk ketersediaan stok.');
}
function gambarToko(D) {
  const { c, x, nama } = dasar(D), f = D.toko.info, w = waktuWIB(f.ver), J = f.kolom !== 'b', B = f.kolom !== 'j', R = f.rows;
  T(x, 'HARGA TOKO HARI INI', 60, 95, 50, '#f3d98b', 'left', 'bold'); T(x, String(nama).replace(/^@/, '') + ' · Emas ' + (f.merek || ''), 60, 145, 32, '#f2ede2');
  T(x, hari(w.tgl) + ' · ' + w.jam + ' WIB', 60, 190, 28, '#a39a86');
  const rh = Math.min(90, Math.floor(760 / Math.max(R.length, 1))), y0 = 320, cj = B ? 660 : 990;
  T(x, 'Berat', 90, 285, 28, '#a39a86'); if (J) T(x, 'Harga jual', cj, 285, 28, '#a39a86', 'right'); if (B) T(x, 'Buyback', 990, 285, 28, '#a39a86', 'right');
  R.forEach((r, i) => {
    const y = y0 + i * rh, ty = y + rh / 2 + 8; x.fillStyle = i % 2 ? 'rgba(216,176,76,.05)' : 'rgba(216,176,76,.12)'; x.fillRect(60, y, 960, rh - 8);
    T(x, gLb(r.g), 90, ty, 38, '#f2ede2', 'left', 'bold');
    if (J) T(x, r.j ? 'Rp ' + Math.round(r.j).toLocaleString('id-ID') : '–', cj, ty, 38, '#f3d98b', 'right', 'bold');
    if (B) T(x, r.b ? 'Rp ' + Math.round(r.b).toLocaleString('id-ID') : '–', 990, ty, J ? 34 : 38, J ? '#f2ede2' : '#f3d98b', 'right', J ? '' : 'bold');
  });
  let y = y0 + R.length * rh + 50; if (f.catatan) { T(x, String(f.catatan).slice(0, 60), 540, y, 30, '#f3d98b', 'center', 'bold'); y += 50; }
  T(x, 'Harga per keping, dapat berubah sewaktu-waktu', 540, Math.max(y, 1230), 26, '#a39a86', 'center');
  pita(x, D); logoAt(x, 890, 18, 140);
  return c.toBuffer('image/png');
}
function proyeksi(D, G) {
  const a = D?.antam; if (!a?.spotRef || !a.beli) return null;
  const adj = spotOf(G) - a.spotRef, be = a.beta || { b: 1, bb: 1 };
  return { adj, beli: rnd(a.beli + be.b * adj), bb: rnd(a.bb + be.bb * adj) };
}
function capGlobal(D, G, tutup, ringkas) {
  const a = D?.antam, pj = proyeksi(D, G), xc = a?.xauRef ? (G.xau - a.xauRef) / a.xauRef : null, L = ST.lastG;
  let s = `${tutup ? '🔔 <b>Pasar tutup.</b>' : '🌍 <b>UPDATE HARGA EMAS GLOBAL</b>'}\n🗓️ ${hari(tglWIB())} · ⏰ ${jamWIB()} WIB\n\n` +
    `• XAUUSD: $${usd(G.xau)}/oz${xc !== null ? ` (${xc < 0 ? '▼' : '▲'} ${pct(Math.abs(xc))})` : ''}\n• Kurs: ${rp(G.kurs)}\n• Spot: ${rp(spotOf(G))}/gr`;
  if (!tutup && L?.x && NOW.getTime() - L.t < 3 * 3600e3) {
    const dx = G.xau - L.x, mnt = Math.round((NOW.getTime() - L.t) / 60e3), dsp = spotOf(G) - L.x * L.k / OZ;
    s += `\n⏱️ ${mnt} menit terakhir: ${Math.abs(dx) < 0.005 ? '= tetap' : `${dx > 0 ? '▲' : '▼'} $${usd(Math.abs(dx))} (${pct(Math.abs(dx) / L.x)})`} · spot ${dsp >= 0 ? '+' : '-'}${rp(Math.abs(dsp))}/gr`;
  }
  if (pj) {
    s += `\n\nEmas ${pj.adj < 0 ? '📉 melemah' : '📈 menguat'} <b>${rp(Math.abs(pj.adj))}/gr</b> sejak update Antam ${esc(refAntam(a))}.`;
    const kRef = a.xauRef ? a.spotRef * OZ / a.xauRef : 0;
    if (kRef && G.kurs) { const dk = G.kurs - kRef; if (Math.abs(dk) >= 1) s += `\n💱 Rupiah ${dk > 0 ? 'melemah' : 'menguat'} ${Math.round(Math.abs(dk)).toLocaleString('id-ID')} poin (Rp ${Math.round(kRef).toLocaleString('id-ID')} → Rp ${Math.round(G.kurs).toLocaleString('id-ID')}/USD)${dk > 0 ? ', ikut mendorong harga emas naik' : ', ikut menekan harga emas'}.`; }
    const db = pj.beli - a.beli, arah = Math.abs(db) < 1000 ? '⚪ <b>CENDERUNG TETAP</b>' : db > 0 ? `🔺 <b>CENDERUNG NAIK</b> ±${rp(db)}` : `🔻 <b>CENDERUNG TURUN</b> ±${rp(-db)}`;
    s += `\n\n🔮 <b>Prediksi harga Antam berikutnya:</b> ${arah}\n• Beli ±${rp(pj.beli)} · Buyback ±${rp(pj.bb)}\n<i>(dari harga resmi ${esc(refAntam(a))}: beli ${rp(a.beli)})</i>`;
  }
  if (ringkas) return s + (PAGE(D) ? `\n\n🌐 ${esc(PAGE(D))}` : '') + '\n<i>Proyeksi hanya perkiraan, bukan saran investasi.</i>';
  return s + kaki(D, true);
}

/* ---------------- gambar ---------------- */
let CV = null, LOGO = null;
async function siapkanCanvas() {
  try {
    CV = await import('@napi-rs/canvas');
    for (const [f, n] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'], ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVu Sans']])
      if (fs.existsSync(f)) CV.GlobalFonts.registerFromPath(f, n);
    if (fs.existsSync('logo-icon.png')) LOGO = await CV.loadImage(fs.readFileSync('logo-icon.png'));
  } catch (e) { console.log('Canvas tidak tersedia, kirim teks saja:', e.message); CV = null; }
}
const FONT = '"DejaVu Sans", sans-serif';
function T(x, t, X, Y, sz, col, al, w) { x.font = `${w || ''} ${sz}px ${FONT}`; x.fillStyle = col; x.textAlign = al || 'left'; x.fillText(t, X, Y); }
function logoAt(x, X, Y, sz) {
  if (!LOGO) return; x.save(); x.beginPath(); x.arc(X + sz / 2, Y + sz / 2, sz / 2 + 4, 0, 7); x.fillStyle = '#d8b04c'; x.fill();
  x.beginPath(); x.arc(X + sz / 2, Y + sz / 2, sz / 2, 0, 7); x.clip(); x.drawImage(LOGO, X, Y, sz, sz); x.restore();
}
function dasar(D) {
  const c = CV.createCanvas(1080, 1350), x = c.getContext('2d'), nama = D?.toko?.nama || '';
  x.fillStyle = '#0d0c09'; x.fillRect(0, 0, 1080, 1350);
  x.save(); x.translate(540, 700); x.rotate(-0.45); x.fillStyle = 'rgba(216,176,76,.06)'; x.font = `bold 110px ${FONT}`; x.textAlign = 'center'; x.fillText(nama, 0, 0); x.restore();
  return { c, x, nama };
}
function pita(x, D) {
  const t = D?.toko || {};
  x.fillStyle = '#d8b04c'; x.fillRect(0, 1290, 1080, 60);
  T(x, (t.nama || '') + (t.wa ? '  ·  WA ' + t.wa.replace(/^62/, '0') : ''), 540, 1331, 34, '#14120d', 'center', 'bold');
}
function gambarAntam(D) {
  const { c, x } = dasar(D), a = D.antam, d = a.beli - (a.prevBeli || 0), db = a.bb - (a.prevBb || 0), red = '#e46b5d', grn = '#5fbf7a';
  const off = g => Number(a.offset?.[String(g)]) || 0;
  T(x, 'HARGA EMAS ANTAM', 60, 95, 54, '#f3d98b', 'left', 'bold');
  T(x, hari(a.tgl) + ' · ' + a.jam + ' WIB', 60, 145, 32, '#a39a86');
  const box = (X, lab, val, ch, prev) => {
    x.fillStyle = '#1f1c15'; x.fillRect(X, 180, 300, 170); T(x, lab, X + 20, 225, 28, '#a39a86'); T(x, 'Rp ' + Math.round(val).toLocaleString('id-ID'), X + 20, 280, 38, '#f2ede2', 'left', 'bold');
    if (prev !== undefined) T(x, prev ? (ch < 0 ? '▼ ' : ch > 0 ? '▲ ' : '= ') + Math.abs(ch).toLocaleString('id-ID') : '', X + 20, 325, 28, ch < 0 ? red : ch > 0 ? grn : '#a39a86', 'left', 'bold');
    else T(x, ch, X + 20, 325, 28, '#a39a86');
  };
  box(60, 'Beli / gram', a.beli, d, a.prevBeli); box(390, 'Buyback / gram', a.bb, db, a.prevBb); box(720, 'Selisih', a.beli - a.bb, pct((a.beli - a.bb) / a.beli));
  T(x, 'Berat', 80, 410, 28, '#a39a86'); T(x, 'Harga', 760, 410, 28, '#a39a86', 'right'); T(x, 'Perubahan', 1000, 410, 28, '#a39a86', 'right');
  AG.forEach((g, i) => {
    const y = 465 + i * 60; x.fillStyle = i % 2 ? 'rgba(216,176,76,.05)' : 'rgba(216,176,76,.12)'; x.fillRect(60, y - 42, 960, 58);
    T(x, gL(g), 80, y, 34, '#f2ede2', 'left', 'bold'); T(x, 'Rp ' + Math.round(a.beli * g + off(g)).toLocaleString('id-ID'), 760, y, 34, '#f3d98b', 'right', 'bold');
    if (a.prevBeli) T(x, kF(d * g), 1000, y, 32, d < 0 ? red : d > 0 ? grn : '#a39a86', 'right');
  });
  const y2 = 465 + AG.length * 60;
  T(x, 'Harga referensi Antam, dapat berubah sewaktu-waktu', 540, y2 + 50, 26, '#a39a86', 'center');
  pita(x, D); logoAt(x, 890, 18, 140);
  return c.toBuffer('image/png');
}
function gambarGlobal(D, G, hist, tutup) {
  const { c, x } = dasar(D), a = D?.antam, pj = proyeksi(D, G), neg = pj ? pj.adj < 0 : false, col = neg ? '#e46b5d' : '#5fbf7a';
  T(x, 'XAUUSD', 60, 90, 32, '#a39a86', 'left', 'bold'); T(x, '$' + usd(G.xau), 60, 150, 58, '#f2ede2', 'left', 'bold');
  if (a?.xauRef) { const p = (G.xau - a.xauRef) / a.xauRef; T(x, (p < 0 ? '▼ ' : '▲ ') + pct(Math.abs(p)), 60, 200, 32, p < 0 ? '#e46b5d' : '#5fbf7a', 'left', 'bold'); }
  T(x, 'IDR ' + Math.round(spotOf(G)).toLocaleString('id-ID') + '/gr', 1020, 150, 36, '#f3d98b', 'right', 'bold');
  T(x, 'Kurs Rp ' + Math.round(G.kurs).toLocaleString('id-ID'), 1020, 200, 30, '#a39a86', 'right');
  const H = hist.filter(h => h.t > NOW.getTime() - 864e5).map(h => h.x * h.k / OZ);
  if (H.length > 1) {
    const mn = Math.min(...H), mx = Math.max(...H), rg = mx - mn || 1; x.beginPath();
    H.forEach((v, i) => { const X = 60 + i / (H.length - 1) * 960, Y = 700 - (v - mn) / rg * 380; i ? x.lineTo(X, Y) : x.moveTo(X, Y); });
    x.strokeStyle = col; x.lineWidth = 5; x.stroke(); T(x, '24 jam terakhir', 60, 740, 24, '#6b6455');
  }
  if (pj) {
    x.fillStyle = 'rgba(13,12,9,.75)'; x.fillRect(60, 420, 960, 200);
    T(x, (neg ? '▼ ' : '▲ ') + 'IDR ' + (neg ? '-' : '+') + Math.round(Math.abs(pj.adj)).toLocaleString('id-ID'), 540, 555, 110, col, 'center', 'bold');
    T(x, 'per gram sejak update Antam ' + refAntam(a), 540, 605, 30, '#a39a86', 'center');
    x.fillStyle = '#1f1c15'; x.fillRect(60, 800, 960, 240);
    T(x, 'PROYEKSI ANTAM (perkiraan)', 90, 860, 32, '#f3d98b', 'left', 'bold');
    T(x, 'Beli', 90, 930, 30, '#a39a86'); T(x, 'Rp ' + pj.beli.toLocaleString('id-ID'), 90, 985, 48, '#f2ede2', 'left', 'bold');
    T(x, 'Buyback', 560, 930, 30, '#a39a86'); T(x, 'Rp ' + pj.bb.toLocaleString('id-ID'), 560, 985, 48, '#f2ede2', 'left', 'bold');
    T(x, `Resmi ${refAntam(a)}: beli ${rp(a.beli)} · buyback ${rp(a.bb)}`, 540, 1100, 28, '#a39a86', 'center');
  }
  T(x, (tutup ? 'PASAR TUTUP · ' : 'UPDATE · ') + new Date(wib().getTime()).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ' ' + jamWIB() + ' WIB', 540, 1170, 34, '#f2ede2', 'center', 'bold');
  T(x, 'Proyeksi hanya perkiraan, bukan saran investasi', 540, 1225, 26, '#a39a86', 'center');
  pita(x, D); logoAt(x, 475, 40, 130);
  return c.toBuffer('image/png');
}

/* ---------------- kirim ---------------- */
const keWA = t => t.replace(/<pre>([\s\S]*?)<\/pre>/g, '```$1```').replace(/<\/?b>/g, '*').replace(/<\/?i>/g, '_').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function tg(method, body, isForm) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, isForm ? { method: 'POST', body } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error('Telegram: ' + j.description);
  return j.result;
}
async function wa(img, caption, textFull, vid) {
  if (!WHAPI || !WA_CH) return false;
  const jenis = vid ? 'video' : img ? 'image' : 'text';
  const body = vid ? { to: WA_CH, media: 'data:video/mp4;base64,' + vid.toString('base64'), caption: keWA(caption) }
    : img ? { to: WA_CH, media: 'data:image/png;base64,' + img.toString('base64'), caption: keWA(caption) } : { to: WA_CH, body: keWA(textFull) };
  for (const tunggu of [0, 1000, 2000, 4000]) {
    if (tunggu) await new Promise(r => setTimeout(r, tunggu));
    try {
      const r = await fetch('https://gate.whapi.cloud/messages/' + jenis, { method: 'POST', headers: { authorization: 'Bearer ' + WHAPI, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) return true;
      const t = (await r.text()).slice(0, 200);
      if (r.status === 429 || r.status >= 500) { console.log('WA dibatasi/sibuk, coba lagi:', r.status); continue; }
      console.log('Gagal kirim WA:', r.status, t); return false;   // 401 = token salah: jangan diulang
    } catch (e) { console.log('Gagal kirim WA:', e.message); }
  }
  return false;
}
async function kirim(nama, img, caption, textFull, keWa = true, senyap = false, vid = null) {
  if (caption.length > 1024) caption = caption.slice(0, 1000) + '…';
  if (DRY) { console.log(`--- ${nama} ${vid ? '(VIDEO ' + Math.round(vid.length / 1024) + ' KB)' : img ? '(gambar ' + Math.round(img.length / 1024) + ' KB)' : '(teks)'} → Telegram${senyap ? ' (senyap)' : ''}${keWa && WHAPI ? ' + WA' : ''} · ${jamWIB()} WIB ---\n${img || vid ? caption : textFull}\n`); if (OUT && img) fs.writeFileSync(`${OUT}/${nama}.png`, img); if (OUT && vid) fs.writeFileSync(`${OUT}/${nama}.mp4`, vid); return; }
  if (keWa && WHAPI && WA_CH && !(await wa(img, caption, textFull, vid))) lapor('wa', `⚠️ Posting "${nama}" <b>gagal terkirim ke Channel WA</b> (Whapi). Telegram tetap jalan. Cek token/koneksi nomor di whapi.cloud.`);
  if (!TOKEN || !CHAT) return;
  try {
    if (vid) {   // dengan musik → video biasa; tanpa musik → animasi yang otomatis berputar
      try { const f = new FormData(), field = vid.musik ? 'video' : 'animation'; f.append('chat_id', CHAT); f.append('caption', caption); f.append('parse_mode', 'HTML'); f.append('width', '720'); f.append('height', '900');
        if (vid.musik) f.append('supports_streaming', 'true'); if (senyap) f.append('disable_notification', 'true'); f.append(field, new Blob([vid], { type: 'video/mp4' }), nama + '.mp4'); await tg(vid.musik ? 'sendVideo' : 'sendAnimation', f, true); return; }
      catch (e) { console.log('Video gagal, kirim gambar/teks:', e.message); }
    }
    if (img) {
      try { const f = new FormData(); f.append('chat_id', CHAT); f.append('caption', caption); f.append('parse_mode', 'HTML'); if (senyap) f.append('disable_notification', 'true'); f.append('photo', new Blob([img], { type: 'image/png' }), nama + '.png'); await tg('sendPhoto', f, true); return; }
      catch (e) { console.log('Foto gagal, kirim teks:', e.message); }
    }
    await tg('sendMessage', { chat_id: CHAT, text: textFull, parse_mode: 'HTML', disable_web_page_preview: true, disable_notification: senyap });
  } catch (e) { lapor('tg', `⚠️ Posting "${nama}" <b>gagal terkirim ke Telegram</b>: ${esc(e.message)}. Pastikan bot masih admin channel.`); }
}

/* ---------------- notifikasi admin ---------------- */
function lapor(kunci, pesan, jedaJam = 6) {           // satu jenis peringatan maks. sekali per jedaJam
  ST.alert = ST.alert || {};
  if (NOW.getTime() - (ST.alert[kunci] || 0) < jedaJam * 3600e3) return;
  ST.alert[kunci] = NOW.getTime(); ADMIN_MSG.push(pesan);
}
async function kirimAdmin() {
  if (!ADMIN_MSG.length) return;
  const t = '🛠️ <b>Info admin bot harga emas</b>\n\n' + ADMIN_MSG.join('\n\n');
  if (DRY) { console.log('--- DM ADMIN ---\n' + t + '\n'); return; }
  if (!TOKEN || !ADMINS.length) { console.log('Tidak bisa DM admin (TELEGRAM_ADMIN kosong):\n' + t); return; }
  for (const id of ADMINS) { try { await tg('sendMessage', { chat_id: id, text: t, parse_mode: 'HTML', disable_web_page_preview: true }); } catch (e) { console.log('DM admin ' + id + ' gagal:', e.message); } }
}
function cekKesehatan(D, G) {
  const w = wib(), jam = w.getUTCHours() + w.getUTCMinutes() / 60, a = D?.antam;
  if (!G.xau) lapor('xau', '⚠️ Harga emas global (XAUUSD) gagal diambil. Update global dilewati sampai sumber pulih.');
  if (!G.kurs) lapor('kurs', '⚠️ Kurs USD/IDR gagal diambil dari semua sumber.');
  if (w.getUTCDay() !== 0 && jam >= 10.5 && a?.tgl !== tglWIB())
    lapor('antam', '⏰ <b>Harga Antam hari ini belum diupdate.</b>\nBalas pesan ini dengan:\n<code>/antam BELI BUYBACK</code>\nContoh: <code>/antam 2495000 2095000</code>', 12);
  const bk = readJSON('backup/data-emas.enc.json', null);
  if (bk?.t) { const hari = (NOW - new Date(bk.t)) / 864e5; if (hari > 3) lapor('backup', `⚠️ Backup otomatis terakhir <b>${Math.floor(hari)} hari lalu</b>. Buka aplikasi → ⚙︎ Pengaturan → Backup sekarang (cek juga token GitHub).`, 24); }
}

/* ---------------- perintah admin lewat Telegram ---------------- */
function parseAntam(txt) {
  const tok = txt.trim().split(/\s+/).slice(1), angka = t => { let n = Number(String(t).replace(/[.,]/g, '')); if (n && n < 100000) n *= 1000; return n; };
  if (tok.length < 2) return null;
  const beli = angka(tok[0]), bb = angka(tok[1]), jam = /^\d{1,2}[.:]\d{2}$/.test(tok[2] || '') ? tok[2].replace(':', '.').padStart(5, '0') : jamWIB();
  if (!(beli > 500000 && beli < 50e6 && bb > 400000 && bb < beli)) return null;
  return { beli, bb, jam };
}
function hitungBeta(r) {
  r = r.filter(x => x.spot > 0).slice(-41); let sb = 0, sbb = 0, ss = 0, n = 0;
  for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i], gap = (new Date(b.tgl) - new Date(a.tgl)) / 864e5; if (gap < 1 || gap > 4) continue; const dS = b.spot - a.spot; if (Math.abs(dS) < 3000) continue; sb += (b.beli - a.beli) * dS; sbb += (b.bb - a.bb) * dS; ss += dS * dS; n++; }
  if (n < 5) return { b: 1, bb: 1, n }; const cl = v => Math.min(1.5, Math.max(0.5, v)); return { b: cl(sb / ss), bb: cl(sbb / ss), n };
}
function terapkanAntam(D, G, r) {
  D = D || { toko: {}, antam: {} }; const a = D.antam = D.antam || {}, t = D.toko = D.toko || {}, hari = tglWIB(), spot = G.xau && G.kurs ? spotOf(G) : 0;
  if (a.tgl !== hari) { a.prevBeli = a.beli || 0; a.prevBb = a.bb || 0; }
  Object.assign(a, { tgl: hari, jam: r.jam, beli: r.beli, bb: r.bb, spotRef: spot || a.spotRef || 0, xauRef: G.xau || a.xauRef || 0 });
  a.riwayat = (a.riwayat || []).filter(x => x.tgl !== hari); a.riwayat.push({ tgl: hari, beli: r.beli, bb: r.bb, spot: Math.round(spot) }); a.riwayat = a.riwayat.slice(-90);
  a.beta = hitungBeta(a.riwayat);
  if (t.tampil && t.margin != null && !t.manual) { t.jual = r.beli + Number(t.margin || 0); t.buyback = Math.max(0, r.bb - Number(t.potBb || 0)); } // harga toko manual tidak ditimpa
  D.diterbitkan = NOW.toISOString(); D.sumber = 'telegram';
  fs.writeFileSync('harga.json', JSON.stringify(D, null, 1)); ST.ubah = true;
  return D;
}
function teksStatus(D, G) {
  const a = D?.antam, pj = proyeksi(D, G), bk = readJSON('backup/data-emas.enc.json', null), r = AK.ringkasan;
  const jm = t => t ? new Date(t + 7 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : '-';
  return `📋 <b>Status bot</b> (${jamWIB()} WIB)\n\n• XAUUSD: ${G.xau ? '$' + usd(G.xau) : 'gagal'} · Kurs: ${G.kurs ? rp(G.kurs) + ' (' + G.kSrc + ')' : 'gagal'}\n` +
    `• Antam: ${a?.beli ? `${rp(a.beli)} / ${rp(a.bb)} (${a.tgl} ${a.jam})` : 'belum ada'}${a?.tgl === tglWIB() ? ' ✅' : ' ⏰ belum hari ini'}\n` +
    (pj ? `• Proyeksi: beli ±${rp(pj.beli)}\n` : '') +
    `• Posting global terakhir: ${jm(ST.globalAt)} · WA: ${WHAPI ? jm(ST.waGlobalAt) : 'nonaktif'}\n` +
    `• Akurasi arah prediksi: ${r?.n ? `${r.tepat}/${r.n} hari (selisih rata² ${rp(r.rataErr)})` : 'belum ada data'}\n` +
    `• Backup aplikasi: ${bk?.t ? new Date(bk.t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'belum ada'}`;
}
async function perintahTelegram(D, G) {
  if (!process.env.MOCK_UPDATES && (!TOKEN || DRY)) return D;
  let up = [];
  try {
    if (process.env.MOCK_UPDATES) up = JSON.parse(process.env.MOCK_UPDATES);
    else { const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=0&offset=${ST.tgOff || 0}`); up = (await r.json()).result || []; }
  } catch (e) { console.log('getUpdates gagal:', e.message); return D; }
  for (const u of up) {
    ST.tgOff = u.update_id + 1; const m = u.message;
    if (!m || !m.text || m.chat?.type !== 'private') continue;
    const dari = String(m.from.id), txt = m.text.trim();
    const balas = t => DRY ? console.log(`--- BALAS ke ${dari} ---\n${t}\n`) : tg('sendMessage', { chat_id: m.chat.id, text: t, parse_mode: 'HTML' }).catch(() => {});
    if (/^\/(id|start)\b/i.test(txt)) { await balas(`ID Telegram Anda: <code>${dari}</code>\nAdmin: masukkan angka ini ke secret <b>TELEGRAM_ADMIN</b> di GitHub (jika lebih dari satu admin, pisahkan dengan koma).`); continue; }
    if (!ADMINS.includes(dari)) { await balas('Maaf, perintah ini khusus admin. Ikuti channel kami untuk info harga emas harian.'); continue; }
    if (/^\/antam\b/i.test(txt)) {
      const r = parseAntam(txt);
      if (!r) { await balas('Format: <code>/antam BELI BUYBACK [JAM]</code>\nContoh: <code>/antam 2495000 2095000</code> atau <code>/antam 2495 2095 09.15</code>'); continue; }
      D = terapkanAntam(D, G, r);
      await balas(`✅ Harga Antam disimpan\nBeli ${rp(r.beli)} · Buyback ${rp(r.bb)} · ${r.jam} WIB\nPosting dikirim ke channel sekarang, halaman publik ikut diperbarui.`);
      if (ADMINS.length > 1) ADMIN_MSG.push(`ℹ️ Harga Antam diupdate oleh admin <code>${dari}</code> via Telegram: beli ${rp(r.beli)} · buyback ${rp(r.bb)} (${r.jam} WIB).`);
      continue;
    }
    if (/^\/status\b/i.test(txt)) { await balas(teksStatus(D, G)); continue; }
    await balas('Perintah admin:\n<code>/antam BELI BUYBACK</code> — update harga Antam\n<code>/status</code> — cek kondisi bot\n<code>/id</code> — lihat ID Telegram');
  }
  return D;
}

/* ---------------- akurasi prediksi ---------------- */
const arahOf = x => Math.abs(x) < 1000 ? 0 : Math.sign(x);
function evaluasiPrediksi(D) {
  const a = D?.antam, p = ST.pred; if (!a?.beli || !p || p.refKey !== ST.antamKey || p.refTgl === a.tgl) return null;
  const item = { tgl: a.tgl, ref: p.refBeli, pred: p.beli, actual: a.beli, tepat: arahOf(p.beli - p.refBeli) === arahOf(a.beli - p.refBeli), err: Math.abs(a.beli - p.beli) };
  AK.riwayat = (AK.riwayat || []).filter(x => x.tgl !== a.tgl); AK.riwayat.push(item); AK.riwayat = AK.riwayat.slice(-60);
  const r = AK.riwayat.slice(-20);
  AK.ringkasan = { n: r.length, tepat: r.filter(x => x.tepat).length, rataErr: Math.round(r.reduce((s, x) => s + x.err, 0) / r.length / 1000) * 1000 };
  AK.diperbarui = NOW.toISOString(); fs.writeFileSync('akurasi.json', JSON.stringify(AK, null, 1)); ST.ubah = true;
  return item;
}
let AK_BARU = null;
function teksAkurasi() {
  const x = AK_BARU, r = AK.ringkasan; if (!x && !r?.n) return '';
  let s = '\n\n🎯 ';
  if (x) s += `Prediksi terakhir ±${rp(x.pred)} → resmi ${rp(x.actual)}: arah <b>${x.tepat ? 'TEPAT ✅' : 'MELESET ❌'}</b> (selisih ${rp(x.err)})`;
  if (r?.n >= 3) s += `${x ? '\n' : ''}Akurasi arah ${r.n} hari terakhir: <b>${r.tepat}/${r.n}</b>`;
  return s;
}

/* ---------------- rekap mingguan ---------------- */
function dataMingguan(D) {
  const r = (D?.antam?.riwayat || []).filter(x => x.beli), hari = tglWIB(), batas = new Date(new Date(hari) - 7 * 864e5).toISOString().slice(0, 10);
  const minggu = r.filter(x => x.tgl > batas && x.tgl <= hari), sebelum = r.filter(x => x.tgl <= batas).at(-1);
  if (minggu.length < 2 && !(minggu.length && sebelum)) return null;
  const awal = sebelum || minggu[0], akhir = minggu.at(-1), vals = minggu.map(x => x.beli);
  const tgl7 = new Date(new Date(hari) - 7 * 864e5).toISOString().slice(0, 10), snap = ST.daily || {};
  const kunciLama = Object.keys(snap).filter(k => k <= tgl7).sort().at(-1), xLama = kunciLama ? snap[kunciLama] : null, xKini = snap[hari];
  const rAk = (AK.riwayat || []).filter(x => x.tgl > batas);
  return { awal, akhir, d: akhir.beli - awal.beli, dbb: akhir.bb - awal.bb, maks: Math.max(...vals), min: Math.min(...vals), seri: r.slice(-14),
    xau: xLama && xKini ? { lama: xLama.x, kini: xKini.x, p: (xKini.x - xLama.x) / xLama.x } : null, ak: rAk.length ? { n: rAk.length, tepat: rAk.filter(x => x.tepat).length } : null, dari: awal.tgl, sampai: akhir.tgl };
}
const tglPendek = t => new Date(t + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function capRekap(D, W) {
  const arah = W.d > 0 ? '📈 NAIK' : W.d < 0 ? '📉 TURUN' : '⚪ TETAP';
  return `🗓️ <b>REKAP MINGGUAN HARGA EMAS</b>\n${tglPendek(W.dari)} – ${tglPendek(W.sampai)} ${new Date(W.sampai).getUTCFullYear()}\n\n` +
    `Antam seminggu: <b>${arah} ${rp(Math.abs(W.d))}/gr</b>\n• ${rp(W.awal.beli)} → <b>${rp(W.akhir.beli)}</b>\n• Tertinggi ${rp(W.maks)} · Terendah ${rp(W.min)}\n• Buyback ${W.dbb >= 0 ? '+' : '-'}${rp(Math.abs(W.dbb))} → ${rp(W.akhir.bb)}` +
    (W.xau ? `\n\n🌍 XAUUSD seminggu: ${W.xau.p < 0 ? '▼' : '▲'} ${pct(Math.abs(W.xau.p))} ($${usd(W.xau.lama)} → $${usd(W.xau.kini)})` : '') +
    (W.ak ? `\n🎯 Prediksi arah minggu ini: ${W.ak.tepat}/${W.ak.n} tepat` : '') + kaki(D, true);
}
function gambarRekap(D, W) {
  const { c, x } = dasar(D), red = '#e46b5d', grn = '#5fbf7a', col = W.d < 0 ? red : W.d > 0 ? grn : '#a39a86';
  T(x, 'REKAP MINGGUAN', 60, 95, 54, '#f3d98b', 'left', 'bold'); T(x, 'Harga emas Antam · ' + tglPendek(W.dari) + ' – ' + tglPendek(W.sampai), 60, 145, 30, '#a39a86');
  x.fillStyle = '#1f1c15'; x.fillRect(60, 185, 960, 200);
  T(x, 'Perubahan seminggu (per gram)', 90, 235, 28, '#a39a86');
  T(x, (W.d < 0 ? '▼ ' : W.d > 0 ? '▲ ' : '= ') + 'Rp ' + Math.abs(W.d).toLocaleString('id-ID'), 90, 320, 76, col, 'left', 'bold');
  T(x, rp(W.awal.beli) + ' → ' + rp(W.akhir.beli), 90, 365, 28, '#f2ede2');
  const box = (X, lab, val) => { x.fillStyle = '#1f1c15'; x.fillRect(X, 405, 300, 130); T(x, lab, X + 20, 450, 26, '#a39a86'); T(x, val, X + 20, 505, 34, '#f2ede2', 'left', 'bold'); };
  box(60, 'Tertinggi', rp(W.maks)); box(390, 'Terendah', rp(W.min)); box(720, 'Buyback akhir', rp(W.akhir.bb));
  const S = W.seri, v = S.map(s => s.beli), mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1, X0 = 110, X1 = 990, Y0 = 600, Y1 = 1000;
  x.strokeStyle = '#3a3428'; x.lineWidth = 2; for (let i = 0; i < 5; i++) { const y = Y0 + i * (Y1 - Y0) / 4; x.beginPath(); x.moveTo(X0, y); x.lineTo(X1, y); x.stroke(); }
  T(x, 'Rp ' + mx.toLocaleString('id-ID'), X0, Y0 - 12, 22, '#6b6455'); T(x, 'Rp ' + mn.toLocaleString('id-ID'), X0, Y1 + 30, 22, '#6b6455');
  const P = S.map((s, i) => [X0 + (S.length > 1 ? i / (S.length - 1) : 0.5) * (X1 - X0), Y1 - (s.beli - mn) / rg * (Y1 - Y0)]);
  x.beginPath(); P.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.strokeStyle = '#d8b04c'; x.lineWidth = 5; x.stroke();
  P.forEach(([px, py], i) => { x.beginPath(); x.arc(px, py, S[i].tgl > W.dari ? 8 : 5, 0, 7); x.fillStyle = S[i].tgl > W.dari ? '#f3d98b' : '#6b6455'; x.fill(); });
  T(x, tglPendek(S[0].tgl), X0, Y1 + 60, 22, '#a39a86'); T(x, tglPendek(S.at(-1).tgl), X1, Y1 + 60, 22, '#a39a86', 'right'); T(x, 'Grafik harga beli Antam ' + S.length + ' hari', 540, Y1 + 60, 22, '#6b6455', 'center');
  let y = 1140;
  if (W.xau) { T(x, `XAUUSD seminggu: ${W.xau.p < 0 ? '▼' : '▲'} ${pct(Math.abs(W.xau.p))}  ($${usd(W.xau.lama)} → $${usd(W.xau.kini)})`, 540, y, 28, W.xau.p < 0 ? red : grn, 'center', 'bold'); y += 50; }
  if (W.ak) T(x, `Akurasi arah prediksi minggu ini: ${W.ak.tepat}/${W.ak.n}`, 540, y, 26, '#a39a86', 'center');
  T(x, 'Harga referensi, bukan saran investasi', 540, 1255, 22, '#6b6455', 'center');
  pita(x, D); logoAt(x, 890, 18, 140);
  return c.toBuffer('image/png');
}

/* ---------------- konten channel (biar tidak monoton) ---------------- */
const aktif = k => KONTEN.includes(k.toLowerCase()) && !KONTEN.includes('off');
const TIPS = [
  ['Kenapa harga emas ikut naik saat rupiah melemah?', 'Harga emas dunia (XAUUSD) dihitung dalam dolar. Saat rupiah melemah, harga emas dalam rupiah ikut naik walaupun XAUUSD diam. Jadi pantau dua-duanya: XAUUSD dan kurs.'],
  ['Apa itu troy ounce?', 'Harga emas dunia memakai satuan troy ounce (oz). 1 oz = 31,1035 gram. Rumus kasar harga per gram: XAUUSD × kurs ÷ 31,1035.'],
  ['Apa itu spread?', 'Spread adalah selisih harga beli dan harga buyback. Karena ada spread, emas yang baru dibeli biasanya belum untung kalau langsung dijual. Emas cocok untuk tabungan jangka menengah–panjang.'],
  ['Keping kecil vs keping besar', 'Harga per gram keping kecil (0,5–1 gr) lebih mahal karena biaya cetak. Keping besar lebih efisien, tapi keping kecil lebih fleksibel kalau suatu saat perlu dijual sebagian.'],
  ['Jaga kemasan & sertifikat', 'Jangan buka atau merusak kemasan dan sertifikat emas batangan. Kondisi kemasan memengaruhi kemudahan dan harga saat dijual kembali.'],
  ['Cek keaslian kemasan CertiEye', 'Emas Antam keluaran baru memakai kemasan CertiEye yang keasliannya bisa dicek lewat aplikasi CertiEye. Biasakan cek saat menerima emas.'],
  ['Beli rutin sedikit-sedikit', 'Strategi menabung rutin (misalnya tiap gajian) membuat harga beli rata-rata lebih stabil, tanpa harus menebak waktu terbaik untuk membeli.'],
  ['Dana darurat dulu', 'Sebelum menabung emas, siapkan dana darurat dalam bentuk yang mudah dicairkan. Emas lebih cocok untuk tujuan jangka panjang.'],
  ['Jangan beli emas pakai utang', 'Harga emas bisa turun dalam jangka pendek. Membeli dengan pinjaman berbunga bisa membuat rugi dobel. Gunakan dana dingin.'],
  ['Apa yang menggerakkan harga emas?', 'Beberapa penggerak utama: suku bunga bank sentral AS (The Fed), inflasi, nilai dolar, ketegangan geopolitik, dan pembelian emas oleh bank sentral dunia.'],
  ['Emas & dolar AS', 'Harga emas sering bergerak berlawanan dengan dolar AS. Saat dolar menguat, emas cenderung tertekan, walau tidak selalu.'],
  ['Pasar emas libur akhir pekan', 'Pasar emas dunia buka hampir 24 jam di hari kerja dan tutup dari Sabtu pagi sampai Senin pagi WIB. Karena itu harga global tidak bergerak saat akhir pekan.'],
  ['Kadar 999,9 artinya apa?', 'Emas batangan Antam berkadar 999,9 atau 99,99% emas murni (24 karat). Angka ini tertulis di sertifikat dan kemasan.'],
  ['Perhiasan vs batangan', 'Perhiasan punya ongkos pembuatan dan biasanya dipotong saat dijual kembali. Untuk tabungan atau investasi, emas batangan lebih efisien.'],
  ['Simpan di tempat aman', 'Simpan emas fisik di brankas tahan api atau safe deposit box. Hindari menyimpan semuanya di satu tempat yang mudah ditebak.'],
  ['Catat setiap pembelian', 'Catat tanggal, harga, gramasi, dan nomor seri setiap keping. Catatan ini memudahkan menghitung untung-rugi dan sebagai bukti kepemilikan.'],
  ['Simpan nota pembelian', 'Nota atau bukti pembelian membantu saat menjual kembali dan menjadi bukti keabsahan transaksi.'],
  ['Harga referensi vs harga final', 'Harga di channel adalah referensi. Selalu konfirmasi harga final dan stok sebelum transfer.'],
  ['Waspada penipuan', 'Hati-hati dengan tawaran emas jauh di bawah harga pasar. Transfer hanya ke rekening resmi penjual yang sudah Anda verifikasi.'],
  ['Jangan panik saat harga turun', 'Penurunan jangka pendek itu wajar. Lihat tren dalam hitungan bulan atau tahun, bukan hari.'],
  ['Merek berbeda, harga berbeda', 'Antam, UBS, dan Galeri24 punya harga beli dan buyback masing-masing. Perhatikan merek saat membandingkan harga.'],
  ['Kapan harga Antam diperbarui?', 'Harga resmi Antam umumnya diperbarui pagi hari, dan kadang berubah lagi di siang hari saat pasar bergerak kencang. Pantau channel ini untuk update terbaru.'],
  ['Emas digital vs fisik', 'Emas digital praktis untuk menabung nominal kecil. Pastikan platformnya berizin dan diawasi otoritas resmi.'],
  ['Jangan taruh semua di satu keranjang', 'Emas bagus untuk melindungi nilai, tapi sebaiknya dikombinasikan dengan tabungan dan instrumen lain sesuai tujuan keuangan.'],
  ['Membaca prediksi di channel ini', 'Prediksi arah harga Antam di channel ini adalah perkiraan dari gerak XAUUSD dan kurs, bukan kepastian. Gunakan sebagai gambaran saja.'],
  ['Pajak emas batangan', 'Transaksi emas batangan dapat dikenakan pajak (PPh). Tarif tanpa NPWP biasanya lebih tinggi, jadi siapkan data NPWP/NIK saat bertransaksi besar.'],
  ['Kenapa harga beli tiap gramasi tidak sekadar dikali?', 'Harga 5 gr tidak persis 5 × harga 1 gr karena biaya cetak per keping berbeda. Itu sebabnya daftar harga selalu ditulis per keping.'],
  ['Tujuan dulu, baru beli', 'Tentukan tujuan menabung emas: dana pendidikan, menikah, atau pensiun. Tujuan membantu menentukan berapa gram dan berapa lama menabung.'],
  ['Inflasi & emas', 'Dalam jangka panjang emas sering dipakai untuk menjaga nilai uang dari inflasi. Dalam jangka pendek harganya tetap bisa naik turun.'],
  ['Cek berat & nomor seri', 'Saat menerima emas, cocokkan berat, nomor seri di keping, dan nomor di sertifikat. Pastikan semuanya sama.'],
];
const dekatJam = (ms) => { const W = ST.hist.filter(h => Math.abs(h.t - ms) < 20 * 60e3).sort((p, q) => Math.abs(p.t - ms) - Math.abs(q.t - ms)); return W[0]; };
async function konten(D, G) {
  if (jamSunyi()) return;
  ST.k = ST.k || {};
  const w = wib(), hm = w.getUTCHours() * 60 + w.getUTCMinutes(), dow = w.getUTCDay(), hr = tglWIB(), a = D?.antam;
  const waktunya = (k, mulai, selesai) => aktif(k) && hm >= mulai && hm < selesai && ST.k[k] !== hr;
  // ☀️ Kabar pagi (Senin–Sabtu 07.00–09.00)
  if (dow >= 1 && dow <= 6 && G.xau && waktunya('pagi', 420, 540)) {
    const kemarin = dekatJam(NOW.getTime() - 864e5), pj = proyeksi(D, G);
    let s = `☀️ <b>KABAR PAGI EMAS</b>\n🗓️ ${hari(hr)}\n\n• XAUUSD: $${usd(G.xau)}/oz`;
    if (kemarin) { const d = (G.xau - kemarin.x) / kemarin.x; s += ` (${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))} dari kemarin)`; }
    s += `\n• Kurs: ${rp(G.kurs)}${kemarin ? ` (${G.kurs >= kemarin.k ? 'rupiah melemah' : 'rupiah menguat'} ${Math.round(Math.abs(G.kurs - kemarin.k)).toLocaleString('id-ID')} poin)` : ''}`;
    if (pj && a?.beli) s += `\n\n🔮 Perkiraan harga Antam pagi ini: beli ±<b>${rp(pj.beli)}</b> (${pj.beli > a.beli ? 'cenderung naik' : pj.beli < a.beli ? 'cenderung turun' : 'cenderung tetap'} dari ${rp(a.beli)}).`;
    s += `\n\n⏰ Harga resmi Antam akan kami posting begitu keluar. Selamat beraktivitas! 💪` + kaki(D, true);
    const vP = await video('pagi', { tgl: hari(hr), xau: G.xau, dx: kemarin ? (G.xau - kemarin.x) / kemarin.x : null, kurs: G.kurs, pBeli: pj && a?.beli ? pj.beli : 0, ref: a?.beli || 0 });
    await kirim('pagi', null, s, s, dalamJam(WA_AKTIF), false, vP); ST.k.pagi = hr; console.log('Terkirim: kabar pagi');
  }
  // 🎯 Tebak harga (Senin–Sabtu 12.00–15.00, setelah harga Antam hari ini keluar) — polling Telegram
  if (dow >= 1 && dow <= 6 && a?.beli && a.tgl === hr && waktunya('polling', 720, 900) && TOKEN && CHAT) {
    const q = `🎯 Tebak harga! Harga beli Antam saat ini ${rp(a.beli)}/gr. Di update berikutnya naik atau turun?`;
    let msg = null;
    if (DRY) console.log('--- polling ---\n' + q + '\n[📈 Naik] [📉 Turun] [➖ Tetap]\n');
    else msg = await tg('sendPoll', { chat_id: CHAT, question: q, options: [{ text: '📈 Naik' }, { text: '📉 Turun' }, { text: '➖ Tetap' }], is_anonymous: true, disable_notification: true });
    ST.poll = { tgl: hr, ref: a.beli, msg: msg?.message_id || 0 }; ST.k.polling = hr; console.log('Terkirim: polling tebak harga');
  }
  // 💡 Edukasi (setiap hari 19.30–21.30)
  if (waktunya('edukasi', 1170, 1290)) {
    const i = Math.floor(NOW.getTime() / 864e5) % TIPS.length, [jdl, isi] = TIPS[i];
    const s = `💡 <b>EDUKASI EMAS #${i + 1}</b>\n\n<b>${esc(jdl)}</b>\n${esc(isi)}\n\nAda pertanyaan seputar emas? Tanya kami lewat WhatsApp 👇` + kaki(D, true).replace('Proyeksi hanya perkiraan, bukan saran investasi.', 'Informasi edukasi, bukan saran investasi.');
    const vE = await video('edukasi', { no: i + 1, judul: jdl, isi });
    await kirim('edukasi', null, s, s, true, false, vE); ST.k.edukasi = hr; console.log('Terkirim: edukasi');
  }
  // ⚡ Alert gerak cepat: XAUUSD bergerak ≥1% dalam ±1 jam (maks. sekali per 3 jam)
  if (aktif('alert') && G.xau && NOW.getTime() - (ST.alertAt || 0) > 3 * 3600e3) {
    const satuJam = dekatJam(NOW.getTime() - 3600e3);
    if (satuJam) {
      const d = (G.xau - satuJam.x) / satuJam.x;
      if (Math.abs(d) >= 0.01) {
        const dsp = spotOf(G) - satuJam.x * satuJam.k / OZ;
        const s = `⚡ <b>EMAS BERGERAK CEPAT!</b>\n⏰ ${jamWIB()} WIB\n\nDalam 1 jam terakhir XAUUSD ${d > 0 ? '📈 NAIK' : '📉 TURUN'} <b>${pct(Math.abs(d))}</b> ($${usd(satuJam.x)} → $${usd(G.xau)}).\nSetara ${d > 0 ? '+' : '-'}${rp(Math.abs(dsp))}/gr harga spot.\n\nHarga Antam bisa ikut menyesuaikan. Pantau update berikutnya di channel ini.` + kaki(D, true);
        await kirim('alert', null, s, s, dalamJam(WA_AKTIF)); ST.alertAt = NOW.getTime(); console.log('Terkirim: alert gerak cepat');
      }
    }
  }
  // ⭐ Testimoni: langsung saat admin menekan "Kirim ke channel", plus rutin Rabu 16.00–18.00
  const TL = D?.toko?.testi || [], TK = D?.toko?.testiKirim;
  const kirimTesti = async t => { const v = await video('testi', { pengirim: t.nama, kota: t.kota, isi: t.isi, bintang: t.bintang });
    const s = `⭐ <b>KATA PELANGGAN KAMI</b>\n${'★'.repeat(t.bintang || 5)}\n\n“${esc(t.isi)}”\n— <b>${esc(t.nama)}</b>${t.kota ? ', ' + esc(t.kota) : ''}\n\nTerima kasih atas kepercayaannya 🙏 Mau beli atau jual emas? Chat kami 👇` + kaki(D, true).replace('Proyeksi hanya perkiraan, bukan saran investasi.', '');
    await kirim('testi', null, s, s, true, false, v); ST.testiAt = NOW.getTime(); console.log('Terkirim: testimoni ' + t.nama); };
  if (aktif('testi') && TK?.ver && TK.ver !== ST.testiVer) { const t = TL.find(x => x.id === TK.id); if (t && NOW.getTime() - TK.ver < 2 * 864e5) await kirimTesti(t); ST.testiVer = TK.ver; }
  if (TL.length && dow === 3 && waktunya('testi', 960, 1080)) {
    if (NOW.getTime() - (ST.testiAt || 0) > 2 * 864e5) { const i = (ST.testiIdx || 0) % TL.length; await kirimTesti(TL[i]); ST.testiIdx = i + 1; }
    ST.k.testi = hr;
  }
  // 📅 Agenda ekonomi (FOMC, CPI, dan agenda dari aplikasi)
  await agenda(D, G);
  // 💭 Andai dulu beli (Minggu 10.00–12.00, saat pasar libur)
  if (dow === 0 && a?.riwayat?.length && a.bb && waktunya('andai', 600, 720)) {
    const R = a.riwayat.filter(r => r.beli), cari = n => { const t = new Date(NOW.getTime() - n * 864e5 + 7 * 3600e3).toISOString().slice(0, 10); return R.filter(r => r.tgl <= t).slice(-1)[0]; };
    const dataAndai = [];
    const baris = [[7, '1 minggu'], [30, '1 bulan'], [90, '3 bulan']].map(([n, l]) => { const r = cari(n); if (!r) return ''; const sel = (a.bb - r.beli) * 10;
      dataAndai.push({ label: l + ' lalu', tgl: new Date(r.tgl + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }), beli: r.beli * 10, bb: a.bb * 10, sel });
      return `• ${l} lalu (${new Date(r.tgl + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })}): beli ${rp(r.beli * 10)} → buyback hari ini ${rp(a.bb * 10)} = <b>${sel >= 0 ? '+' : '-'}${rp(Math.abs(sel))}</b> ${sel >= 0 ? '🟢' : '🔴'}`; }).filter(Boolean);
    if (baris.length) {
      const s = `💭 <b>ANDAI DULU BELI 10 GRAM ANTAM…</b>\n\n${baris.join('\n')}\n\n<i>Hitungan memakai harga beli per gram × 10 dan buyback terakhir, belum termasuk pajak. Karena ada selisih beli–buyback, emas paling cocok untuk tabungan jangka panjang.</i>` + kaki(D, true);
      const vN = await video('andai', { baris: dataAndai });
      await kirim('andai', null, s, s, true, false, vN); console.log('Terkirim: andai dulu beli');
    }
    ST.k.andai = hr;
  }
}
async function hasilPolling(a) {                                    // dipanggil setelah harga Antam baru terkirim
  const P = ST.poll; if (!aktif('polling') || !P || P.selesai || a.tgl <= P.tgl) return;
  const d = a.beli - P.ref, jwb = Math.abs(d) < 1000 ? '➖ Tetap' : d > 0 ? '📈 Naik' : '📉 Turun';
  const s = `🎯 <b>HASIL TEBAK HARGA</b>\n\nHarga beli Antam ${d > 0 ? 'NAIK' : d < 0 ? 'TURUN' : 'TETAP'}${d ? ' ' + rp(Math.abs(d)) : ''} (${rp(P.ref)} → ${rp(a.beli)}).\nJawaban yang benar: <b>${jwb}</b> 🎉\n\nYang menebak benar, mantap! Tebakan berikutnya siang ini ya 😉`;
  if (P.msg && !DRY) try { await tg('stopPoll', { chat_id: CHAT, message_id: P.msg }); } catch (e) { }
  await kirim('hasil-polling', null, s, s, false, true); P.selesai = true; console.log('Terkirim: hasil polling');
}
async function rekor(a) {                                           // harga Antam tertinggi / terendah dalam data yang ada
  if (!aktif('rekor')) return;
  const R = (a.riwayat || []).filter(r => r.tgl < a.tgl && r.beli); if (R.length < 20) return;
  const mx = Math.max(...R.map(r => r.beli)), mn = Math.min(...R.map(r => r.beli)), hari0 = Math.round((new Date(a.tgl) - new Date(R[0].tgl)) / 864e5);
  let s = '';
  if (a.beli > mx) s = `🏆 <b>REKOR BARU!</b>\nHarga beli Antam ${rp(a.beli)}/gr adalah yang <b>tertinggi dalam ${hari0} hari terakhir</b> (sebelumnya ${rp(mx)}).`;
  else if (a.beli < mn) s = `💎 <b>TERENDAH DALAM ${hari0} HARI</b>\nHarga beli Antam ${rp(a.beli)}/gr adalah yang <b>termurah dalam ${hari0} hari terakhir</b> (sebelumnya ${rp(mn)}).`;
  if (s) { s += '\n\n<i>Berdasarkan data harga yang tercatat di channel ini. Bukan saran investasi.</i>';
    const vR = await video('rekor', { tinggi: a.beli > mx, hari: hari0, beli: a.beli, sebelum: a.beli > mx ? mx : mn, seri: R.slice(-12).map(r => r.beli).concat([a.beli]) });
    await kirim('rekor', null, s, s, true, false, vR); console.log('Terkirim: rekor'); }
}

/* ---------------- video animasi 3D ---------------- */
let VMOD;
async function video(jenis, data) {
  if (!CV || /^(off|0|false)$/i.test(process.env.VIDEO || '')) return null;
  try { VMOD = VMOD || await import('./video.mjs'); return await VMOD.buatVideo(jenis, { nama: D0?.toko?.nama || '', wa: String(D0?.toko?.wa || '').replace(/^62/, '0'), ...data }, { CV, LOGO, FONT, musik: !/^(off|0|false)$/i.test(process.env.MUSIK || '') }); }
  catch (e) { console.log('Video gagal dibuat:', e.message); return null; }
}
let D0 = null;
const seriAntam = (a, n = 20) => (a?.riwayat || []).filter(r => r.beli).slice(-n).map(r => r.beli);
async function kirimToko(D, promo) {
  const f = D.toko.info, v = await video('toko', { tgl: hari(waktuWIB(f.upd || f.ver).tgl), merek: f.merek, kolom: f.kolom, catatan: f.catatan, rows: f.rows });
  let cap = capToko(D); if (promo) cap = cap.replace(/^🏪 <b>[^<]*<\/b>/, '🛍️ <b>HARGA TOKO HARI INI</b> (pengingat sore)');
  ST.tokoAt = NOW.getTime();
  if (v) { await kirim('toko', null, cap, cap, true, false, v); if (CV) await kirim('toko-tabel', gambarToko(D), `📋 <b>Daftar harga ${esc(String(D.toko.nama || '').replace(/^@/, ''))}</b> (gambar)`, cap, true, true); }
  else await kirim('toko', CV ? gambarToko(D) : null, cap, cap);
}
/* ---------------- agenda ekonomi: hitung mundur & reaksi pasar ---------------- */
// Sumber: jadwal resmi FOMC (federalreserve.gov, revisi 12 Nov 2026) & jadwal rilis CPI (bls.gov). Keputusan FOMC 14.00 ET hari ke-2; CPI 08.30 ET.
const FOMC = ['2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-11-17', '2028-01-26'];
const CPI = ['2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'];
function etKeUtc(tgl, hh, mm) {                                  // jam New York (otomatis EST/EDT) → milidetik UTC
  const [y, m, d] = tgl.split('-').map(Number);
  for (const off of [5, 4]) { const ms = Date.UTC(y, m - 1, d, hh + off, mm), j = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date(ms));
    if (Number(j) % 24 === hh) return ms; }
  return Date.UTC(y, m - 1, d, hh + 5, mm);
}
function daftarAgenda(D) {
  const L = [...FOMC.map(t => ({ id: 'fomc-' + t, acara: 'Keputusan suku bunga The Fed (FOMC)', t: etKeUtc(t, 14, 0), ket: 'Suku bunga AS sangat memengaruhi harga emas. Saat pengumuman, harga emas biasanya bergerak tajam.' })),
    ...CPI.map(t => ({ id: 'cpi-' + t, acara: 'Rilis data inflasi AS (CPI)', t: etKeUtc(t, 8, 30), ket: 'Data inflasi memengaruhi arah suku bunga The Fed dan sering membuat harga emas bergejolak.' }))];
  for (const a of D?.toko?.agenda || []) { const [hh, mm] = String(a.jam).split('.').map(Number); const [y, m, d] = a.tgl.split('-').map(Number);
    if (y && hh >= 0) L.push({ id: 'c-' + a.id + '-' + a.tgl + a.jam, acara: a.nama, t: Date.UTC(y, m - 1, d, hh - 7, mm || 0), ket: a.ket || '' }); }
  return L;
}
const labelWaktu = ms => { const w = new Date(ms + 7 * 3600e3); return w.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) + ' · ' + w.toISOString().slice(11, 16).replace(':', '.') + ' WIB'; };
async function agenda(D, G) {
  if (!aktif('agenda') || jamSunyi()) return;
  ST.ag = ST.ag || {}; const now = NOW.getTime();
  for (const id of Object.keys(ST.ag)) if (ST.ag[id].t < now - 3 * 864e5) delete ST.ag[id];
  for (const e of daftarAgenda(D)) {
    const sisa = e.t - now, st = ST.ag[e.id] || (ST.ag[e.id] = { t: e.t });
    if (sisa > 20 * 3600e3 && sisa < 30 * 3600e3 && !st.h1) {
      const s = `📅 <b>AGENDA BESOK</b>\n\n<b>${esc(e.acara)}</b>\n🕑 ${labelWaktu(e.t)}\n\n${esc(e.ket)}\n\nKami akan kirim pengingat beberapa jam sebelumnya dan update pergerakan emas setelah pengumuman.` + kaki(D, true);
      await kirim('agenda-h1', null, s, s, dalamJam(WA_AKTIF), true); st.h1 = 1; console.log('Terkirim: agenda H-1 ' + e.id);
    } else if (sisa > 110 * 60e3 && sisa <= 200 * 60e3 && !st.mundur) {
      const jam = Math.round(sisa / 3600e3), label = jam >= 3 ? '3 JAM LAGI' : jam >= 2 ? '2 JAM LAGI' : 'SEBENTAR LAGI';
      const v = await video('agenda', { sisa: label, acara: e.acara, waktu: labelWaktu(e.t), ket: e.ket, frac: Math.max(0.1, 1 - sisa / (4 * 3600e3)) });
      const s = `⏳ <b>${label}: ${esc(e.acara.toUpperCase())}</b>\n🕑 ${labelWaktu(e.t)}\n\n${esc(e.ket)}${G.xau ? `\n\nPosisi emas sekarang: XAUUSD $${usd(G.xau)} · spot ${rp(spotOf(G))}/gr` : ''}\n\n<i>Harga bisa bergerak cepat menjelang & sesudah pengumuman. Bukan saran investasi.</i>` + kaki(D, true);
      await kirim('agenda', null, s, s, dalamJam(WA_AKTIF), false, v); st.mundur = 1; if (G.xau) st.pre = { x: G.xau, k: G.kurs }; console.log('Terkirim: hitung mundur ' + e.id);
    } else if (sisa < -20 * 60e3 && sisa > -10 * 3600e3 && !st.reaksi && G.xau) {
      const pre = st.pre || (() => { const h = ST.hist.filter(p => p.t < e.t && p.t > e.t - 3 * 3600e3).at(-1); return h ? { x: h.x, k: h.k } : null; })();
      if (pre) { const d = (G.xau - pre.x) / pre.x, dsp = spotOf(G) - pre.x * pre.k / OZ;
        const s = `⚡ <b>REAKSI PASAR: ${esc(e.acara)}</b>\n\nSejak sebelum pengumuman (${labelWaktu(e.t)}):\n• XAUUSD ${d >= 0 ? '📈' : '📉'} <b>${d >= 0 ? '+' : '-'}${pct(Math.abs(d))}</b> ($${usd(pre.x)} → $${usd(G.xau)})\n• Spot ${dsp >= 0 ? '+' : '-'}${rp(Math.abs(dsp))}/gr → ${rp(spotOf(G))}/gr\n\nHarga Antam berikutnya bisa ikut menyesuaikan. Pantau terus channel ini.` + kaki(D, true);
        await kirim('agenda-reaksi', null, s, s, dalamJam(WA_AKTIF)); console.log('Terkirim: reaksi ' + e.id); }
      st.reaksi = 1;
    }
  }
}
function cariSlot() {                                           // jadwal kelipatan PERIODE terdekat: ≤4 menit ke depan atau ≤4 menit lewat
  const P = PERIODE * 60e3, t = NOW.getTime(), next = Math.ceil(t / P) * P, prev = Math.floor(t / P) * P;
  if (next - t <= TELAT_MAKS && next !== t) return next;
  if (t - prev <= TELAT_MAKS) return prev;
  return null;
}
function dalamJam(r) {                                           // "7-21" → 07.00–20.59 WIB
  if (!/^\d{1,2}-\d{1,2}$/.test(r)) return true;
  const [a, b] = r.split('-').map(Number), h = wib().getUTCHours();
  return a > b ? (h >= a || h < b) : (h >= a && h < b);
}
function jamSunyi() {
  if (!/^\d{1,2}-\d{1,2}$/.test(QUIET)) return false;
  const [a, b] = QUIET.split('-').map(Number), h = wib().getUTCHours();
  return a > b ? (h >= a || h < b) : (h >= a && h < b);
}

async function main() {
  if (!DRY && !(TOKEN && CHAT) && !(WHAPI && WA_CH)) throw new Error('Isi secret TELEGRAM_TOKEN/TELEGRAM_CHAT dan/atau WHAPI_TOKEN/WA_CHANNEL');
  ST = readJSON(STATE, {}); AK = readJSON('akurasi.json', { riwayat: [] });
  let D = readJSON('harga.json', null); D0 = D; const G = await hargaGlobal(D);
  await siapkanCanvas();
  D = await perintahTelegram(D, G);
  ST.hist = (ST.hist || []).filter(h => h.t > NOW.getTime() - 3 * 864e5);
  if (G.xau && G.kurs) { ST.hist.push({ t: NOW.getTime(), x: G.xau, k: G.kurs }); ST.daily = ST.daily || {}; ST.daily[tglWIB()] = { x: G.xau, k: G.kurs };
    const lama = Object.keys(ST.daily).sort().slice(0, -40); lama.forEach(k => delete ST.daily[k]); }

  // 1) harga Antam baru → evaluasi prediksi sebelumnya, lalu kirim
  const a = D?.antam;
  if (a?.beli && a.tgl === tglWIB()) {
    const key = [a.tgl, a.jam, a.beli, a.bb].join('|');
    if (key !== ST.antamKey) {
      AK_BARU = evaluasiPrediksi(D);
      const vA = await video('antam', { tgl: hari(a.tgl), jam: a.jam, beli: a.beli, bb: a.bb, prevBeli: a.prevBeli, prevBb: a.prevBb, seri: seriAntam(a) });
      if (vA) {
        await kirim('antam', null, capAntam(D).replace('📋 Daftar 0,5 gr – 1 kg ada di gambar.', '📋 Daftar 0,5 gr – 1 kg ada di gambar berikutnya.'), teksAntamLengkap(D, G), true, false, vA);
        if (CV) await kirim('antam-tabel', gambarAntam(D), `📋 <b>Daftar harga Antam ${hari(a.tgl)}</b> · 0,5 gr – 1 kg`, teksAntamLengkap(D, G), true, true);
      } else await kirim('antam', CV ? gambarAntam(D) : null, capAntam(D), teksAntamLengkap(D, G));
      ST.antamKey = key; console.log('Terkirim: Antam');
      try { await hasilPolling(a); await rekor(a); } catch (e) { console.log('Konten Antam gagal:', e.message); }
    }
  }
  // 1b) harga toko yang dikirim admin dari aplikasi (sekali per pengiriman; abaikan yang sudah >2 hari)
  const inf = D?.toko?.info;
  if (inf?.ver && inf.rows?.length && inf.ver !== ST.infoVer) {
    if (NOW.getTime() - inf.ver < 2 * 864e5) { await kirimToko(D, false); console.log('Terkirim: harga toko'); }
    ST.infoVer = inf.ver;
  }
  // 2) & 3) update global TEPAT di menit kelipatan PERIODE (WIB) / pasar tutup
  const slot = cariSlot();
  if (slot) {
    if (slot > NOW.getTime()) {                                  // dipicu 1 menit lebih awal → tunggu sampai detik ke-0
      const tunggu = slot - (MOCK ? NOW.getTime() : Date.now());
      console.log(`Menunggu ${Math.round(tunggu / 1000)} detik sampai ${jamWIB(new Date(slot))} WIB`);
      if (!MOCK && tunggu > 0) await new Promise(r => setTimeout(r, tunggu));
      NOW = MOCK ? new Date(slot) : new Date();
      Object.assign(G, await hargaGlobal(D));                    // ambil harga terbaru tepat di jam posting
      if (G.xau && G.kurs) ST.hist.push({ t: NOW.getTime(), x: G.xau, k: G.kurs });
    }
  }
  if (G.xau && G.kurs) {
    const umur = G.at ? (NOW.getTime() - new Date(G.at).getTime()) / 60e3 : 0, buka = G.at && umur < 30;
    if (buka) {
      ST.tutup = false;
      if (slot && slot !== ST.globalSlot && !jamSunyi()) {
        const w = wib(new Date(slot)), mHari = w.getUTCHours() * 60 + w.getUTCMinutes(), perJam = w.getUTCMinutes() === 0;
        const keWa = mHari % WA_MENIT === 0 && dalamJam(WA_AKTIF);
        const cap = capGlobal(D, G, false, !perJam);
        await kirim('global', CV ? gambarGlobal(D, G, ST.hist, false) : null, cap, cap, keWa, !perJam);
        ST.globalSlot = slot; ST.globalAt = NOW.getTime(); ST.lastG = { x: G.xau, k: G.kurs, t: NOW.getTime() }; if (keWa) ST.waGlobalAt = NOW.getTime();
        console.log(`Terkirim: global ${jamWIB()} WIB` + (perJam ? ' (dengan notifikasi)' : ' (senyap)') + (keWa ? ' + WA' : ''));
      } else console.log('Update global: bukan jadwal / sudah terkirim / jam sunyi.');
      ST.xauAt = G.at;
    } else if (umur >= 60 && !ST.tutup && ST.xauAt) {
      const cap = capGlobal(D, G, true);
      await kirim('tutup', CV ? gambarGlobal(D, G, ST.hist, true) : null, cap, cap); ST.tutup = true; console.log('Terkirim: pasar tutup');
    } else console.log('Update global: pasar diam, tidak ada yang dikirim.');
  }
  // 3b) konten channel: kabar pagi, tebak harga, edukasi, alert gerak cepat, andai dulu beli
  try { await konten(D, G); } catch (e) { console.log('Konten gagal:', e.message); }
  // 4) rekap mingguan: Sabtu mulai 12.00 WIB, sekali seminggu
  const w = wib();
  if (w.getUTCDay() === 6 && w.getUTCHours() >= 12 && ST.rekap !== tglWIB()) {
    const W = dataMingguan(D);
    if (W) {
      const S7 = (D?.antam?.riwayat || []).filter(r => r.beli).slice(-7);
      const vK = await video('rekap', { periode: `${tglPendek(W.dari)} – ${tglPendek(W.sampai)} ${new Date(W.sampai).getUTCFullYear()}`, d: W.d, awal: W.awal.beli, akhir: W.akhir.beli,
        seri: S7.map(r => r.beli), label: S7.map(r => new Date(r.tgl + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' })), xau: W.xau?.p ?? null, ak: W.ak ? `${W.ak.tepat}/${W.ak.n}` : '' });
      await kirim('rekap', CV && !vK ? gambarRekap(D, W) : null, capRekap(D, W), capRekap(D, W), true, false, vK); console.log('Terkirim: rekap mingguan');
    }
    ST.rekap = tglWIB();
  }
  // 5) simpan prediksi terbaru untuk dinilai saat harga Antam berikutnya keluar
  const pj = proyeksi(D, G);
  if (pj && D?.antam?.beli) ST.pred = { refKey: [D.antam.tgl, D.antam.jam, D.antam.beli, D.antam.bb].join('|'), refTgl: D.antam.tgl, refBeli: D.antam.beli, beli: pj.beli, bb: pj.bb, t: NOW.getTime() };
  cekKesehatan(D, G);
  await kirimAdmin();
  fs.mkdirSync(STATE.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(ST));
}
main().catch(async e => { console.error(e.message); ADMIN_MSG.push('❌ Bot error: ' + esc(e.message)); await kirimAdmin(); process.exit(1); });
