/* ============================================================================
 * STALLZ SHARED (Client ↔ Admin Bridge) — Rules-Compatible Edition
 * ----------------------------------------------------------------------------
 * Goal: Work with strict RTDB rules WITHOUT reading whole protected roots.
 * - No reads of: /clients (unless admin), /stallzShared_v1 (root is .read:false)
 * - Uses only allowed, narrow listeners:
 * - Client:  /clients/{uid}/requests
 * /stallzShared_v1/notifications/users/{uid}
 * /stallzShared_v1/messages/{uid}
 * - Admin:   /clients
 * /stallzShared_v1/notifications/admin
 * /stallzShared_v1/loanRequests   (optional / legacy)
 * /stallzShared_v1/messages/{clientUid} (on-demand thread)
 * ----------------------------------------------------------------------------
 * This file is intentionally defensive: it won't "seed" or overwrite DB data.
 * ============================================================================ */
(function () {
  "use strict";

  const ROOT_PATH = "stallzShared_v1";
  const CLIENTS_PATH = "clients";

  // --------------------
  // TEST MODE (URL ?test=1) — localStorage only
  // --------------------
  function isTestMode() {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("test") === "1";
    } catch (e) {
      return false;
    }
  }
  const TEST_KEY = "stallz_shared_test_db_v1";

  function loadTestDB() {
    try {
      return JSON.parse(localStorage.getItem(TEST_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function saveTestDB(db) {
    try {
      localStorage.setItem(TEST_KEY, JSON.stringify(db || {}));
    } catch (e) {}
  }
  function updateTestDB(mutator) {
    const db = loadTestDB();
    mutator(db);
    saveTestDB(db);
    notify();
    return Promise.resolve(db);
  }

  // --------------------
  // INTERNAL STATE
  // --------------------
  let _started = false;
  let _uid = null;
  let _isAdmin = false;

  // Client-scoped caches
  let _clientRequests = {};              // clients/{uid}/requests
  let _clientNotifs = {};                // stallzShared_v1/notifications/users/{uid}
  let _clientNotifsClients = {};         // clients/{uid}/notifications
  let _clientMessages = {};              // messages/{uid}

  // Admin-scoped caches
  let _clientsMap = {};                  // clients (full)
  let _adminNotifs = {};                 // notifications/admin
  let _legacyLoanRequests = {};          // stallzShared_v1/loanRequests (legacy)

  // On-demand message threads (admin reads per-client)
  const _threads = {};                   // messages/{clientUid}

  // Subscriptions
  const _subs = new Set();
  function notify() {
    _subs.forEach((fn) => {
      try { fn(getSnapshot()); } catch (e) {}
    });
  }

  function subscribe(fn) {
    if (typeof fn === "function") _subs.add(fn);
    // Fire once immediately for convenience
    try { fn(getSnapshot()); } catch (e) {}
    return () => _subs.delete(fn);
  }

  // --------------------
  // FIREBASE READY CHECKS
  // --------------------
  function firebaseReady() {
    return (typeof firebase !== "undefined" &&
      firebase.apps &&
      firebase.apps.length > 0 &&
      firebase.auth &&
      firebase.database);
  }

  function getSessionRole() {
    try {
      const s = window.StallzAuth?.getSession?.();
      return s?.role || null;
    } catch (e) {
      return null;
    }
  }

  async function detectAdmin(user) {
    // Prefer session role to avoid extra calls.
    const role = getSessionRole();
    if (role === "admin") return true;

    try {
      const snap = await firebase.database().ref(`admins/${user.uid}`).get();
      return snap.exists();
    } catch (e) {
      return false;
    }
  }

  // --------------------
  // LISTENER HELPERS
  // --------------------
  function onValueSafe(ref, onOk) {
    // Add cancel callback so permission errors don't throw unhandled noise.
    ref.on("value", (snap) => onOk(snap), (err) => {
      console.warn("RTDB listener blocked:", ref.toString?.() || "", err?.code || err);
    });
  }

  function startClientListeners(uid) {
    // Requests
    onValueSafe(firebase.database().ref(`${CLIENTS_PATH}/${uid}/requests`), (snap) => {
      _clientRequests = snap.val() || {};
      notify();
    });

    // Notifications
    onValueSafe(firebase.database().ref(`${ROOT_PATH}/notifications/users/${uid}`), (snap) => {
      _clientNotifs = snap.val() || {};
      notify();
    });

    // Client notifications (direct path)
    onValueSafe(firebase.database().ref(`${CLIENTS_PATH}/${uid}/notifications`), (snap) => {
      _clientNotifsClients = snap.val() || {};
      notify();
    });

    // Messages thread (client ↔ admin)
    onValueSafe(firebase.database().ref(`${ROOT_PATH}/messages/${uid}`), (snap) => {
      _clientMessages = snap.val() || {};
      notify();
    });
  }

  function startAdminListeners() {
    // Clients list (+ requests embedded under each client)
    onValueSafe(firebase.database().ref(`${CLIENTS_PATH}`), (snap) => {
      _clientsMap = snap.val() || {};
      notify();
    });

    // Admin notifications feed
    onValueSafe(firebase.database().ref(`${ROOT_PATH}/notifications/admin`), (snap) => {
      _adminNotifs = snap.val() || {};
      notify();
    });

    // Legacy loanRequests root (optional)
    onValueSafe(firebase.database().ref(`${ROOT_PATH}/loanRequests`), (snap) => {
      _legacyLoanRequests = snap.val() || {};
      notify();
    });
  }

  function ensureThreadListener(clientUid) {
    if (!clientUid || _threads[clientUid]?.__listening) return;
    _threads[clientUid] = _threads[clientUid] || {};
    _threads[clientUid].__listening = true;

    onValueSafe(firebase.database().ref(`${ROOT_PATH}/messages/${clientUid}`), (snap) => {
      _threads[clientUid].data = snap.val() || {};
      notify();
    });
  }

  // --------------------
  // INIT (SAFE: no seeding / overwrites)
  // --------------------
  function ensureSeed() {
    if (isTestMode()) {
      // Test mode doesn't need Firebase.
      return Promise.resolve(true);
    }

    if (_started) return Promise.resolve(true);
    _started = true;

    if (!firebaseReady()) {
      try { window.STALLZ_FIREBASE?.init?.(); } catch (e) {}
    }

    if (!firebaseReady()) {
      console.warn("Firebase not ready: StallzShared init skipped.");
      return Promise.resolve(false);
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        _uid = null;
        _isAdmin = false;
        _clientRequests = {};
        _clientNotifs = {};
        _clientMessages = {};
        _clientsMap = {};
        _adminNotifs = {};
        _legacyLoanRequests = {};
        notify();
        return;
      }

      _uid = user.uid;
      _isAdmin = await detectAdmin(user);

      if (_isAdmin) startAdminListeners();
      else startClientListeners(_uid);

      notify();
    });

    return Promise.resolve(true);
  }

  // --------------------
  // DATA ACCESSORS (Keep API stable)
  // --------------------
  function listUsers() {
    // Admin-only: list all registered clients
    return Object.values(_clientsMap || {}).filter(Boolean);
  }

  function getUser(uid) {
    // Admin-only helper
    return (_clientsMap || {})[uid] || null;
  }

  function listLoanRequests() {
    // Admin: from clients/{uid}/requests and legacy shared root
    const out = [];

    if (_isAdmin) {
      try {
        Object.entries(_clientsMap || {}).forEach(([uid, user]) => {
          const reqs = user?.requests || {};
          Object.values(reqs).filter(Boolean).forEach((r) => out.push({ ...r, clientUid: r.clientUid || uid }));
        });
      } catch (e) {}

      // Legacy (optional): shared root loanRequests
      try {
        Object.values(_legacyLoanRequests || {}).filter(Boolean).forEach((r) => out.push(r));
      } catch (e) {}
    } else if (_uid) {
      // Client: just own requests
      try {
        Object.values(_clientRequests || {}).filter(Boolean).forEach((r) => out.push(r));
      } catch (e) {}
    }

    // Sort newest first
    return out.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  function listLoanRequestsForClient(uid) {
    if (!uid) return [];
    if (!_isAdmin && uid === _uid) {
      return Object.values(_clientRequests || {}).filter(Boolean).sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return tb - ta;
      });
    }
    // Admin view for a specific client
    const u = (_clientsMap || {})[uid];
    const reqs = u?.requests || {};
    return Object.values(reqs || {}).filter(Boolean).sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  function getLoanRequest(id) {
    const all = listLoanRequests();
    const sId = String(id);
    return all.find((r) => String(r.id) === sId || String(r.requestId) === sId) || null;
  }

  function getAdminNotifications() {
    // Explicit admin notifications from DB
    const explicit = Object.values(_adminNotifs || {}).filter(Boolean);
    // Synthetic "pending request" notifications (no client write to admin notif feed)
    const pendingReqs = listLoanRequests()
      .filter((r) => String(r.status || "").toUpperCase() === "PENDING")
      .map((r) => ({
        id: "req_" + String(r.id),
        type: "LOAN_REQUEST",
        title: "New loan request",
        body: `${r.clientName || "Client"} • K${Number(r.amount || 0).toLocaleString()}`,
        meta: { requestId: r.id, clientUid: r.clientUid },
        createdAt: r.createdAt || new Date().toISOString(),
        read: false
      }));

    return [...explicit, ...pendingReqs]
      .filter((n) => !n.read)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function getUserNotifications(uid) {
    if (!uid) return [];
    if (isTestMode()) {
      const db = loadTestDB();
      const notifs = Object.values(db?.notifications?.users?.[uid] || {}).filter(Boolean);
      return notifs.filter((n) => !n.read).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    // Client reads only their own cache; admin typically doesn't need to read user notifs (rules block it)
    if (uid !== _uid) return [];
    const notifs = Object.values(_clientNotifs || {}).filter(Boolean);
    return notifs.filter((n) => !n.read).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function listMessages(clientUid) {
    if (!clientUid) return [];
    if (isTestMode()) {
      const db = loadTestDB();
      const msgs = Object.values(db?.messages?.[clientUid] || {}).filter(Boolean);
      return msgs.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    }

    // Client: own thread
    if (!_isAdmin && clientUid === _uid) {
      const msgs = Object.values(_clientMessages || {}).filter(Boolean);
      return msgs.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    }

    // Admin: on-demand thread
    if (_isAdmin) {
      ensureThreadListener(clientUid);
      const data = _threads[clientUid]?.data || {};
      const msgs = Object.values(data || {}).filter(Boolean);
      return msgs.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    }

    return [];
  }
  function getMessages(uid) { return listMessages(uid); }

  // --------------------
  // WRITE OPERATIONS (Narrow, non-destructive)
  // --------------------
  function createLoanRequest(clientUid, payload) {
    const reqId = Date.now();
    const requestData = {
      id: reqId,
      clientUid: clientUid,
      clientName: payload?.clientName || "Client",
      clientEmail: payload?.clientEmail || "",
      clientPhone: payload?.clientPhone || "",
      nrcNumber: payload?.nrcNumber || payload?.nrc || "",
      address: payload?.address || "",
      amount: Number(payload?.amount || 0),
      plan: payload?.plan || "Weekly",
      collateralItem: payload?.collateralItem || "",
      collateralValue: Number(payload?.collateralValue || 0),
      nrcFrontUrl: payload?.nrcFrontUrl || "",
      nrcBackUrl: payload?.nrcBackUrl || "",
      status: "PENDING",
      createdAt: new Date().toISOString()
    };

    if (isTestMode()) {
      return updateTestDB((db) => {
        db.clients = db.clients || {};
        db.clients[clientUid] = db.clients[clientUid] || {};
        db.clients[clientUid].requests = db.clients[clientUid].requests || {};
        db.clients[clientUid].requests[String(reqId)] = requestData;
      });
    }

    ensureSeed();
    return firebase.database().ref(`${CLIENTS_PATH}/${clientUid}/requests/${reqId}`).set(requestData);
  }

  function approveLoanRequest(adminUid, requestId) {
    if (isTestMode()) {
      return updateTestDB((db) => {
        db.clients = db.clients || {};
        Object.values(db.clients).forEach((c) => {
          if (!c.requests) return;
          Object.values(c.requests).forEach((r) => {
            if (String(r.id) === String(requestId)) r.status = "APPROVED";
          });
        });
      });
    }

    ensureSeed();
    const req = getLoanRequest(requestId);
    if (!req) return Promise.reject(new Error("Request not found"));

    const updates = {};
    // Update request status under client profile
    const uid = req.clientUid;
    updates[`${CLIENTS_PATH}/${uid}/requests/${req.id}/status`] = "APPROVED";

    // Notify user
    const notifId = "n_" + Date.now();
    updates[`${ROOT_PATH}/notifications/users/${uid}/${notifId}`] = {
      id: notifId,
      type: "REQUEST_APPROVED",
      title: "✅ Loan request approved",
      body: "Your loan request has been approved. Please check your dashboard for loan details.",
      createdAt: new Date().toISOString(),
      read: false,
      meta: { requestId: req.id }
    };

    return firebase.database().ref().update(updates);
  }

  function rejectLoanRequest(adminUid, requestId, reason) {
    if (isTestMode()) {
      return updateTestDB((db) => {
        db.clients = db.clients || {};
        Object.values(db.clients).forEach((c) => {
          if (!c.requests) return;
          Object.values(c.requests).forEach((r) => {
            if (String(r.id) === String(requestId)) {
              r.status = "REJECTED";
              r.rejectionReason = String(reason || "");
            }
          });
        });
      });
    }

    ensureSeed();
    const req = getLoanRequest(requestId);
    if (!req) return Promise.reject(new Error("Request not found"));

    const updates = {};
    const uid = req.clientUid;

    updates[`${CLIENTS_PATH}/${uid}/requests/${req.id}/status`] = "REJECTED";
    updates[`${CLIENTS_PATH}/${uid}/requests/${req.id}/rejectionReason`] = String(reason || "");

    const notifId = "n_" + Date.now();
    updates[`${ROOT_PATH}/notifications/users/${uid}/${notifId}`] = {
      id: notifId,
      type: "REQUEST_REJECTED",
      title: "❌ Loan request declined",
      body: `Reason: ${String(reason || "No reason given")}`,
      createdAt: new Date().toISOString(),
      read: false,
      meta: { requestId: req.id }
    };

    return firebase.database().ref().update(updates);
  }

  function sendMessage(opts) {
    const clientUid = String(opts?.clientUid || "");
    const fromUid = String(opts?.fromUid || "");
    const fromRole = String(opts?.fromRole || "");
    const text = String(opts?.text || "").trim();
    if (!clientUid || !text) return Promise.reject(new Error("Missing clientUid or text"));

    if (isTestMode()) {
      return updateTestDB((db) => {
        db.messages = db.messages || {};
        db.messages[clientUid] = db.messages[clientUid] || {};
        const id = "m_" + Date.now();
        db.messages[clientUid][id] = {
          id,
          fromUid,
          fromRole,
          text,
          createdAt: new Date().toISOString(),
          read: false
        };
      });
    }

    ensureSeed();
    const threadRef = firebase.database().ref(`${ROOT_PATH}/messages/${clientUid}`).push();
    const msgId = threadRef.key;

    const msgData = {
      id: msgId,
      fromUid,
      fromRole,
      text,
      createdAt: new Date().toISOString(),
      read: false
    };

    // Also notify the user if the admin is the sender
    const updates = {};
    updates[`${ROOT_PATH}/messages/${clientUid}/${msgId}`] = msgData;

    if (fromRole === "admin") {
      const notifId = "n_" + Date.now();
      updates[`${ROOT_PATH}/notifications/users/${clientUid}/${notifId}`] = {
        id: notifId,
        type: "MESSAGE",
        title: "💬 New message from Admin",
        body: text.length > 120 ? (text.slice(0, 117) + "...") : text,
        createdAt: new Date().toISOString(),
        read: false,
        meta: { clientUid }
      };
    }

    return firebase.database().ref().update(updates);
  }

  function markNotifRead(scope, uid, notifId) {
    if (!notifId) return Promise.resolve(false);

    if (isTestMode()) {
      return updateTestDB((db) => {
        db.notifications = db.notifications || { admin: {}, users: {} };
        if (scope === "admin") {
          if (db.notifications.admin?.[notifId]) db.notifications.admin[notifId].read = true;
        } else {
          db.notifications.users = db.notifications.users || {};
          db.notifications.users[uid] = db.notifications.users[uid] || {};
          if (db.notifications.users[uid]?.[notifId]) db.notifications.users[uid][notifId].read = true;
        }
      });
    }

    ensureSeed();
    const path = (scope === "admin")
      ? `${ROOT_PATH}/notifications/admin/${notifId}/read`
      : `${ROOT_PATH}/notifications/users/${uid}/${notifId}/read`;

    return firebase.database().ref(path).set(true);
  }

  // Admin-only: optional legacy sync for older clients (kept, non-destructive)
  function syncAdminSnapshot(loansArray) {
    if (isTestMode()) return Promise.resolve(true);
    ensureSeed();

    // Safety: never wipe the shared snapshot with an empty/undefined list
    const arr = Array.isArray(loansArray) ? loansArray.filter(l => l && typeof l === "object") : [];
    if (!arr.length) return Promise.resolve(false);

    // De-duplicate by loan.id (keeps the most recently updated copy)
    const byId = new Map();
    arr.forEach((l) => {
      const key = (l && l.id !== undefined && l.id !== null) ? String(l.id) : "";
      if (!key) return;
      const t = Date.parse(l.updatedAt || l.createdAt || "");
      const ts = isNaN(t) ? 0 : t;
      const prev = byId.get(key);
      if (!prev || ts >= prev.ts) byId.set(key, { loan: l, ts });
    });

    const compact = Array.from(byId.values()).map(x => x.loan);

    // Writes ONLY to stallzShared_v1/loans (admin-only), does not touch loanManagerData_v5.
    return firebase.database().ref(`${ROOT_PATH}/loans`).set(compact);
  }


  // --------------------
  // SNAPSHOT (for debugging / subscriptions)
  // --------------------
  function getSnapshot() {
    return {
      uid: _uid,
      isAdmin: _isAdmin,
      clientRequests: _clientRequests,
      clientNotifications: _clientNotifs,
      clientNotificationsClients: _clientNotifsClients,
      clientMessages: _clientMessages,
      clients: _clientsMap,
      adminNotifications: _adminNotifs,
      legacyLoanRequests: _legacyLoanRequests
    };
  }

  // --------------------
  // PUBLIC API
  // --------------------
  window.StallzShared = {
    ensureSeed,
    subscribe,

    // Users & lookup
    listUsers,
    getUser,

    // Loan requests
    listLoanRequests,
    listLoanRequestsForClient,
    getLoanRequest,
    createLoanRequest,
    approveLoanRequest,
    rejectLoanRequest,

    // Notifications
    getAdminNotifications,
    getUserNotifications,
    markNotifRead,

    // Messages
    listMessages,
    getMessages,
    sendMessage,

    // Legacy sync
    syncAdminSnapshot
  };

  // --------------------
  // 🚫 NAVIGATION GUARD (Portals)
  // Prevent back/gesture navigation from returning to gatekeeper/login once a portal is open.
  // Call: window.StallzShared.enableNoBackNavigation() inside admin + client portals.
  // --------------------
  let __stallzNoBackEnabled = false;
  function enableNoBackNavigation() {
    if (__stallzNoBackEnabled) return;
    __stallzNoBackEnabled = true;

    try { history.replaceState({ stallzNoBack: true }, document.title, location.href); } catch (e) {}
    try { history.pushState({ stallzNoBack: true }, document.title, location.href); } catch (e) {}

    window.addEventListener('popstate', () => {
      if (!__stallzNoBackEnabled) return;
      try { history.pushState({ stallzNoBack: true }, document.title, location.href); } catch (e) {}
    });
  }

  function disableNoBackNavigation() {
    __stallzNoBackEnabled = false;
  }

  window.StallzShared.enableNoBackNavigation = enableNoBackNavigation;
  window.StallzShared.disableNoBackNavigation = disableNoBackNavigation;

// ============================================================================
  // 🌐 STALLZ GLOBAL OFFLINE ENGINE (Smart Firebase Detection)
  // ============================================================================

  let _isOffline = !navigator.onLine;

 function initGlobalOfflineEngine() {
      if (document.getElementById('stallzOfflineBanner')) return;

      // 1. Inject the Global CSS (FIXED: Using translateY, box-sizing, and opacity)
      const style = document.createElement('style');
      style.innerHTML = `
        #stallzOfflineBanner {
            position: fixed; top: 0; left: 0; right: 0; background: var(--stallz-banner-bg, #ef4444); color: white;
            text-align: center; padding: 12px; font-weight: 700; font-size: 0.9rem; z-index: 9999999;

            box-sizing: border-box; /* Ensures padding doesn't add to height */
            transform: translateY(-150%); /* Moves it far above the viewport */
            opacity: 0; /* Makes it completely transparent when hidden */
            visibility: hidden; /* Prevents interaction/rendering when offscreen */

            transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, box-shadow 0.4s ease;
            display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        #stallzOfflineBanner.show {
            transform: translateY(0);
            opacity: 1; /* Fades in */
            visibility: visible;
            box-shadow: 0 10px 20px rgba(239, 68, 68, 0.3); /* Adds shadow only when shown */
        }
        #stallzOfflineBanner[data-state="offline"] { --stallz-banner-bg: #ef4444; }
        #stallzOfflineBanner[data-state="connecting"] { --stallz-banner-bg: #f59e0b; box-shadow: 0 10px 20px rgba(245, 158, 11, 0.22); }
        #stallzOfflineBanner[data-state="online"] { --stallz-banner-bg: #22c55e; box-shadow: 0 10px 20px rgba(34, 197, 94, 0.22); }
        .stallz-offline-blocker {
            position: absolute; inset: 0; background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 10000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-align: center; padding: 24px; border-radius: inherit; animation: fadeIn 0.3s ease;
        }
        .stallz-offline-blocker svg { width: 80px; height: 80px; color: #ef4444; margin-bottom: 16px; filter: drop-shadow(0 10px 15px rgba(239, 68, 68, 0.3)); }
        .stallz-offline-blocker h3 { color: #fff; margin: 0 0 8px 0; font-size: 1.4rem; font-weight: 800; }
        .stallz-offline-blocker p { color: #94a3b8; font-size: 0.95rem; margin: 0; max-width: 280px; line-height: 1.5; }
      `;
      document.head.appendChild(style);

      // 2. Inject the Warning Banner
      const banner = document.createElement('div');
      banner.id = 'stallzOfflineBanner';
      banner.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><line x1="22" y1="2" x2="2" y2="22"/></svg>
          <span id="stallzOfflineText">You are offline. Reconnect to sync with Stallz Cloud.</span>
      `;
      banner.dataset.state = 'offline';
      document.body.appendChild(banner);

      // 2b. Back-online pulse (modern UX)
      let _everShownBanner = false;
      let _backOnlineTimer = null;

      const showBanner = (state, text) => {
           if (document.hidden) return;
          _everShownBanner = true;
          setBannerState(state, text);
          banner.classList.add('show');
      };

      const showBackOnlinePulse = (text) => {
           if (document.hidden) return;
          if (!_everShownBanner) return;
          clearTimeout(_backOnlineTimer);
          setBannerState('online', text || "Back online — syncing...");
          banner.classList.add('show');
          _backOnlineTimer = setTimeout(() => {
              banner.classList.remove('show');
          }, 1800);
      };


      // 3. SMART STATUS UPDATER (Smarter: avoids false offline during slow RTDB loads)
      let _offlineDebounceTimer = null;
      let _connectingTimer = null;
      let _firebaseConnectedOnce = false; // Tracks if Firebase has successfully connected at least once
      let _firebaseLastConnected = null;  // null = unknown, true/false once known

      const setBannerState = (state, text) => {
          if (!banner) return;
          banner.dataset.state = state || 'offline';
          const t = document.getElementById('stallzOfflineText');
          if (t && text) t.textContent = text;
      };

      const hideAllSilent = () => {
          clearTimeout(_offlineDebounceTimer);
          clearTimeout(_connectingTimer);
          banner.classList.remove('show');
          document.querySelectorAll('.stallz-offline-blocker').forEach(b => b.remove());
      };

      const hideAll = () => {
          hideAllSilent();
      };


      const showConnectingIfStillDown = (delayMs, message) => {
          clearTimeout(_connectingTimer);
          _connectingTimer = setTimeout(() => {
              if (isTestMode()) return;
              if (!navigator.onLine) return;
              if (_firebaseLastConnected === false) {
                  _isOffline = false; // Connecting/reconnecting is NOT hard-offline
                  showBanner('connecting', message);
              }
          }, delayMs);
      };

      const escalateToOfflineIfStillDown = (delayMs, message) => {
          clearTimeout(_offlineDebounceTimer);
          _offlineDebounceTimer = setTimeout(() => {
              if (isTestMode()) return;
              // Only escalate if we're still disconnected and browser isn't reporting offline
              if (navigator.onLine && _firebaseLastConnected === false) {
                  _isOffline = true;
                  showBanner('offline', message);
              }
          }, delayMs);
      };

      const handleBrowserStatus = (isOffline) => {
          if (isTestMode()) return;

          if (!isOffline) {
              // Browser says we're back online
              const _shouldPulse = (banner.classList && banner.classList.contains('show')) && banner.dataset.state !== 'online';
              _isOffline = false;
              hideAllSilent();
              if (_shouldPulse && _firebaseLastConnected !== false) showBackOnlinePulse("Back online — syncing...");

              // If Firebase is still down, show a gentle connecting banner after a grace period
              if (_firebaseLastConnected === false) {
                  showConnectingIfStillDown(_firebaseConnectedOnce ? 2500 : 9000, "Connecting to Stallz Cloud...");
                  escalateToOfflineIfStillDown(_firebaseConnectedOnce ? 15000 : 25000, "Connection to Stallz Cloud is taking too long. Please check your internet.");
              }
              if (typeof refreshUI === 'function') refreshUI();
              return;
          }

          // Browser offline = hard offline (fast)
          _isOffline = true;
          showBanner('offline', "You are offline. Reconnect to sync with Stallz Cloud.");
      };

      const handleFirebaseStatus = (isDisconnected) => {
          if (isTestMode()) return;

          _firebaseLastConnected = !isDisconnected;

          if (!isDisconnected) {
              // Connected (or reconnected)
              // Connected (or reconnected)
              const _shouldPulse = (banner.classList && banner.classList.contains('show')) && banner.dataset.state !== 'online';
              _firebaseConnectedOnce = true;
              _isOffline = false;
              hideAllSilent();
              if (_shouldPulse) showBackOnlinePulse("Back online — syncing...");
              if (typeof refreshUI === 'function') refreshUI();
              return;
          }

          // Disconnected
          if (!navigator.onLine) {
              // If browser already says offline, go hard-offline immediately
              _isOffline = true;
              showBanner('offline', "You are offline. Reconnect to sync with Stallz Cloud.");
              return;
          }

          // Browser says online but Firebase says disconnected:
          // Treat as CONNECTING/RECONNECTING first (prevents false offline during slow loads)
          _isOffline = false;

          // Longer grace on first boot; shorter on drops after a successful connect
          showConnectingIfStillDown(_firebaseConnectedOnce ? 2000 : 9000, _firebaseConnectedOnce ? "Reconnecting to Stallz Cloud..." : "Connecting to Stallz Cloud...");
          escalateToOfflineIfStillDown(_firebaseConnectedOnce ? 12000 : 22000, "Connection lost. Please check your internet.");
      };

// 4. Listeners
       // Visibility: don't flash offline banners while app is backgrounded (prevents "random offline")
       const reconcileOnVisible = () => {
           if (isTestMode()) return;
           if (document.hidden) return;
           // Re-evaluate quickly on return
           if (!navigator.onLine) {
               _isOffline = true;
               showBanner('offline', "You are offline. Reconnect to sync with Stallz Cloud.");
               return;
           }
           if (_firebaseLastConnected === false) {
               _isOffline = false;
               showBanner('connecting', "Reconnecting to Stallz Cloud...");
               escalateToOfflineIfStillDown(_firebaseConnectedOnce ? 18000 : 26000, "Connection lost. Please check your internet.");
               return;
           }
           // Online
           const _shouldPulse = (banner.classList && banner.classList.contains('show')) && banner.dataset.state !== 'online';
           _isOffline = false;
           hideAllSilent();
           if (_shouldPulse) showBackOnlinePulse("Back online — syncing...");
       };

       document.addEventListener('visibilitychange', () => {
           if (document.hidden) {
               // Hide banners when backgrounded & cancel timers (avoids false offline)
               hideAllSilent();
               clearTimeout(_offlineDebounceTimer);
               clearTimeout(_connectingTimer);
               return;
           }
           reconcileOnVisible();
       });

      window.addEventListener('offline', () => handleBrowserStatus(true));
      window.addEventListener('online', () => handleBrowserStatus(false));

      // SMART FIREBASE HEARTBEAT
      setTimeout(() => {
          if (typeof firebase !== 'undefined' && firebase.database) {
              firebase.database().ref('.info/connected').on('value', (snap) => {
                  handleFirebaseStatus(snap.val() === false);
              });
          }
      }, 1500); // Wait 1.5s before attaching the listener to avoid instant false-negatives during script load

      // Initial check on load
      if (!navigator.onLine) handleBrowserStatus(true);
  }
  // 4. The Global Blocker Function
  window.enforceOfflineView = function(containerElement) {
      if (!containerElement || isTestMode() || !_isOffline) return false;

      const style = window.getComputedStyle(containerElement);
      if (style.position === 'static') containerElement.style.position = 'relative';

      if (!containerElement.querySelector('.stallz-offline-blocker')) {
          const blocker = document.createElement('div');
          blocker.className = 'stallz-offline-blocker';
          blocker.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><line x1="22" y1="2" x2="2" y2="22"/>
              </svg>
              <h3>Connection Lost</h3>
              <p>You are currently offline. Please reconnect to the internet to access this data.</p>
          `;
          containerElement.appendChild(blocker);
      }
      return true;
  };

  window.isAppOffline = () => _isOffline;

  // Auto-start engine on every page load
  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initGlobalOfflineEngine);
  } else {
      initGlobalOfflineEngine();
  }
})();