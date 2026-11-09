/* ==========================================================================
   TonoScan - Yerel Depolama (IndexedDB) ve Dosya Yönetimi
   ========================================================================== */

let idb;

const idbOpen = () => new Promise((res, rej) => {
  const r = indexedDB.open('tonoscan', 2);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
  };
  r.onsuccess = () => { idb = r.result; res(); };
  r.onerror = () => rej(r.error);
});

const idbTx = (m, fn) => new Promise((res, rej) => {
  const t = idb.transaction('files', m), s = t.objectStore('files'), q = fn(s);
  t.oncomplete = () => res(q && q.result);
  t.onerror = () => rej(t.error);
});

const kvPut = (k, v) => new Promise(r => {
  const t = idb.transaction('kv', 'readwrite');
  t.objectStore('kv').put(v, k);
  t.oncomplete = r;
  t.onerror = r;
});

const kvGet = k => new Promise(r => {
  const q = idb.transaction('kv').objectStore('kv').get(k);
  q.onsuccess = () => r(q.result);
  q.onerror = () => r(null);
});

const idbPut = f => {
  const { url, fresh, ...r } = f;
  return idbTx('readwrite', s => s.put(r));
};

const idbDel = id => idbTx('readwrite', s => s.delete(id));
const idbClear = () => idbTx('readwrite', s => s.clear());
const idbAll = () => idbTx('readonly', s => s.getAll());

/* Küçük resim oluşturma */
async function makeThumb(f) {
  try {
    if (f.mime.startsWith('image/')) {
      f.type = 'image';
      const b = await createImageBitmap(f.blob);
      const s = Math.min(1, 400 / Math.max(b.width, b.height));
      const c = document.createElement('canvas');
      c.width = b.width * s;
      c.height = b.height * s;
      c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
      f.thumb = c.toDataURL('image/jpeg', 0.7);
    } else if (f.mime === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      f.type = 'pdf';
      const d = await pdfjsLib.getDocument({ data: new Uint8Array(await f.blob.arrayBuffer()) }).promise;
      f.pages = d.numPages;
      const pg = await d.getPage(1);
      const v = pg.getViewport({ scale: 0.5 });
      const c = document.createElement('canvas');
      c.width = v.width;
      c.height = v.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      f.thumb = c.toDataURL('image/jpeg', 0.7);
    } else if (f.mime.startsWith('video/')) {
      f.type = 'video';
    }
  } catch (e) {}
}

/* Yeni dosya ekleme */
async function addFile({ name, mime, blob, sender, color }) {
  const f = {
    id: rid(8),
    name,
    mime: mime || blob.type || 'application/octet-stream',
    size: blob.size,
    blob,
    sender,
    color,
    time: Date.now(),
    type: 'other',
    fresh: true
  };
  await makeThumb(f);
  f.url = URL.createObjectURL(blob);
  files.unshift(f);
  await idbPut(f);
  if (typeof render === 'function') render();
  if (typeof storInfo === 'function') storInfo();
  setTimeout(() => { f.fresh = false; }, 900);
  if (f.sender !== 'Bu Bilgisayar' && typeof dirSave === 'function') {
    dirSave(f);
  }
  return f;
}

const get = id => files.find(f => f.id === id);
