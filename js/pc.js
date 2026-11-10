/* ==========================================================================
   TonoScan - PC Ana Yönetim ve Dosya Gezgini
   ========================================================================== */

const LOCAL_MAX = 5 * 1024 ** 3;
const delQ = {};

/* PC başlatma */
async function pcInit() {
  $('pc').classList.add('on');
  if (navigator.locks) {
    const got = await new Promise(r => navigator.locks.request('tonoscan-pc', { ifAvailable: true }, l => {
      if (!l) { r(false); return; }
      r(true);
      return new Promise(() => {});
    }));
    if (!got) {
      document.body.innerHTML = '<div style="height:100vh;display:grid;place-items:center;text-align:center;padding:24px;font-family:Inter,sans-serif;color:#e8eefb"><div><h2 style="margin-bottom:8px">TonoScan başka bir sekmede açık</h2><p style="color:#8795b0">Aynı anda tek sekme kullanılabilir. Diğer sekmeyi kapatıp bu sayfayı yenileyin.</p></div></div>';
      return;
    }
  }

  await idbOpen();
  files = (await idbAll()).sort((a, b) => b.time - a.time).map(r => ({ ...r, url: URL.createObjectURL(r.blob) }));

  $('grid').addEventListener('pointermove', e => {
    const c = e.target.closest('.card');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  pdInit();
  setFlt('all');
  storInfo();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  dirH = await kvGet('dir') || null;
  dirUi();
  autoClean();

  if (!localStorage.ts_room) {
    localStorage.ts_room = rid(16);
    localStorage.ts_key = rid(32);
    localStorage.ts_dev = '{}';
  }
  room = localStorage.ts_room;
  await initKey(localStorage.ts_key);

  const url = location.origin + location.pathname + '#r=' + room + '&k=' + localStorage.ts_key;
  window.joinUrl = url;

  new QRCode($('qr1'), { text: url, width: 170, height: 170, correctLevel: QRCode.CorrectLevel.M });
  new QRCode($('qr2'), { text: url, width: 280, height: 280, correctLevel: QRCode.CorrectLevel.M });

  try {
    await fbInit();
  } catch (e) {
    $('st').className = 'chip bad';
    $('st').textContent = trErr(e);
    return;
  }

  let conn = false;
  const meta = R('meta');
  const setMeta = () => {
    meta.onDisconnect().remove();
    meta.set({ u: firebase.auth().currentUser.uid, t: firebase.database.ServerValue.TIMESTAMP });
  };

  db.ref('.info/connected').on('value', s => {
    conn = !!s.val();
    const e = $('st');
    if (conn) {
      setMeta();
      e.className = 'chip ok';
      e.textContent = 'Şifreli köprü aktif';
    } else {
      e.className = 'chip bad';
      e.textContent = 'Bağlantı yok';
    }
  });

  meta.on('value', s => { if (!s.exists() && conn) setMeta(); });
  R('req').on('child_added', onReq);
  R('req').on('child_changed', onReq);
  R('req').on('child_removed', s => {
    const d = devs[s.key];
    if (d) { d.online = false; renderDevs(); }
  });
  R('inbox').on('child_added', onInbox);
  R('inbox').on('child_removed', s => abortRx(s.key));

  db.ref('usage/pool').on('value', x => { pool = x.val(); poolUi(); }, e => { poolErr = e.code || 'okuma hatası'; poolUi(); });
  setInterval(() => $('pool').classList.toggle('live', Object.keys(rx).length > 0), 800);
  setInterval(poolUi, 60000);
  poolUi();

  const dz = $('drop');
  dz.ondragover = e => e.preventDefault();
  dz.ondrop = e => {
    e.preventDefault();
    if (e.dataTransfer.files.length) pcFiles(e.dataTransfer.files);
  };

  renderDevs();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { unread = 0; document.title = baseT; }
  });

  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (pdOn()) { pdKey(e); return; }
    if ($('colm').classList.contains('on')) { colKey(e); return; }
    if ($('pvm').classList.contains('on')) {
      if (e.key === 'ArrowRight') pvNav(1);
      else if (e.key === 'ArrowLeft') pvNav(-1);
      else if (e.key === 'Escape') closePv();
      return;
    }
    if (e.key === 'Escape') {
      if ($('edm').classList.contains('on')) closeEd();
      document.querySelectorAll('.modal.on').forEach(m => m.classList.remove('on'));
      clearSel();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selAll();
    } else if (e.key === 'Delete' && sel.length) {
      delSel();
    }
  });

  document.addEventListener('paste', e => {
    const l = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (!l.length) return;
    pdOn() ? pdAddFiles(l) : pcFiles(l);
  });

  document.querySelector('.scroll').addEventListener('click', e => {
    if (sel.length && !e.target.closest('.card')) clearSel();
  });
}

