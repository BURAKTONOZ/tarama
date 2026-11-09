/* ==========================================================================
   TonoScan - Ana Giriş Noktası ve Başlatıcı (Bootstrap & Router)
   ========================================================================== */

function openInfo() {
  show('info', 1);
}

function closeInfo() {
  show('info', 0);
}

window.addEventListener('DOMContentLoaded', () => {
  if (isBot || location.hash === '#bilgi' || /[?&]bilgi/.test(location.search)) {
    openInfo();
  }
  if (isBot) return;

  const h = new URLSearchParams(location.hash.slice(1));
  const forcePC = /[?&]pc\b/.test(location.search);
  const mobMode = (h.get('r') && h.get('k')) || (!forcePC && (isMob || (localStorage.ts_ismob && !localStorage.ts_room)));

  if (mobMode) {
    mobInit();
  } else {
    pcInit();
  }
});
