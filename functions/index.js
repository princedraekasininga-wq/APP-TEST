/* eslint-disable */
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function collectTokenEntries(tokensObj) {
  // Supports:
  // 1) { key: { token: "..." } }
  // 2) { key: "..." }
  // 3) { "<tokenString>": true }  (legacy)
  const entries = [];
  Object.entries(tokensObj || {}).forEach(([k, v]) => {
    let token = null;
    if (typeof v === "string") token = v;
    else if (v && typeof v === "object" && typeof v.token === "string") token = v.token;
    else if (v === true && typeof k === "string") token = k;

    if (typeof token === "string" && token.trim().length > 0) {
      entries.push({ key: k, token: token.trim() });
    }
  });
  return entries;
}

function buildMulticastMessage({ title, body, clickAction, portal, source, pushId, extraData }) {
  const t = String(title || "Stallz Loans");
  const b = String(body || "You have a new update.");
  const click = String(clickAction || (portal === "admin" ? "admin/admin.html" : "client-portal/client.html"));

  // Keep URLs subpath-safe for GitHub Pages: avoid leading "/" defaults.
  const cleanClick = click.startsWith("/") ? click.slice(1) : click;

  const data = {
    title: t,
    body: b,
    click_action: cleanClick,
    portal: String(portal || "client"),
    source: String(source || "STALLZ"),
    pushId: String(pushId || Date.now())
  };

  if (extraData && typeof extraData === "object") {
    Object.entries(extraData).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      data[String(k)] = String(v);
    });
  }

  // Provide BOTH:
  // - data: consumed by app + service worker routing
  // - notification/webpush.notification: boosts reliability for background display on mobile/PWA
  return {
    notification: { title: t, body: b },
    data,
    webpush: {
      headers: { Urgency: "high" },
      notification: {
        title: t,
        body: b,
        // subpath-safe (no leading slash)
        icon: "icon-192.png",
        badge: "myfavicon.png",
        // Vibrate is respected by some platforms; harmless elsewhere
        vibrate: [60, 30, 60],
        tag: String(extraData?.dedupeKey || pushId || Date.now())
      },
      fcmOptions: { link: cleanClick }
    }
  };
}

async function cleanupBadTokens({ basePath, uid, tokenEntries, multicastResponse }) {
  const badKeys = [];
  multicastResponse.responses.forEach((r, i) => {
    if (!r.success) {
      badKeys.push(tokenEntries[i]?.key);
    }
  });

  if (!badKeys.length) return;

  const updates = {};
  badKeys.forEach((k) => {
    if (!k) return;
    updates[`${basePath}/${uid}/fcmTokens/${k}`] = null;
  });
  await admin.database().ref().update(updates);
}

async function collectAllAdminTokens() {
  const adminsSnap = await admin.database().ref("/admins").once("value");
  const adminsObj = adminsSnap.val() || {};
  const out = [];
  Object.entries(adminsObj).forEach(([adminUid, adminUser]) => {
    const entries = collectTokenEntries(adminUser?.fcmTokens || {});
    entries.forEach((e) => out.push({ adminUid, tokenKey: e.key, token: e.token }));
  });
  return out;
}

// ----------------------------------------------------------------------------
// 1) SEND: Client push queue -> FCM multicast
// Path: /clients/{uid}/pushQueue/{pushId}
// ----------------------------------------------------------------------------
exports.sendPushFromQueue = functions.database
  .ref("/clients/{uid}/pushQueue/{pushId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const pushId = context.params.pushId;

    const job = snap.val() || {};
    const title = String(job.title || "Stallz Loans");
    const body = String(job.body || "You have a new update.");
    const clickAction = String(job.click_action || "client-portal/client.html");

    const tokensSnap = await admin.database().ref(`/clients/${uid}/fcmTokens`).once("value");
    const tokensObj = tokensSnap.val() || {};
    const tokenEntries = collectTokenEntries(tokensObj);

    if (!tokenEntries.length) {
      await snap.ref.remove();
      return null;
    }

    const message = buildMulticastMessage({
      title,
      body,
      clickAction,
      portal: "client",
      source: String(job.source || "CLIENT"),
      pushId: String(job.pushId || pushId),
      extraData: {
        notifId: job.notifId || "",
        type: job.source || "",
        dedupeKey: job.dedupeKey || `client_${uid}_${job.notifId || pushId}`
      }
    });

    const res = await admin.messaging().sendEachForMulticast({
      ...message,
      tokens: tokenEntries.map((e) => e.token)
    });

    await cleanupBadTokens({ basePath: "/clients", uid, tokenEntries, multicastResponse: res });

    // Remove queue job after sending
    await snap.ref.remove();
    return null;
  });

// ----------------------------------------------------------------------------
// 2) ENQUEUE: Shared notifications for clients -> client pushQueue
// Path: /stallzShared_v1/notifications/users/{uid}/{notifId}
// ----------------------------------------------------------------------------
exports.enqueuePushOnClientNotification = functions.database
  .ref("/stallzShared_v1/notifications/users/{uid}/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    if (n && n.read === true) return null;

    await admin.database().ref(`/clients/${uid}/pushQueue`).push().set({
      title: String(n.title || "Stallz Loans"),
      body: String(n.body || "You have a new update."),
      click_action: String(n.click_action || "client-portal/client.html"),
      portal: "client",
      createdAt: new Date().toISOString(),
      source: String(n.type || "CLIENT_NOTIFICATION"),
      notifId
    });

    return null;
  });

