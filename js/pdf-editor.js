/* ==========================================================================
   TonoScan - PDF Sayfa Düzenleyici, Birleştirme ve Kesme
   ========================================================================== */

const PDC = ['#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#a855f7', '#06b6d4', '#f43f5e', '#84cc16'];
const PD_UNDO = 80;
let pd = null, pc = null;

function pdOn() {
  return $('pdm').classList.contains('on');
}

const pdIdx = id => pd.pages.findIndex(p => p.id === id);
const pdSelIds = () => (pd ? pd.pages.filter(p => pd.sel.has(p.id)).map(p => p.id) : []);
const pdNorm = a => ((a % 360) + 360) % 360;

/* Kesme alanını döndürülmüş görünüme çevirir (saat yönü) */
function pdToDisp(c, r) {
  r = pdNorm(r);
  const { x, y, w, h } = c;
  return r === 90 ? { x: 1 - y - h, y: x, w: h, h: w }
       : r === 180 ? { x: 1 - x - w, y: 1 - y - h, w, h }
       : r === 270 ? { x: y, y: 1 - x - w, w: h, h: w }
       : { x, y, w, h };
}

const pdFull = c => !c || (c.x < 0.002 && c.y < 0.002 && c.w > 0.996 && c.h > 0.996);
const isImgFile = f => /^image\//.test(f.type || f.mime || '') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name || '');
const isPdfFile = f => (f.type || f.mime) === 'application/pdf' || /\.pdf$/i.test(f.name || '');

function dlBlob(b, n) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = n;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* Görseli tek sayfalık PDF'e çevirir (mevcut tercihe göre) */
async function imgPdfBytes(blob) {
  const out = await PDFLib.PDFDocument.create(), by = await blob.arrayBuffer();
  let img = null;
  try {
    if (blob.type === 'image/jpeg') img = await out.embedJpg(by);
    else if (blob.type === 'image/png') img = await out.embedPng(by);
  } catch (e) {
    img = null;
  }
  if (!img) {
    const b = await createImageBitmap(blob), c = document.createElement('canvas');
    c.width = b.width;
    c.height = b.height;
    c.getContext('2d').drawImage(b, 0, 0);
    img = await out.embedJpg(await (await toBlob(c, 0.92)).arrayBuffer());
  }
  const fm = localStorage.ts_fit || 'fit';
  if (fm === 'orig') {
    const hh = img.height * 595 / img.width;
    out.addPage([595, hh]).drawImage(img, { x: 0, y: 0, width: 595, height: hh });
  } else {
    const pg = out.addPage([595, 842]);
    const k = fm === 'fill' ? Math.max(595 / img.width, 842 / img.height) : Math.min(575 / img.width, 822 / img.height);
    const w = img.width * k;
    const h = img.height * k;
    pg.drawImage(img, { x: (595 - w) / 2, y: (842 - h) / 2, width: w, height: h });
  }
  return out.save();
}

async function pdOpen(ids) {
  const fl = [...ids].map(get).filter(f => f && (f.type === 'pdf' || f.type === 'image'));
  if (!fl.length) return toast('Önce görsel veya PDF seçin');
  if (pd) pdClose(true);
  const isAllImg = fl.every(f => f.type === 'image');
  const isMixed = fl.some(f => f.type === 'image') && fl.some(f => f.type === 'pdf');
  const P = pd = {
    docs: {}, pages: [], sel: new Set(), anchor: null, undo: [],
    dirty: fl.length > 1, thumbs: {}, lib: {}, ci: 0, busy: false, saving: false, drag: null, at: null
  };
  $('pdt').textContent = fl.length > 1 
    ? (isAllImg ? 'Görselleri PDF Dönüştür & Düzenle' : (isMixed ? 'Görsel & PDF Birleştir' : 'PDF Birleştir ve Düzenle')) 
    : (fl[0].type === 'image' ? fl[0].name + ' → PDF' : fl[0].name);
  $('pdg').innerHTML = '<div class="pdempty"><i class="fa-solid fa-spinner fa-spin"></i>Sayfalar hazırlanıyor...</div>';
  $('pdsrc').innerHTML = '';
  $('pdbulk').classList.remove('on');
  show('pdm', 1);
  pdUndoUi();

  for (const f of fl) {
    if (pd !== P) return;
    await pdAddSrc(P, f.name, f.blob, f.id, f.type === 'image');
  }
  if (pd === P) pdRender();
}

