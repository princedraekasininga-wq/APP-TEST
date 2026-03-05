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

    if (typeof token === "string" && token.length > 0) {
      entries.push({ key: k, token });
    }
  });
  return entries;
}

function buildDataMessage({ title, body, clickAction, portal, source, pushId, extraData }) {
  const data = {
    title: String(title || "Stallz Loans"),
    body: String(body || "You have a new update."),
    click_action: String(clickAction || (portal === "admin" ? "/admin/admin.html" : "/client-portal/client.html")),
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
  return { data };
}

// 1. Trigger: Actually Send the Push from the Queue
// Path: /clients/{uid}/pushQueue/{pushId}
exports.sendPushFromQueue = functions.database
  .ref("/clients/{uid}/pushQueue/{pushId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const pushId = context.params.pushId;

    const job = snap.val() || {};
    const title = String(job.title || "Stallz Loans");
    const body = String(job.body || "You have a new update.");
    const clickAction = String(job.click_action || "/client-portal/client.html");

    const tokensSnap = await admin.database().ref(`/clients/${uid}/fcmTokens`).once("value");
    const tokensObj = tokensSnap.val() || {};

    const tokenEntries = collectTokenEntries(tokensObj);
if (tokenEntries.length === 0) {
      await snap.ref.remove();
      return null;
    }

    const tokens = tokenEntries.map(x => x.token);

<<<<<<< HEAD
    // Send webpush with BOTH data + notification for maximum reliability (especially on mobile/PWA)
    // - data: consumed by the app UI + sw.js click routing
    // - notification/webpush.notification: ensures background notifications display even if the browser throttles data-only pushes
    const message = {
      notification: { title: title, body: body },
      data: {
        title: title,
        body: body,
        click_action: clickAction,
        portal: "client",
        source: String(job.source || "STALLZ"),
        pushId: String(pushId)
      },
      webpush: {
        headers: { Urgency: "high" },
        notification: {
          title: title,
          body: body,
          icon: "/assets/logo_images/icon-192.png",
          badge: "/assets/logo_images/myfavicon.png"
        },
        fcmOptions: { link: clickAction }
      },
      tokens: tokens
    };
=======
    // MUST use data-only payload for sw.js to catch it properly
const payload = buildDataMessage({
  title,
  body,
  clickAction,
  portal: "client",
  source: String(job.source || "STALLZ"),
  pushId: String(pushId),
  extraData: {
    notifId: job.notifId || "",
    type: job.source || ""
  }
});

const message = { ...payload, tokens };
>>>>>>> 846dee3 ( updated push notifications functionality)

    const res = await admin.messaging().sendEachForMulticast(message);

    // Cleanup bad tokens
    const badKeys = [];
    res.responses.forEach((r, i) => {
      if (!r.success) badKeys.push(tokenEntries[i].key);
    });

    if (badKeys.length) {
      const updates = {};
      badKeys.forEach(k => updates[`/clients/${uid}/fcmTokens/${k}`] = null);
      await admin.database().ref().update(updates);
    }

    await snap.ref.remove();
    return null;
  });


// 2. Trigger: Listen to the NEW Shared Notifications Path for Clients
// Path: /stallzShared_v1/notifications/users/{uid}/{notifId}
exports.enqueuePushOnClientNotification = functions.database
  .ref("/stallzShared_v1/notifications/users/{uid}/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    const title = String(n.title || "Stallz Loans");
    const body = String(n.body || "You have a new update.");
    const clickAction = String(n.click_action || "/client-portal/client.html");
    const source = String(n.type || "CLIENT_NOTIFICATION");

    try {
      await admin.database().ref(`/clients/${uid}/pushQueue`).push().set({
        title,
        body,
        click_action: clickAction,
        portal: "client",
        createdAt: new Date().toISOString(),
        source,
        notifId
      });
    } catch (e) {
      console.warn("Failed to enqueue pushQueue:", e);
    }
    return null;
  });


