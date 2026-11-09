/* ==========================================================================
   TonoScan - Kolaj ve Sayfa Düzenleyici (A4/A5/Letter & Uzun Görsel)
   ========================================================================== */

const SZ = { A4: [210, 297], A5: [148, 210], LT: [215.9, 279.4] };
const FL = {
  none: 'none',
  gray: 'grayscale(1)',
  scan: 'grayscale(1) contrast(1.85) brightness(1.12)'
};

let col = null, colK = 1, colRO = null;

const colSelItem = () => (col && col.sel ? col.pages[col.pi].items.find(i => i.id === col.sel) : null);

const colBBox = it => {
  const a = Math.abs(it.rot * Math.PI / 180),
        c = Math.abs(Math.cos(a)),
        s = Math.abs(Math.sin(a));
  return { w: it.w * c + it.h * s, h: it.w * s + it.h * c };
};

/* PDF'te (y yukarı) görselin sol-alt köşesi: merkez etrafında döndürülmüş kutunun başlangıç noktası */
function colOrigin(cx, cy, w, h, rot, ph) {
  const f = -rot * Math.PI / 180,
        c = Math.cos(f),
        s = Math.sin(f),
        ym = ph - cy;
  return { x: cx + (-w / 2) * c - (-h / 2) * s, y: ym + (-w / 2) * s + (-h / 2) * c };
}

function colContain(it, bx, by, bw, bh) {
  const r = it.ar;
  let w, h;
  if (bw / bh > r) { h = bh; w = h * r; }
  else { w = bw; h = w / r; }
  it.w = w;
  it.h = h;
  it.cx = bx + bw / 2;
  it.cy = by + bh / 2;
  it.rot = 0;
}

function colArrange(all, k, pw, ph, mg) {
  all.forEach(i => { i.rot = 0; });
  if (k === 'long') {
    let y = 0;
    all.forEach(i => {
      i.w = pw;
      i.h = pw / i.ar;
      i.cx = pw / 2;
      i.cy = y + i.h / 2;
      y += i.h;
    });
    return { pages: [{ items: all }], ph: Math.max(50, y), mg: 0 };
  }
  const cfg = { fit1: [1, 1], v2: [1, 2], h2: [2, 1], g4: [2, 2], g6: [2, 3], id: [1, 2] }[k],
        cols = cfg[0], rows = cfg[1],
        per = cols * rows,
        g = Math.max(4, mg / 2),
        pages = [];
  for (let i = 0; i < all.length; i += per) pages.push({ items: all.slice(i, i + per) });
  pages.forEach(p => {
    if (k === 'id') {
      const bw = 100, bh = 64, gap = 14, top = mg + 25;
      p.items.forEach((it, n) => colContain(it, (pw - bw) / 2, top + n * (bh + gap), bw, bh));
      return;
    }
    const cw = (pw - 2 * mg - (cols - 1) * g) / cols,
          ch = (ph - 2 * mg - (rows - 1) * g) / rows;
    p.items.forEach((it, n) => colContain(it, mg + (n % cols) * (cw + g), mg + Math.floor(n / cols) * (ch + g), cw, ch));
  });
  return { pages, ph, mg };
}

function colSnap(it, cx, cy) {
  const b = colBBox(it),
        xs = [0, col.mg, col.pw / 2, col.pw - col.mg, col.pw],
        ys = [0, col.mg, col.ph / 2, col.ph - col.mg, col.ph];
  col.pages[col.pi].items.forEach(o => {
    if (o === it) return;
    const ob = colBBox(o);
    xs.push(o.cx - ob.w / 2, o.cx, o.cx + ob.w / 2);
    ys.push(o.cy - ob.h / 2, o.cy, o.cy + ob.h / 2);
  });
  const thr = 2.5;
  let gx = null, gy = null, bx = thr, by = thr, dx = 0, dy = 0;
  for (const off of [-b.w / 2, 0, b.w / 2]) {
    for (const x of xs) {
      const d = x - (cx + off);
      if (Math.abs(d) < bx) { bx = Math.abs(d); dx = d; gx = x; }
    }
  }
  for (const off of [-b.h / 2, 0, b.h / 2]) {
    for (const y of ys) {
      const d = y - (cy + off);
      if (Math.abs(d) < by) { by = Math.abs(d); dy = d; gy = y; }
    }
  }
  return { cx: cx + dx, cy: cy + dy, gx, gy };
}