async function pdAddSrc(P, name, blob, fid, img) {
  try {
    const bytes = img ? await imgPdfBytes(blob) : new Uint8Array(await blob.arrayBuffer());
    const pj = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    if (pd !== P) { pj.destroy(); return false; }
    const key = rid(5);
    P.docs[key] = { key, name, bytes, pj, fid, color: PDC[P.ci++ % PDC.length] };
    for (let n = 0; n < pj.numPages; n++) {
      P.pages.push({ id: rid(6), src: key, n, rot: 0, crop: null });
    }
    return true;
  } catch (e) {
    toast('Açılamadı: ' + name);
    return false;
  }
}

function pdSnap() {
  pd.undo.push({ pages: pd.pages.map(p => ({ ...p, crop: p.crop && { ...p.crop } })), sel: [...pd.sel] });
  if (pd.undo.length > PD_UNDO) pd.undo.shift();
  pd.dirty = true;
}

function pdUndo() {
  if (!pd) return;
  const s = pd.undo.pop();
  if (!s) return toast('Geri alınacak işlem yok');
  pd.pages = s.pages;
  pd.sel = new Set(s.sel);
  pdRender();
  toast('Geri alındı');
}

function pdUndoUi() {
  const b = $('pdu');
  b.disabled = !pd || !pd.undo.length;
  b.title = 'Geri al (Ctrl+Z)' + (pd && pd.undo.length ? ' · ' + pd.undo.length + ' adım' : '');
}

/* ---- Çizim ve Kartlar ---- */
function pdRender() {
  if (!pd) return;
  const P = pd, g = $('pdg'), N = P.pages.length;
  const used = {};
  P.pages.forEach(p => { if (!p.blank) used[p.src] = (used[p.src] || 0) + 1; });
  $('pdsrc').innerHTML = Object.values(P.docs).filter(d => used[d.key]).map(d =>
    `<span class="pdsc" style="--c:${d.color}" title="${esc(d.name)}"><i></i><span>${esc(d.name)}</span><small>${used[d.key]} sf</small></span>`
  ).join('');
  $('pds').textContent = N ? N + ' sayfa · sürükleyerek sıralayın · Shift ile aralık seçin · Ctrl+Z geri al' : 'Dosya veya boş sayfa ekleyin';
  g.innerHTML = N ? P.pages.map((p, i) => pdCard(p, i, N)).join('')
                  : '<div class="pdempty"><i class="fa-regular fa-folder-open"></i>Sayfa kalmadı.<br>Yukarıdan dosya ekleyin, dosyaları buraya sürükleyin veya Ctrl+Z ile geri alın.</div>';
  g.querySelectorAll('canvas[data-id]').forEach(pdPaint);
  pdBulk();
  pdUndoUi();
  pdQueue();
}

function pdCard(p, i, N) {
  const d = p.blank ? null : pd.docs[p.src],
        lbl = p.blank ? 'Boş sayfa' : `${d.name} · s.${p.n + 1}`,
        id = p.id;
  return `<div class="pdc${pd.sel.has(id) ? ' sel' : ''}" draggable="true" data-id="${id}" style="--c:${d ? d.color : '#94a3b8'}">
  <div class="pdth" onclick="pdClick(event,'${id}')" ondblclick="pdCrop(['${id}'])">
    <canvas data-id="${id}" data-k="${p.blank ? '' : p.src + ':' + p.n}"></canvas>
    <span class="pdno">${i + 1}</span>
    <span class="pdbd">${p.rot ? `<span>${p.rot}°</span>` : ''}${p.crop ? '<span><i class="fa-solid fa-crop-simple"></i></span>' : ''}</span>
  </div>
  <div class="pdlb" onclick="pdClick(event,'${id}')" title="${esc(lbl)}"><i></i><span>${esc(lbl)}</span></div>
  <div class="pdact">
    <button title="Sola taşı" onclick="pdMv('${id}',-1)" ${i ? '' : 'disabled'}><i class="fa-solid fa-arrow-left"></i></button>
    <button title="Sağa taşı" onclick="pdMv('${id}',1)" ${i < N - 1 ? '' : 'disabled'}><i class="fa-solid fa-arrow-right"></i></button>
    <button title="Döndür (90°)" onclick="pdRotIds(['${id}'],90)"><i class="fa-solid fa-rotate-right"></i></button>
    <button title="Kes" onclick="pdCrop(['${id}'])" ${p.blank ? 'disabled' : ''}><i class="fa-solid fa-crop-simple"></i></button>
    <button title="Kopyala" onclick="pdDup(['${id}'])"><i class="fa-regular fa-clone"></i></button>
    <button class="dg" title="Sil" onclick="pdDel(['${id}'])"><i class="fa-solid fa-trash-can"></i></button>
  </div></div>`;
}

