# Stallz Loans — Cloud Functions (FCM)

This folder enables **real OS-level push notifications** (background notifications) via Firebase Cloud Functions.

## What it does
- Admin writes an in-app notification to: `/clients/{uid}/notifications/{notifId}`
- Admin also enqueues a push job to: `/clients/{uid}/pushQueue/{pushId}`
- Cloud Function `sendPushFromQueue` triggers, reads `/clients/{uid}/fcmTokens`, sends FCM push to all tokens, then removes the queue job.

## Deploy (high level)
1. In Firebase CLI:
   - `firebase init functions`
   - Replace generated `functions/index.js` with this one (or copy this folder into the generated project).
2. Deploy:
   - `firebase deploy --only functions`

## Notes
- Tokens are stored as objects under `/clients/{uid}/fcmTokens/{pushKey}` with `{ token, createdAt, ... }`
- Invalid tokens are auto-removed when FCM reports them as unregistered.
