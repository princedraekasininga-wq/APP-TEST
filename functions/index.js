/* eslint-disable */
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();

const ROOT = "stallzShared_v1";
const LUSAKA_TZ = "Africa/Lusaka";

function nowIso() {
  return new Date().toISOString();
}

function dateKeyInTZ(d = new Date(), timeZone = LUSAKA_TZ) {
  // YYYY-MM-DD in requested TZ
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);

  const y = parts.find(p => p.type === "year")?.value || "1970";
  const m = parts.find(p => p.type === "month")?.value || "01";
  const da = parts.find(p => p.type === "day")?.value || "01";
  return `${y}-${m}-${da}`;
}

function dateOnlyToUtcMs(dateOnly) {
  // Treat YYYY-MM-DD as UTC midnight for stable day-diff math
  if (!dateOnly || typeof dateOnly !== "string") return null;
  const m = dateOnly.trim().match(/^\d{4}-\d{2}-\d{2}$/);
  if (!m) return null;
  return Date.parse(`${dateOnly}T00:00:00.000Z`);
}

function safeSnippet(s, max = 120) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.length > max ? (t.slice(0, max - 3) + "...") : t;
}

async function sendMulticastAndCleanup(tokenEntries, title, body, data) {
  const tokens = tokenEntries.map(e => e.token).filter(t => typeof t === "string" && t.length > 0);
  if (!tokens.length) return { sent: 0, bad: 0 };

  const message = {
    notification: { title: String(title || "Stallz Loans"), body: String(body || "") },
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [String(k), String(v)])),
    tokens
  };

  const res = await admin.messaging().sendEachForMulticast(message);

  // Clean up invalid tokens
  const badEntries = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code ? String(r.error.code) : "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
        badEntries.push(tokenEntries[i]);
      }
    }
  });

  if (badEntries.length) {
    const updates = {};
    badEntries.forEach(e => {
      updates[e.path] = null;
    });
    await admin.database().ref().update(updates);
  }

  return { sent: res.successCount || 0, bad: badEntries.length };
}

async function getClientTokenEntries(uid) {
  const tokensSnap = await admin.database().ref(`/clients/${uid}/fcmTokens`).once("value");
  const tokensObj = tokensSnap.val() || {};
  return Object.entries(tokensObj)
    .map(([k, v]) => ({ path: `/clients/${uid}/fcmTokens/${k}`, token: v && v.token }))
    .filter(x => typeof x.token === "string" && x.token.length > 0);
}

async function getAllAdminTokenEntries() {
  const adminsSnap = await admin.database().ref(`/admins`).once("value");
  const adminsObj = adminsSnap.val() || {};
  const out = [];
  Object.entries(adminsObj).forEach(([adminUid, adminVal]) => {
    const tokensObj = (adminVal && adminVal.fcmTokens) ? adminVal.fcmTokens : {};
    Object.entries(tokensObj || {}).forEach(([k, v]) => {
      const token = v && v.token;
      if (typeof token === "string" && token.length > 0) {
        out.push({ path: `/admins/${adminUid}/fcmTokens/${k}`, token });
      }
    });
  });
  return out;
}

// ============================================================================
// 1) EXISTING QUEUE SENDER (Client)
// Path: /clients/{uid}/pushQueue/{pushId}
// ============================================================================
exports.sendPushFromQueue = functions.database
  .ref("/clients/{uid}/pushQueue/{pushId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const pushId = context.params.pushId;

    const job = snap.val() || {};
    const title = String(job.title || "Stallz Loans");
    const body = String(job.body || "");
    const clickAction = String(job.click_action || "/client-portal/client.html");

    const tokenEntries = await getClientTokenEntries(uid);
    if (!tokenEntries.length) {
      await snap.ref.remove();
      return null;
    }

    await sendMulticastAndCleanup(tokenEntries, title, body, {
      click_action: clickAction,
      source: String(job.source || "STALLZ"),
      pushId: String(pushId)
    });

    // Remove the job (prevents duplicates)
    await snap.ref.remove();
    return null;
  });

// ============================================================================
// 2) MIRROR /clients/{uid}/notifications → /stallzShared_v1/notifications/users
// This keeps the client bell feed consistent and lets shared triggers handle push.
// ============================================================================
exports.mirrorClientNotifsToShared = functions.database
  .ref("/clients/{uid}/notifications/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const notif = snap.val() || {};
    const sharedRef = admin.database().ref(`/${ROOT}/notifications/users/${uid}/${notifId}`);

    const exists = await sharedRef.get();
    if (exists.exists()) return null;

    const payload = {
      id: String(notif.id || notifId),
      type: String(notif.type || "UPDATE"),
      title: String(notif.title || "Stallz Loans"),
      body: String(notif.body || ""),
      createdAt: String(notif.createdAt || nowIso()),
      read: Boolean(notif.read === true),
      meta: Object.assign({}, (notif.meta || null), { mirroredFrom: "clients_notifications" }),
      click_action: String(notif.click_action || "/client-portal/client.html")
    };

    await sharedRef.set(payload);
    return null;
  });

