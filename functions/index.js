/* eslint-disable */
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();

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
    const clickAction = String(job.click_action || "client-portal/client.html");

    const tokensSnap = await admin.database().ref(`/clients/${uid}/fcmTokens`).once("value");
    const tokensObj = tokensSnap.val() || {};

    const tokenEntries = Object.entries(tokensObj)
      .map(([k, v]) => ({ key: k, token: v && v.token }))
      .filter(x => typeof x.token === "string" && x.token.length > 0);

    if (tokenEntries.length === 0) {
      await snap.ref.remove();
      return null;
    }

    const tokens = tokenEntries.map(x => x.token);

    // MUST use data-only payload for sw.js to catch it properly
    const message = {
      data: {
        title: title,
        body: body,
        click_action: clickAction,
        source: String(job.source || "STALLZ"),
        pushId: String(job.pushId || job.notifId || pushId)
      },
      tokens: tokens
    };

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
    const clickAction = String(n.click_action || "client-portal/client.html");
    const source = String(n.type || "CLIENT_NOTIFICATION");

    try {
      await admin.database().ref(`/clients/${uid}/pushQueue`).push().set({
        title,
        body,
        click_action: clickAction,
        createdAt: new Date().toISOString(),
        source,
        notifId
      });
    } catch (e) {
      console.warn("Failed to enqueue pushQueue:", e);
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
    const clickAction = "admin/admin.html";

    const adminsSnap = await admin.database().ref("/admins").once("value");
    const adminsObj = adminsSnap.val() || {};

    const tokenSet = new Set();
Object.values(adminsObj).forEach(adminUser => {
  if (adminUser && adminUser.fcmTokens) {
    Object.values(adminUser.fcmTokens).forEach(td => {
      if (td && td.token) tokenSet.add(String(td.token));
    });
  }
});

const tokens = Array.from(tokenSet);
if (tokens.length === 0) return null;

    const message = {
      data: {
        title: title,
        body: body,
        click_action: clickAction,
        source: "ADMIN_ALERT",
        pushId: "req_" + context.params.reqId
      },
      tokens: tokens
    };

    await admin.messaging().sendEachForMulticast(message);
    return null;
  });

// 4. Trigger: Direct client notifications path (Admin writes here)
 // Path: /clients/{uid}/notifications/{notifId}
exports.enqueuePushOnClientDirectNotification = functions.database
  .ref("/clients/{uid}/notifications/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    const title = String(n.title || "Stallz Loans");
    const body = String(n.body || "You have a new update.");
    const clickAction = String(n.click_action || n.clickAction || "client-portal/client.html");
    const source = String(n.type || "CLIENT_NOTIFICATION_DIRECT");

    try {
      await admin.database().ref(`/clients/${uid}/pushQueue`).push().set({
        title,
        body,
        click_action: clickAction,
        createdAt: new Date().toISOString(),
        source,
        notifId,
        pushId: String(notifId) // helps device-side dedupe (tag)
      });
    } catch (e) {
      console.warn("Failed to enqueue pushQueue (direct):", e);
    }
    return null;
  });


// 5. Trigger: Admin alerts path (shared notifications)
 // Path: /stallzShared_v1/notifications/admin/{notifId}
exports.enqueuePushOnAdminNotification = functions.database
  .ref("/stallzShared_v1/notifications/admin/{notifId}")
  .onCreate(async (snap, context) => {
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    const title = String(n.title || "Admin Alert");
    const body = String(n.body || "You have a new update.");
    const clickAction = String(n.click_action || n.clickAction || "admin/admin.html");

    const adminsSnap = await admin.database().ref("/admins").once("value");
    const adminsObj = adminsSnap.val() || {};

    const tokenSet = new Set();
    Object.values(adminsObj).forEach(adminUser => {
      if (adminUser && adminUser.fcmTokens) {
        Object.values(adminUser.fcmTokens).forEach(td => {
          if (td && td.token) tokenSet.add(String(td.token));
        });
      }
    });

    const tokens = Array.from(tokenSet);
    if (!tokens.length) return null;

    const message = {
      data: {
        title,
        body,
        click_action: clickAction,
        source: "ADMIN_NOTIFICATION",
        pushId: "admin_notif_" + String(notifId)
      },
      tokens
    };

    await admin.messaging().sendEachForMulticast(message);
    return null;
  });


// 6. Trigger: Notify admins on NEW client message
 // Path: /stallzShared_v1/messages/{clientUid}/{msgId}
exports.notifyAdminsOnClientMessage = functions.database
  .ref("/stallzShared_v1/messages/{clientUid}/{msgId}")
  .onCreate(async (snap, context) => {
    const clientUid = context.params.clientUid;
    const msgId = context.params.msgId;

    const m = snap.val() || {};
    if (String(m.fromRole || "").toLowerCase() !== "client") return null;

    // best-effort client label
    let clientLabel = "Client";
    try {
      const cSnap = await admin.database().ref(`/clients/${clientUid}`).once("value");
      const c = cSnap.val() || {};
      clientLabel = String(c.name || c.fullName || c.firstName || c.phone || "Client");
    } catch (_) {}

    const text = String(m.text || "");
    const preview = text.length > 140 ? (text.slice(0, 137) + "...") : text;

    const adminsSnap = await admin.database().ref("/admins").once("value");
    const adminsObj = adminsSnap.val() || {};

    const tokenSet = new Set();
    Object.values(adminsObj).forEach(adminUser => {
      if (adminUser && adminUser.fcmTokens) {
        Object.values(adminUser.fcmTokens).forEach(td => {
          if (td && td.token) tokenSet.add(String(td.token));
        });
      }
    });

    const tokens = Array.from(tokenSet);
    if (!tokens.length) return null;

    const message = {
      data: {
        title: `New Message: ${clientLabel}`,
        body: preview || "You have a new client message.",
        click_action: "admin/admin.html",
        source: "ADMIN_MESSAGE",
        pushId: "msg_" + String(msgId)
      },
      tokens
    };

    await admin.messaging().sendEachForMulticast(message);
    return null;
  });
