// sw.js - Service Worker + Firebase Background Push (GitHub Pages safe)

// 1. Import Firebase Scripts (Compat)
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// ============================================================================
// 🎛️ MASTER CONFIGURATION (Single source of truth: shared/app-config.js)
// ============================================================================
importScripts('./shared/app-config.js');

const CFG = self.STALLZ_APP_CONFIG || {};
const ACTIVE_FIREBASE_CONFIG = (CFG.firebase && CFG.firebase.active) ? CFG.firebase.active : null;

if (!ACTIVE_FIREBASE_CONFIG) {
  console.error('[sw.js] Missing firebase config. Check shared/app-config.js');
}

// Cache name is versioned (keeps updates clean)
const CACHE_NAME = 'stallz-loans-v' + (CFG.version || '0');

// ----------------------------------------------------------------------------
// GitHub Pages / subpath-safe URL helpers
// ----------------------------------------------------------------------------
const SCOPE = (self.registration && self.registration.scope) ? self.registration.scope : (self.location && self.location.origin ? (self.location.origin + '/') : '/');

function normalizeRelative(path) {
  const s = String(path || '').trim();
  if (!s) return '';
  // avoid origin-root absolute paths on GitHub Pages subpaths
  return s.startsWith('/') ? s.slice(1) : s;
}

function toAbsoluteUrl(maybePath, fallbackRelative) {
  const raw = String(maybePath || '').trim();
  if (!raw) return new URL(normalizeRelative(fallbackRelative || ''), SCOPE).toString();
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(normalizeRelative(raw), SCOPE).toString();
}

const DEFAULT_CLIENT_REL = 'client-portal/client.html';
const DEFAULT_ADMIN_REL  = 'admin/admin.html';
const DEFAULT_CLIENT_URL = toAbsoluteUrl(DEFAULT_CLIENT_REL, DEFAULT_CLIENT_REL);
const DEFAULT_ADMIN_URL  = toAbsoluteUrl(DEFAULT_ADMIN_REL, DEFAULT_ADMIN_REL);

// ----------------------------------------------------------------------------
// Firebase init + messaging
// ----------------------------------------------------------------------------
firebase.initializeApp(ACTIVE_FIREBASE_CONFIG || {});
const messaging = firebase.messaging();

// ----------------------------------------------------------------------------
// Install / Activate (basic, safe caching)
// ----------------------------------------------------------------------------
const APP_SHELL = [
  '.', 'index.html',
  'manifest.json',
  'icon-192.png', 'icon-512.png', 'myfavicon.png',
  'shared/app-config.js', 'shared/firebase-init.js', 'shared/auth.js', 'shared/push.js', 'shared/stallz-shared.js',
  'client-portal/client.html', 'client-portal/client-portal.css', 'client-portal/client-portal.js',
  'admin/admin.html', 'admin/styles.css', 'admin/app.js'
].map(normalizeRelative);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
    } catch (e) {
      // If any shell file fails, don't brick SW install
      console.warn('[sw.js] cache addAll failed:', e);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    } catch (e) {}
    await self.clients.claim();
  })());
});

// Network-first for navigations, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = (url.origin === self.location.origin);
  if (!isSameOrigin) return;

  // Navigations: network-first
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match('index.html');
      }
    })());
    return;
  }

  // Assets: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached;
    }
  })());
});

// Allow pages to request SW update
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg && msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ----------------------------------------------------------------------------
// Firebase background messages -> show system notification OR Silent Update
// ----------------------------------------------------------------------------
messaging.onBackgroundMessage((payload) => {
  try { console.log('[sw.js] background payload:', payload); } catch(e) {}

  const data = payload && payload.data ? payload.data : {};
  const notif = payload && payload.notification ? payload.notification : {};

  // 🚨 SILENT UPDATE INTERCEPTOR
  // If the server sends a data message with action 'SILENT_UPDATE', wake up and fetch new code.
  if (data.action === 'SILENT_UPDATE' || data.type === 'SILENT_UPDATE') {
      console.log('[sw.js] Received silent update ping from server. Checking for new SW version...');
      if (self.registration && self.registration.update) {
          self.registration.update(); // Forces the phone to download your latest GitHub push!
      }
      return; // Stop here. Do NOT show a notification bubble to the user.
  }

  // NORMAL NOTIFICATION HANDLER
  const title = String(notif.title || data.title || 'Stallz Loans');
  const body  = String(notif.body  || data.body  || 'You have a new update.');

  const portal = String(data.portal || (String(data.click_action || '').includes('admin') ? 'admin' : 'client'));
  const clickRel = normalizeRelative(data.click_action || (portal === 'admin' ? DEFAULT_ADMIN_REL : DEFAULT_CLIENT_REL));

  const iconUrl  = toAbsoluteUrl(data.icon  || 'icon-192.png', 'icon-192.png');
  const badgeUrl = toAbsoluteUrl(data.badge || 'myfavicon.png', 'myfavicon.png');

  const options = {
    body,
    icon: iconUrl,
    badge: badgeUrl,
    vibrate: [60, 30, 60],
    tag: String(data.dedupeKey || data.pushId || Date.now()),
    data: {
      click_action: clickRel,
      portal
    }
  };

  self.registration.showNotification(title, options);
});

// ----------------------------------------------------------------------------
// Notification click routing
// ----------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const clickRel = (event.notification && event.notification.data && event.notification.data.click_action)
    ? String(event.notification.data.click_action)
    : DEFAULT_CLIENT_REL;

  const url = toAbsoluteUrl(clickRel, DEFAULT_CLIENT_REL);

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    // If a client is already open within our scope, focus it.
    for (const c of allClients) {
      try {
        if (c.url && c.url.startsWith(SCOPE)) {
          await c.focus();
          // Ask the page to navigate
          c.postMessage({ type: 'STALLZ_NAVIGATE', url });
          return;
        }
      } catch (e) {}
    }

    if (clients.openWindow) {
      return clients.openWindow(url);
    }
  })());
});