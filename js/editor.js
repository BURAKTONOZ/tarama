/* ==========================================================================
   TonoScan - Görsel Düzenleyici ve Görsel Birleştirme
   ========================================================================== */

/* ---------- Çoklu Görsel Birleştirme (Seçim Sırasına Göre Alt Alta) ---------- */
async function mergeJPG() {
  const s = sel.map(get).filter(f => f && f.type === 'image');
  if (s.length < 2) return toast('En az 2 görsel seçin');
  const im = await Promise.all(s.map(f => createImageBitmap(f.blob)));
  const w = Math.max(...im.map(i => i.width));
  const hs = im.map(i => i.height * w / i.width);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hs.reduce((a, b) => a + b, 0);
  const x = c.getContext('2d');
  let y = 0;
  im.forEach((i, k) => {
    x.drawImage(i, 0, y, w, hs[k]);
    y += hs[k];
  });
  await addFile({
    name: `Birlesik_Gorsel_${Date.now()}.jpg`,
    mime: 'image/jpeg',
    blob: await toBlob(c, 0.92),
    sender: 'Stüdyo',
    color: PAL[2]
  });
  sel = [];
  render();
  toast('Görseller alt alta birleştirildi');
}

/* ---------- Tek Görsel Düzenleyici (Kırpma, Döndürme, Filtre) ---------- */
function edit(id) {
  ed = get(id);
  edF = 'none';
  $('edx').classList.remove('hidden');
  $('efit').value = localStorage.ts_fit || 'fit';
  $('cri').src = ed.url;
  show('edm', 1);
  if (cr) cr.destroy();
  cr = new Cropper($('cri'), { viewMode: 1, autoCropArea: 0.95 });
}

async function edPdf() {
  if (!cr || !ed || ed.ci) return;
  toast('PDF hazırlanıyor...');
  const s = cr.getCroppedCanvas({ maxWidth: 4000, maxHeight: 4000 });
  const c = document.createElement('canvas');
  c.width = s.width;
  c.height = s.height;
  const x = c.getContext('2d');
  x.filter = edF === 'gray' ? 'grayscale(1)' : edF === 'scan' ? 'grayscale(1) contrast(1.85) brightness(1.12)' : 'none';
  x.drawImage(s, 0, 0);

  const out = await PDFLib.PDFDocument.create();
  const img = await out.embedJpg(await (await toBlob(c, 0.92)).arrayBuffer());
  const fm = $('efit').value;

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

  await addFile({
    name: ed.name.replace(/\.\w+$/, '') + '.pdf',
    mime: 'application/pdf',
    blob: new Blob([await out.save()], { type: 'application/pdf' }),
    sender: ed.sender,
    color: ed.color
  });
  closeEd();
  toast('PDF oluşturuldu ve klasöre kaydedildi');
}

function setEdF(k) {
  edF = k;
  const b = document.querySelector('.cropper-container');
  if (b) {
    b.style.filter = k === 'gray' ? 'grayscale(1)' : k === 'scan' ? 'grayscale(1) contrast(1.85) brightness(1.12)' : 'none';
  }
}

async function saveEd(copy) {
  if (!cr || !ed) return;
  const s = cr.getCroppedCanvas({ maxWidth: 4000, maxHeight: 4000 });
  const c = document.createElement('canvas');
  c.width = s.width;
  c.height = s.height;
  const x = c.getContext('2d');
  x.filter = edF === 'gray' ? 'grayscale(1)' : edF === 'scan' ? 'grayscale(1) contrast(1.85) brightness(1.12)' : 'none';
  x.drawImage(s, 0, 0);
  const nb = await toBlob(c, 0.92);
  const nn = ed.name.replace(/\.\w+$/, '') + '.jpg';

  if (ed.ci) {
    await colCropDone(ed.ci, nb);
    closeEd();
    return;
  }

  if (copy) {
    await addFile({
      name: 'Duzenlenen_' + nn,
      mime: 'image/jpeg',
      blob: nb,
      sender: ed.sender,
      color: ed.color
    });
  } else {
    URL.revokeObjectURL(ed.url);
    Object.assign(ed, {
      blob: nb,
      size: nb.size,
      mime: 'image/jpeg',
      name: nn,
      url: URL.createObjectURL(nb)
    });
    await makeThumb(ed);
    await idbPut(ed);
    render();
    storInfo();
  }
  closeEd();
}

function closeEd() {
  if (cr) cr.destroy();
  cr = null;
  show('edm', 0);
}