// ============================================================================
// 3) ENQUEUE PUSH WHEN A SHARED USER NOTIFICATION IS CREATED
// Path: /stallzShared_v1/notifications/users/{uid}/{notifId}
// ============================================================================
exports.enqueuePushOnSharedUserNotif = functions.database
  .ref(`/${ROOT}/notifications/users/{uid}/{notifId}`)
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    const title = String(n.title || "Stallz Loans");
    const body = String(n.body || "");
    const clickAction = String(n.click_action || "/client-portal/client.html");

    const job = {
      title,
      body,
      click_action: clickAction,
      createdAt: nowIso(),
      source: String(n.type || "NOTIFICATION"),
      notifId: String(notifId)
    };

    // Idempotent enqueue (only creates once)
    const jobRef = admin.database().ref(`/clients/${uid}/pushQueue/${notifId}`);
    await jobRef.transaction((cur) => (cur ? cur : job));

    return null;
  });

// ============================================================================
// 4) ADMIN PUSH BROADCAST WHEN AN ADMIN NOTIFICATION IS CREATED
// Path: /stallzShared_v1/notifications/admin/{notifId}
// ============================================================================
exports.pushAdminsOnAdminNotif = functions.database
  .ref(`/${ROOT}/notifications/admin/{notifId}`)
  .onCreate(async (snap, context) => {
    const notifId = context.params.notifId;
    const n = snap.val() || {};

    // Idempotency: if already marked, skip
    if (n && n.deliveredPushAt) return null;

    const title = String(n.title || "Stallz Loans (Admin)");
    const body = String(n.body || "");
    const clickAction = String(n.click_action || "/admin/admin.html");

    const tokenEntries = await getAllAdminTokenEntries();
    if (!tokenEntries.length) {
      // still mark as delivered to avoid retry loops
      await snap.ref.child("deliveredPushAt").set(nowIso());
      return null;
    }

    await sendMulticastAndCleanup(tokenEntries, title, body, {
      click_action: clickAction,
      source: String(n.type || "ADMIN_NOTIFICATION"),
      notifId: String(notifId)
    });

    await snap.ref.child("deliveredPushAt").set(nowIso());
    return null;
  });

// ============================================================================
// 5) EVENT: NEW LOAN REQUEST (Client created)
// Path: /clients/{uid}/requests/{reqId}
// Creates: user notif (submitted) + admin notif (new request)
// ============================================================================
exports.onLoanRequestCreated = functions.database
  .ref("/clients/{uid}/requests/{reqId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const reqId = context.params.reqId;
    const r = snap.val() || {};

    const createdAt = String(r.createdAt || nowIso());
    const amount = Number(r.amount || 0);
    const clientName = String(r.clientName || "Client");

    const updates = {};

    // Client: submission confirmation
    const userNotifId = `req_sub_${reqId}`;
    updates[`/${ROOT}/notifications/users/${uid}/${userNotifId}`] = {
      id: userNotifId,
      type: "REQUEST_SUBMITTED",
      title: "📨 Request submitted",
      body: "We received your loan request. We'll notify you once it's reviewed.",
      createdAt,
      read: false,
      meta: { requestId: String(r.id || reqId) },
      click_action: "/client-portal/client.html"
    };

    // Admin: new request
    const adminNotifId = `req_new_${reqId}`;
    updates[`/${ROOT}/notifications/admin/${adminNotifId}`] = {
      id: adminNotifId,
      type: "LOAN_REQUEST_NEW",
      title: "🆕 New loan request",
      body: `${clientName} • K${amount.toLocaleString()}`,
      createdAt,
      read: false,
      meta: { clientUid: uid, requestId: String(r.id || reqId) },
      click_action: "/admin/admin.html"
    };

    await admin.database().ref().update(updates);
    return null;
  });

// ============================================================================
// 6) EVENT: NEW CLIENT CREATED (first time /clients/{uid} appears)
// ============================================================================
exports.onNewClientCreated = functions.database
  .ref("/clients/{uid}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const c = snap.val() || {};
    const createdAt = nowIso();
    const name = String(c.name || c.fullName || c.firstName || "New client");
    const phone = String(c.phone || "");
    const email = String(c.email || "");

    const notifId = `client_new_${uid.slice(0, 8)}_${Date.now()}`;

    await admin.database().ref(`/${ROOT}/notifications/admin/${notifId}`).set({
      id: notifId,
      type: "CLIENT_NEW",
      title: "👤 New client registered",
      body: safeSnippet(`${name}${phone ? " • " + phone : ""}${email ? " • " + email : ""}`, 120),
      createdAt,
      read: false,
      meta: { clientUid: uid },
      click_action: "/admin/admin.html"
    });

    return null;
  });