function colDims() {
  let w = SZ[col.sz] ? SZ[col.sz][0] : 210,
      h = SZ[col.sz] ? SZ[col.sz][1] : 297;
  if (col.ori === 'l') { const t = w; w = h; h = t; }
  col.pw = w;
  col.ph = h;
}

function oriUi() {
  $('cop').classList.toggle('on', col.ori === 'p');
  $('col2').classList.toggle('on', col.ori === 'l');
}

async function colMake(f) {
  const bm = await createImageBitmap(f.blob),
        it = { id: rid(5), fid: f.id, blob: f.blob, url: f.url, ar: bm.width / bm.height, cx: 0, cy: 0, w: 50, h: 50, rot: 0, flt: 'none', bw: 0 };
  if (bm.close) bm.close();
  return it;
}

async function colOpen() {
  const fl = sel.map(get).filter(f => f && f.type === 'image');
  if (!fl.length) return toast('Önce görsel seçin');
  col = { sz: 'A4', ori: 'p', pw: 210, ph: 297, mg: 10, pages: [{ items: [] }], pi: 0, sel: null, lay: 'fit1', dirty: false };
  $('csz').value = 'A4';
  $('cmg').value = 10;
  oriUi();
  show('colm', 1);
  colInit();
  for (const f of fl) col.pages[0].items.push(await colMake(f));
  colLayout('fit1');
  col.dirty = false;
}

function colClose() {
  if (col && col.dirty && !confirm('Kapatırsanız kaydedilmemiş kolaj düzeni silinir. Kapatılsın mı?')) return;
  show('colm', 0);
  col = null;
}

function colLayout(k) {
  if (!k || !col) return;
  const all = col.pages.flatMap(p => p.items);
  if (!all.length) return toast('Önce soldaki listeden görsel ekleyin');
  if (k === 'long') {
    col.sz = 'LONG'; col.pw = 210; col.mg = 0; $('csz').value = 'LONG'; $('cmg').value = 0;
  } else if (col.sz === 'LONG') {
    col.sz = 'A4'; col.ori = 'p'; colDims(); col.mg = 10; $('csz').value = 'A4'; $('cmg').value = 10;
  }
  const r = colArrange(all, k, col.pw, col.ph, col.mg);
  col.pages = r.pages; col.ph = r.ph; col.mg = r.mg; col.pi = 0; col.sel = null; col.lay = k; col.dirty = true;
  oriUi();
  colRender();
}

function colResize(old) {
  const sx = col.pw / old[0], sy = col.ph / old[1], s = Math.min(sx, sy);
  col.pages.forEach(p => p.items.forEach(i => { i.cx *= sx; i.cy *= sy; i.w *= s; i.h *= s; }));
  col.dirty = true;
  oriUi();
  colRender();
}

function colSize() {
  const v = $('csz').value;
  if (!col) return;
  if (col.sz === 'LONG' && v !== 'LONG') {
    col.sz = v; col.ori = 'p'; colDims(); col.mg = 10; $('cmg').value = 10; colLayout('fit1'); return;
  }
  const old = [col.pw, col.ph];
  col.sz = v;
  colDims();
  colResize(old);
}

function colOri(o) {
  if (!col) return;
  if (col.sz === 'LONG') return toast('Uzun görselde yön seçilemez');
  const old = [col.pw, col.ph];
  col.ori = o;
  colDims();
  colResize(old);
}

function colMargin(v) {
  col.mg = +v;
  colRender();
}

function colPos(it) {
  const el = $('ci-' + it.id);
  if (!el) return;
  const k = colK;
  el.style.cssText = `left:${(it.cx - it.w / 2) * k}px;top:${(it.cy - it.h / 2) * k}px;width:${it.w * k}px;height:${it.h * k}px;transform:rotate(${it.rot}deg);box-shadow:${it.bw ? `0 0 0 ${it.bw * k}px #000` : 'none'}`;
}