function pdPaint(c) {
  if (!pd) return;
  const p = pd.pages.find(x => x.id === c.dataset.id);
  if (!p) return;
  const src = p.blank ? null : pd.thumbs[c.dataset.k];
  if (!p.blank && !src) { c.classList.add('ld'); return; }
  c.classList.remove('ld');
  const W = src ? src.width : p.blank.w,
        H = src ? src.height : p.blank.h,
        cr = p.crop || { x: 0, y: 0, w: 1, h: 1 },
        sw = W * cr.w, sh = H * cr.h,
        rt = p.rot % 180 !== 0,
        ow = rt ? sh : sw, oh = rt ? sw : sh,
        k = 240 / Math.max(ow, oh);
  c.width = Math.max(1, Math.round(ow * k));
  c.height = Math.max(1, Math.round(oh * k));
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  if (src) {
    x.translate(c.width / 2, c.height / 2);
    x.rotate(p.rot * Math.PI / 180);
    x.drawImage(src, cr.x * W, cr.y * H, sw, sh, -sw * k / 2, -sh * k / 2, sw * k, sh * k);
  }
}

async function pdQueue() {
  const P = pd;
  if (!P || P.busy) return;
  P.busy = true;
  try {
    while (pd === P) {
      const p = P.pages.find(p => !p.blank && !P.thumbs[p.src + ':' + p.n]);
      if (!p) break;
      const k = p.src + ':' + p.n;
      let c = document.createElement('canvas');
      try {
        const pg = await P.docs[p.src].pj.getPage(p.n + 1),
              v0 = pg.getViewport({ scale: 1 }),
              v = pg.getViewport({ scale: Math.min(2, 300 / Math.max(v0.width, v0.height)) });
        c.width = Math.ceil(v.width);
        c.height = Math.ceil(v.height);
        await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
        pg.cleanup();
      } catch (e) {
        c.width = 150; c.height = 200;
        const x = c.getContext('2d');
        x.fillStyle = '#f1f5f9';
        x.fillRect(0, 0, 150, 200);
        x.fillStyle = '#94a3b8';
        x.font = '14px sans-serif';
        x.fillText('Önizleme yok', 28, 104);
      }
      P.thumbs[k] = c;
      if (pd === P) {
        document.querySelectorAll(`#pdg canvas[data-k="${k}"]`).forEach(pdPaint);
      }
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    P.busy = false;
  }
}

/* ---- Seçim Yönetimi ---- */
function pdClick(e, id) {
  if (!pd) return;
  const ids = pd.pages.map(p => p.id);
  if (e.shiftKey && pd.anchor && ids.includes(pd.anchor)) {
    let a = ids.indexOf(pd.anchor), b = ids.indexOf(id);
    if (a > b) [a, b] = [b, a];
    if (!(e.ctrlKey || e.metaKey)) pd.sel.clear();
    for (let i = a; i <= b; i++) pd.sel.add(ids[i]);
  } else {
    pd.sel.has(id) ? pd.sel.delete(id) : pd.sel.add(id);
    pd.anchor = id;
  }
  pdSelUi();
}

function pdSelUi() {
  document.querySelectorAll('#pdg .pdc').forEach(c => c.classList.toggle('sel', pd.sel.has(c.dataset.id)));
  pdBulk();
}

function pdSelAll() {
  if (!pd) return;
  pd.sel = new Set(pd.pages.map(p => p.id));
  pdSelUi();
}

function pdSelNone() {
  if (!pd) return;
  pd.sel.clear();
  pdSelUi();
}

function pdBulk() {
  const n = pd ? pd.sel.size : 0, b = $('pdbulk');
  b.classList.toggle('on', n > 0);
  if (!n) return;
  b.innerHTML = `<b>${n} sayfa seçili</b>
  <button class="btn sm" onclick="pdRotIds(pdSelIds(),-90)"><i class="fa-solid fa-rotate-left"></i>Sola</button>
  <button class="btn sm" onclick="pdRotIds(pdSelIds(),90)"><i class="fa-solid fa-rotate-right"></i>Sağa</button>
  <button class="btn sm" onclick="pdCrop(pdSelIds())"><i class="fa-solid fa-crop-simple"></i>Kes</button>
  <button class="btn sm" onclick="pdDup(pdSelIds())"><i class="fa-regular fa-clone"></i>Kopyala</button>
  <button class="btn sm dg" onclick="pdDel(pdSelIds())"><i class="fa-solid fa-trash-can"></i>Sil</button>
  <div class="sep"></div>
  <button class="btn sm" onclick="pdSelAll()">Tümünü Seç</button>
  <button class="btn sm" title="Seçimi temizle (Esc)" onclick="pdSelNone()"><i class="fa-solid fa-xmark"></i></button>`;
}

/* ---- Sayfa İşlemleri ---- */
function pdMv(id, d) {
  const i = pdIdx(id), j = i + d;
  if (i < 0 || j < 0 || j >= pd.pages.length) return;
  pdSnap();
  const a = pd.pages;
  [a[i], a[j]] = [a[j], a[i]];
  pdRender();
}

function pdRotIds(ids, deg) {
  if (!pd || !ids.length) return;
  pdSnap();
  ids.forEach(id => {
    const p = pd.pages[pdIdx(id)];
    if (p) p.rot = pdNorm(p.rot + deg);
  });
  pdRender();
}

function pdDup(ids) {
  if (!pd || !ids.length) return;
  pdSnap();
  const set = new Set(ids), out = [];
  pd.pages.forEach(p => {
    out.push(p);
    if (set.has(p.id)) out.push({ ...p, id: rid(6), crop: p.crop && { ...p.crop } });
  });
  pd.pages = out;
  pdRender();
  toast(ids.length > 1 ? ids.length + ' sayfa kopyalandı' : 'Sayfa kopyalandı');
}

function pdDel(ids) {
  if (!pd || !ids.length) return;
  pdSnap();
  const set = new Set(ids);
  pd.pages = pd.pages.filter(p => !set.has(p.id));
  ids.forEach(i => pd.sel.delete(i));
  pdRender();
  toast((ids.length > 1 ? ids.length + ' sayfa' : 'Sayfa') + ' silindi · Ctrl+Z ile geri alabilirsiniz');
}

async function pdBlank() {
  if (!pd) return;
  const P = pd, ids = pdSelIds(),
        ref = ids.length ? P.pages[pdIdx(ids[ids.length - 1])] : P.pages[P.pages.length - 1];
  let w = 595.28, h = 841.89;
  try {
    if (ref && ref.blank) { w = ref.blank.w; h = ref.blank.h; }
    else if (ref) {
      const v = (await P.docs[ref.src].pj.getPage(ref.n + 1)).getViewport({ scale: 1 });
      w = v.width; h = v.height;
      if (ref.crop) { w *= ref.crop.w; h *= ref.crop.h; }
    }
    if (ref && ref.rot % 180) [w, h] = [h, w];
  } catch (e) {}
  if (pd !== P) return;
  pdSnap();
  const at = ids.length ? pdIdx(ids[ids.length - 1]) + 1 : P.pages.length;
  P.pages.splice(at, 0, { id: rid(6), src: null, n: 0, blank: { w, h }, rot: 0, crop: null });
  pdRender();
  const el = document.querySelectorAll('#pdg .pdc')[at];
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function pdClearAll() {
  if (!pd || !pd.pages.length) return;
  if (!confirm('Tüm sayfalar kaldırılsın mı? (Ctrl+Z ile geri alınabilir)')) return;
  pdSnap();
  pd.pages = [];
  pd.sel.clear();
  pdRender();
}

function pdMoveGroup(ids, at) {
  if (!at || ids.includes(at.id)) return;
  const set = new Set(ids), mv = pd.pages.filter(p => set.has(p.id));
  if (!mv.length) return;
  pdSnap();
  const rest = pd.pages.filter(p => !set.has(p.id));
  let j = at.id ? rest.findIndex(p => p.id === at.id) : rest.length;
  if (j < 0) j = rest.length;
  else if (at.id && at.after) j++;
  rest.splice(j, 0, ...mv);
  pd.pages = rest;
  pdRender();
}

/* ---- Dosya Ekleme ---- */
async function pdAddFiles(list) {
  if (!pd) return;
  const P = pd, l = [...list].filter(f => isPdfFile(f) || isImgFile(f));
  if (!l.length) return toast('Yalnızca PDF ve görsel eklenebilir');
  pdSnap();
  let ok = 0;
  toast('Ekleniyor...');
  for (const f of l) {
    if (await pdAddSrc(P, f.name, f, null, !isPdfFile(f))) ok++;
  }
  if (pd === P) {
    pdRender();
    toast(ok + ' dosya eklendi');
    $('pdmb').scrollTo({ top: 1e9, behavior: 'smooth' });
  }
}

function pdFolder(e) {
  e.stopPropagation();
  const m = $('pdfl');
  if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
  const l = files.filter(f => f.type === 'pdf' || f.type === 'image')
                 .sort((a, b) => (a.type === 'pdf' ? 0 : 1) - (b.type === 'pdf' ? 0 : 1) || b.time - a.time);
  m.innerHTML = l.length ? l.map(f => {
    const n = Object.values(pd.docs).some(d => d.fid === f.id);
    return `<button onclick="pdAddFid('${f.id}')">
      ${f.thumb ? `<img src="${f.thumb}" alt="">` : '<span class="ph0"><i class="fa-solid fa-file"></i></span>'}
      <span style="min-width:0;flex:1"><div class="nm">${esc(f.name)}</div><small>${f.type === 'pdf' ? (f.pages || '?') + ' sayfa' : 'Görsel'}${n ? ' · düzenleyicide var' : ''}</small></span>
      <i class="fa-solid fa-plus" style="color:#93c5fd"></i>
    </button>`;
  }).join('') : '<div class="mu sm" style="padding:12px">Klasörde PDF veya görsel yok</div>';
  m.classList.remove('hidden');
}

async function pdAddFid(fid) {
  $('pdfl').classList.add('hidden');
  const f = get(fid);
  if (!f || !pd) return;
  const P = pd;
  pdSnap();
  if (await pdAddSrc(P, f.name, f.blob, f.id, f.type === 'image') && pd === P) {
    pdRender();
    toast('«' + f.name + '» eklendi');
    $('pdmb').scrollTo({ top: 1e9, behavior: 'smooth' });
  }
}

/* ---- Kesme Ekranı ---- */
async function pdCrop(ids) {
  if (!pd) return;
  const p = ids.map(id => pd.pages[pdIdx(id)]).find(p => p && !p.blank);
  if (!p) return toast('Boş sayfada kesme yapılamaz');
  const tk = pc = { id: p.id, r: pdToDisp(p.crop || { x: 0, y: 0, w: 1, h: 1 }, p.rot) };
  $('pdcsc').value = ids.length > 1 ? 'sel' : 'one';
  $('pdcsc').options[1].textContent = 'Seçili sayfalar (' + Math.max(pd.sel.size, ids.length > 1 ? ids.length : 0) + ')';
  $('pdcrop').classList.remove('hidden');
  $('pdcr').style.display = 'none';
  try {
    const pg = await pd.docs[p.src].pj.getPage(p.n + 1),
          rot = pdNorm(pg.rotate + p.rot),
          v1 = pg.getViewport({ scale: 1, rotation: rot }),
          bx = $('pdcs');
    const k = Math.min((bx.clientWidth - 70) / v1.width, (bx.clientHeight - 70) / v1.height),
          dpr = Math.min(2, devicePixelRatio || 1),
          v = pg.getViewport({ scale: k * dpr, rotation: rot }),
          c = $('pdcc');
    c.width = Math.floor(v.width);
    c.height = Math.floor(v.height);
    c.style.width = c.width / dpr + 'px';
    c.style.height = c.height / dpr + 'px';
    await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
  } catch (e) {
    toast('Sayfa açılamadı');
  }
  if (pc !== tk) return;
  $('pdcr').style.display = '';
  pdcUi();
}

function pdcUi() {
  if (!pc) return;
  const r = pc.r, e = $('pdcr');
  e.style.left = r.x * 100 + '%';
  e.style.top = r.y * 100 + '%';
  e.style.width = r.w * 100 + '%';
  e.style.height = r.h * 100 + '%';
  $('pdci').textContent = pdFull(r) ? 'Kesme yok · tüm sayfa' : 'Alan: %' + Math.round(r.w * 100) + ' × %' + Math.round(r.h * 100);
}

function pdcReset() {
  if (pc) { pc.r = { x: 0, y: 0, w: 1, h: 1 }; pdcUi(); }
}

function pdCropClose() {
  pc = null;
  $('pdcrop').classList.add('hidden');
}

function pdCropApply(clear) {
  if (!pc || !pd) return;
  const sc = $('pdcsc').value, sl = pdSelIds();
  const ids = sc === 'all' ? pd.pages.map(p => p.id) : sc === 'sel' && sl.length ? sl : [pc.id];
  pdSnap();
  let n = 0;
  for (const id of ids) {
    const p = pd.pages[pdIdx(id)];
    if (!p || p.blank) continue;
    n++;
    if (clear || pdFull(pc.r)) p.crop = null;
    else {
      const c = pdToDisp(pc.r, 360 - p.rot);
      p.crop = { x: Math.max(0, c.x), y: Math.max(0, c.y), w: Math.min(1, c.w), h: Math.min(1, c.h) };
    }
  }
  pdCropClose();
  pdRender();
  toast(clear ? n + ' sayfada kesme kaldırıldı' : n + ' sayfa kesildi');
}

/* ---- Çıktı ve PDF Oluşturma ---- */
async function pdLib(P, k) {
  return P.lib[k] || (P.lib[k] = await PDFLib.PDFDocument.load(P.docs[k].bytes, { ignoreEncryption: true }));
}

function pdApply(pg, p) {
  const r0 = p.blank ? 0 : pdNorm(pg.getRotation().angle || 0);
  if (p.crop && !p.blank) {
    const b = pg.getCropBox(),
          f = pdToDisp(p.crop, 360 - r0),
          x = b.x + f.x * b.width,
          y = b.y + (1 - f.y - f.h) * b.height,
          w = f.w * b.width,
          h = f.h * b.height;
    pg.setMediaBox(x, y, w, h);
    pg.setCropBox(x, y, w, h);
  }
  pg.setRotation(PDFLib.degrees(pdNorm(r0 + p.rot)));
}

async function pdBuild(P, list) {
  const out = await PDFLib.PDFDocument.create(), need = {}, cache = {}, used = new Set();
  list.forEach(p => { if (!p.blank) (need[p.src] = need[p.src] || new Set()).add(p.n); });
  for (const k in need) {
    const idx = [...need[k]], cp = await out.copyPages(await pdLib(P, k), idx);
    idx.forEach((n, i) => cache[k + ':' + n] = cp[i]);
  }
  for (const p of list) {
    let pg;
    if (p.blank) pg = out.addPage([p.blank.w, p.blank.h]);
    else {
      const k = p.src + ':' + p.n;
      pg = used.has(k) ? (await out.copyPages(await pdLib(P, p.src), [p.n]))[0] : cache[k];
      used.add(k);
      out.addPage(pg);
    }
    pdApply(pg, p);
  }
  return out;
}

async function pdSave(mode) {
  if (!pd || pd.saving) return;
  const P = pd, list = P.pages.slice();
  if (!list.length) return toast('Kaydedilecek sayfa yok');
  P.saving = true;
  toast('Hazırlanıyor...');
  try {
    const srcs = [...new Set(list.filter(p => !p.blank).map(p => p.src))],
          one = srcs.length === 1 ? P.docs[srcs[0]] : null,
          of = one && one.fid ? get(one.fid) : null;
    const isImgOrig = of && of.type === 'image';
    const base = (one ? one.name.replace(/\.[^.]+$/, '') : (srcs.length ? 'Birlesik_Evrak_' + Date.now() : 'Evrak_' + Date.now())).replace(/[\\/:*?"<>|]/g, '_');
    const who = of ? { sender: of.sender, color: of.color } : { sender: 'Stüdyo', color: PAL[2] };
    const mk = async l => new Blob([await (await pdBuild(P, l)).save()], { type: 'application/pdf' });
    const w = Math.max(2, String(list.length).length),
          pad = i => String(i + 1).padStart(w, '0'),
          nm = one ? (isImgOrig ? base + '.pdf' : base + '_Duzenlenmis.pdf') : base + '.pdf';
    if (mode === 'folder') {
      await addFile({ name: nm, mime: 'application/pdf', blob: await mk(list), ...who });
      P.dirty = false; sel = []; render(); pdClose(true); toast('PDF klasöre kaydedildi');
    } else if (mode === 'dl') {
      dlBlob(await mk(list), nm); P.dirty = false; toast('PDF indirildi');
    } else if (mode === 'each') {
      for (let i = 0; i < list.length; i++) {
        await addFile({ name: `${base}_sayfa-${pad(i)}.pdf`, mime: 'application/pdf', blob: await mk([list[i]]), ...who });
      }
      P.dirty = false; pdClose(true); toast(list.length + ' ayrı PDF klasöre eklendi');
    } else {
      const z = new JSZip();
      for (let i = 0; i < list.length; i++) {
        z.file(`sayfa-${pad(i)}.pdf`, await (await pdBuild(P, [list[i]])).save());
      }
      dlBlob(await z.generateAsync({ type: 'blob', compression: 'STORE' }), base + '_sayfalar.zip');
      P.dirty = false; toast(list.length + ' sayfa ZIP olarak indirildi');
    }
  } catch (e) {
    toast('Kaydedilemedi: ' + (e.message || e));
  } finally {
    P.saving = false;
  }
}

function pdClose(force) {
  if (!pd) return show('pdm', 0);
  if (!force && pd.dirty && !confirm('Kaydedilmemiş değişiklikler silinecek. Düzenleyici kapatılsın mı?')) return;
  Object.values(pd.docs).forEach(d => { try { d.pj.destroy(); } catch (e) {} });
  pd = null;
  pdCropClose();
  $('pdfl').classList.add('hidden');
  $('pddrop').classList.add('hidden');
  $('pdbulk').classList.remove('on');
  $('pdg').innerHTML = '';
  show('pdm', 0);
}

/* ---- Kısayollar ---- */
function pdKey(e) {
  if (!pd) return;
  const k = e.key.toLowerCase(), m = e.ctrlKey || e.metaKey;
  if (pc) {
    if (e.key === 'Escape') pdCropClose();
    else if (e.key === 'Enter') { e.preventDefault(); pdCropApply(false); }
    else if (m && k === 'z') { e.preventDefault(); }
    return;
  }
  if (m && k === 'z') { e.preventDefault(); pdUndo(); }
  else if (m && k === 'a') { e.preventDefault(); pdSelAll(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (pd.sel.size) { e.preventDefault(); pdDel(pdSelIds()); }
  } else if (e.key === 'Escape') {
    if (!$('pdfl').classList.contains('hidden')) $('pdfl').classList.add('hidden');
    else if (pd.sel.size) pdSelNone();
    else pdClose();
  }
}

/* ---- Sürükle-Bırak Olayları ---- */
function pdInit() {
  const g = $('pdg'), m = $('pdm'), dz = $('pddrop'), isF = e => [...(e.dataTransfer.types || [])].includes('Files');
  const line = (id, after) => {
    g.querySelectorAll('.ib,.ia').forEach(x => x.classList.remove('ib', 'ia'));
    if (id) {
      const c = g.querySelector(`.pdc[data-id="${id}"]`);
      if (c) c.classList.add(after ? 'ia' : 'ib');
    }
  };

  g.addEventListener('dragstart', e => {
    const c = e.target.closest && e.target.closest('.pdc');
    if (!c || !pd) return;
    const id = c.dataset.id;
    pd.drag = pd.sel.has(id) ? pdSelIds() : [id];
    pd.at = null;
    e.dataTransfer.setData('application/x-tonoscan-page', id);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => pd && pd.drag && pd.drag.forEach(i => {
      const x = g.querySelector(`.pdc[data-id="${i}"]`);
      if (x) x.classList.add('drg');
    }));
  });

  g.addEventListener('dragover', e => {
    if (!pd || !pd.drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const c = e.target.closest('.pdc');
    if (!c) return;
    const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
    pd.at = { id: c.dataset.id, after };
    line(pd.drag.includes(c.dataset.id) ? null : c.dataset.id, after);
  });

  g.addEventListener('drop', e => {
    if (!pd || !pd.drag) return;
    e.preventDefault();
    e.stopPropagation();
    const d = pd.drag, a = pd.at;
    pd.drag = null;
    line();
    pdMoveGroup(d, a);
  });

  g.addEventListener('dragend', () => {
    if (pd) { pd.drag = null; pd.at = null; }
    line();
    g.querySelectorAll('.drg').forEach(x => x.classList.remove('drg'));
  });

  let dep = 0;
  m.addEventListener('dragenter', e => {
    if (!pd || pd.drag || !isF(e)) return;
    dep++;
    dz.classList.remove('hidden');
  });

  m.addEventListener('dragleave', e => {
    if (!pd || pd.drag || !isF(e)) return;
    dep = Math.max(0, dep - 1);
    if (!dep) dz.classList.add('hidden');
  });

  m.addEventListener('dragover', e => {
    if (!pd || pd.drag || !isF(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  m.addEventListener('drop', e => {
    if (!pd || pd.drag) return;
    e.preventDefault();
    dep = 0;
    dz.classList.add('hidden');
    if (e.dataTransfer.files.length) pdAddFiles(e.dataTransfer.files);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.pdpick')) $('pdfl').classList.add('hidden');
  });

  /* Kesme alanı: 8 tutamaç, taşıma ve yeni alan çizme */
  const w = $('pdcw');
  w.addEventListener('pointerdown', e => {
    if (!pc) return;
    e.preventDefault();
    const B = w.getBoundingClientRect(), cl = v => Math.min(1, Math.max(0, v));
    const fx = v => cl((v - B.left) / B.width), fy = v => cl((v - B.top) / B.height),
          x0 = fx(e.clientX), y0 = fy(e.clientY), r0 = { ...pc.r }, M = 0.03;
    const mode = e.target.dataset.h || (e.target === $('pdcr') ? 'move' : 'draw');
    const mv = ev => {
      const x = fx(ev.clientX), y = fy(ev.clientY);
      let L = r0.x, T = r0.y, R = r0.x + r0.w, Bo = r0.y + r0.h;
      if (mode === 'move') {
        L = Math.min(1 - r0.w, Math.max(0, r0.x + x - x0));
        T = Math.min(1 - r0.h, Math.max(0, r0.y + y - y0));
        R = L + r0.w; Bo = T + r0.h;
      } else if (mode === 'draw') {
        L = Math.min(x0, x); R = Math.max(x0, x);
        T = Math.min(y0, y); Bo = Math.max(y0, y);
        if (R - L < M || Bo - T < M) return;
      } else {
        if (mode.includes('w')) L = Math.min(x, R - M);
        if (mode.includes('e')) R = Math.max(x, L + M);
        if (mode.includes('n')) T = Math.min(y, Bo - M);
        if (mode.includes('s')) Bo = Math.max(y, T + M);
      }
      pc.r = { x: L, y: T, w: R - L, h: Bo - T };
      pdcUi();
    };
    const up = () => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  });
}
