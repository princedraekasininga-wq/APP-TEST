/* ============================================================================
 * STALLZ PUSH (Client + Admin) — Web Push / FCM Glue
 * ----------------------------------------------------------------------------
 * - Registers the Service Worker (sw.js)
 * - Requests permission ONLY on user action
 * - Gets FCM token + hands it off to RTDB (via StallzAuth.syncPendingFCMToken)
 * - Foreground handler: refresh dropdown + badge
 *   ✅ FIXED: can also show OS popups (system notifications), especially on phones
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

  function isMobileUA() {
    try { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ""); } catch (_) { return false; }
  }

  function safeAbsoluteFromScope(pathOrUrl) {
    try {
      const scope = (self?.registration?.scope || (navigator.serviceWorker?.controller && navigator.serviceWorker?.controller?.scriptURL) || null);
      // In window context we can't reliably get registration.scope synchronously. Use location origin + base path instead.
      const origin = location.origin;
      const basePath = location.pathname.split("/").slice(0, -1).join("/") || "/";
      const base = origin + (basePath.endsWith("/") ? basePath : basePath + "/");

      if (!pathOrUrl) return base;
      const s = String(pathOrUrl);

      if (/^https?:\/\//i.test(s)) return s;

      // If already includes the repo subpath, keep it.
      const scopeLike = (origin + "/") + (location.pathname.split("/")[1] || "");
      if (s.startsWith(scopeLike)) return s;

      if (s.startsWith("/")) return origin + s;
      return base + s.replace(/^\.\//, "");
    } catch (_) {
      return pathOrUrl;
    }
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;

    // Nested portal routes register from a subfolder
    const isNested = location.pathname.includes('/client-portal/') || location.pathname.includes('/admin/');
    const regPath = isNested ? '../sw.js' : 'sw.js';

    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register(regPath);
    return navigator.serviceWorker.ready;
  }

  async function showForegroundSystemPopup(payload) {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

      // Use SW registration so it's a real OS-level notification
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      const data = payload?.data || {};
      const title = data.title || payload?.notification?.title || "Stallz Loans";
      const body  = data.body  || payload?.notification?.body  || "You have a new alert.";

      // IMPORTANT: paths must work on GitHub Pages subpaths too (service worker fixes handle this)
      await reg.showNotification(title, {
        body,
        icon: data.icon || "/assets/logo_images/icon-192.png",
        badge: data.badge || "/assets/logo_images/myfavicon.png",
        tag: data.pushId || data.tag || ("fg_" + Date.now()),
        data: {
          click_action: data.click_action || data.url || data.link || "/client-portal/client.html",
          portal: data.portal || "client"
        }
      });
    } catch (e) {
      console.warn("[Push] Foreground popup failed:", e);
    }
  }

  /**
   * initPushNotifications(options)
   *
   * options:
   *  - forcePrompt: boolean   (ONLY call true from a user click)
   *  - foregroundPopups: boolean (default: true on mobile, false on desktop)
   *  - popupWhenVisible: boolean (default: true on mobile, false on desktop)
   */
  async function initPushNotifications(options) {
    const opts = options || {};
    const forcePrompt = !!opts.forcePrompt;

    if (!firebaseReady()) return false;
    if (typeof Notification === "undefined") return false;

    const mobile = isMobileUA();
    const foregroundPopups = (typeof opts.foregroundPopups === "boolean") ? opts.foregroundPopups : mobile;
    const popupWhenVisible = (typeof opts.popupWhenVisible === "boolean") ? opts.popupWhenVisible : mobile;

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

      // 5) Foreground messages — ✅ now can show popups (while still refreshing dropdown/badges)
      if (!window.__STALLZ_FOREGROUND_PUSH_BOUND) {
        window.__STALLZ_FOREGROUND_PUSH_BOUND = true;

        // Keep cfg accessible for later calls
        window.__STALLZ_FOREGROUND_PUSH_CFG = { foregroundPopups, popupWhenVisible };

        messaging.onMessage(async (payload) => {
          try { console.log('[Foreground] Push received:', payload); } catch (_) {}

          // Diagnostics markers
          try {
            const t = new Date().toISOString();
            localStorage.setItem('stallz_last_push_at', t);
            const type = payload?.data?.type || payload?.data?.event || payload?.data?.kind || 'unknown';
            localStorage.setItem('stallz_last_push_type', String(type));
            const entity = payload?.data?.loanId || payload?.data?.clientId || payload?.data?.paymentId || '';
            if (entity) localStorage.setItem('stallz_last_push_entity', String(entity));
          } catch (_) {}

          // sound/haptics are optional; never block if browser prevents them
          try {
            const audio = document.getElementById('pushTone');
            if (audio) audio.play().catch(() => {});
          } catch (_) {}
          try { if (typeof __haptic === 'function') __haptic('success'); } catch (_) {}

          // Refresh dropdown + badges
          try { if (typeof renderSharedNotifications === 'function') renderSharedNotifications(); } catch (_) {}
          try { if (typeof refreshUI === 'function') refreshUI(); } catch (_) {}

          // ✅ Foreground popup (system banner) on phones (and optionally when tab hidden)
          try {
            const cfg = window.__STALLZ_FOREGROUND_PUSH_CFG || { foregroundPopups, popupWhenVisible };
            const shouldPopup =
              !!cfg.foregroundPopups &&
              (document.visibilityState !== 'visible' || !!cfg.popupWhenVisible);

            if (shouldPopup) await showForegroundSystemPopup(payload);
          } catch (_) {}
        });
      } else {
        // If already bound, just update the cfg
        window.__STALLZ_FOREGROUND_PUSH_CFG = { foregroundPopups, popupWhenVisible };
      }

      return true;
    } catch (err) {
      console.warn('Push init failed:', err);
      return false;
    }
  }

  // ===========================
  // Diagnostics (unchanged)
  // ===========================

  function diagEnabled() {
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('diag') === '1' || qs.get('pushdiag') === '1') return true;
      return localStorage.getItem('stallz_push_diag') === '1';
    } catch (_) { return false; }
  }

  function safeJson(obj) {
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
  }

  async function getDiagnostics() {
    const out = {
      time: new Date().toISOString(),
      page: location.href,
      notificationPermission: (typeof Notification !== "undefined") ? Notification.permission : "unsupported",
      firebaseReady: firebaseReady(),
      vapidKeyPresent: !!getVapidKey(),
      activeTokenPresent: !!localStorage.getItem('stallz_active_fcm_token'),
      pendingTokenPresent: !!localStorage.getItem('stallz_pending_fcm_token'),
      lastForegroundPushAt: localStorage.getItem('stallz_last_push_at') || null,
      lastForegroundPushType: localStorage.getItem('stallz_last_push_type') || null,
      lastForegroundPushEntity: localStorage.getItem('stallz_last_push_entity') || null,
      serviceWorker: {
        supported: ('serviceWorker' in navigator),
        controller: !!navigator.serviceWorker?.controller,
        scope: null,
        state: null
      }
    };

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        out.serviceWorker.scope = reg.scope || null;
        out.serviceWorker.state = reg.active?.state || reg.installing?.state || reg.waiting?.state || null;
      }
    } catch (_) {}

    return out;
  }

  function mountDiagnostics() {
    if (!diagEnabled()) return;
    if (document.getElementById('stallzPushDiagBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'stallzPushDiagBtn';
    btn.type = 'button';
    btn.title = 'Push diagnostics';
    btn.setAttribute('aria-label', 'Push diagnostics');
    btn.style.cssText = [
      'position:fixed',
      'left:14px',
      'bottom:14px',
      'z-index:999999',
      'width:44px',
      'height:44px',
      'border-radius:14px',
      'border:1px solid rgba(255,255,255,0.14)',
      'background:rgba(2,6,23,0.78)',
      'backdrop-filter: blur(10px)',
      'color:#e2e8f0',
      'box-shadow:0 18px 55px rgba(0,0,0,0.45)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'cursor:pointer',
      'user-select:none'
    ].join(';');
    btn.innerHTML = '🛠️';

    const overlay = document.createElement('div');
    overlay.id = 'stallzPushDiagOverlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:999998',
      'background:rgba(0,0,0,0.45)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'padding:18px'
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(760px, 100%)',
      'max-height:min(78vh, 820px)',
      'overflow:auto',
      'border-radius:18px',
      'border:1px solid rgba(255,255,255,0.14)',
      'background:rgba(15,23,42,0.92)',
      'backdrop-filter: blur(14px)',
      'box-shadow:0 30px 90px rgba(0,0,0,0.60)',
      'color:#e2e8f0',
      'font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
      'padding:16px'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;';
    header.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;">
        <div style="font-weight:800;letter-spacing:.2px;">Push Diagnostics</div>
        <div style="font-size:12px;opacity:.75;">Toggle: <code style="padding:2px 6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(2,6,23,0.45);">localStorage.stallz_push_diag=1</code> or <code style="padding:2px 6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(2,6,23,0.45);">?diag=1</code></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="stallzPushDiagRefresh" type="button" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(2,6,23,0.55);color:#e2e8f0;cursor:pointer;">Refresh</button>
        <button id="stallzPushDiagCopy" type="button" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(2,6,23,0.55);color:#e2e8f0;cursor:pointer;">Copy</button>
        <button id="stallzPushDiagClose" type="button" style="width:42px;height:42px;border-radius:14px;border:1px solid rgba(255,255,255,0.14);background:rgba(2,6,23,0.55);color:#e2e8f0;cursor:pointer;">✕</button>
      </div>
    `;

    const pre = document.createElement('pre');
    pre.id = 'stallzPushDiagPre';
    pre.style.cssText = [
      'margin:0',
      'padding:12px',
      'border-radius:14px',
      'border:1px solid rgba(255,255,255,0.12)',
      'background:rgba(2,6,23,0.45)',
      'font-size:12px',
      'line-height:1.45',
      'white-space:pre-wrap',
      'word-break:break-word'
    ].join(';');
    pre.textContent = 'Loading…';

    panel.appendChild(header);
    panel.appendChild(pre);
    overlay.appendChild(panel);

    function open() {
      overlay.style.display = 'flex';
      refresh();
      try { history.pushState({ stallzPushDiag: true }, '', location.href); } catch (_) {}
    }
    function close() { overlay.style.display = 'none'; }
    async function refresh() {
      const d = await getDiagnostics();
      pre.textContent = safeJson(d);
    }

    btn.addEventListener('click', open);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    panel.querySelector('#stallzPushDiagClose').addEventListener('click', close);
    panel.querySelector('#stallzPushDiagRefresh').addEventListener('click', refresh);
    panel.querySelector('#stallzPushDiagCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent || '');
        panel.querySelector('#stallzPushDiagCopy').textContent = 'Copied';
        setTimeout(() => { panel.querySelector('#stallzPushDiagCopy').textContent = 'Copy'; }, 900);
      } catch (_) {}
    });

    window.addEventListener('popstate', () => { if (overlay.style.display !== 'none') close(); });

    document.body.appendChild(overlay);
    document.body.appendChild(btn);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && overlay.style.display !== 'none') refresh();
    });
  }

  window.StallzPush = { initPushNotifications, getDiagnostics, mountDiagnostics };

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => mountDiagnostics());
    } else {
      mountDiagnostics();
    }
  } catch (_) {}
})();