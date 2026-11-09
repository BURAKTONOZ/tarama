/* ==========================================================================
   TonoScan - Ortak Kapasite Havuzu, Otomatik Temizleme ve Yerel Klasör
   ========================================================================== */

/* ---------- Ortak kapasite havuzu (5 GB / ay) ---------- */
const CAP = 5 * 1024 ** 3;
let pool = null, poolErr = null, qPend = 0, qT = null;

const nextMonth = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};

function poolState() {
  const now = Date.now();
  let b = 0, u = null;
  if (pool && now < pool.u) {
    b = pool.b;
    u = pool.u;
  }
  return { b, u, p: Math.min(100, b / CAP * 100), full: b >= CAP };
}

function poolUi0() {
  const s = poolState();
  const cls = s.p >= 90 ? 'bad' : s.p >= 60 ? 'warn' : '';
  const days = s.u ? Math.max(1, Math.ceil((s.u - Date.now()) / 864e5)) : null;
  const pct = s.p < 10 ? s.p.toFixed(1).replace('.', ',') : Math.round(s.p);
  const pc = $('pool'), mp = $('mpool');

  if (pc) {
    pc.classList.remove('warn', 'bad');
    if (cls) pc.classList.add(cls);
    $('pf').style.width = Math.max(s.b ? 1.5 : 0, s.p) + '%';
    $('ppc').textContent = '%' + pct;
    $('pgb').textContent = fmt(s.b) + ' / 5 GB';
    const st = $('pst');
    st.className = 'chip ' + (s.p >= 90 ? 'bad' : s.p >= 60 ? '' : 'ok');
    st.style.padding = '1px 9px';
    st.textContent = s.full ? 'Doldu' : s.p >= 60 ? 'Yoğun' : 'Açık';
    $('pnote').textContent = s.full
      ? 'Ortak kapasite doldu. ' + days + ' gün sonra yenilenir, o zamana kadar yeni aktarım yapılamaz.'
      : 'Tüm kullanıcıların bu ay birlikte aktardığı veri' + (days ? ' · ' + days + ' gün sonra yenilenir' : '');
  }

  if (mp) {
    mp.classList.add('on');
    mp.classList.remove('warn', 'bad');
    if (cls) mp.classList.add(cls);
    $('mpf').style.width = Math.max(s.b ? 3 : 0, s.p) + '%';
    $('mpt').textContent = s.full ? 'Kapasite doldu' : 'Ortak kapasite %' + pct;
  }
}

function poolUi() {
  poolUi0();
  if (!poolErr) return;
  if ($('pool')) {
    const st = $('pst');
    st.className = 'chip bad';
    st.textContent = 'Hata';
    $('pnote').textContent = 'Kapasite sayacı kullanılamıyor (' + poolErr + '). Firebase kurallarını güncel dosyadaki gibi yenileyin.';
  }
  if ($('mpool')) {
    $('mpt').textContent = 'Kapasite bilgisi alınamıyor';
  }
}

/* PC: aldığı her parçanın boyutunu biriktirip birkaç saniyede bir havuza ekler */
function qAdd(n) {
  qPend += n;
  if (!qT) qT = setTimeout(qFlush, 2500);
}

function qFlush() {
  qT = null;
  if (!qPend || !db) return;
  const n = Math.min(qPend, 24e6);
  qPend -= n;
  db.ref('usage/pool').transaction(
    c => {
      const now = Date.now();
      if (!c || now >= c.u) return { b: n, u: nextMonth() };
      return { b: c.b + n, u: c.u };
    },
    err => {
      poolErr = err ? (err.code || err.message || 'hata') : null;
      if (err) qPend = 0;
      poolUi();
      if (qPend && !qT) qT = setTimeout(qFlush, 2500);
    }
  );
}

/* Otomatik dosya temizleme */
async function autoClean() {
  const d = +localStorage.ts_ac || 0;
  $('autoc').value = String(d);
  if (!d) return;
  const lim = Date.now() - d * 864e5;
  const old = files.filter(f => f.time < lim);
  for (const f of old) {
    URL.revokeObjectURL(f.url);
    await idbDel(f.id);
  }
  if (old.length) {
    files = files.filter(f => f.time >= lim);
    sel = [];
    render();
    toast(old.length + ' eski dosya otomatik silindi');
  }
}

/* Klasöre otomatik kaydetme (Chrome/Edge File System Access API) */
async function dirOk() {
  return !!dirH && (await dirH.queryPermission({ mode: 'readwrite' })) === 'granted';
}

async function dirUi() {
  const ok = await dirOk();
  $('bdirt').textContent = !dirH ? 'Klasöre Kaydet' : ok ? dirH.name : 'İzni Yenile';
  $('bdir').classList.toggle('on', ok);
}

async function pickDir() {
  if (!window.showDirectoryPicker) {
    return toast('Bu tarayıcı klasöre kaydetmeyi desteklemiyor (Chrome veya Edge kullanın)');
  }
  if (dirH) {
    if (!(await dirOk())) {
      if ((await dirH.requestPermission({ mode: 'readwrite' })) === 'granted') {
        dirUi();
        return toast('Klasöre kaydetme etkin');
      }
    }
    if (confirm('Klasöre otomatik kaydetme kapatılsın mı?')) {
      dirH = null;
      await kvPut('dir', null);
      dirUi();
    }
    return;
  }
  try {
    dirH = await showDirectoryPicker({ mode: 'readwrite' });
    await kvPut('dir', dirH);
    dirUi();
    toast('Gelen dosyalar «' + dirH.name + '» klasörüne de yazılacak');
  } catch (e) {}
}

async function dirSave(f) {
  try {
    if (!(await dirOk())) return;
    let n = f.name.replace(/[\\/:*?"<>|]/g, '_');
    try {
      await dirH.getFileHandle(n);
      n = n.replace(/(\.\w+)?$/, '_' + Date.now() + '$1');
    } catch (e) {}
    const w = await (await dirH.getFileHandle(n, { create: true })).createWritable();
    await w.write(f.blob);
    await w.close();
  } catch (e) {}
}
