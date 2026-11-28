// Video animasi (infografis 3D) untuk channel @safehaven.assets.
// Digambar frame demi frame dengan @napi-rs/canvas (mesin 3D kecil: batang emas & koin berputar,
// grafik batang 3D, partikel kilau), lalu di-encode ke MP4 H.264 tanpa suara dengan ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const W = 720, H = 900, FPS = 30;
const C = { bg: '#0d0c09', mar: '#5a0a0a', gold: '#d8b04c', cream: '#f3d98b', txt: '#f2ede2', mut: '#a39a86', dim: '#6b6455', grn: '#5fbf7a', red: '#e46b5d', card: 'rgba(31,28,21,.92)' };
let CV, LOGO, FONT = 'sans-serif';

/* ---------- util ---------- */
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const prog = (t, s, d) => clamp((t - s) / d);
const eOut = p => 1 - Math.pow(1 - p, 3);
const eBack = p => { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const rpS = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  try { const p = path.resolve('node_modules/ffmpeg-static/ffmpeg'); if (fs.existsSync(p)) return p; } catch { }
  return null;
}
function T(x, t, X, Y, sz, col, al = 'left', w = '', a = 1) {
  if (a <= 0) return; x.save(); x.globalAlpha *= a; x.font = `${w} ${sz}px ${FONT}`; x.fillStyle = col; x.textAlign = al; x.fillText(t, X, Y); x.restore();
}
function wrap(x, t, maxW, sz, w = '') {
  x.font = `${w} ${sz}px ${FONT}`; const out = []; let line = '';
  for (const kata of String(t).split(/\s+/)) { const c = line ? line + ' ' + kata : kata; if (x.measureText(c).width > maxW && line) { out.push(line); line = kata; } else line = c; }
  if (line) out.push(line); return out;
}
function rrect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function kartu(x, X, Y, w, h, a = 1, garis = 'rgba(216,176,76,.35)') { if (a <= 0) return; x.save(); x.globalAlpha *= a; rrect(x, X, Y, w, h, 18); x.fillStyle = C.card; x.fill(); x.strokeStyle = garis; x.lineWidth = 2; x.stroke(); x.restore(); }

/* ---------- latar ---------- */
function latar(x, t, mode = 'malam') {
  const g = x.createLinearGradient(0, 0, 0, H);
  if (mode === 'pagi') { g.addColorStop(0, '#120d08'); g.addColorStop(0.55, '#3a1d0c'); g.addColorStop(1, '#7a3a10'); }
  else { g.addColorStop(0, '#0d0c09'); g.addColorStop(0.6, '#1a0c08'); g.addColorStop(1, '#3d0909'); }
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  if (mode === 'pagi') {                                   // matahari terbit
    const sy = 560 - eOut(prog(t, 0, 2.5)) * 170, r = x.createRadialGradient(360, sy, 10, 360, sy, 330);
    r.addColorStop(0, 'rgba(255,214,120,.85)'); r.addColorStop(0.25, 'rgba(255,170,70,.35)'); r.addColorStop(1, 'rgba(255,140,40,0)');
    x.fillStyle = r; x.fillRect(0, 0, W, H);
  }
  const v = x.createRadialGradient(360, 330, 120, 360, 330, 560); v.addColorStop(0, 'rgba(216,176,76,.10)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = v; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 38; i++) {                            // debu emas melayang
    const px = rnd(i) * W, py = (rnd(i + 99) * H - t * (12 + rnd(i + 7) * 28)) % H, yy = py < 0 ? py + H : py, s = 1 + rnd(i + 3) * 2.4;
    x.fillStyle = `rgba(243,217,139,${0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2 + i))})`; x.beginPath(); x.arc(px, yy, s, 0, 7); x.fill();
  }
}
function kilau(x, X, Y, t, n = 7, R = 150) {
  for (let i = 0; i < n; i++) {
    const a = rnd(i + 40) * 6.28 + t * 0.4, rr = R * (0.55 + 0.45 * rnd(i + 50)), s = (0.5 + 0.5 * Math.sin(t * 3 + i * 1.7)) * (6 + 6 * rnd(i));
    const px = X + Math.cos(a) * rr, py = Y + Math.sin(a) * rr * 0.6;
    x.save(); x.translate(px, py); x.fillStyle = 'rgba(255,240,200,.9)';
    x.beginPath(); x.moveTo(0, -s); x.lineTo(s * 0.22, 0); x.lineTo(0, s); x.lineTo(-s * 0.22, 0); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(-s, 0); x.lineTo(0, s * 0.22); x.lineTo(s, 0); x.lineTo(0, -s * 0.22); x.closePath(); x.fill(); x.restore();
  }
}
function logo(x, X, Y, sz, a = 1) {
  if (!LOGO || a <= 0) return; x.save(); x.globalAlpha *= a; x.beginPath(); x.arc(X, Y, sz / 2 + 3, 0, 7); x.fillStyle = C.gold; x.fill();
  x.beginPath(); x.arc(X, Y, sz / 2, 0, 7); x.clip(); x.drawImage(LOGO, X - sz / 2, Y - sz / 2, sz, sz); x.restore();
}
function pita(x, d, a = 1) {
  if (a <= 0) return; x.save(); x.globalAlpha *= a;
  const g = x.createLinearGradient(0, H - 64, W, H); g.addColorStop(0, '#b8902f'); g.addColorStop(0.5, '#f3d98b'); g.addColorStop(1, '#b8902f');
  x.fillStyle = g; x.fillRect(0, H - 64, W, 64);
  T(x, (d.nama || '') + (d.wa ? '  ·  WA ' + d.wa : ''), W / 2, H - 22, 26, '#14120d', 'center', 'bold'); x.restore();
}