// 2B. Trigger: Listen to LEGACY Client Notifications (Admin portal writes here)
// Path: /clients/{uid}/notifications/{notifId}
// NOTE: onCreate only -> marking read will NOT trigger a push
exports.enqueuePushOnLegacyClientNotification = functions.database
  .ref("/clients/{uid}/notifications/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    if (n && n.read === true) return null;

    const title = String(n.title || "Stallz Loans");
    const body = String(n.body || "You have a new update.");
    const clickAction = String(n.click_action || "/client-portal/client.html");
    const source = String(n.type || "CLIENT_NOTIFICATION");

    try {
      await admin.database().ref(`/clients/${uid}/pushQueue`).push().set({
        title,
        body,
        click_action: clickAction,
        portal: "client",
        createdAt: new Date().toISOString(),
        source,
        notifId
      });
    } catch (e) {
      console.warn("Failed to enqueue legacy client pushQueue:", e);
    }
    return null;
  });



// 3. Trigger: Listen to the NEW Client Requests Path to Notify Admins
// Path: /clients/{clientUid}/requests/{reqId}
exports.notifyAdminsOnLoanRequest = functions.database
  .ref("/clients/{clientUid}/requests/{reqId}")
  .onCreate(async (snap, context) => {
    const req = snap.val() || {};

    // Only fire for brand new pending requests
    if (String(req.status).toUpperCase() !== "PENDING") return null;

    const clientName = String(req.clientName || "A client");
    const amount = String(req.amount || "0");

    const title = "New Loan Request";
    const body = `${clientName} has requested K${amount}.`;
    const clickAction = "/admin/admin.html";

    const adminsSnap = await admin.database().ref("/admins").once("value");
    const adminsObj = adminsSnap.val() || {};

    const tokens = [];
    Object.values(adminsObj).forEach((adminUser) => {
      const entries = collectTokenEntries(adminUser?.fcmTokens || {});
      entries.forEach((e) => tokens.push(e.token));
    });

// 2C. Trigger: Admin shared notifications -> push to ALL admins
// Path: /stallzShared_v1/notifications/admin/{notifId}
// NOTE: onCreate only -> marking read will NOT trigger a push
exports.sendPushOnAdminSharedNotification = functions.database
  .ref("/stallzShared_v1/notifications/admin/{notifId}")
  .onCreate(async (snap, context) => {
    const notifId = context.params.notifId;
    const n = snap.val() || {};
    if (n && n.read === true) return null;

    const title = String(n.title || "Stallz Loans");
    const body = String(n.body || "You have a new admin alert.");
    const clickAction = String(n.click_action || "/admin/admin.html");
    const source = String(n.type || "ADMIN_NOTIFICATION");

    const adminsSnap = await admin.database().ref("/admins").once("value");
    const adminsObj = adminsSnap.val() || {};

    const tokenEntries = [];
    Object.entries(adminsObj).forEach(([adminUid, adminUser]) => {
      const entries = collectTokenEntries(adminUser?.fcmTokens || {});
      entries.forEach((e) => tokenEntries.push({ adminUid, tokenKey: e.key, token: e.token }));
    });

    if (!tokenEntries.length) return null;

    const tokens = tokenEntries.map((e) => e.token);

    const payload = buildDataMessage({
      title,
      body,
      clickAction,
      portal: "admin",
      source,
      pushId: `admin_${notifId || Date.now()}`
    });

    const res = await admin.messaging().sendEachForMulticast({ ...payload, tokens });

    // Cleanup bad tokens
    const bad = [];
    res.responses.forEach((r, i) => {
      if (!r.success) bad.push(tokenEntries[i]);
    });

    if (bad.length) {
      const updates = {};
      bad.forEach((e) => {
        updates[`/admins/${e.adminUid}/fcmTokens/${e.tokenKey}`] = null;
      });
      await admin.database().ref().update(updates);
    }

    return null;
  });


    if (tokens.length === 0) return null;

    const message = {
      notification: { title: title, body: body },
      data: {
        title: title,
        body: body,
        click_action: clickAction,
        portal: "admin",
        source: "ADMIN_ALERT",
        pushId: "req_" + context.params.reqId
      },
      webpush: {
        headers: { Urgency: "high" },
        notification: {
          title: title,
          body: body,
          icon: "/assets/logo_images/icon-192.png",
          badge: "/assets/logo_images/myfavicon.png"
        },
        fcmOptions: { link: clickAction }
      },
      tokens: tokens
    };

    await admin.messaging().sendEachForMulticast(message);
    return null;
  });