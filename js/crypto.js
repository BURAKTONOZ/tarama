/* ==========================================================================
   TonoScan - Şifreleme ve Firebase Bağlantısı
   ========================================================================== */

/* AES-256-GCM uçtan uca şifreleme; parça sırası AAD'ye bağlıdır */
async function initKey(k) {
  K = await crypto.subtle.importKey('raw', un64u(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function enc(d, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(aad) },
    K,
    typeof d === 'string' ? te.encode(d) : d
  ));
  const o = new Uint8Array(12 + ct.length);
  o.set(iv);
  o.set(ct, 12);
  return b64(o);
}

async function dec(s, aad) {
  const u = unb64(s);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: u.subarray(0, 12), additionalData: te.encode(aad) },
    K,
    u.subarray(12)
  );
}

/* Firebase başlatma ve isimsiz oturum açma */
async function fbInit() {
  firebase.initializeApp(FB);
  if (APPCHECK_KEY && firebase.appCheck) {
    firebase.appCheck().activate(APPCHECK_KEY, true);
  }
  await firebase.auth().signInAnonymously();
  db = firebase.database();
}

const R = p => db.ref(`rooms/${room}/${p}`);

/* Hata mesajı çözümleyici */
function trErr(e) {
  const c = (e && (e.code || e.message)) || '';
  return /operation-not-allowed|admin-restricted/.test(c)
    ? 'Anonymous giriş kapalı (Firebase → Authentication)'
    : /network|offline/.test(c)
    ? 'İnternet bağlantısı yok'
    : /unauthorized-domain/.test(c)
    ? "Bu alan adı Firebase'de yetkili değil"
    : /permission|PERMISSION/.test(c)
    ? 'Veritabanı kuralları izin vermiyor'
    : 'Bağlantı hatası: ' + c;
}