/* ---------- mesin 3D mini ---------- */
const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
const rotX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const LUZ = nrm([-0.45, 0.75, -0.6]), CAM = 7;
function gambar3D(x, mesh, { X, Y, s, ry = 0, rx = 0.35, warna = [228, 178, 62], garis = 'rgba(90,60,10,.55)', glow = 0 }) {
  const V = mesh.v.map(p => rotX(rotY(p, ry), rx)), pr = p => { const f = CAM / (p[2] + CAM); return [X + p[0] * s * f, Y - p[1] * s * f]; };
  const ctr = V.reduce((a, p) => [a[0] + p[0] / V.length, a[1] + p[1] / V.length, a[2] + p[2] / V.length], [0, 0, 0]);
  const F = mesh.f.map(f => {
    const P = f.map(i => V[i]), c = P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length, a[2] + p[2] / P.length], [0, 0, 0]);
    let n = nrm(crs(sub(P[1], P[0]), sub(P[2], P[0]))); if (dot(n, sub(c, ctr)) < 0) n = n.map(v => -v);
    return { f, c, n, vis: dot(n, sub(c, [0, 0, -CAM])) < 0 };
  }).filter(o => o.vis).sort((a, b) => b.c[2] - a.c[2]);
  if (glow) { x.save(); x.shadowColor = 'rgba(243,217,139,.8)'; x.shadowBlur = glow; }
  for (const o of F) {
    const dif = Math.max(0, dot(o.n, LUZ)), h = nrm([LUZ[0], LUZ[1], LUZ[2] - 1]), sp = Math.pow(Math.max(0, dot(o.n, h)), 24) * 0.7, k = 0.32 + 0.68 * dif;
    const col = warna.map(v => Math.min(255, Math.round(v * k + 255 * sp)));
    x.beginPath(); o.f.forEach((i, j) => { const [px, py] = pr(V[i]); j ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath();
    x.fillStyle = `rgb(${col})`; x.fill(); x.strokeStyle = garis; x.lineWidth = 1.5; x.stroke();
  }
  if (glow) x.restore();
  return { pr, V, F };
}
const INGOT = (() => { const b = [[-1.25, -0.27, -0.62], [1.25, -0.27, -0.62], [1.25, -0.27, 0.62], [-1.25, -0.27, 0.62]], t = [[-1, 0.27, -0.44], [1, 0.27, -0.44], [1, 0.27, 0.44], [-1, 0.27, 0.44]];
  return { v: [...b, ...t], f: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] }; })();
const KOIN = (() => { const N = 44, v = [], f = [[], []];
  for (let i = 0; i < N; i++) { const a = i / N * 6.2832; v.push([Math.cos(a), Math.sin(a), -0.11], [Math.cos(a), Math.sin(a), 0.11]); f[0].push(i * 2); f[1].push(i * 2 + 1); }
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; f.push([i * 2, j * 2, j * 2 + 1, i * 2 + 1]); }
  return { v, f }; })();
const KOTAK = (x0, x1, y0, y1, z0, z1) => ({ v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], f: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] });

