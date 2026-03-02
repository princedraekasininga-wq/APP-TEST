# STALLZ LOANS — PWA

## Push Notifications (FCM) — What was fixed/added
### Client Portal
- A new **Push Notifications** button exists in **Profile & Settings**.
- It prompts for permission and generates an **FCM token** using your VAPID key.
- The token is stored as a *pending handoff* in:
  - `localStorage.stallz_pending_fcm_token`
- On login (or immediately if already logged in), the token is synced into RTDB:
  - `/clients/{uid}/fcmTokens/{pushKey} = { token, createdAt, appVersion, ua }`

### Admin Portal
- When sending a Custom Alert, the admin now:
  1) Saves the in-app notification to `/clients/{uid}/notifications/{notifId}`
  2) Enqueues a push job to `/clients/{uid}/pushQueue/{pushId}`

### Backend (Required for OS-level pushes)
Realtime Database writes **do not** automatically trigger OS-level push.  
To deliver background notifications, deploy the Cloud Function inside `/functions`.

See: `/functions/README.md`

---

## Firebase Config Consistency
Firebase config is now centralized:
- `shared/app-config.js` (single source of truth)
- Used by:
  - `shared/firebase-init.js`
  - `sw.js` (service worker)

Quick override (optional):
- URL: `?db=main` or `?db=test`
- localStorage: `stallz_firebase_mode = "main" | "test"`

---

## Security Rules Snippet (Token hardening)
Recommended RTDB rule pattern for tokens stored as values (not keys):

```
"clients": {
  "$uid": {
    "fcmTokens": {
      "$tokenId": {
        ".read": "auth != null && (auth.uid === $uid || root.child('roles').child(auth.uid).val() === 'admin')",
        ".write": "auth != null && auth.uid === $uid",
        "token": {
          ".validate": "newData.isString() && newData.val().matches('^[A-Za-z0-9\\-_:]{20,400}$')"
        },
        "createdAt": { ".validate": "newData.isString()" }
      }
    }
  }
}
```

---

## Offline / Online UX
- Offline banner is now smarter:
  - Shows **Connecting/Reconnecting** first when RTDB is slow
  - Only escalates to **Offline** after a grace period
- When connection returns, it shows a **Back online — syncing...** pulse instead of silently disappearing.

