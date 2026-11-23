// Bot harga emas @safehaven.assets — dijalankan GitHub Actions tiap 15 menit (posting global tetap maks. 1x per jam).
// Mengirim GAMBAR + keterangan ke Telegram (dan Channel WA via Whapi, opsional):
//   (1) harga Antam saat ada update baru di harga.json,
//   (2) update harga global (XAUUSD + kurs) tiap ±1 jam selama pasar buka,
//   (3) "Pasar tutup" sekali saat pasar global berhenti bergerak.
import fs from 'node:fs';

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT;
const WHAPI = process.env.WHAPI_TOKEN, WA_CH = process.env.WA_CHANNEL;
const TDKEY = (process.env.TWELVEDATA_KEY || '').trim();
const WA_JAM = Math.max(1, Number(process.env.WA_INTERVAL_JAM) || 1); // jarak minimal update global ke Channel WA (jam)
const ADMINS = String(process.env.TELEGRAM_ADMIN || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean); // ID Telegram admin, pisahkan koma bila >1
const NOW = process.env.MOCK_NOW ? new Date(process.env.MOCK_NOW) : new Date();
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
  if (!pendek && t.tampil && t.jual) s += `\n\n🏪 <b>Harga ${esc(String(t.nama || '').replace(/^@/, ''))}</b>\n• Jual: ${rp(t.jual)}/gr\n• Buyback: ${rp(t.buyback)}/gr`;
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
function proyeksi(D, G) {
  const a = D?.antam; if (!a?.spotRef || !a.beli) return null;
  const adj = spotOf(G) - a.spotRef, be = a.beta || { b: 1, bb: 1 };
  return { adj, beli: rnd(a.beli + be.b * adj), bb: rnd(a.bb + be.bb * adj) };
}
function capGlobal(D, G, tutup) {
  const a = D?.antam, pj = proyeksi(D, G), xc = a?.xauRef ? (G.xau - a.xauRef) / a.xauRef : null;
  let s = `${tutup ? '🔔 <b>Pasar tutup.</b>' : '🌍 <b>UPDATE HARGA EMAS GLOBAL</b>'}\n🗓️ ${hari(tglWIB())} · ⏰ ${jamWIB()} WIB\n\n` +
    `• XAUUSD: $${usd(G.xau)}/oz${xc !== null ? ` (${xc < 0 ? '▼' : '▲'} ${pct(Math.abs(xc))})` : ''}\n• Kurs: ${rp(G.kurs)}\n• Spot: ${rp(spotOf(G))}/gr`;
  if (pj) {
    s += `\n\nEmas ${pj.adj < 0 ? '📉 melemah' : '📈 menguat'} <b>${rp(Math.abs(pj.adj))}/gr</b> sejak update Antam ${esc(refAntam(a))}.`;
    const kRef = a.xauRef ? a.spotRef * OZ / a.xauRef : 0;
    if (kRef && G.kurs) { const dk = G.kurs - kRef; if (Math.abs(dk) >= 1) s += `\n💱 Rupiah ${dk > 0 ? 'melemah' : 'menguat'} ${Math.round(Math.abs(dk)).toLocaleString('id-ID')} poin (Rp ${Math.round(kRef).toLocaleString('id-ID')} → Rp ${Math.round(G.kurs).toLocaleString('id-ID')}/USD)${dk > 0 ? ', ikut mendorong harga emas naik' : ', ikut menekan harga emas'}.`; }
    const db = pj.beli - a.beli, arah = Math.abs(db) < 1000 ? '⚪ <b>CENDERUNG TETAP</b>' : db > 0 ? `🔺 <b>CENDERUNG NAIK</b> ±${rp(db)}` : `🔻 <b>CENDERUNG TURUN</b> ±${rp(-db)}`;
    s += `\n\n🔮 <b>Prediksi harga Antam berikutnya:</b> ${arah}\n• Beli ±${rp(pj.beli)} · Buyback ±${rp(pj.bb)}\n<i>(dari harga resmi ${esc(refAntam(a))}: beli ${rp(a.beli)})</i>`;
  }
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
  const y2 = 465 + AG.length * 60, t = D.toko || {};
  if (t.tampil && t.jual) T(x, `Harga toko: jual ${rp(t.jual)}/gr · buyback ${rp(t.buyback)}/gr`, 540, y2 + 5, 27, '#f3d98b', 'center', 'bold');
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
}
async function wa(img, caption, textFull) {
  if (!WHAPI || !WA_CH) return false;
  const body = img ? { to: WA_CH, media: 'data:image/png;base64,' + img.toString('base64'), caption: keWA(caption) } : { to: WA_CH, body: keWA(textFull) };
  for (const tunggu of [0, 1000, 2000, 4000]) {
    if (tunggu) await new Promise(r => setTimeout(r, tunggu));
    try {
      const r = await fetch('https://gate.whapi.cloud/messages/' + (img ? 'image' : 'text'), { method: 'POST', headers: { authorization: 'Bearer ' + WHAPI, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) return true;
      const t = (await r.text()).slice(0, 200);
      if (r.status === 429 || r.status >= 500) { console.log('WA dibatasi/sibuk, coba lagi:', r.status); continue; }
      console.log('Gagal kirim WA:', r.status, t); return false;   // 401 = token salah: jangan diulang
    } catch (e) { console.log('Gagal kirim WA:', e.message); }
  }
  return false;
}
async function kirim(nama, img, caption, textFull, keWa = true) {
  if (caption.length > 1024) caption = caption.slice(0, 1000) + '…';
  if (DRY) { console.log(`--- ${nama} ${img ? '(gambar ' + Math.round(img.length / 1024) + ' KB)' : '(teks)'} → Telegram${keWa && WHAPI ? ' + WA' : ''} ---\n${img ? caption : textFull}\n`); if (OUT && img) fs.writeFileSync(`${OUT}/${nama}.png`, img); return; }
  if (keWa && WHAPI && WA_CH && !(await wa(img, caption, textFull))) lapor('wa', `⚠️ Posting "${nama}" <b>gagal terkirim ke Channel WA</b> (Whapi). Telegram tetap jalan. Cek token/koneksi nomor di whapi.cloud.`);
  if (!TOKEN || !CHAT) return;
  try {
    if (img) {
      try { const f = new FormData(); f.append('chat_id', CHAT); f.append('caption', caption); f.append('parse_mode', 'HTML'); f.append('photo', new Blob([img], { type: 'image/png' }), nama + '.png'); await tg('sendPhoto', f, true); return; }
      catch (e) { console.log('Foto gagal, kirim teks:', e.message); }
    }
    await tg('sendMessage', { chat_id: CHAT, text: textFull, parse_mode: 'HTML', disable_web_page_preview: true });
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
  if (t.tampil && t.margin != null) { t.jual = r.beli + Number(t.margin || 0); t.buyback = Math.max(0, r.bb - Number(t.potBb || 0)); }
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

function jamSunyi() {
  if (!/^\d{1,2}-\d{1,2}$/.test(QUIET)) return false;
  const [a, b] = QUIET.split('-').map(Number), h = wib().getUTCHours();
  return a > b ? (h >= a || h < b) : (h >= a && h < b);
}

async function main() {
  if (!DRY && !(TOKEN && CHAT) && !(WHAPI && WA_CH)) throw new Error('Isi secret TELEGRAM_TOKEN/TELEGRAM_CHAT dan/atau WHAPI_TOKEN/WA_CHANNEL');
  ST = readJSON(STATE, {}); AK = readJSON('akurasi.json', { riwayat: [] });
  let D = readJSON('harga.json', null); const G = await hargaGlobal(D);
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
      await kirim('antam', CV ? gambarAntam(D) : null, capAntam(D), teksAntamLengkap(D, G)); ST.antamKey = key; console.log('Terkirim: Antam');
    }
  }
  // 2) & 3) update global / pasar tutup
  if (G.xau && G.kurs) {
    const umur = G.at ? (NOW.getTime() - new Date(G.at).getTime()) / 60e3 : 0, gerak = G.at && G.at !== ST.xauAt;
    if (gerak && umur < 60) {
      ST.tutup = false;
      if (!jamSunyi() && NOW.getTime() - (ST.globalAt || 0) > 50 * 60e3) {
        const cap = capGlobal(D, G, false), keWa = NOW.getTime() - (ST.waGlobalAt || 0) > WA_JAM * 3600e3 - 10 * 60e3;
        await kirim('global', CV ? gambarGlobal(D, G, ST.hist, false) : null, cap, cap, keWa); ST.globalAt = NOW.getTime(); if (keWa) ST.waGlobalAt = NOW.getTime();
        console.log('Terkirim: global' + (keWa ? ' (Telegram + WA)' : ' (Telegram saja, WA menunggu jadwal)'));
      } else console.log('Update global: belum 1 jam sejak posting terakhir / jam sunyi.');
      ST.xauAt = G.at;
    } else if (umur >= 60 && !ST.tutup && ST.xauAt) {
      const cap = capGlobal(D, G, true);
      await kirim('tutup', CV ? gambarGlobal(D, G, ST.hist, true) : null, cap, cap); ST.tutup = true; console.log('Terkirim: pasar tutup');
    } else console.log('Update global: tidak ada yang dikirim (pasar diam / jam sunyi / belum 1 jam).');
  }
  // 4) rekap mingguan: Sabtu mulai 12.00 WIB, sekali seminggu
  const w = wib();
  if (w.getUTCDay() === 6 && w.getUTCHours() >= 12 && ST.rekap !== tglWIB()) {
    const W = dataMingguan(D);
    if (W) { await kirim('rekap', CV ? gambarRekap(D, W) : null, capRekap(D, W), capRekap(D, W)); console.log('Terkirim: rekap mingguan'); }
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
