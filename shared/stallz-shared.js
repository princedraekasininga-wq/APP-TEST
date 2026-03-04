/* ============================================================================
 * STALLZ SHARED (Client ↔ Admin Bridge) — Rules-Compatible Edition
 * ----------------------------------------------------------------------------
 * Goal: Work with strict RTDB rules WITHOUT reading whole protected roots.
 * - No reads of: /clients (unless admin), /stallzShared_v1 (root is .read:false)
 * - Uses only allowed, narrow listeners:
 *   - Client:  /clients/{uid}/requests
 *             /stallzShared_v1/notifications/users/{uid}
 *             /stallzShared_v1/messages/{uid}
 *   - Admin:   /clients
 *             /stallzShared_v1/notifications/admin
 *             /stallzShared_v1/loanRequests   (optional / legacy)
 *             /stallzShared_v1/messages/{clientUid} (on-demand thread)
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
      // Offline/demo mode (localStorage DB) can be enabled by:
      //  - URL: ?test=1   (legacy) or ?offline=1 (clearer)
      //  - JS:  window.STALLZ_OFFLINE_DEMO = true
      if (window.STALLZ_OFFLINE_DEMO === true) return true;
      const u = new URL(window.location.href);
      return u.searchParams.get("test") === "1" || u.searchParams.get("offline") === "1";
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
  let _clientNotifs = {};                // notifications/users/{uid}
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
})();
