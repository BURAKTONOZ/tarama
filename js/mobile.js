/* ==========================================================================
   TonoScan - Mobil Kamera, Karekod Tarama ve Şifreli Aktarım
   ========================================================================== */

const isMob = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
              (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

let dev, pcUp = false, state = null, mName, mInfo, stream, facing = 'environment',
    tOn = false, wake = null, queue = Promise.resolve(), mScan = null;

function ui() {
  const [c, t] = !pcUp ? ['#fbbf24', 'PC bekleniyor...']
               : state === 'ok' ? ['#34d399', "PC'ye bağlı (şifreli)"]
               : state === 'no' ? ['#ef4444', 'Bu cihaz engellendi']
               : ['#fbbf24', "PC'de onay bekleniyor..."];
  $('md').style.background = c;
  $('md').style.boxShadow = `0 0 0 4px ${c}33`;
  $('ms').textContent = t;
}

function hint() {
  const e = $('fs');
  e.style.animation = 'none';
  e.offsetHeight;
  e.style.animation = '';
}

async function mobInit() {
  $('mob').classList.add('on');
  if (isMob) localStorage.ts_ismob = 1;
  const h = new URLSearchParams(location.hash.slice(1));
  let r = h.get('r'), k = h.get('k');
  if (r && k) {
    localStorage.ts_mr = r;
    localStorage.ts_mk = k;
    history.replaceState(null, '', location.pathname);
  } else {
    r = localStorage.ts_mr;
    k = localStorage.ts_mk;
  }

  const ua = navigator.userAgent;
  let os = 'Mobil', model = 'Telefon';
  if (/iPhone/.test(ua)) {
    os = 'iOS'; model = 'iPhone';
  } else if (/iPad/.test(ua)) {
    os = 'iPadOS'; model = 'iPad';
  } else if (/Android/.test(ua)) {
    os = 'Android';
    const m = ua.match(/Android\s[0-9.]+;\s([^;)]+)/);
    model = m ? m[1].replace(/Build\/.*/, '').trim() : 'Android';
  }

  mInfo = { os, model };
  mName = localStorage.ts_name || model;
  $('mn').textContent = mName;
  $('ml').textContent = os + ' • ' + model;

  const v = $('mv');
  addEventListener('resize', () => { if (CAPS[capI][0]) maskUi(); });
  v.addEventListener('pause', () => { if (!document.hidden) v.play().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !stream) return;
    const t = stream.getVideoTracks()[0];
    if (!t || t.readyState !== 'live') startCam();
    else v.play().catch(() => {});
  });

  if (!r || !k) {
    scanMode();
    return;
  }
  await connectMode(r, k);
}

async function connectMode(r, k) {
  $('mob').classList.remove('scan');
  ui();
  hint();
  if (!stream || !stream.active) {
    startCam().then(ok => {
      if (!ok) toast('Kamera açılamadı. Galeri ve Dosya düğmeleriyle gönderebilirsiniz.');
    });
  }
  try {
    room = r;
    await initKey(k);
    await fbInit();
  } catch (e) {
    $('ms').textContent = 'Karekodu yeniden okutun';
    return;
  }
  dev = localStorage.ts_did || (localStorage.ts_did = rid(8));
  R('meta').on('value', s => {
    pcUp = s.exists();
    ui();
    if (pcUp) hello();
  });
  R('dev/' + dev).on('value', s => {
    state = s.val();
    ui();
  });
  db.ref('usage/pool').on('value', x => {
    pool = x.val();
    poolUi();
  }, e => {
    poolErr = e.code || 'okuma hatası';
    poolUi();
  });
  setInterval(poolUi, 60000);
  poolUi();
  ui();
}

/* Karekod okuma ekranı */
function scanMode() {
  $('mob').classList.add('scan');
  $('ms').textContent = 'Karekod bekleniyor';
  $('md').style.background = '#60a5fa';
  $('sgate').classList.remove('hidden');
  $('sview').classList.add('hidden');
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' }).then(p => {
      if (p.state === 'granted') scanStart();
    }).catch(() => {});
  }
}

