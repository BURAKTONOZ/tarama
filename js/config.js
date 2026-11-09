/* ==========================================================================
   TonoScan - Yapılandırma, Sabitler ve Temel Yardımcılar
   ========================================================================== */

const FB = {
  apiKey: "AIzaSyC1yFeAKzqziGz_Z0C8RHgSabSRb7Wff_M",
  authDomain: "tarama-646dc.firebaseapp.com",
  databaseURL: "https://tarama-646dc-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "tarama-646dc",
  storageBucket: "tarama-646dc.firebasestorage.app",
  messagingSenderId: "50610490478",
  appId: "1:50610490478:web:7b6c5e0d731c1942c6aa7f"
};

const APPCHECK_KEY = "";
const MAX = 250 * 1024 * 1024;      // 250 MB tek dosya sınırı
const CH = 192 * 1024;              // 192 KB parça boyutu
const WIN = 6;                      // Aktarım pencere boyutu
const PAL = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#f43f5e', '#06b6d4'];

// PDF.js worker yapılandırması
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Temel yardımcılar
const $ = id => document.getElementById(id);
const te = new TextEncoder();
const td = new TextDecoder();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = b => {
  if (!b) return '0 B';
  const i = Math.min(3, Math.floor(Math.log(b) / Math.log(1024)));
  return (b / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
};
const b64 = u => {
  let s = '';
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
  return btoa(s);
};
const unb64 = s => {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
};
const u64 = u => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const un64u = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
const rid = n => u64(crypto.getRandomValues(new Uint8Array(n)));
const toBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

// Bildirimler ve UI araçları
function toast(m) {
  const t = $('tt');
  if (!t) return;
  t.textContent = m;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 3200);
}

function show(id, on) {
  const el = $(id);
  if (el) el.classList.toggle('on', !!on);
}

// Genel durum değişkenleri
let db, room, K;
let files = [], sel = [], devs = {}, rx = {}, flt = 'all';
let cr = null, edF = 'none', ed = null;
let pvId = null, dragI = -1, dirH = null, unread = 0;
const baseT = document.title;

const isBot = /bot|crawl|spider|slurp|mediapartners|lighthouse|pagespeed|facebookexternalhit|twitterbot|whatsapp|telegrambot/i.test(navigator.userAgent);