function colRender() {
  if (!col) return;
  const st = $('cstage'), pg = $('cpg'), P = col.pages[col.pi];
  colK = Math.max(0.15, Math.min((st.clientWidth - 70) / col.pw, (st.clientHeight - 70) / col.ph));
  pg.style.width = col.pw * colK + 'px';
  pg.style.height = col.ph * colK + 'px';
  pg.innerHTML = col.mg ? `<div class="cmg" style="inset:${col.mg * colK}px"></div>` : '';
  P.items.forEach(it => {
    const el = document.createElement('div'), on = col.sel === it.id;
    el.id = 'ci-' + it.id;
    el.dataset.id = it.id;
    el.className = 'cit' + (on ? ' on' : '');
    el.innerHTML = `<img src="${it.url}" alt="" style="filter:${FL[it.flt] || 'none'}">` +
      (on ? '<i class="hrl"></i><i class="hd hr" data-h="r"></i><i class="hd" data-h="s" style="left:-8px;top:-8px;cursor:nwse-resize"></i><i class="hd" data-h="s" style="right:-8px;top:-8px;cursor:nesw-resize"></i><i class="hd" data-h="s" style="left:-8px;bottom:-8px;cursor:nesw-resize"></i><i class="hd" data-h="s" style="right:-8px;bottom:-8px;cursor:nwse-resize"></i>' : '');
    pg.appendChild(el);
    colPos(it);
  });
  colPages();
  colProps();
  colList();
}

function colList() {
  $('clist').innerHTML = files.filter(f => f.type === 'image').map(f =>
    `<div class="clt" title="${esc(f.name)}" style="background-image:url('${f.thumb || f.url}')" onclick="colAdd('${f.id}')"></div>`
  ).join('') || '<div class="mu sm">Klasörde görsel yok</div>';
}

async function colAdd(fid) {
  const f = get(fid);
  if (!f || !col) return;
  const it = await colMake(f);
  colContain(it, col.mg, col.mg, col.pw - 2 * col.mg, col.ph - 2 * col.mg);
  it.w *= 0.6;
  it.h *= 0.6;
  col.pages[col.pi].items.push(it);
  col.sel = it.id;
  col.dirty = true;
  colRender();
}

function colPages() {
  $('cpages').innerHTML = col.pages.map((p, i) =>
    `<button class="btn sm ${i === col.pi ? 'on' : ''}" onclick="colGo(${i})">Sayfa ${i + 1} <span class="mu">(${p.items.length})</span></button>`
  ).join('') +
  `<button class="btn sm" onclick="colPg(1)"><i class="fa-solid fa-plus"></i>Sayfa Ekle</button>` +
  `<button class="btn sm" title="Sayfayı sola taşı" onclick="colMv(-1)"><i class="fa-solid fa-arrow-left"></i></button>` +
  `<button class="btn sm" title="Sayfayı sağa taşı" onclick="colMv(1)"><i class="fa-solid fa-arrow-right"></i></button>` +
  `<button class="btn sm dg" onclick="colPg(-1)"><i class="fa-solid fa-trash-can"></i>Sayfayı Sil</button>`;
}

function colGo(i) {
  col.pi = i;
  col.sel = null;
  colRender();
}

function colPg(d) {
  if (d > 0) {
    col.pages.push({ items: [] });
    col.pi = col.pages.length - 1;
  } else {
    if (col.pages.length < 2) return toast('En az bir sayfa kalmalı');
    if (col.pages[col.pi].items.length && !confirm('Bu sayfadaki görseller silinecek. Emin misiniz?')) return;
    col.pages.splice(col.pi, 1);
    col.pi = Math.max(0, col.pi - 1);
  }
  col.sel = null;
  col.dirty = true;
  colRender();
}

function colMv(d) {
  const j = col.pi + d;
  if (j < 0 || j >= col.pages.length) return;
  const t = col.pages[col.pi];
  col.pages[col.pi] = col.pages[j];
  col.pages[j] = t;
  col.pi = j;
  col.dirty = true;
  colRender();
}