function batangEmas(x, X, Y, s, t, masuk = 1) {
  const sc = s * eBack(clamp(masuk)), bob = Math.sin(t * 2) * 6;
  x.save(); const sh = x.createRadialGradient(X, Y + s * 0.62, 5, X, Y + s * 0.62, s * 1.4); sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = sh; x.scale(1, 0.25); x.fillRect(X - s * 1.6, (Y + s * 0.62) * 4 - s * 1.4, s * 3.2, s * 2.8); x.restore();
  if (sc > 1) { const r = gambar3D(x, INGOT, { X, Y: Y + bob, s: sc, ry: t * 0.9, rx: 0.42 });
    const top = INGOT.f[1].map(i => r.pr(r.V[i])), vis = r.F.some(o => o.f === INGOT.f[1]);
    if (vis) { const cx = top.reduce((a, p) => a + p[0] / 4, 0), cy = top.reduce((a, p) => a + p[1] / 4, 0);
      x.save(); x.globalAlpha = 0.55; T(x, '999,9', cx, cy + sc * 0.07, Math.max(10, sc * 0.2), '#7a5410', 'center', 'bold'); x.restore(); } }
}
function koinEmas(x, X, Y, s, t, masuk = 1) {
  const sc = s * eBack(clamp(masuk)); if (sc <= 1) return;
  const r = gambar3D(x, KOIN, { X, Y: Y + Math.sin(t * 2) * 6, s: sc, ry: t * 1.6, rx: 0.12, warna: [232, 184, 70], garis: 'rgba(120,80,15,.25)' });
  const depan = r.F.find(o => o.f === KOIN.f[0] || o.f === KOIN.f[1]);
  if (depan) { const z = depan.f === KOIN.f[0] ? -0.111 : 0.111;
    x.save(); x.strokeStyle = 'rgba(122,84,16,.6)'; x.lineWidth = 3; x.beginPath();
    for (let i = 0; i <= 44; i++) { const a = i / 44 * 6.2832, p = rotX(rotY([Math.cos(a) * 0.78, Math.sin(a) * 0.78, z], t * 1.6), 0.12), [px, py] = r.pr(p); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke(); const c = r.pr(rotX(rotY([0, 0, z], t * 1.6), 0.12)), lebar = Math.abs(Math.cos(t * 1.6));
    x.translate(c[0], c[1]); x.scale(Math.max(0.05, lebar), 1); T(x, 'Au', 0, sc * 0.18, sc * 0.5, 'rgba(122,84,16,.75)', 'center', 'bold'); x.restore(); }
}
function batang3D(x, nilai, { X0, X1, Ybase, Hmax, t0, t, warna, sorot = -1, label = [] }) {   // grafik batang 3D
  const n = nilai.length, mn = Math.min(...nilai), mx = Math.max(...nilai), rg = mx - mn || 1, lebar = (X1 - X0) / n;
  for (let i = 0; i < n; i++) {
    const p = eOut(prog(t, t0 + i * 0.07, 0.6)), hh = (0.25 + 0.75 * (nilai[i] - mn) / rg) * Hmax * p;
    if (hh < 1) continue;
    const cx = X0 + lebar * (i + 0.5), w = lebar * 0.36, d = w * 0.6, top = Ybase - hh, on = i === sorot;
    const base = on ? [243, 217, 139] : warna || [200, 150, 50];
    const f = (pts, k) => { x.beginPath(); pts.forEach(([a, b], j) => j ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.fillStyle = `rgb(${base.map(v => Math.round(v * k))})`; x.fill(); };
    if (on) { x.save(); x.shadowColor = 'rgba(243,217,139,.9)'; x.shadowBlur = 25; }
    f([[cx - w, Ybase], [cx + w, Ybase], [cx + w, top], [cx - w, top]], 0.85);
    f([[cx + w, Ybase], [cx + w + d, Ybase - d * 0.6], [cx + w + d, top - d * 0.6], [cx + w, top]], 0.55);
    f([[cx - w, top], [cx + w, top], [cx + w + d, top - d * 0.6], [cx - w + d, top - d * 0.6]], 1.08);
    if (on) x.restore();
    if (label[i]) T(x, label[i], cx + d / 2, Ybase + 24, 16, C.mut, 'center', '', p);
  }
}
function konfeti(x, t, mulai, n = 70) {
  const p = t - mulai; if (p < 0) return;
  for (let i = 0; i < n; i++) {
    const a = rnd(i) * 6.28, v = 260 + rnd(i + 3) * 420, px = 360 + Math.cos(a) * v * p, py = 380 + Math.sin(a) * v * p * 0.7 + 420 * p * p;
    if (py > H) continue; x.save(); x.translate(px, py); x.rotate(p * 6 + i); x.globalAlpha = clamp(1.6 - p * 0.5);
    x.fillStyle = [C.gold, C.cream, C.grn, '#fff', '#e8a33d'][i % 5]; x.fillRect(-5, -3, 10, 6); x.restore();
  }
}
function angka(x, dari, ke, t, s, d, bulat = 1000) { const p = eOut(prog(t, s, d)); return p >= 1 ? ke : Math.round((dari + (ke - dari) * p) / bulat) * bulat; }
function judul(x, t, a, b, y = 78) {
  const p = eOut(prog(t, 0.15, 0.6)); let sz = 40; x.font = `bold ${sz}px ${FONT}`; while (x.measureText(a).width > 540 && sz > 24) { sz--; x.font = `bold ${sz}px ${FONT}`; }
  T(x, a, W / 2, y + (1 - p) * 30, sz, C.cream, 'center', 'bold', p); if (b) T(x, b, W / 2, y + 38 + (1 - p) * 30, 22, C.mut, 'center', '', p);
}
function grafikGaris(x, seri, X0, X1, Y0, Y1, p, t) {
  if (seri.length < 2) return; const mn = Math.min(...seri), mx = Math.max(...seri), rg = mx - mn || 1;
  const P = seri.map((v, i) => [X0 + i / (seri.length - 1) * (X1 - X0), Y1 - (v - mn) / rg * (Y1 - Y0)]), k = Math.max(1, Math.floor(p * (P.length - 1) + 1));
  const part = P.slice(0, k + 1); const frac = p * (P.length - 1) - (k - 1);
  if (k < P.length) part[part.length - 1] = [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * clamp(frac), P[k - 1][1] + (P[k][1] - P[k - 1][1]) * clamp(frac)];
  const g = x.createLinearGradient(0, Y0, 0, Y1); g.addColorStop(0, 'rgba(216,176,76,.35)'); g.addColorStop(1, 'rgba(216,176,76,0)');
  x.beginPath(); part.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.lineTo(part.at(-1)[0], Y1); x.lineTo(X0, Y1); x.closePath(); x.fillStyle = g; x.fill();
  x.beginPath(); part.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.strokeStyle = C.gold; x.lineWidth = 4; x.stroke();
  const [ex, ey] = part.at(-1), pul = 8 + 5 * Math.sin(t * 6);
  x.beginPath(); x.arc(ex, ey, pul + 6, 0, 7); x.fillStyle = 'rgba(243,217,139,.25)'; x.fill(); x.beginPath(); x.arc(ex, ey, 7, 0, 7); x.fillStyle = C.cream; x.fill();
}
function panah(x, X, Y, naik, t, a = 1) {
  if (a <= 0) return; const b = Math.sin(t * 5) * 5 * (naik ? -1 : 1); x.save(); x.globalAlpha *= a; x.translate(X, Y + b); x.fillStyle = naik ? C.grn : C.red;
  x.beginPath(); if (naik) { x.moveTo(0, -16); x.lineTo(14, 4); x.lineTo(-14, 4); } else { x.moveTo(0, 16); x.lineTo(14, -4); x.lineTo(-14, -4); } x.closePath(); x.fill(); x.restore();
}

/* ---------- template ---------- */
const TPL = {
  antam(x, t, d) {
    latar(x, t); kilau(x, 360, 250, t, 8, 170); batangEmas(x, 360, 250, 115, t, prog(t, 0, 0.9));
    judul(x, t, 'HARGA EMAS ANTAM', d.tgl + ' · ' + d.jam + ' WIB');
    const kartuH = (X, lab, now, prev, s) => {
      const a = eOut(prog(t, s, 0.5)); kartu(x, X, 420 + (1 - a) * 40, 300, 150, a);
      T(x, lab, X + 22, 460 + (1 - a) * 40, 22, C.mut, 'left', '', a);
      T(x, rpS(angka(x, prev || now * 0.98, now, t, s + 0.2, 1.4)), X + 22, 510 + (1 - a) * 40, 36, C.txt, 'left', 'bold', a);
      if (prev) { const ch = now - prev, on = prog(t, s + 1.5, 0.4); panah(x, X + 36, 543, ch >= 0, t, ch ? on : 0);
        T(x, (ch ? (ch > 0 ? '+' : '-') + rpS(Math.abs(ch)).slice(3) : 'tetap'), X + 58, 551, 24, ch > 0 ? C.grn : ch < 0 ? C.red : C.mut, 'left', 'bold', on); }
    };
    kartuH(45, 'Harga beli / gram', d.beli, d.prevBeli, 1.0); kartuH(375, 'Buyback / gram', d.bb, d.prevBb, 1.25);
    const sa = prog(t, 2.8, 0.5); T(x, `Selisih beli–buyback ${rpS(d.beli - d.bb)} (${((d.beli - d.bb) / d.beli * 100).toFixed(1).replace('.', ',')}%)`, W / 2, 612, 21, C.mut, 'center', '', sa);
    if (d.seri?.length > 2) { const ca = prog(t, 3.2, 0.4); kartu(x, 45, 635, 630, 175, ca);
      T(x, `Tren harga beli ${d.seri.length} hari terakhir`, 70, 668, 20, C.mut, 'left', '', ca); if (ca > 0) grafikGaris(x, d.seri, 75, 645, 685, 790, eOut(prog(t, 3.5, 2.2)), t); }
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  pagi(x, t, d) {
    latar(x, t, 'pagi'); kilau(x, 360, 250, t, 6, 160); koinEmas(x, 360, 255, 120, t, prog(t, 0, 0.9));
    judul(x, t, 'KABAR PAGI EMAS', d.tgl);
    const a = eOut(prog(t, 1.0, 0.5)); kartu(x, 45, 420 + (1 - a) * 40, 630, 170, a);
    T(x, 'XAUUSD (per troy ounce)', 70, 460, 22, C.mut, 'left', '', a);
    T(x, '$' + angka(x, d.xau * 0.99, d.xau, t, 1.2, 1.4, 0.01).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 70, 515, 46, C.txt, 'left', 'bold', a);
    if (d.dx !== null && d.dx !== undefined) { const on = prog(t, 2.6, 0.4); panah(x, 88, 556, d.dx >= 0, t, on); T(x, `${(Math.abs(d.dx) * 100).toFixed(2).replace('.', ',')}% dari kemarin`, 110, 564, 24, d.dx >= 0 ? C.grn : C.red, 'left', 'bold', on); }
    T(x, 'Kurs ' + rpS(d.kurs), 650, 564, 24, C.cream, 'right', 'bold', prog(t, 2.6, 0.4));
    if (d.pBeli) { const b = eOut(prog(t, 3.0, 0.5)); kartu(x, 45, 610 + (1 - b) * 40, 630, 165, b, d.pBeli >= d.ref ? 'rgba(95,191,122,.6)' : 'rgba(228,107,93,.6)');
      T(x, 'Perkiraan harga beli Antam pagi ini', 70, 650, 22, C.mut, 'left', '', b);
      T(x, '± ' + rpS(angka(x, d.ref, d.pBeli, t, 3.3, 1.3)), 70, 705, 44, C.cream, 'left', 'bold', b);
      const ch = d.pBeli - d.ref; T(x, (Math.abs(ch) < 1000 ? 'cenderung tetap' : (ch > 0 ? 'cenderung naik ' : 'cenderung turun ') + rpS(Math.abs(ch))) + ' dari ' + rpS(d.ref), 70, 748, 22, ch > 0 ? C.grn : ch < 0 ? C.red : C.mut, 'left', 'bold', prog(t, 4.4, 0.4)); }
    T(x, 'Harga resmi Antam segera kami posting', W / 2, 808, 22, C.txt, 'center', '', prog(t, 5, 0.5));
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  edukasi(x, t, d) {
    latar(x, t); kilau(x, 360, 200, t, 6, 130); batangEmas(x, 360, 200, 78, t, prog(t, 0, 0.9));
    const p = eOut(prog(t, 0.15, 0.6)); T(x, 'EDUKASI EMAS #' + d.no, W / 2, 70 + (1 - p) * 20, 30, C.gold, 'center', 'bold', p);
    const J = wrap(x, d.judul, 610, 36, 'bold'), B = wrap(x, d.isi, 600, 27);
    const a = eOut(prog(t, 0.9, 0.5)), hK = 60 + J.length * 46 + B.length * 40 + 30; kartu(x, 40, 330, 640, Math.min(hK, 470), a);
    J.forEach((l, i) => T(x, l, 70, 385 + i * 46, 36, C.cream, 'left', 'bold', prog(t, 1.0 + i * 0.2, 0.4)));
    const y0 = 385 + J.length * 46 + 20; B.forEach((l, i) => T(x, l, 70, y0 + i * 40, 27, C.txt, 'left', '', prog(t, 1.8 + i * 0.28, 0.4)));
    T(x, '#TipsEmas  ·  Info edukasi, bukan saran investasi', W / 2, 818, 18, C.mut, 'center', '', prog(t, 2.5, 0.5));
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  rekor(x, t, d) {
    latar(x, t); const n = d.seri.length;
    batang3D(x, d.seri, { X0: 60, X1: 640, Ybase: 640, Hmax: 300, t0: 0.4, t, sorot: n - 1, warna: [160, 120, 45] });
    if (t > 2.3) konfeti(x, t, 2.3);
    const p = eBack(prog(t, 2.2, 0.6)); x.save(); x.translate(W / 2, 150); x.scale(Math.max(0.01, p), Math.max(0.01, p));
    T(x, d.tinggi ? 'REKOR BARU!' : 'TERMURAH!', 0, 0, 64, d.tinggi ? C.cream : C.grn, 'center', 'bold'); x.restore();
    T(x, `${d.tinggi ? 'Tertinggi' : 'Terendah'} dalam ${d.hari} hari terakhir`, W / 2, 200, 26, C.txt, 'center', '', prog(t, 2.6, 0.5));
    const a = eOut(prog(t, 3.0, 0.5)); kartu(x, 110, 680, 500, 130, a);
    T(x, 'Harga beli Antam', W / 2, 718, 22, C.mut, 'center', '', a); T(x, rpS(d.beli) + ' /gr', W / 2, 770, 44, C.cream, 'center', 'bold', a);
    T(x, 'Sebelumnya ' + rpS(d.sebelum), W / 2, 800, 18, C.mut, 'center', '', a);
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  andai(x, t, d) {
    latar(x, t); judul(x, t, 'ANDAI DULU BELI 10 GRAM', 'dijual hari ini dengan harga buyback');
    d.baris.forEach((r, i) => {
      const s = 0.8 + i * 1.2, a = eOut(prog(t, s, 0.5)), Y = 175 + i * 205; kartu(x, 40, Y + (1 - a) * 30, 640, 185, a);
      T(x, r.label, 66, Y + 40, 26, C.cream, 'left', 'bold', a); T(x, r.tgl, 654, Y + 40, 20, C.mut, 'right', '', a);
      const mx = Math.max(r.beli, r.bb), bar = (v, yy, col, lab) => { const w = 380 * (v / mx) * eOut(prog(t, s + 0.3, 0.9));
        x.save(); x.globalAlpha *= a; x.fillStyle = col; rrect(x, 200, yy, Math.max(4, w), 26, 6); x.fill(); x.restore(); T(x, lab, 66, yy + 20, 20, C.mut, 'left', '', a); T(x, rpS(v), 196 + Math.max(4, w), yy + 20, 18, C.txt, 'right', 'bold', prog(t, s + 1.1, 0.3)); };
      bar(r.beli, Y + 60, '#b8902f', 'Beli dulu'); bar(r.bb, Y + 98, '#8a7a55', 'Buyback kini');
      const ok = r.sel >= 0; T(x, (ok ? 'Untung ' : 'Selisih ') + (ok ? '+' : '-') + rpS(Math.abs(r.sel)), 66, Y + 160, 26, ok ? C.grn : C.red, 'left', 'bold', prog(t, s + 1.0, 0.4));
    });
    T(x, 'Emas cocok untuk tabungan jangka panjang', W / 2, 820, 20, C.mut, 'center', '', prog(t, 4.6, 0.5));
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  rekap(x, t, d) {
    latar(x, t); judul(x, t, 'REKAP MINGGUAN', d.periode);
    const a = eOut(prog(t, 0.6, 0.5)); kartu(x, 45, 160 + (1 - a) * 30, 630, 170, a);
    T(x, 'Harga beli Antam seminggu', 70, 200, 22, C.mut, 'left', '', a);
    const v = angka(x, 0, d.d, t, 0.9, 1.6); T(x, (d.d >= 0 ? '+' : '-') + rpS(Math.abs(v)) + ' /gr', 70, 262, 52, d.d > 0 ? C.grn : d.d < 0 ? C.red : C.mut, 'left', 'bold', a);
    T(x, rpS(d.awal) + '  →  ' + rpS(d.akhir), 70, 305, 22, C.txt, 'left', '', a);
    batang3D(x, d.seri, { X0: 60, X1: 640, Ybase: 690, Hmax: 280, t0: 1.6, t, sorot: d.seri.length - 1, label: d.label });
    if (d.xau) T(x, `XAUUSD seminggu ${d.xau >= 0 ? '+' : '-'}${(Math.abs(d.xau) * 100).toFixed(2).replace('.', ',')}%`, W / 2, 770, 24, d.xau >= 0 ? C.grn : C.red, 'center', 'bold', prog(t, 3.8, 0.4));
    if (d.ak) T(x, `Prediksi arah tepat ${d.ak}`, W / 2, 806, 20, C.mut, 'center', '', prog(t, 4.2, 0.4));
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  toko(x, t, d) {
    latar(x, t); kilau(x, 360, 165, t, 6, 120); batangEmas(x, 360, 165, 70, t, prog(t, 0, 0.8));
    const p = eOut(prog(t, 0.2, 0.6)); T(x, 'HARGA TOKO HARI INI', W / 2, 60 + (1 - p) * 20, 30, C.cream, 'center', 'bold', p);
    T(x, (d.tgl ? d.tgl + ' · ' : '') + 'Emas ' + (d.merek || '') + ' · per keping', W / 2, 262, 21, C.gold, 'center', 'bold', prog(t, 0.6, 0.5));
    const R = d.rows.slice(0, 9), J = d.kolom !== 'b', B = d.kolom !== 'j', rh = Math.min(58, Math.floor(430 / Math.max(R.length, 1))), y0 = 300;
    T(x, 'Berat', 70, y0, 18, C.mut, 'left', '', prog(t, 0.8, 0.4)); if (J) T(x, 'Harga jual', B ? 470 : 650, y0, 18, C.mut, 'right', '', prog(t, 0.8, 0.4)); if (B) T(x, 'Buyback', 650, y0, 18, C.mut, 'right', '', prog(t, 0.8, 0.4));
    R.forEach((r, i) => { const a = eOut(prog(t, 1.0 + i * 0.22, 0.45)), y = y0 + 14 + i * rh, dx = (1 - a) * 80;
      x.save(); x.globalAlpha = a; rrect(x, 45 + dx, y, 630, rh - 8, 12); x.fillStyle = i % 2 ? 'rgba(216,176,76,.07)' : 'rgba(216,176,76,.16)'; x.fill(); x.restore();
      const ty = y + rh / 2 + 4; T(x, (r.g >= 1000 ? r.g / 1000 + ' kg' : String(r.g).replace('.', ',') + ' gr'), 70 + dx, ty, 26, C.txt, 'left', 'bold', a);
      if (J) T(x, r.j ? rpS(r.j) : '–', (B ? 470 : 650) + dx, ty, 25, C.cream, 'right', 'bold', a); if (B) T(x, r.b ? rpS(r.b) : '–', 650 + dx, ty, 22, J ? C.txt : C.cream, 'right', J ? '' : 'bold', a); });
    const yc = y0 + 14 + R.length * rh + 30; if (d.catatan) T(x, d.catatan.slice(0, 48), W / 2, yc, 22, C.cream, 'center', 'bold', prog(t, 1.2 + R.length * 0.22, 0.5));
    T(x, 'Pesan sekarang via WhatsApp', W / 2, 808, 24, C.txt, 'center', 'bold', prog(t, 2 + R.length * 0.22, 0.5) * (0.75 + 0.25 * Math.sin(t * 4)));
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  testi(x, t, d) {
    latar(x, t); kilau(x, 360, 170, t, 6, 120); koinEmas(x, 360, 175, 72, t, prog(t, 0, 0.8));
    T(x, 'KATA PELANGGAN KAMI', W / 2, 62, 28, C.cream, 'center', 'bold', eOut(prog(t, 0.2, 0.6)));
    const a = eOut(prog(t, 0.7, 0.5)), L = wrap(x, '"' + d.isi + '"', 560, 30), hK = 150 + L.length * 44; kartu(x, 40, 290, 640, hK, a);
    T(x, '\u201C', 70, 380, 120, 'rgba(216,176,76,.25)', 'left', 'bold', a);
    for (let i = 0; i < 5; i++) { const sp = eBack(prog(t, 1.0 + i * 0.15, 0.4)); x.save(); x.translate(260 + i * 50, 340); x.scale(Math.max(0.01, sp), Math.max(0.01, sp));
      T(x, i < (d.bintang || 5) ? '\u2605' : '\u2606', 0, 14, 40, C.gold, 'center', 'bold'); x.restore(); }
    L.forEach((l, i) => T(x, l, 80, 410 + i * 44, 30, C.txt, 'left', '', prog(t, 1.8 + i * 0.3, 0.4)));
    const ya = 410 + L.length * 44 + 20; T(x, '— ' + d.pengirim + (d.kota ? ', ' + d.kota : ''), 640, ya, 24, C.cream, 'right', 'bold', prog(t, 2 + L.length * 0.3, 0.5));
    T(x, 'Terima kasih atas kepercayaannya', W / 2, 808, 22, C.mut, 'center', '', prog(t, 2.6 + L.length * 0.3, 0.5));
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
  agenda(x, t, d) {
    latar(x, t); const cx = 360, cy = 300, R = 150;
    x.save(); x.lineWidth = 14; x.strokeStyle = 'rgba(216,176,76,.15)'; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
    const pr = eOut(prog(t, 0.3, 2.2)) * (d.frac ?? 0.75); x.strokeStyle = C.gold; x.lineCap = 'round'; x.shadowColor = 'rgba(243,217,139,.7)'; x.shadowBlur = 18;
    x.beginPath(); x.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + pr * 6.283); x.stroke(); x.restore();
    for (let i = 0; i < 60; i++) { const a = i / 60 * 6.283 + t * 0.3, r1 = R + 22, r2 = R + (i % 5 ? 28 : 36); x.strokeStyle = `rgba(243,217,139,${i % 5 ? 0.25 : 0.6})`; x.lineWidth = 2;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); x.stroke(); }
    koinEmas(x, cx, cy, 78, t, prog(t, 0, 0.8));
    const pp = eBack(prog(t, 0.8, 0.6)), puls = 1 + 0.04 * Math.sin(t * 6); x.save(); x.translate(W / 2, 535); x.scale(Math.max(0.01, pp * puls), Math.max(0.01, pp * puls));
    T(x, d.sisa, 0, 0, 58, C.cream, 'center', 'bold'); x.restore();
    const L = wrap(x, d.acara, 600, 32, 'bold'); L.forEach((l, i) => T(x, l, W / 2, 600 + i * 40, 32, C.txt, 'center', 'bold', prog(t, 1.4 + i * 0.2, 0.5)));
    const yb = 600 + L.length * 40; T(x, d.waktu, W / 2, yb + 10, 26, C.gold, 'center', 'bold', prog(t, 1.9, 0.5));
    wrap(x, d.ket || '', 600, 21).slice(0, 3).forEach((l, i) => T(x, l, W / 2, yb + 56 + i * 30, 21, C.mut, 'center', '', prog(t, 2.4 + i * 0.2, 0.5)));
    T(x, 'AGENDA EKONOMI', W / 2, 62, 28, C.cream, 'center', 'bold', eOut(prog(t, 0.2, 0.6)));
    pita(x, d, prog(t, 0.3, 0.6)); logo(x, 662, 50, 64, prog(t, 0.1, 0.5));
  },
};
const DURASI = { antam: 8, pagi: 7.5, edukasi: 9, rekor: 6.5, andai: 7.5, rekap: 7.5, toko: 8, testi: 9, agenda: 7.5 };

/* ---------- musik latar buatan sendiri (sintesis, bebas royalti) ---------- */
const PROG = [[[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], [[50, 53, 57], [55, 59, 62], [48, 52, 55], [57, 60, 64]]];
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
function musik(dur, seed) {
  const SR = 44100, n = Math.floor(dur * SR), L = new Float32Array(n), Rr = new Float32Array(n), prg = PROG[seed % PROG.length], cl = dur / prg.length;
  prg.forEach((ch, ci) => {                                   // pad akor lembut
    const s0 = Math.floor(ci * cl * SR), s1 = Math.min(n, Math.floor((ci + 1) * cl * SR + 0.8 * SR));
    const notes = [ch[0] - 12, ...ch];
    for (let i = s0; i < s1; i++) {
      const tt = (i - s0) / SR, env = Math.min(1, tt / 0.5) * Math.min(1, Math.max(0, (s1 - i) / SR / 0.8));
      let l = 0, r = 0;
      for (const m of notes) { const f = hz(m), ph = 2 * Math.PI * f * i / SR; const v = Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph);
        l += v * (1 + 0.15 * Math.sin(2 * Math.PI * 0.21 * i / SR)); r += Math.sin(2 * Math.PI * f * 1.003 * i / SR) + 0.25 * Math.sin(4 * Math.PI * f * 1.003 * i / SR); }
      L[i] += l * env * 0.045; Rr[i] += r * env * 0.045;
    }
  });
  const step = 60 / 96 / 2;                                    // arpeggio lonceng (tempo 96, seperdelapan)
  for (let k = 0; k * step < dur - 0.4; k++) {
    const t0 = k * step, ch = prg[Math.min(prg.length - 1, Math.floor(t0 / cl))], m = ch[[0, 1, 2, 1, 2, 0, 2, 1][k % 8]] + 12 + (k % 16 >= 8 && k % 4 === 3 ? 12 : 0);
    const f = hz(m), s0 = Math.floor(t0 * SR), len = Math.floor(1.4 * SR), pan = 0.5 + 0.35 * Math.sin(k * 0.9), amp = 0.075 * (k % 2 ? 0.7 : 1);
    for (let j = 0; j < len && s0 + j < n; j++) { const tt = j / SR, e = Math.exp(-tt * 3.2) * Math.min(1, tt / 0.004), v = (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(2 * Math.PI * f * 2.01 * tt) * Math.exp(-tt * 6)) * e * amp;
      L[s0 + j] += v * (1 - pan) * 1.4; Rr[s0 + j] += v * pan * 1.4; }
  }
  for (const [t0, m] of [[0.12, 84], [0.24, 88], [0.36, 91]]) {   // denting pembuka
    const f = hz(m), s0 = Math.floor(t0 * SR);
    for (let j = 0; j < 2.0 * SR && s0 + j < n; j++) { const tt = j / SR, v = Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 2.5) * 0.06; L[s0 + j] += v; Rr[s0 + j] += v; }
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const g = Math.min(1, i / SR / 0.3) * Math.min(1, (n - i) / SR / 0.8);
    buf.writeInt16LE(Math.round(Math.tanh(L[i] * g) * 32000), 44 + i * 4); buf.writeInt16LE(Math.round(Math.tanh(Rr[i] * g) * 32000), 46 + i * 4); }
  return buf;
}

export async function buatVideo(jenis, data, ctx) {
  CV = ctx.CV; LOGO = ctx.LOGO; FONT = ctx.FONT || FONT;
  const ff = ffmpegPath(); if (!CV || !ff || !TPL[jenis]) { console.log('Video dilewati:', !ff ? 'ffmpeg tidak ada' : jenis); return null; }
  const dur = jenis === 'edukasi' ? Math.min(11, 7 + String(data.isi || '').length / 60) : jenis === 'toko' ? 6 + Math.min(9, data.rows?.length || 0) * 0.35 : jenis === 'testi' ? Math.min(12, 7 + String(data.isi || '').length / 50) : DURASI[jenis], n = Math.round(dur * FPS);
  const out = path.join(os.tmpdir(), `vid-${jenis}-${process.pid}.mp4`), c = CV.createCanvas(W, H), x = c.getContext('2d');
  const pakaiMusik = ctx.musik !== false, wav = path.join(os.tmpdir(), `aud-${jenis}-${process.pid}.wav`);
  if (pakaiMusik) fs.writeFileSync(wav, musik(dur, [...jenis].reduce((a, ch) => a + ch.charCodeAt(0), 0) + new Date().getUTCDate()));
  const p = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    ...(pakaiMusik ? ['-i', wav, '-c:a', 'aac', '-b:a', '96k', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', b => err += b);
  const selesai = new Promise(r => p.on('close', r));
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = i / FPS; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1;
    TPL[jenis](x, t, data);
    const akhir = clamp((dur - t) / 0.35); if (akhir < 1) { x.fillStyle = `rgba(13,12,9,${1 - akhir})`; x.fillRect(0, 0, W, H); }   // fade out
    const buf = Buffer.from(x.getImageData(0, 0, W, H).data.buffer);
    if (!p.stdin.write(buf)) await new Promise(r => p.stdin.once('drain', r));
  }
  p.stdin.end(); const code = await selesai;
  if (code !== 0 || !fs.existsSync(out)) { console.log('ffmpeg gagal:', err.slice(0, 300)); return null; }
  const b = fs.readFileSync(out); fs.unlinkSync(out); if (pakaiMusik) { try { fs.unlinkSync(wav); } catch { } b.musik = true; }
  console.log(`Video ${jenis}: ${n} frame, ${Math.round(b.length / 1024)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} dtk`);
  return b;
}
