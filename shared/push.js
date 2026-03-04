/* ============================================================================
 * STALLZ PUSH (Client + Admin) — Web Push / FCM Glue
 * ----------------------------------------------------------------------------
 * - Registers the Service Worker (sw.js)
 * - Requests permission ONLY on user action
 * - Gets FCM token + hands it off to RTDB (via StallzAuth.syncPendingFCMToken)
 * - Foreground handler: refresh notification dropdown + badge (NO popups)
 * ========================================================================== */
(function () {
  "use strict";

  function firebaseReady() {
    return (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length > 0 && firebase.messaging);
  }

  function getVapidKey() {
    return (
      window.STALLZ_FIREBASE?.config?.vapidKey ||
      window.STALLZ_APP_CONFIG?.firebase?.active?.vapidKey ||
      null
    );
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    const isNested = location.pathname.includes('/client-portal/') || location.pathname.includes('/admin/');
    const regPath = isNested ? '../sw.js' : 'sw.js';

    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register(regPath);
    return navigator.serviceWorker.ready;
  }

  async function initPushNotifications(options) {
    const opts = options || {};
    const forcePrompt = !!opts.forcePrompt;

    if (!firebaseReady()) return false;
    if (typeof Notification === "undefined") return false;

    try {
      // 1) Permission (ONLY on user action)
      if (Notification.permission !== 'granted') {
        if (!forcePrompt) return false;
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return false;
      }

      // 2) SW (needed for background pushes)
      const swReg = await ensureServiceWorker();

      // 3) Token
      const vapidKey = getVapidKey();
      const messaging = firebase.messaging();
      const token = await messaging.getToken({
        vapidKey: vapidKey || undefined,
        serviceWorkerRegistration: swReg || undefined
      });

      if (!token) return false;

      const prev = localStorage.getItem('stallz_active_fcm_token');
      if (prev !== token) localStorage.setItem('stallz_pending_fcm_token', token);
      localStorage.setItem('stallz_active_fcm_token', token);

      // 4) Sync immediately if logged in
      try {
        const user = firebase.auth().currentUser;
        if (user && window.StallzAuth?.syncPendingFCMToken) {
          await window.StallzAuth.syncPendingFCMToken(user.uid);
        }
      } catch (_) {}

      // 5) Foreground messages — no popups (badge + dropdown only)
      if (!window.__STALLZ_FOREGROUND_PUSH_BOUND) {
        window.__STALLZ_FOREGROUND_PUSH_BOUND = true;
        messaging.onMessage((payload) => {
          try { console.log('[Foreground] Push received:', payload); } catch (_) {}

          // sound/haptics are optional; never block if browser prevents them
          try {
            const audio = document.getElementById('pushTone');
            if (audio) audio.play().catch(() => {});
          } catch (_) {}
          try { if (typeof __haptic === 'function') __haptic('success'); } catch (_) {}

          // Refresh dropdown + badges
          try {
            if (typeof renderSharedNotifications === 'function') renderSharedNotifications();
          } catch (_) {}
          try {
            if (typeof refreshUI === 'function') refreshUI();
          } catch (_) {}
        });
      }

      return true;
    } catch (err) {
      console.warn('Push init failed:', err);
      return false;
    }
  }

  window.StallzPush = { initPushNotifications };
})();