function colProps() {
  const it = colSelItem(), el = $('cprop');
  if (!it) {
    el.innerHTML = '<h4>Özellikler</h4><div class="mu" style="line-height:1.75">Bir görsele tıklayın.<br><br><b style="color:#cbd5e1">İpuçları</b><br>• Sürükleyerek taşıyın<br>• Köşeden ölçekleyin<br>• Üstteki daireden döndürün (Shift: 15°)<br>• Alt tuşu hizalamayı kapatır<br>• Oklar: 1 mm (Shift: 5 mm)<br>• Del: sil · Ctrl+D: kopyala</div>';
    return;
  }
  const pgs = col.pages.map((p, i) => i === col.pi ? '' : `<option value="${i}">Sayfa ${i + 1}</option>`).join('');
  el.innerHTML = `<h4>Yerleşim</h4><div class="g"><button class="btn sm" onclick="colFit('fit')">Sığdır</button><button class="btn sm" onclick="colFit('fill')">Doldur</button><button class="btn sm" onclick="colFit('mid')">Ortala</button></div>
  <h4>Boyut ve açı</h4><label class="mu">Genişlik (mm)<input type="number" min="5" step="1" value="${Math.round(it.w)}" onchange="colSet('w',this.value)"></label>
  <label class="mu">Açı (°)<input type="number" step="1" value="${Math.round(it.rot)}" onchange="colSet('rot',this.value)"></label>
  <div class="g"><button class="btn sm" onclick="colSet('rot',${it.rot - 90})">⟲ 90°</button><button class="btn sm" onclick="colSet('rot',${it.rot + 90})">⟳ 90°</button></div>
  <h4>Görünüm</h4><label class="mu">Filtre<select onchange="colSet('flt',this.value)"><option value="none">Orijinal</option><option value="gray" ${it.flt === 'gray' ? 'selected' : ''}>Gri</option><option value="scan" ${it.flt === 'scan' ? 'selected' : ''}>Net evrak</option></select></label>
  <label class="mu">Çerçeve<select onchange="colSet('bw',this.value)"><option value="0">Yok</option><option value="0.3" ${it.bw === 0.3 ? 'selected' : ''}>İnce</option><option value="0.8" ${it.bw === 0.8 ? 'selected' : ''}>Kalın</option></select></label>
  <button class="btn sm" onclick="colCrop()"><i class="fa-solid fa-crop-simple"></i>Kırp</button>
  <h4>Katman</h4><div class="g"><button class="btn sm" onclick="colZ(1)">Öne</button><button class="btn sm" onclick="colZ(-1)">Arkaya</button><button class="btn sm" onclick="colDup()">Kopyala</button><button class="btn sm dg" onclick="colDel()"><i class="fa-solid fa-trash-can"></i>Sil</button></div>
  ${pgs ? `<label class="mu">Başka sayfaya taşı<select onchange="colMove(this.value)"><option value="">Seçin...</option>${pgs}</select></label>` : ''}`;
}

function colSet(k, v) {
  const it = colSelItem();
  if (!it) return;
  if (k !== 'flt') v = +v;
  if (k === 'w') {
    if (!(v >= 5)) return;
    it.h = it.h * v / it.w;
    it.w = v;
  } else if (k === 'rot') {
    it.rot = ((v % 360) + 540) % 360 - 180;
  } else it[k] = v;
  col.dirty = true;
  colRender();
}

function colAllFlt(v) {
  if (!v || !col) return;
  col.pages.forEach(p => p.items.forEach(i => { i.flt = v; }));
  col.dirty = true;
  colRender();
}

function colFit(m) {
  const it = colSelItem();
  if (!it) return;
  const sw = Math.abs(it.rot - Math.round(it.rot / 90) * 90) < 0.5 && Math.abs(Math.round(it.rot / 90)) % 2 === 1,
        ar = sw ? 1 / it.ar : it.ar;
  let bx = col.mg, by = col.mg, bw = col.pw - 2 * col.mg, bh = col.ph - 2 * col.mg;
  if (m === 'fill') { bx = 0; by = 0; bw = col.pw; bh = col.ph; }
  if (m !== 'mid') {
    let vw, vh;
    if (m === 'fill' ? bw / bh > ar : bw / bh <= ar) { vw = bw; vh = bw / ar; }
    else { vh = bh; vw = bh * ar; }
    it.w = sw ? vh : vw;
    it.h = sw ? vw : vh;
  }
  it.cx = bx + bw / 2;
  it.cy = by + bh / 2;
  col.dirty = true;
  colRender();
}

function colZ(d) {
  const a = col.pages[col.pi].items, i = a.findIndex(x => x.id === col.sel), j = i + d;
  if (i < 0 || j < 0 || j >= a.length) return;
  const t = a[i]; a[i] = a[j]; a[j] = t;
  col.dirty = true;
  colRender();
}

function colDup() {
  const it = colSelItem();
  if (!it) return;
  const n = { ...it, id: rid(5), cx: it.cx + 6, cy: it.cy + 6 };
  col.pages[col.pi].items.push(n);
  col.sel = n.id;
  col.dirty = true;
  colRender();
}