async function scanStart() {
  $('serr').textContent = '';
  $('sgate').classList.add('hidden');
  $('sview').classList.remove('hidden');
  if (!(stream && stream.active) && !(await startCam())) {
    $('sgate').classList.remove('hidden');
    $('sview').classList.add('hidden');
    $('serr').textContent = 'Kamera izni verilmedi. Adres çubuğundaki izin ayarından kameraya izin verip tekrar deneyin.';
    return;
  }
  let det = null;
  try {
    if ('BarcodeDetector' in window) det = new BarcodeDetector({ formats: ['qr_code'] });
  } catch (e) {}
  const cv = document.createElement('canvas'),
        cx = cv.getContext('2d', { willReadFrequently: true });
  clearInterval(mScan);
  mScan = setInterval(async () => {
    const v = $('mv');
    if (!v.videoWidth) return;
    const s = Math.min(1, 720 / v.videoWidth);
    cv.width = Math.round(v.videoWidth * s);
    cv.height = Math.round(v.videoHeight * s);
    cx.drawImage(v, 0, 0, cv.width, cv.height);
    let txt = null;
    try {
      if (det) {
        const r = await det.detect(cv);
        if (r[0]) txt = r[0].rawValue;
      } else if (window.jsQR) {
        const d = cx.getImageData(0, 0, cv.width, cv.height),
              q = jsQR(d.data, d.width, d.height);
        if (q) txt = q.data;
      }
    } catch (e) {}
    if (txt) scanGot(txt);
  }, 300);
}

function scanGot(t) {
  let r, k;
  try {
    const p = new URLSearchParams(new URL(t).hash.slice(1));
    r = p.get('r');
    k = p.get('k');
  } catch (e) {
    return;
  }
  if (!r || !k || r.length < 20) return;
  clearInterval(mScan);
  if (navigator.vibrate) navigator.vibrate(60);
  localStorage.ts_mr = r;
  localStorage.ts_mk = k;
  connectMode(r, k);
}

function resetPC() {
  if (!confirm('Başka bir bilgisayara bağlanmak için karekodu yeniden okutacaksınız. Devam edilsin mi?')) return;
  localStorage.removeItem('ts_mr');
  localStorage.removeItem('ts_mk');
  location.reload();
}

async function hello() {
  const q = R('req/' + dev);
  q.onDisconnect().remove();
  await q.set({ e: await enc(JSON.stringify({ name: mName, ...mInfo }), 'hello:' + dev) });
}

/* İsim değiştirme */
function rename() {
  $('rni').value = mName;
  show('rnm', 1);
  setTimeout(() => $('rni').focus(), 150);
}

function resumeCam() {
  setTimeout(() => {
    const v = $('mv');
    (!stream || !stream.active) ? startCam() : v.play().catch(() => {});
  }, 200);
}

function closeRn() {
  show('rnm', 0);
  resumeCam();
}

function saveName() {
  const n = $('rni').value.trim().slice(0, 30);
  show('rnm', 0);
  if (n) {
    mName = n;
    localStorage.ts_name = n;
    $('mn').textContent = n;
    if (pcUp) hello();
  }
  resumeCam();
}

async function startCam() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  tOn = false;
  $('mt').classList.remove('on');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false
    });
    const v = $('mv');
    v.srcObject = stream;
    v.play().catch(() => {});
    stream.getVideoTracks()[0].onended = () => { if (!document.hidden) startCam(); };
    return true;
  } catch (e) {
    return false;
  }
}

function flip() {
  facing = facing === 'environment' ? 'user' : 'environment';
  startCam();
  hint();
}

/* Çekim oranı: Tam ekran / 3:4 / A4 */
let capI = 0;
const CAPS = [[0, 'Tam'], [3 / 4, '3:4'], [1 / Math.SQRT2, 'A4']];