// ----------------------------------------------------------------------------
// 2B) ENQUEUE: Legacy client notifications -> client pushQueue
// Path: /clients/{uid}/notifications/{notifId}
// ----------------------------------------------------------------------------
exports.enqueuePushOnLegacyClientNotification = functions.database
  .ref("/clients/{uid}/notifications/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    if (n && n.read === true) return null;

    await admin.database().ref(`/clients/${uid}/pushQueue`).push().set({
      title: String(n.title || "Stallz Loans"),
      body: String(n.body || "You have a new update."),
      click_action: String(n.click_action || "client-portal/client.html"),
      portal: "client",
      createdAt: new Date().toISOString(),
      source: String(n.type || "CLIENT_NOTIFICATION"),
      notifId
    });

    return null;
  });

// ----------------------------------------------------------------------------
// 3) ADMIN: Notify admins on NEW pending loan request
// Path: /clients/{clientUid}/requests/{reqId}
// ----------------------------------------------------------------------------
exports.notifyAdminsOnLoanRequest = functions.database
  .ref("/clients/{clientUid}/requests/{reqId}")
  .onCreate(async (snap, context) => {
    const req = snap.val() || {};
    if (String(req.status || "").toUpperCase() !== "PENDING") return null;

    const clientName = String(req.clientName || "A client");
    const amount = String(req.amount || "0");

    const title = "New Loan Request";
    const body = `${clientName} has requested K${amount}.`;
    const clickAction = "admin/admin.html";

    const tokenEntries = await collectAllAdminTokens();
    if (!tokenEntries.length) return null;

    const message = buildMulticastMessage({
      title,
      body,
      clickAction,
      portal: "admin",
      source: "ADMIN_ALERT",
      pushId: `req_${context.params.reqId}`,
      extraData: {
        type: "NEW_LOAN_REQUEST",
        requestId: context.params.reqId,
        clientUid: context.params.clientUid,
        dedupeKey: `req_${context.params.reqId}`
      }
    });

    const res = await admin.messaging().sendEachForMulticast({
      ...message,
      tokens: tokenEntries.map((e) => e.token)
    });

    // Cleanup bad admin tokens
    const bad = [];
    res.responses.forEach((r, i) => {
      if (!r.success) bad.push(tokenEntries[i]);
    });

    if (bad.length) {
      const updates = {};
      bad.forEach((e) => {
        if (!e) return;
        updates[`/admins/${e.adminUid}/fcmTokens/${e.tokenKey}`] = null;
      });
      await admin.database().ref().update(updates);
    }

    return null;
  });

// ----------------------------------------------------------------------------
// 4) ADMIN: Shared admin notifications -> push to ALL admins
// Path: /stallzShared_v1/notifications/admin/{notifId}
// ----------------------------------------------------------------------------
exports.sendPushOnAdminSharedNotification = functions.database
  .ref("/stallzShared_v1/notifications/admin/{notifId}")
  .onCreate(async (snap, context) => {
    const notifId = context.params.notifId;
    const n = snap.val() || {};
    if (n && n.read === true) return null;

    const tokenEntries = await collectAllAdminTokens();
    if (!tokenEntries.length) return null;

    const message = buildMulticastMessage({
      title: String(n.title || "Stallz Loans"),
      body: String(n.body || "You have a new admin alert."),
      clickAction: String(n.click_action || "admin/admin.html"),
      portal: "admin",
      source: String(n.type || "ADMIN_NOTIFICATION"),
      pushId: `admin_${notifId}`,
      extraData: {
        notifId,
        type: String(n.type || "ADMIN_NOTIFICATION"),
        dedupeKey: `admin_${notifId}`
      }
    });

    const res = await admin.messaging().sendEachForMulticast({
      ...message,
      tokens: tokenEntries.map((e) => e.token)
    });

    // Cleanup bad admin tokens
    const bad = [];
    res.responses.forEach((r, i) => {
      if (!r.success) bad.push(tokenEntries[i]);
    });

    if (bad.length) {
      const updates = {};
      bad.forEach((e) => {
        if (!e) return;
        updates[`/admins/${e.adminUid}/fcmTokens/${e.tokenKey}`] = null;
      });
      await admin.database().ref().update(updates);
    }

    return null;
  });

// ----------------------------------------------------------------------------
// 5) ADMIN: Legacy admin notifications -> push to that admin
// Path: /admins/{uid}/notifications/{notifId}
// ----------------------------------------------------------------------------
exports.sendPushOnLegacyAdminNotification = functions.database
  .ref("/admins/{uid}/notifications/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    if (n && n.read === true) return null;

    const tokensSnap = await admin.database().ref(`/admins/${uid}/fcmTokens`).once("value");
    const tokensObj = tokensSnap.val() || {};
    const tokenEntries = collectTokenEntries(tokensObj);
    if (!tokenEntries.length) return null;

    const message = buildMulticastMessage({
      title: String(n.title || "Stallz Loans"),
      body: String(n.body || "You have a new alert."),
      clickAction: String(n.click_action || "admin/admin.html"),
      portal: "admin",
      source: String(n.type || "ADMIN_NOTIFICATION"),
      pushId: `admin_${uid}_${notifId}`,
      extraData: {
        notifId,
        type: String(n.type || "ADMIN_NOTIFICATION"),
        dedupeKey: `admin_${uid}_${notifId}`
      }
    });

    const res = await admin.messaging().sendEachForMulticast({
      ...message,
      tokens: tokenEntries.map((e) => e.token)
    });

    await cleanupBadTokens({ basePath: "/admins", uid, tokenEntries, multicastResponse: res });
    return null;
  });