const apr = () => JSON.parse(localStorage.ts_dev || '{}');

async function onReq(s) {
  const id = s.key;
  let i;
  try {
    i = JSON.parse(td.decode(await dec(s.val().e, 'hello:' + id)));
  } catch {
    return;
  }
  const reqName = (i.name || '').trim();

  // Çakışma kontrolü: Başka bir aktif online cihazda bu isim var mı?
  const hasConflict = Object.values(devs).some(d => d.id !== id && d.online && (d.name || '').trim().toLowerCase() === reqName.toLowerCase());

  if (hasConflict) {
    R('conflict/' + id).set({ conflict: true, name: reqName });
    toast('«' + reqName + '» adı başka bir cihaz tarafından kullanılıyor. Cihazdan yeni ad istendi.');
    return;
  } else {
    R('conflict/' + id).remove().catch(() => {});
  }

  const isNew = !devs[id] || !devs[id].online;
  const d = devs[id] || (devs[id] = { id, n: 0, color: PAL[Object.keys(devs).length % PAL.length] });
  Object.assign(d, i, { online: true });
  const a = apr()[id];
  if (a) R('dev/' + id).set(a);
  if (isNew) {
    show('qm', 0);
    toast('Yeni cihaz bağlandı: ' + (d.name || 'Telefon') + (a === 'ok' ? '' : ' — soldan izin verin'));
  }
  renderDevs();
}

function decide(id, v) {
  const a = apr();
  a[id] = v;
  localStorage.ts_dev = JSON.stringify(a);
  R('dev/' + id).set(v);
  renderDevs();
}