// ============================================================================
// 7) EVENT: NEW FEEDBACK (client feedback form)
// Path: /feedbacks/{fbId}
// ============================================================================
exports.onFeedbackCreated = functions.database
  .ref("/feedbacks/{fbId}")
  .onCreate(async (snap, context) => {
    const fbId = context.params.fbId;
    const f = snap.val() || {};
    const createdAt = String(f.createdAt || nowIso());

    const name = String(f.name || "Anonymous");
    const contact = String(f.contact || "");
    const msg = safeSnippet(f.message || "", 120);
    const clientUid = String(f.clientUid || "");

    const notifId = `fb_${fbId}`;

    await admin.database().ref(`/${ROOT}/notifications/admin/${notifId}`).set({
      id: notifId,
      type: "FEEDBACK_NEW",
      title: "📝 New feedback received",
      body: safeSnippet(`${name}${contact ? " • " + contact : ""}: ${msg}`, 160),
      createdAt,
      read: false,
      meta: { clientUid },
      click_action: "/admin/admin.html"
    });

    return null;
  });

// ============================================================================
// 8) SCHEDULED: DUE DATE / OVERDUE NOTIFICATIONS (Client + Admin)
// Runs hourly. Requires Blaze plan + Cloud Scheduler enabled.
// ============================================================================
exports.scheduledLoanDueNotifications = functions.pubsub
  .schedule("every 60 minutes")
  .timeZone(LUSAKA_TZ)
  .onRun(async () => {
    const todayKey = dateKeyInTZ(new Date(), LUSAKA_TZ);
    const todayUtcMs = dateOnlyToUtcMs(todayKey);

    const clientsSnap = await admin.database().ref("/clients").once("value");
    const clientsObj = clientsSnap.val() || {};

    const stateRef = admin.database().ref(`/${ROOT}/notifState/loans`);
    const stateSnap = await stateRef.once("value");
    const stateObj = stateSnap.val() || {};

    const updates = {};
    const dayMs = 24 * 60 * 60 * 1000;

    Object.entries(clientsObj).forEach(([uid, client]) => {
      const loans = (client && client.loans) ? client.loans : {};
      if (!loans) return;

      const userState = (stateObj && stateObj[uid]) ? stateObj[uid] : {};

      Object.entries(loans).forEach(([loanId, loan]) => {
        if (!loan || typeof loan !== "object") return;

        const status = String(loan.status || "").toUpperCase();
        const balance = Number(loan.balance ?? loan.remaining ?? loan.amount ?? 0);

        // Skip settled loans
        if (status === "PAID" || balance <= 0) return;

        const dueStr = String(loan.dueDate || "").trim();
        const dueUtcMs = dateOnlyToUtcMs(dueStr);
        if (!dueUtcMs || !todayUtcMs) return;

        const daysLeft = Math.round((dueUtcMs - todayUtcMs) / dayMs);

        let eventKey = null;
        let title = null;
        let body = null;

        if (daysLeft === 3) {
          eventKey = "DUE_IN_3_DAYS";
          title = "⏳ Due in 3 days";
          body = `Reminder: Your repayment is due on ${dueStr}. Please plan early to avoid penalties.`;
        } else if (daysLeft === 1) {
          eventKey = "DUE_TOMORROW";
          title = "⏰ Due tomorrow";
          body = `Your repayment is due tomorrow (${dueStr}). If you need help, contact support early.`;
        } else if (daysLeft === 0) {
          eventKey = "DUE_TODAY";
          title = "📌 Due today";
          body = `Your repayment is due today (${dueStr}). Please settle as soon as possible.`;
        } else if (daysLeft < 0) {
          eventKey = "OVERDUE";
          title = "⚠️ Overdue repayment";
          body = `Your repayment was due on ${dueStr}. Please settle immediately to avoid escalation.`;
        } else {
          return;
        }

        const lastSent = userState?.[loanId]?.[eventKey] || null;
        if (lastSent === todayKey) return; // already sent today

        const userNotifId = `loan_${loanId}_${eventKey}_${todayKey}`;
        updates[`/${ROOT}/notifications/users/${uid}/${userNotifId}`] = {
          id: userNotifId,
          type: eventKey,
          title,
          body,
          createdAt: nowIso(),
          read: false,
          meta: { loanId: String(loanId), dueDate: dueStr, daysLeft: String(daysLeft) },
          click_action: "/client-portal/client.html"
        };

        updates[`/${ROOT}/notifState/loans/${uid}/${loanId}/${eventKey}`] = todayKey;

        // Admin: only for overdue (to avoid spam)
        if (eventKey === "OVERDUE") {
          const clientName = String(client.name || client.fullName || client.firstName || "Client");
          const adminNotifId = `overdue_${uid.slice(0, 6)}_${loanId}_${todayKey}`;
          updates[`/${ROOT}/notifications/admin/${adminNotifId}`] = {
            id: adminNotifId,
            type: "CLIENT_OVERDUE",
            title: "🚨 Client overdue",
            body: `${clientName} • Due ${dueStr} • Balance K${Number(balance || 0).toLocaleString()}`,
            createdAt: nowIso(),
            read: false,
            meta: { clientUid: uid, loanId: String(loanId), dueDate: dueStr },
            click_action: "/admin/admin.html"
          };
        }
      });
    });

    // If nothing to write, exit fast
    const keys = Object.keys(updates);
    if (!keys.length) return null;

    await admin.database().ref().update(updates);
    return null;
  });