function colDel() {
  const a = col.pages[col.pi].items, i = a.findIndex(x => x.id === col.sel);
  if (i < 0) return;
  a.splice(i, 1);
  col.sel = null;
  col.dirty = true;
  colRender();
}

function colMove(j) {
  j = +j;
  const it = colSelItem();
  if (!it || isNaN(j) || !col.pages[j]) return;
  const a = col.pages[col.pi].items;
  a.splice(a.indexOf(it), 1);
  col.pages[j].items.push(it);
  col.sel = null;
  col.dirty = true;
  colRender();
}

function colCrop() {
  const it = colSelItem();
  if (!it) return;
  ed = { ci: it, name: 'kolaj.jpg' };
  edF = 'none';
  $('edx').classList.add('hidden');
  $('cri').src = it.url;
  show('edm', 1);
  if (cr) cr.destroy();
  cr = new Cropper($('cri'), { viewMode: 1, autoCropArea: 0.95 });
}

async function colCropDone(it, nb) {
  const bm = await createImageBitmap(nb), ar = bm.width / bm.height;
  if (bm.close) bm.close();
  it.blob = nb;
  it.url = URL.createObjectURL(nb);
  it.ar = ar;
  it.h = it.w / ar;
  col.dirty = true;
  colRender();
}

function colKey(e) {
  if (!col || $('edm').classList.contains('on')) return;
  if (e.key === 'Escape') { col.sel = null; colRender(); return; }
  const it = colSelItem();
  if (!it) return;
  const st = e.shiftKey ? 5 : 1,
        m = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
  if (m) {
    e.preventDefault();
    it.cx += m[0];
    it.cy += m[1];
    col.dirty = true;
    colPos(it);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    colDel();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    colDup();
  }
}

function colGuides(r) {
  const pg = $('cpg');
  pg.querySelectorAll('.gd').forEach(x => x.remove());
  if (!r) return;
  const k = colK;
  if (r.gx != null) {
    const d = document.createElement('div');
    d.className = 'gd';
    d.style.cssText = `left:${r.gx * k}px;top:0;width:1px;height:100%`;
    pg.appendChild(d);
  }
  if (r.gy != null) {
    const d = document.createElement('div');
    d.className = 'gd';
    d.style.cssText = `top:${r.gy * k}px;left:0;height:1px;width:100%`;
    pg.appendChild(d);
  }
}

function colInit() {
  if (colRO) return;
  const st = $('cstage');
  colRO = new ResizeObserver(() => {
    if (col && $('colm').classList.contains('on')) colRender();
  });
  colRO.observe(st);

  st.addEventListener('pointerdown', e => {
    if (!col) return;
    const el = e.target.closest('.cit');
    if (!el) {
      if (col.sel) { col.sel = null; colRender(); }
      return;
    }
    e.preventDefault();
    const id = el.dataset.id,
          it = col.pages[col.pi].items.find(i => i.id === id),
          mode = e.target.dataset.h || 'move';
    if (!it) return;
    if (col.sel !== id) { col.sel = id; colRender(); }
    const pr = $('cpg').getBoundingClientRect(),
          k = colK,
          ccx = pr.left + it.cx * k,
          ccy = pr.top + it.cy * k;
    const S = {
      x: e.clientX, y: e.clientY,
      cx: it.cx, cy: it.cy,
      w: it.w, h: it.h,
      rot: it.rot,
      d: Math.hypot(e.clientX - ccx, e.clientY - ccy) || 1,
      a: Math.atan2(e.clientY - ccy, e.clientX - ccx)
    };
    const mv = ev => {
      if (mode === 'move') {
        let cx = S.cx + (ev.clientX - S.x) / k,
            cy = S.cy + (ev.clientY - S.y) / k;
        colGuides();
        if (!ev.altKey) {
          const r = colSnap(it, cx, cy);
          cx = r.cx; cy = r.cy;
          colGuides(r);
        }
        it.cx = cx; it.cy = cy;
      } else if (mode === 's') {
        const f = Math.max(0.05, Math.hypot(ev.clientX - ccx, ev.clientY - ccy) / S.d);
        it.w = Math.max(6, S.w * f);
        it.h = it.w * (S.h / S.w);
      } else {
        let r = S.rot + (Math.atan2(ev.clientY - ccy, ev.clientX - ccx) - S.a) * 180 / Math.PI;
        r = ((r % 360) + 540) % 360 - 180;
        const q = Math.round(r / 90) * 90;
        if (Math.abs(r - q) < 4) r = q;
        else if (ev.shiftKey) r = Math.round(r / 15) * 15;
        it.rot = Math.round(r * 10) / 10;
      }
      col.dirty = true;
      colPos(it);
    };
    const up = () => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      colGuides();
      colProps();
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  });
}