function renderDevs() {
  const a = apr(), v = Object.values(devs);
  $('dc').textContent = v.filter(d => d.online).length + ' aktif';
  $('dl').innerHTML = v.length ? v.map(d => {
    const s = a[d.id];
    return `<div class="dev" style="cursor:pointer" onclick="openFolder('${esc(d.name || '').replace(/'/g, "\\'")}')" title="Bu cihazın klasörünü aç">
      <div class="av" style="background:${d.color}22;color:${d.color}"><i class="fa-solid fa-mobile-screen"></i></div>
      <div style="min-width:0;flex:1">
        <div class="dr">
          <b class="nm"><span class="dot" style="background:${d.online ? '#34d399' : '#475569'}"></span>${esc(d.name || 'Cihaz')}</b>
          <span class="mu sm">${d.n} dosya</span>
        </div>
        <div class="mu sm">${esc(d.os || '')} • ${esc(d.model || '')}${d.online ? '' : ' • çevrimdışı'}</div>
        <div class="acts" style="margin-top:8px" onclick="event.stopPropagation()">
          ${s === 'ok' ? '<span class="chip ok">İzinli</span>' : `<button class="btn sm ok" onclick="decide('${d.id}','ok')">İzin ver</button>`}
          ${s === 'no' ? '<span class="chip bad">Engelli</span>' : `<button class="btn sm dg" onclick="decide('${d.id}','no')">Engelle</button>`}
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="mu sm" style="text-align:center;padding:14px 0"><i class="fa-solid fa-wifi" style="display:block;font-size:20px;margin-bottom:6px;opacity:.5"></i>Telefondan karekodu okutun.</div>';
}

function junk(key) {
  R('inbox/' + key).remove();
  R('chunks/' + key).remove();
}

async function onInbox(s) {
  const key = s.key, id = key.split('~')[0], v = s.val();
  if (rx[key]) return;
  if (apr()[id] !== 'ok') { junk(key); return; }
  let m;
  try {
    m = JSON.parse(td.decode(await dec(v.m, 'm:' + key)));
  } catch {
    junk(key);
    return;
  }
  if (!(m.size <= MAX) || !(v.n >= 1 && v.n <= 1400)) { junk(key); return; }
  const t = rx[key] = { m, n: v.n, parts: [], c: 0, id, ref: R('chunks/' + key) }, d = devs[id];
  prog(key, m.name, 0, d);
  t.fn = t.ref.on('child_added', async cs => {
    const i = +cs.key;
    if (!rx[key] || t.parts[i]) return;
    let b;
    try {
      b = await dec(cs.val(), key + ':' + i);
    } catch {
      cs.ref.remove();
      return;
    }
    if (t.parts[i]) return;
    t.parts[i] = b;
    t.c++;
    qAdd(cs.val().length);
    cs.ref.remove();
    R('acks/' + key).set(t.c);
    prog(key, m.name, Math.floor(t.c / t.n * 100), d);
    if (t.c === t.n) await fin(key);
  });
}

async function fin(key) {
  const t = rx[key];
  delete rx[key];
  t.ref.off('child_added', t.fn);
  R('inbox/' + key).remove();
  const blob = new Blob(t.parts, { type: t.m.mime });
  t.parts = null;
  if (blob.size !== t.m.size) {
    toast('Dosya doğrulanamadı: ' + t.m.name);
    $('tr-' + key)?.remove();
    return;
  }
  const d = devs[t.id];
  if (d) d.n++;
  if (files.some(x => x.name === t.m.name && x.size === blob.size)) {
    toast('Dikkat: «' + t.m.name + '» aynı ad ve boyutta daha önce gelmişti');
  }
  const nf = await addFile({
    name: t.m.name,
    mime: t.m.mime,
    blob,
    sender: d ? d.name : 'Telefon',
    color: d ? d.color : PAL[0]
  });
  notify(nf);
  setTimeout(() => $('tr-' + key)?.remove(), 400);
  renderDevs();
}

function abortRx(key) {
  const t = rx[key];
  if (!t) return;
  t.ref.off('child_added', t.fn);
  delete rx[key];
  $('tr-' + key)?.remove();
  toast('Aktarım yarıda kesildi: ' + t.m.name);
}

function prog(key, name, p, d) {
  let r = $('tr-' + key);
  if (!r) {
    r = document.createElement('div');
    r.id = 'tr-' + key;
    r.className = 'tr';
    $('inc').appendChild(r);
  }
  const c = d ? d.color : PAL[0];
  r.innerHTML = `<div class="l">
    <span class="nm"><i class="fa-solid fa-cloud-arrow-down" style="color:${c}"></i> ${esc(name)} <span class="mu sm">(${esc(d ? d.name : 'Telefon')})</span></span>
    <b style="color:${c}">${p}%</b>
  </div>
  <div class="pb"><div style="width:${p}%;background:${c}"></div></div>`;
}

function newRoom() {
  if (!confirm('Eski karekod geçersiz olur ve bağlı telefonlar ayrılır. Devam edilsin mi?')) return;
  db.ref('rooms/' + room).remove().finally(() => {
    ['ts_room', 'ts_key', 'ts_dev'].forEach(k => localStorage.removeItem(k));
    location.reload();
  });
}

function copyLink() {
  navigator.clipboard.writeText(window.joinUrl);
  toast('Bağlantı kopyalandı');
}

function storInfo() {
  const b = files.reduce((a, f) => a + f.size, 0),
        p = Math.min(100, b / LOCAL_MAX * 100),
        m = $('mtr');
  $('stor').textContent = 'Bu bilgisayarda: ' + fmt(b) + ' / 5 GB';
  m.style.width = Math.max(1, p) + '%';
  m.parentNode.className = 'meter' + (p >= 100 ? ' bad' : p >= 80 ? ' warn' : '');
  if (p >= 80 && !window._lw) {
    window._lw = 1;
    toast(p >= 100 ? 'Yerel depo sınırına ulaştınız (5 GB). Eski dosyaları silin.' : 'Yerel depo %80 doldu. Eski dosyaları silmeyi düşünün.');
  }
}

/* ---------- Gezgin ve Dosya Listesi ---------- */
function setFlt(k) {
  flt = k;
  ['all', 'image', 'pdf'].forEach(x => $('f-' + x).classList.toggle('on', x === k));
  render();
}

function openFolder(name) {
  curFolder = name;
  sel = [];
  render();
}

function render() {
  const q = $('q').value.toLowerCase();

  // Gönderen/cihaz bazlı gruplama
  const senderMap = {};
  files.forEach(f => {
    const s = f.sender || 'Bilinmeyen Cihaz';
    if (!senderMap[s]) senderMap[s] = { count: 0, color: f.color || PAL[0], lastTime: f.time, size: 0 };
    senderMap[s].count++;
    senderMap[s].size += f.size;
    if (f.time > senderMap[s].lastTime) senderMap[s].lastTime = f.time;
  });
  const senders = Object.keys(senderMap);

  // Ekmek kırıntısı (Breadcrumbs)
  const bc = $('bc');
  if (curFolder === 'all') {
    bc.innerHTML = `<i class="fa-solid fa-folder-open"></i>Gelen Evraklar<small id="cnt">${files.length}</small>
      <span id="hint0" class="mu sm ${files.length && !sel.length ? '' : 'hidden'}" style="margin-left:10px">
        <i class="fa-regular fa-hand-pointer"></i> Düzenlemek için dosyanın köşesindeki daireye tıklayın
      </span>`;
  } else {
    const cinf = senderMap[curFolder] || { count: 0, color: '#60a5fa' };
    bc.innerHTML = `<div class="breadcrumb">
      <a class="bc-link" onclick="openFolder('all')"><i class="fa-solid fa-folder"></i> Evraklar</a>
      <span class="bc-sep"><i class="fa-solid fa-chevron-right"></i></span>
      <span class="bc-cur"><i class="fa-solid fa-folder-open" style="color:${cinf.color}"></i> ${esc(curFolder)}</span>
      <small id="cnt">${cinf.count}</small>
    </div>`;
  }

  // Klasör Bölümü (#fsec)
  const fsec = $('fsec');
  if (fsec) {
    if (curFolder === 'all') {
      if (senders.length > 0) {
        fsec.innerHTML = `
          <div class="folder-grid">
            <div class="folder-card active" onclick="openFolder('all')">
              <div class="fc-icon"><i class="fa-solid fa-inbox"></i></div>
              <div class="fc-info">
                <div class="fc-title">Tüm Dosyalar</div>
                <div class="fc-count">${files.length} dosya · ${fmt(files.reduce((a, f) => a + f.size, 0))}</div>
              </div>
            </div>
            ${senders.map(s => {
              const inf = senderMap[s];
              return `<div class="folder-card" onclick="openFolder('${esc(s).replace(/'/g, "\\'")}')">
                <div class="fc-icon" style="background:${inf.color}22;color:${inf.color}"><i class="fa-solid fa-folder"></i></div>
                <div class="fc-info">
                  <div class="fc-title">${esc(s)}</div>
                  <div class="fc-count">${inf.count} dosya · ${fmt(inf.size)}</div>
                </div>
              </div>`;
            }).join('')}
          </div>`;
        fsec.style.display = 'block';
      } else {
        fsec.innerHTML = '';
        fsec.style.display = 'none';
      }
    } else {
      const inf = senderMap[curFolder] || { count: 0, size: 0, color: '#60a5fa' };
      fsec.innerHTML = `
        <div class="folder-banner">
          <div class="fb-info">
            <div class="fb-icon" style="background:${inf.color}22;color:${inf.color}"><i class="fa-solid fa-folder-open"></i></div>
            <div>
              <h3>${esc(curFolder)} Klasörü</h3>
              <p>${inf.count} dosya · ${fmt(inf.size)}</p>
            </div>
          </div>
          <button class="btn sm" onclick="openFolder('all')"><i class="fa-solid fa-arrow-left"></i> Tüm Dosyalar</button>
        </div>`;
      fsec.style.display = 'block';
    }
  }

  // Dosyaları filtrele
  const l = files.filter(f => {
    if (curFolder !== 'all' && f.sender !== curFolder) return false;
    if (flt !== 'all' && f.type !== flt) return false;
    if (q && !(f.name + f.sender).toLowerCase().includes(q)) return false;
    return true;
  });

  const so = $('srt').value;
  l.sort(so === 'o' ? (a, b) => a.time - b.time
       : so === 'n' ? (a, b) => a.name.localeCompare(b.name, 'tr')
       : so === 's' ? (a, b) => b.size - a.size
       : (a, b) => b.time - a.time);

  const emp = $('empty');
  emp.classList.toggle('hidden', l.length > 0 || (curFolder === 'all' && files.length > 0));
  const h2 = emp.querySelector('h2');
  if (h2) h2.textContent = curFolder !== 'all' ? 'Bu klasörde henüz dosya yok' : 'Klasör henüz boş';

  $('grid').innerHTML = l.map(f => {
    const n = sel.indexOf(f.id) + 1,
          ext = (f.name.split('.').pop() || '').slice(0, 5).toUpperCase();
    const lbl = f.type === 'pdf' ? `PDF · ${f.pages || '?'} sf` : f.type === 'video' ? 'VİDEO' : ext;
    return `<div class="card ${n ? 'sel' : ''} ${f.fresh ? 'new' : ''}" draggable="true" ondragstart="dragOut(event,'${f.id}')">
    <div class="th" onclick="prev('${f.id}')">
      ${f.thumb ? `<img src="${f.thumb}" alt="">` : `<i class="fa-solid ${f.type === 'video' ? 'fa-film' : 'fa-file-lines'} ico"></i>`}
      <div class="num" title="Seçim sırası" onclick="event.stopPropagation();tog('${f.id}')">${n || ''}</div>
      <span class="who" style="background:${f.color}33;color:${f.color}" title="${esc(f.sender)} (Klasörü aç)" onclick="event.stopPropagation();openFolder('${esc(f.sender).replace(/'/g, "\\'")}')">${esc(f.sender)}</span>
      <span class="tag ${f.type === 'pdf' ? 'pdf' : ''}">${esc(lbl)}</span>
    </div>
    <div class="ci" onclick="tog('${f.id}')" style="cursor:pointer">
      <div class="nm" title="${esc(f.name)} (çift tıkla: yeniden adlandır)" ondblclick="renameFile('${f.id}')">${esc(f.name)}</div>
      <div class="meta"><span>${fmt(f.size)}</span><span>${new Date(f.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span></div>
    </div>
    <div class="cact">
      ${f.type === 'image' || f.type === 'pdf' ? `<button class="cab" title="${f.type === 'pdf' ? 'Sayfa düzenleyicide aç' : 'Görsel düzenleyicide aç'}" onclick="event.stopPropagation();${f.type === 'pdf' ? `pdOpen(['${f.id}'])` : `edit('${f.id}')`}"><i class="fa-solid fa-pen-to-square"></i>Düzenle</button>` : ''}
      <button class="cab" title="İndir" onclick="event.stopPropagation();dl('${f.id}')"><i class="fa-solid fa-download"></i>İndir</button>
      <button class="cab dg" title="Sil" onclick="event.stopPropagation();del('${f.id}')"><i class="fa-solid fa-trash-can"></i>Sil</button>
    </div></div>`;
  }).join('');
  renderBar();
}

function renderBar() {
  const it = sel.map(get).filter(Boolean), n = it.length;
  $('hint0').classList.toggle('hidden', !(files.length && !n));
  $('selbar').classList.toggle('on', n > 0);
  if (!n) { $('strip').innerHTML = ''; return; }
  const im = it.filter(f => f.type === 'image'),
        pd = it.filter(f => f.type === 'pdf'),
        ot = n - im.length - pd.length;
  const B = (id, cls, ic, tx, fn, c) => `<button id="${id}" class="btn ${cls}" onclick="${fn}"><i class="fa-solid ${ic}"${c ? ` style="color:${c}"` : ''}></i>${tx}</button>`;
  const fv = localStorage.ts_fit || 'fit';
  const fit = `<select id="pfit" class="btn sm" onchange="localStorage.ts_fit=this.value" title="Görselleri PDF sayfasına yerleştirme biçimi">
    <option value="fit" ${fv === 'fit' ? 'selected' : ''}>PDF: Sığdır</option>
    <option value="fill" ${fv === 'fill' ? 'selected' : ''}>PDF: Doldur</option>
    <option value="orig" ${fv === 'orig' ? 'selected' : ''}>PDF: Orijinal Oran</option>
  </select>`;
  let title, hint, tools = '';
  if (ot) {
    title = n + ' dosya seçili';
    hint = 'Bu dosya türleri için indirme ve silme kullanılabilir';
  } else if (!pd.length) {
    // Sadece görsel(ler) seçili
    if (n === 1) {
      title = '1 görsel seçili';
      hint = 'Kırpma ve filtre için Düzenle veya doğrudan PDF yapın';
      tools = B('bedit', '', 'fa-pen-to-square', 'Düzenle', `edit('${im[0].id}')`, '#60a5fa') +
              fit +
              B('bpdf', 'ok', 'fa-file-pdf', "PDF'e Dönüştür", 'pdOpen(sel)');
    } else {
      title = n + ' görsel seçili';
      hint = 'Seçim sırasıyla tek PDF oluşturun veya Kolaj hazırlayın (küçük resimleri sürükleyerek sıralayabilirsiniz)';
      tools = fit +
              B('bpdf', 'ok', 'fa-file-pdf', 'PDF Dönüştür', 'pdOpen(sel)') +
              B('bcol', '', 'fa-table-cells-large', 'Kolaj / Sayfa', 'colOpen()', '#c4b5fd');
    }
  } else if (!im.length) {
    // Sadece PDF(ler) seçili
    if (n === 1) {
      title = '1 PDF seçili';
      hint = 'Sayfaları sırala, döndür, kes, sil, ayır';
      tools = B('bpg', 'ok', 'fa-file-pen', 'Sayfa Düzenleyici', `pdOpen(['${pd[0].id}'])`, '#fbbf24');
    } else {
      title = n + ' PDF seçili';
      hint = 'Seçim sırasıyla sayfaları birleştirin ve düzenleyin';
      tools = B('bpdf', 'ok', 'fa-object-group', 'PDF Birleştir', 'pdOpen(sel)');
    }
  } else {
    // Karışık: Görsel(ler) + PDF(ler)
    title = im.length + ' görsel + ' + pd.length + ' PDF seçili (' + n + ' dosya)';
    hint = 'Tüm görsel ve PDF sayfaları seçim sırasına göre tek PDF olarak birleşir';
    tools = fit + B('bpdf', 'ok', 'fa-file-circle-plus', 'PDF Dönüştür / Birleştir', 'pdOpen(sel)');
  }
  tools += B('bdl', 'pri', 'fa-download', n > 1 ? 'ZIP İndir' : 'İndir', 'dlSel()') +
           B('bdel', 'dg', 'fa-trash-can', 'Sil', 'delSel()') +
           '<button class="btn" title="Seçimi temizle" onclick="clearSel()"><i class="fa-solid fa-xmark"></i></button>';
  $('selc').textContent = title;
  $('selh').textContent = hint;
  $('stools').innerHTML = tools;
  $('strip').innerHTML = n > 1 ? it.map((f, i) =>
    `<div class="sti" draggable="true" style="background-image:url('${f.thumb || ''}')" title="${esc(f.name)}" ondragstart="stDrag(event,${i})" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="stDrop(event,${i})"><b>${i + 1}</b></div>`
  ).join('') : '';
}

function dragOut(e, id) {
  const f = get(id);
  e.dataTransfer.setData('DownloadURL', `${f.mime}:${f.name}:${f.url}`);
}

function tog(id) {
  const i = sel.indexOf(id);
  i >= 0 ? sel.splice(i, 1) : sel.push(id);
  render();
}

function selAll() {
  const visible = files.filter(f => curFolder === 'all' || f.sender === curFolder);
  const all = visible.length && visible.every(f => sel.includes(f.id));
  sel = all ? [] : [...visible].reverse().map(f => f.id);
  render();
}

function clearSel() {
  sel = [];
  render();
}

function dl(id) {
  const f = get(id), a = document.createElement('a');
  a.href = f.url;
  a.download = f.name;
  a.click();
}

async function dlSel() {
  const s = sel.map(get).filter(Boolean);
  if (!s.length) return toast('Dosya seçin');
  if (s.length === 1 || !window.JSZip) {
    return s.forEach((f, i) => setTimeout(() => dl(f.id), i * 300));
  }
  toast('ZIP hazırlanıyor...');
  const z = new JSZip(), used = {};
  s.forEach((f, i) => {
    let n = f.name;
    if (used[n]) n = (i + 1) + '_' + n;
    used[n] = 1;
    z.file(n, f.blob);
  });
  const b = await z.generateAsync({ type: 'blob', compression: 'STORE' }),
        a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'TonoScan_' + new Date().toISOString().slice(0, 10) + '.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function delMany(ids) {
  const gone = ids.map(get).filter(Boolean);
  if (!gone.length) return;
  const set = new Set(gone.map(f => f.id));
  files = files.filter(f => !set.has(f.id));
  sel = sel.filter(x => !set.has(x));
  render();
  const t = setTimeout(async () => {
    for (const f of gone) {
      URL.revokeObjectURL(f.url);
      await idbDel(f.id);
      delete delQ[f.id];
    }
    storInfo();
  }, 7000);
  gone.forEach(f => delQ[f.id] = t);
  undoToast(gone.length > 1 ? gone.length + ' dosya silindi' : '«' + gone[0].name + '» silindi', () => {
    clearTimeout(t);
    gone.forEach(f => delete delQ[f.id]);
    files.push(...gone);
    files.sort((a, b) => b.time - a.time);
    render();
    storInfo();
  });
}

function del(id) { delMany([id]); }
function delSel() { delMany([...sel]); }

function undoToast(m, fn) {
  const t = $('tt');
  t.innerHTML = esc(m) + ' <button class="btn sm" style="margin-left:10px" id="ub">Geri al</button>';
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 7000);
  $('ub').onclick = () => { fn(); t.classList.add('hidden'); };
}

async function clearAll() {
  if (!files.length || !confirm('Bu bilgisayardaki tüm dosyalar kalıcı olarak silinecek. Emin misiniz?')) return;
  files.forEach(f => URL.revokeObjectURL(f.url));
  files = [];
  sel = [];
  await idbClear();
  render();
  storInfo();
}

async function pcFiles(l) {
  for (const f of Array.from(l)) {
    await addFile({ name: f.name, mime: f.type, blob: f, sender: 'Bu Bilgisayar', color: PAL[1] });
  }
}

function prev(id) {
  const f = get(id);
  pvId = id;
  $('pvt').textContent = f.name;
  $('pvc').classList.toggle('hidden', f.type !== 'image');
  $('pvb').innerHTML = f.type === 'image' ? `<img src="${f.url}" style="max-width:100%;max-height:100%;border-radius:12px">`
                     : f.type === 'pdf' ? `<iframe src="${f.url}" style="width:100%;height:100%;border:0;border-radius:12px;background:#fff"></iframe>`
                     : f.type === 'video' ? `<video src="${f.url}" controls style="max-width:100%;max-height:100%"></video>`
                     : `<button class="btn pri" onclick="dl('${f.id}')"><i class="fa-solid fa-download"></i>Dosyayı İndir (${fmt(f.size)})</button>`;
  show('pvm', 1);
}

function stDrag(e, i) {
  dragI = i;
  e.dataTransfer.effectAllowed = 'move';
}

function stDrop(e, j) {
  e.preventDefault();
  if (dragI < 0 || dragI === j) return;
  const x = sel.splice(dragI, 1)[0];
  sel.splice(j, 0, x);
  dragI = -1;
  render();
}

function pvNav(d) {
  const l = files.filter(f => flt === 'all' || f.type === flt),
        i = l.findIndex(f => f.id === pvId);
  if (i < 0) return;
  prev(l[(i + d + l.length) % l.length].id);
}

function closePv() {
  show('pvm', 0);
  $('pvb').innerHTML = '';
  pvId = null;
}

async function copyImg() {
  const f = get(pvId);
  if (!f) return;
  try {
    const b = await createImageBitmap(f.blob), c = document.createElement('canvas');
    c.width = b.width;
    c.height = b.height;
    c.getContext('2d').drawImage(b, 0, 0);
    const pb = await new Promise(r => c.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pb })]);
    toast('Görsel panoya kopyalandı');
  } catch (e) {
    toast('Kopyalanamadı');
  }
}

async function renameFile(id) {
  const f = get(id), n = prompt('Yeni ad:', f.name);
  if (!n || !n.trim()) return;
  f.name = n.trim();
  await idbPut(f);
  render();
}

async function scanSel() {
  const s = sel.map(get).filter(f => f && f.type === 'image');
  if (!s.length) return;
  toast('Net evrak uygulanıyor...');
  for (const f of s) {
    const b = await createImageBitmap(f.blob), c = document.createElement('canvas');
    c.width = b.width;
    c.height = b.height;
    const x = c.getContext('2d');
    x.filter = 'grayscale(1) contrast(1.85) brightness(1.12)';
    x.drawImage(b, 0, 0);
    const nb = await toBlob(c, 0.92);
    URL.revokeObjectURL(f.url);
    Object.assign(f, { blob: nb, size: nb.size, mime: 'image/jpeg', url: URL.createObjectURL(nb) });
    await makeThumb(f);
    await idbPut(f);
  }
  render();
  storInfo();
  toast(s.length + ' görsele net evrak filtresi uygulandı');
}

function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(),
          o = a.createOscillator(),
          g = a.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.12, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.25);
    o.connect(g);
    g.connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.25);
  } catch (e) {}
}

function notify(f) {
  if (document.hidden) {
    unread++;
    document.title = '(' + unread + ' yeni) ' + baseT;
  }
  beep();
}
