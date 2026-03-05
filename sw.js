// sw.js - Aggressive Service Worker + Firebase Background Push

// 1. Import Firebase Scripts
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// ============================================================================
// 🎛️ MASTER CONFIGURATION (Single source of truth: shared/app-config.js)
// ============================================================================
importScripts('./shared/app-config.js');

const CFG = self.STALLZ_APP_CONFIG || {};
const ACTIVE_FIREBASE_CONFIG = (CFG.firebase && CFG.firebase.active) ? CFG.firebase.active : null;

if (!ACTIVE_FIREBASE_CONFIG) {
  console.error("[sw.js] Missing firebase config. Check shared/app-config.js");
}

// Cache name is versioned (keeps updates clean)
const CACHE_NAME = 'stallz-loans-v' + (CFG.version || '0');

// 2. Initialize Firebase (uses the active config)
firebase.initializeApp(ACTIVE_FIREBASE_CONFIG || {});
const messaging = firebase.messaging();


// ----------------------------------------------------------------------------
<<<<<<< HEAD
// GitHub Pages / subpath-safe URL helper
// ----------------------------------------------------------------------------
const __SCOPE = (self.registration && self.registration.scope) ? self.registration.scope : (self.location && self.location.origin ? (self.location.origin + "/") : "/");
const __BASE = __SCOPE.replace(/\/$/, ""); // e.g. https://host/APP-TEST

function toAbsoluteUrl(maybePath) {
  try {
    if (!maybePath) return __SCOPE;
    const s = String(maybePath);

    // already absolute
    if (/^https?:\/\//i.test(s)) return s;

    // already includes our base path
    if (__BASE && s.startsWith(__BASE)) return s;

    // root-relative -> prefix with base (important for GitHub Pages)
    if (s.startsWith("/")) return __BASE + s;

    // relative -> resolve under scope
    return __BASE + "/" + s.replace(/^\.\//, "");
  } catch (_) {
    return maybePath;
  }
}

=======
// GitHub Pages / subpath-safe URL helpers
// ----------------------------------------------------------------------------
function toAbsoluteUrl(maybeUrl, fallbackRel) {
  try {
    const scope = (self.registration && self.registration.scope) ? self.registration.scope : self.location.origin + "/";
    if (typeof maybeUrl === "string" && maybeUrl.trim()) {
      const u = maybeUrl.trim();
      // Absolute already
      if (/^https?:\/\//i.test(u)) return u;
      // Leading slash -> treat as app-scope root (NOT origin root)
      if (u.startsWith("/")) return new URL(u.replace(/^\/+/, ""), scope).href;
      // Relative
      return new URL(u.replace(/^\.\/+/, ""), scope).href;
    }
    return new URL(String(fallbackRel || ""), scope).href;
  } catch (_) {
    return maybeUrl || fallbackRel || "/";
  }
}

const DEFAULT_CLIENT_URL = toAbsoluteUrl(null, "client-portal/client.html");
const DEFAULT_ADMIN_URL  = toAbsoluteUrl(null, "admin/admin.html");
const ICON_URL  = toAbsoluteUrl(null, "assets/logo_images/icon-192.png");
const BADGE_URL = toAbsoluteUrl(null, "assets/logo_images/myfavicon.png");


>>>>>>> 846dee3 ( updated push notifications functionality)

// 3. Handle Background Messages (When app is closed)
messaging.onBackgroundMessage(function(payload) {
    console.log('[sw.js] Received background message: ', payload);

    // We send data-only payloads from Cloud Functions
    const data = (payload && payload.data) ? payload.data : {};
    const portal = String(data.portal || 'client');

    const notificationTitle = data.title || payload.notification?.title || 'Stallz Loans';

    const clickFallback = (portal === 'admin') ? DEFAULT_ADMIN_URL : DEFAULT_CLIENT_URL;
    const click_action = toAbsoluteUrl(data.click_action || clickFallback, clickFallback);

    const notificationOptions = {
        body: data.body || payload.notification?.body || 'You have a new alert from Stallz.',
<<<<<<< HEAD
        icon: toAbsoluteUrl('/assets/logo_images/icon-192.png'),
        badge: toAbsoluteUrl('/assets/logo_images/myfavicon.png'),
        vibrate: [200, 100, 200, 100, 200, 100, 200],
        data: {
            click_action: toAbsoluteUrl(data.click_action || payload.data?.click_action || '/client-portal/client.html'),
            portal: data.portal || payload.data?.portal || 'client'
=======
        icon: ICON_URL,
        badge: BADGE_URL,
        vibrate: [200, 100, 200, 100, 200, 100, 200],
        data: {
            click_action: click_action,
            portal: portal
>>>>>>> 846dee3 ( updated push notifications functionality)
        }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});



// 4. Handle Notification Clicks (When user taps the notification)
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    const raw = (event.notification && event.notification.data && event.notification.data.click_action)
      ? event.notification.data.click_action
      : DEFAULT_CLIENT_URL;

    const url = toAbsoluteUrl(raw, DEFAULT_CLIENT_URL);

    event.waitUntil((async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
<<<<<<< HEAD
      const target = allClients.find(c => c && c.url && (c.url === targetUrl || c.url.includes(url) || c.url.includes(targetUrl)));
=======
      let target = null;

      try {
        const want = new URL(url);
        target = allClients.find((c) => {
          try {
            const cu = new URL(c.url);
            return cu.origin === want.origin && cu.pathname === want.pathname;
          } catch (_) { return false; }
        });
      } catch (_) {}

>>>>>>> 846dee3 ( updated push notifications functionality)
      if (target && 'focus' in target) return target.focus();
      return clients.openWindow(targetUrl);
    })());
});


// ==========================================
// 5. EXISTING AGGRESSIVE CACHE LOGIC
// ==========================================
self.addEventListener('install', (event) => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) return caches.delete(cache);
                })
            );
        }).then(() => self.clients.claim())
    );
});

// ==========================================
// 5. SMART OFFLINE CACHING (Prevents GitHub/Browser Offline Pages)
// ==========================================
self.addEventListener('fetch', (event) => {
    // 1. Only intercept basic GET requests
    if (event.request.method !== 'GET') return;

    // 2. NEW FIX: Ignore non-HTTP/HTTPS requests (like chrome-extension://)
    // to prevent Cache API crashes
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Attempt to fetch fresh data from the internet
            const networkFetch = fetch(event.request).then((response) => {
                // If successful, silently update the cache in the background
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            }).catch(() => {
                // If offline, the network fails. We catch it quietly here.
                console.log('[Service Worker] Offline: Serving cached asset.');
            });

            // Return the cached version immediately if we have it, otherwise wait for network
            return cachedResponse || networkFetch;
        })
    );
});