function maskRect() {
  const v = $('mv'), cw = v.clientWidth, ch = v.clientHeight, r = CAPS[capI][0];
  if (!r) return { x: 0, y: 0, w: cw, h: ch };
  let w, h;
  if (cw / ch > r) { h = ch * 0.8; w = h * r; }
  else { w = cw * 0.84; h = w / r; }
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

function maskUi() {
  const r = CAPS[capI][0], mk = $('cmask'), fr = document.querySelector('.frame');
  $('mat').textContent = CAPS[capI][1];
  $('ma').classList.toggle('on', !!r);
  if (r) {
    const m = maskRect();
    mk.style.cssText = `left:${m.x}px;top:${m.y}px;width:${m.w}px;height:${m.h}px`;
    mk.classList.remove('hidden');
    fr.style.display = 'none';
    $('fs').innerHTML = '<i class="fa-solid fa-crop"></i> ' + CAPS[capI][1] + ' oranında çekim · çerçevenin içi gönderilir';
  } else {
    mk.classList.add('hidden');
    fr.style.display = '';
    $('fs').innerHTML = '<i class="fa-solid fa-expand"></i> Tam ekran çekim · gördüğünüz her şey gönderilir';
  }
  hint();
}

function capAspect() {
  capI = (capI + 1) % CAPS.length;
  maskUi();
}

function grid3() {
  $('g3').classList.toggle('on');
  $('mg').classList.toggle('on');
}

async function torch() {
  if (!stream) return;
  const t = stream.getVideoTracks()[0],
        c = t.getCapabilities ? t.getCapabilities() : {};
  if (!c.torch) return toast('Flaş desteklenmiyor');
  tOn = !tOn;
  await t.applyConstraints({ advanced: [{ torch: tOn }] });
  $('mt').classList.toggle('on', tOn);
}

/* Çekim alma */
async function shoot() {
  const v = $('mv');
  if (!v.videoWidth) return toast('Kamera açık değil');
  const f = $('fl');
  f.style.opacity = 1;
  setTimeout(() => f.style.opacity = 0, 120);
  const vw = v.videoWidth, vh = v.videoHeight, cw = v.clientWidth, ch = v.clientHeight,
        k = Math.max(cw / vw, ch / vh), sw = cw / k, sh = ch / k, m = maskRect();
  const sx = (vw - sw) / 2 + m.x / k, sy = (vh - sh) / 2 + m.y / k, rw = m.w / k, rh = m.h / k;
  const c = document.createElement('canvas');
  c.width = Math.round(rw);
  c.height = Math.round(rh);
  c.getContext('2d').drawImage(v, sx, sy, rw, rh, 0, 0, c.width, c.height);
  const bl = await toBlob(c, 0.92);
  if (navigator.vibrate) navigator.vibrate(15);
  if (docOn) {
    docPg.push(bl);
    docUi();
    return;
  }
  enqueue([new File([bl], 'Kamera_' + new Date().toLocaleTimeString('tr-TR').replace(/:/g, '') + '.jpg', { type: 'image/jpeg' })]);
}

/* Çoklu sayfa (belge) modu */
let docOn = false, docPg = [];

function docMode() {
  if (docOn && docPg.length && !confirm('Çekilen ' + docPg.length + ' sayfa silinecek. Belge modundan çıkılsın mı?')) return;
  docOn = !docOn;
  if (!docOn) docPg = [];
  $('mm').classList.toggle('on', docOn);
  docUi();
  toast(docOn ? 'Belge modu: sayfaları çekin, sonra «Bitir» deyin' : 'Belge modu kapalı');
}

function docUi() {
  const c = $('cnb');
  c.textContent = docPg.length;
  c.classList.toggle('hidden', !docPg.length);
  $('mfin').classList.toggle('hidden', !docPg.length);
}

async function docFinish() {
  if (!docPg.length) return;
  const out = await PDFLib.PDFDocument.create();
  for (const b of docPg) {
    const img = await out.embedJpg(await b.arrayBuffer()),
          k = 595 / img.width,
          pg = out.addPage([595, img.height * k]);
    pg.drawImage(img, { x: 0, y: 0, width: 595, height: img.height * k });
  }
  const pdf = new File([await out.save()], 'Belge_' + new Date().toLocaleTimeString('tr-TR').replace(/:/g, '') + '.pdf', { type: 'application/pdf' });
  docPg = [];
  docUi();
  enqueue([pdf]);
}

function failChip(f, e) {
  toast('Gönderilemedi: ' + (e.message || e));
  $('mu').classList.add('hidden');
  const r = document.createElement('div');
  r.style.cssText = 'pointer-events:auto;color:#fca5a5;display:flex;gap:8px;align-items:center';
  r.innerHTML = '<span>✗ ' + esc(f.name) + '</span>';
  const b = document.createElement('button');
  b.className = 'btn sm';
  b.textContent = 'Tekrar dene';
  b.onclick = () => { r.remove(); enqueue([f]); };
  r.appendChild(b);
  $('mh').prepend(r);
}

function pick(i) {
  enqueue(Array.from(i.files));
  i.value = '';
}

function enqueue(l) {
  for (const f of l) {
    if (f.size > MAX) {
      toast(`${f.name} 250 MB sınırını aşıyor`);
      continue;
    }
    queue = queue.then(() => send(f)).catch(e => failChip(f, e));
  }
}

const waitAck = () => new Promise(r => {
  wake = r;
  setTimeout(r, 2000);
});

async function send(f) {
  if (!pcUp || state !== 'ok') throw new Error(!pcUp ? 'PC bağlı değil' : 'PC onayı gerekli');
  const ps = poolState();
  if (ps.full) throw new Error('Ortak kapasite doldu · ' + Math.max(1, Math.ceil((ps.u - Date.now()) / 864e5)) + ' gün sonra yenilenir');

  const key = dev + '~' + rid(6),
        n = Math.max(1, Math.ceil(f.size / CH)),
        ib = R('inbox/' + key),
        cb = R('chunks/' + key),
        ab = R('acks/' + key);
  let acked = 0, last = Date.now(), wl = null;

  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      wl = await navigator.wakeLock.request('screen');
    }
  } catch {}

  [ib, cb, ab].forEach(x => x.onDisconnect().remove());
  ab.on('value', s => {
    const v = s.val() || 0;
    if (v > acked) { acked = v; last = Date.now(); }
    if (wake) wake();
  });

  const chk = () => {
    if (!pcUp || Date.now() - last > 60000) throw new Error('PC yanıt vermiyor');
  };

  $('mu').classList.remove('hidden');
  $('mun').textContent = f.name;
  const setP = p => {
    $('mup').textContent = p + '%';
    $('mub').style.width = p + '%';
    $('shw').style.setProperty('--p', p);
    $('shw').classList.add('up');
  };
  setP(0);

  try {
    await ib.set({
      n,
      m: await enc(JSON.stringify({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size }), 'm:' + key)
    });
    const pend = new Set();
    let werr = null;
    for (let i = 0; i < n; i++) {
      while (i - acked >= WIN) {
        chk();
        if (werr) throw werr;
        await waitAck();
      }
      const c = await enc(await f.slice(i * CH, (i + 1) * CH).arrayBuffer(), key + ':' + i);
      const p = cb.child(i).set(c).catch(e => { werr = e; });
      pend.add(p);
      p.then(() => pend.delete(p));
      if (pend.size >= 3) await Promise.race(pend);
      setP(Math.floor((i + 1) / n * 100));
    }
    await Promise.all(pend);
    if (werr) throw werr;
    while (acked < n) {
      chk();
      await waitAck();
    }
  } finally {
    ab.off();
    await Promise.allSettled([ib.remove(), cb.remove(), ab.remove()]);
    [ib, cb, ab].forEach(x => x.onDisconnect().cancel());
    if (wl) wl.release().catch(() => {});
    $('shw').classList.remove('up');
    setTimeout(() => $('mu').classList.add('hidden'), 400);
  }

  if (navigator.vibrate) navigator.vibrate(25);
  const r = document.createElement('div');
  r.textContent = '✓ ' + f.name;
  $('mh').prepend(r);
  while ($('mh').children.length > 4) $('mh').lastChild.remove();
}
