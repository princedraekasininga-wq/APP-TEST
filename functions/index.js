/* eslint-disable */
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();

// Trigger: when an admin enqueues a push job for a client
// Path: /clients/{uid}/pushQueue/{pushId}
exports.sendPushFromQueue = functions.database
  .ref("/clients/{uid}/pushQueue/{pushId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const pushId = context.params.pushId;

    const job = snap.val() || {};
    const title = String(job.title || "Stallz Loans");
    const body = String(job.body || "");
    const clickAction = String(job.click_action || "client-portal/client.html");

    // Load all registered FCM tokens for this client
    const tokensSnap = await admin.database().ref(`/clients/${uid}/fcmTokens`).once("value");
    const tokensObj = tokensSnap.val() || {};

    const tokenEntries = Object.entries(tokensObj)
      .map(([k, v]) => ({ key: k, token: v && v.token }))
      .filter(x => typeof x.token === "string" && x.token.length > 0);

    if (tokenEntries.length === 0) {
      // No tokens: just delete the queue job
      await snap.ref.remove();
      return null;
    }

    const tokens = tokenEntries.map(x => x.token);

    // functions/index.js  ✅ DATA-ONLY MESSAGE (no auto-notification)
const message = {
  data: {
    title: String(title),
    body: String(body),
    click_action: String(clickAction),
    source: String(job.source || "STALLZ"),
    pushId: String(pushId)
  },
  tokens
};

const res = await admin.messaging().sendEachForMulticast(message);
    // Clean up invalid tokens
    const badKeys = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code ? String(r.error.code) : "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          badKeys.push(tokenEntries[i].key);
        }
      }
    });

    if (badKeys.length) {
      const updates = {};
      badKeys.forEach(k => updates[`/clients/${uid}/fcmTokens/${k}`] = null);
      await admin.database().ref().update(updates);
    }

    // Remove the job (prevents duplicates)
    await snap.ref.remove();

    return null;
  });



// Trigger: when ANY client notification is created, enqueue an FCM push job
// Path: /clients/{uid}/notifications/{notifId}
exports.enqueuePushOnClientNotification = functions.database
  .ref("/clients/{uid}/notifications/{notifId}")
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const notifId = context.params.notifId;

    const n = snap.val() || {};
    const title = String(n.title || "Stallz Loans");
    const body = String(n.body || "You have a new update.");
    const clickAction = String(n.click_action || "client-portal/client.html");
    const source = String(n.type || n.source || "CLIENT_NOTIFICATION");

    try {
      const qRef = admin.database().ref(`/clients/${uid}/pushQueue`).push();
      await qRef.set({
        title,
        body,
        click_action: clickAction,
        createdAt: new Date().toISOString(),
        source,
        notifId
      });
    } catch (e) {
      console.warn("Failed to enqueue pushQueue for notification:", e);
    }

    return null;
  });

// Trigger: Notify ALL Admins when a new loan request is created
// Path: /stallzShared_v1/loanRequests/{reqId}
exports.notifyAdminsOnLoanRequest = functions.database
  .ref("/stallzShared_v1/loanRequests/{reqId}")
  .onCreate(async (snap, context) => {
    const req = snap.val() || {};
    const clientName = String(req.clientName || "A client");
    const amount = String(req.amount || "0");

    const title = "📝 New Loan Request";
    const body = `${clientName} has requested K${amount}.`;
    const clickAction = "admin/admin.html"; // Clicking the push opens the admin panel

    // 1. Fetch all admin tokens
    const adminsSnap = await admin.database().ref("/admins").once("value");
    const adminsObj = adminsSnap.val() || {};

    const tokens = [];
    Object.values(adminsObj).forEach(adminUser => {
        if (adminUser.fcmTokens) {
            Object.values(adminUser.fcmTokens).forEach(tokenData => {
                if (tokenData && tokenData.token) {
                    tokens.push(tokenData.token);
                }
            });
        }
    });

    if (tokens.length === 0) {
        console.log("No admin tokens registered.");
        return null;
    }

    // 2. Create the data payload for sw.js
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

    // 3. Send the multicast message to all admins
    const res = await admin.messaging().sendEachForMulticast(message);
    console.log(`Sent to ${tokens.length} admins. Success: ${res.successCount}, Failures: ${res.failureCount}`);

    return null;
  });