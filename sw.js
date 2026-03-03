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


// 3. Handle Background Messages (When app is closed)
function toAbsoluteTarget(target) {
    try {
        const t = String(target || "").trim();
        const fallback = new URL("client-portal/client.html", self.registration.scope).href;

        if (!t) return fallback;
        if (/^https?:\/\//i.test(t)) return t;

        // If it's a root path like "/client-portal/...", make it scope-relative.
        const cleaned = t.replace(/^\//, "");
        return new URL(cleaned, self.registration.scope).href;
    } catch (e) {
        try { return new URL("client-portal/client.html", self.registration.scope).href; } catch(_) {}
        return "client-portal/client.html";
    }
}

// sw.js ✅ SHOW NOTIFICATION FROM payload.data (data-only messages)
messaging.onBackgroundMessage(function(payload) {
  const title = payload.data?.title || 'Stallz Loans';
  const body  = payload.data?.body  || 'You have a new alert from Stallz.';
  const click = payload.data?.click_action || '/client-portal/client.html';

  const notificationOptions = {
    body,
    icon: '/assets/logo_images/icon-192.png',
    badge: '/assets/logo_images/myfavicon.png',
    vibrate: [200, 100, 200, 100, 200, 100, 200],

    // ✅ DEDUPE ON DEVICE (stops “same push twice” from showing twice)
    tag: payload.data?.pushId || undefined,
    renotify: false,

    data: { click_action: click }
  };

  return self.registration.showNotification(title, notificationOptions);
});

// 4. Handle Notification Clicks (When user taps the notification)
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(toAbsoluteTarget(event.notification?.data?.click_action))
    );
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