async function colBake(it, dpi) {
  const bm = await createImageBitmap(it.blob),
        tw = Math.max(16, Math.min(bm.width, Math.round(it.w / 25.4 * dpi))),
        th = Math.max(16, Math.round(tw / it.ar)),
        c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const x = c.getContext('2d');
  x.filter = FL[it.flt] || 'none';
  x.drawImage(bm, 0, 0, tw, th);
  if (bm.close) bm.close();
  return toBlob(c, 0.92);
}

async function colPdf() {
  const out = await PDFLib.PDFDocument.create(), mm = 72 / 25.4;
  for (const pg of col.pages) {
    const P = out.addPage([col.pw * mm, col.ph * mm]);
    for (const it of pg.items) {
      const img = await out.embedJpg(await (await colBake(it, 250)).arrayBuffer()),
            o = colOrigin(it.cx, it.cy, it.w, it.h, it.rot, col.ph);
      P.drawImage(img, { x: o.x * mm, y: o.y * mm, width: it.w * mm, height: it.h * mm, rotate: PDFLib.degrees(-it.rot) });
      if (it.bw) {
        const b = it.bw, o2 = colOrigin(it.cx, it.cy, it.w + b, it.h + b, it.rot, col.ph);
        P.drawRectangle({
          x: o2.x * mm, y: o2.y * mm, width: (it.w + b) * mm, height: (it.h + b) * mm,
          rotate: PDFLib.degrees(-it.rot), borderWidth: b * mm, borderColor: PDFLib.rgb(0, 0, 0)
        });
      }
    }
  }
  await addFile({
    name: `Kolaj_${Date.now()}.pdf`,
    mime: 'application/pdf',
    blob: new Blob([await out.save()], { type: 'application/pdf' }),
    sender: 'Stüdyo',
    color: PAL[2]
  });
  toast('PDF oluşturuldu ve klasöre kaydedildi');
}

async function colJpg() {
  const dpi = +$('cdp').value,
        pxmm = dpi / 25.4,
        m = pxmm * Math.min(1, 16000 / Math.max(col.pw * pxmm, col.ph * pxmm)),
        stamp = Date.now();
  for (let pi = 0; pi < col.pages.length; pi++) {
    const c = document.createElement('canvas');
    c.width = Math.round(col.pw * m);
    c.height = Math.round(col.ph * m);
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    for (const it of col.pages[pi].items) {
      const bm = await createImageBitmap(it.blob);
      x.save();
      x.translate(it.cx * m, it.cy * m);
      x.rotate(it.rot * Math.PI / 180);
      x.filter = FL[it.flt] || 'none';
      x.drawImage(bm, -it.w * m / 2, -it.h * m / 2, it.w * m, it.h * m);
      x.filter = 'none';
      if (it.bw) {
        x.lineWidth = it.bw * m;
        x.strokeStyle = '#000';
        x.strokeRect(-(it.w + it.bw) * m / 2, -(it.h + it.bw) * m / 2, (it.w + it.bw) * m, (it.h + it.bw) * m);
      }
      x.restore();
      if (bm.close) bm.close();
    }
    await addFile({
      name: `Kolaj_${stamp}_${pi + 1}.jpg`,
      mime: 'image/jpeg',
      blob: await toBlob(c, 0.92),
      sender: 'Stüdyo',
      color: PAL[2]
    });
  }
  toast(col.pages.length + ' JPG klasöre kaydedildi');
}

async function colExport(t) {
  if (!col) return;
  if (!col.pages.some(p => p.items.length)) return toast('Sayfada görsel yok');
  toast('Hazırlanıyor...');
  try {
    t === 'pdf' ? await colPdf() : await colJpg();
    col.dirty = false;
  } catch (e) {
    toast('Dışa aktarılamadı: ' + (e.message || e));
  }
}
