/**
 * ============================================================================
 * STALLZ LOANS - AUTH.JS
 * Optimized v3.5: Multi-Device FCM Push Handoff & KYC Strict Routing Enabled
 * ============================================================================
 */

(function() {
  const StallzAuth = {

    /* ==========================================
       1.0 | SESSION MANAGEMENT
       ========================================== */

    /**
     * Retrieves the current user session from local storage.
     */
    getSession() {
      try {
        const sess = localStorage.getItem("stallz_test_session");
        return sess ? JSON.parse(sess) : null;
      } catch (e) {
        console.error("Session retrieval error:", e);
        return null;
      }
    },

    /**
     * Saves user details and role to local storage.
     */
    saveSession(user, role) {
      const sess = {
        uid: user.uid,
        email: user.email,
        role: role,
        loginTime: Date.now()
      };
      localStorage.setItem("stallz_test_session", JSON.stringify(sess));
      localStorage.setItem("stallz_last_active", Date.now());
    },

    /**
     * Completes the Anonymous Token Handoff securely (Multi-Device Version).
     */
    async syncPendingFCMToken(uid) {
      try {
        const pendingToken = localStorage.getItem("stallz_pending_fcm_token");
        if (!pendingToken || !uid) return;

        // Basic hardening (prevents localStorage injection bloating your DB)
        const token = String(pendingToken).trim();
        const MAX_LEN = 400;
        const MIN_LEN = 20;
        const SAFE_RE = /^[A-Za-z0-9\-_:]+$/;

        if (token.length < MIN_LEN || token.length > MAX_LEN || !SAFE_RE.test(token)) {
          console.warn("Blocked suspicious FCM token payload.");
          localStorage.removeItem("stallz_pending_fcm_token");
          return;
        }

        // Store tokens under the correct user root.
        // - Clients: clients/{uid}/fcmTokens
        // - Admins:  admins/{uid}/fcmTokens
        const sessRole = (this.getSession && this.getSession()?.role) || null;
        const rootPath = (sessRole === 'admin') ? `admins/${uid}/fcmTokens` : `clients/${uid}/fcmTokens`;

        const tokensRef = firebase.database().ref(rootPath);

        // Deterministic key = stable per token (prevents duplicates + multi-tabs spam)
        const tokenKey = (function fnv1a(str){
          let h = 2166136261;
          for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h + (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24)) >>> 0;
          }
          return 't_' + h.toString(16);
        })(token);

        const meta = {
          token: token,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          appVersion: (window.STALLZ_APP_VERSION || window.STALLZ_APP_CONFIG?.version || null),
          ua: (typeof navigator !== "undefined" ? navigator.userAgent : null)
        };

        // Preserve original createdAt if this token already exists
        try {
          const existing = await tokensRef.child(tokenKey).get();
          if (existing.exists() && existing.val()?.createdAt) meta.createdAt = existing.val().createdAt;
        } catch (_) {}

        await tokensRef.child(tokenKey).set(meta);

        // Move it to 'active' storage so this device remembers its own token
        localStorage.setItem("stallz_active_fcm_token", token);
        localStorage.removeItem("stallz_pending_fcm_token");

      } catch (e) {
        console.warn("FCM Token handoff failed:", e);
      }
    },

    /* ==========================================
       2.0 | AUTHENTICATION LOGIC
       ========================================== */

    /**
     * Handles user sign-in and determines access level (Admin vs Client).
     * Supports silent re-sync for Gatekeeper routing.
     */
    async signIn(email, password, isReSync = false) {
      try {
        let user;

        if (!isReSync) {
            // Standard Login Flow
            await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            user = userCredential.user;
        } else {
            // Gatekeeper Re-sync Flow (Skips password check, uses active session)
            user = firebase.auth().currentUser;
            if (!user) throw new Error("No active session found");
            email = user.email; // Grab email for the V5 check below
        }

        let role = 'client';

        try {
          // Check Root Admin Node (Priority 1)
          const rootSnap = await firebase.database().ref(`admins/${user.uid}`).get();
          if (rootSnap.exists()) {
              role = 'admin';
          } else {
              // Check V5 Admin List (Priority 2)
              const v5Snap = await firebase.database().ref(`loanManagerData_v5/admins`).get();
              const v5Admins = v5Snap.val() || [];

              const adminList = Array.isArray(v5Admins) ? v5Admins : Object.values(v5Admins);

              const isV5Admin = adminList.some(a =>
                  a.email && a.email.toLowerCase() === email.toLowerCase()
              );

              if (isV5Admin) role = 'admin';
          }
        } catch (e) {
          console.warn("Role check warning (defaulting to client):", e);
        }

        this.saveSession(user, role);
        if (!isReSync) await this.syncPendingFCMToken(user.uid);

        return { user, role };

      } catch (error) {
        throw error;
      }
    },

    /**
     * ==========================================
     * REGISTRATION PATH A: 1-STEP DIRECT REGISTRATION
     * (Used when ENABLE_PHONE_OTP = false)
     * ==========================================
     */
    async registerClient(data) {
      // Destructure 'city' from the payload to ensure it is saved separately for Admin sorting
      const { email, password, phone, nrc, address, city, dob, gender, occupation, nextOfKinName, nextOfKinPhone, momoName, whatsapp } = data;

      const firstName = (data.firstName || "").trim().toUpperCase();
      const surname = (data.surname || "").trim().toUpperCase();
      const fullName = `${firstName} ${surname}`;

      // 1. Create Firebase Auth Account
      const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // 2. Build Structured Profile
      const profile = {
        uid: user.uid, id: user.uid, name: fullName, firstName: firstName, surname: surname,
        dob: dob || "", gender: gender || "", email: email, phone: phone, whatsapp: whatsapp || "",
        momoName: (momoName || "").trim().toUpperCase(), nrc: nrc, occupation: occupation || "",
        address: address, city: city || "", nextOfKinName: (nextOfKinName || "").trim().toUpperCase(),
        nextOfKinPhone: nextOfKinPhone || "", role: 'client',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };

      // 3. Save to Database & Sync Push Token
      await firebase.database().ref(`clients/${user.uid}`).set(profile);
      this.saveSession(user, 'client');
      await this.syncPendingFCMToken(user.uid);

      return { user, role: 'client' };
    },

    /**
     * ==========================================
     * REGISTRATION PATH B: 2-STEP SMS OTP
     * (Used when ENABLE_PHONE_OTP = true)
     * ==========================================
     */

    // Step 1: Request SMS OTP via Firebase
    async sendPhoneOTP(phone, appVerifier) {
      // 1. Format the phone number to E.164 Standard for Zambia
      let formattedPhone = phone.replace(/\D/g, '');
      if (formattedPhone.startsWith('0')) formattedPhone = '+260' + formattedPhone.substring(1);
      else if (formattedPhone.startsWith('260')) formattedPhone = '+' + formattedPhone;
      else if (!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;

      // 2. Trigger Firebase SMS
      window.confirmationResult = await firebase.auth().signInWithPhoneNumber(formattedPhone, appVerifier);
      return true;
    },

    // Step 2: Verify the Code and Create the Account
    async verifyOTPAndRegister(code, data) {
      if (!window.confirmationResult) throw new Error("No OTP request found. Please try again.");

      const { email, password, phone, nrc, address, city, dob, gender, occupation, nextOfKinName, nextOfKinPhone, momoName, whatsapp } = data;

      // 1. Confirm OTP (Logs them in via Phone)
      const result = await window.confirmationResult.confirm(code);
      const user = result.user;

      // 2. Link Email & Password so they can log in via email next time
      try {
        const credential = firebase.auth.EmailAuthProvider.credential(email, password);
        await user.linkWithCredential(credential);
      } catch (linkError) {
        // We do NOT delete the user here, just in case they are logging into a pre-existing account
        throw new Error("This Email Address or Phone Number is already registered. Please log in.");
      }

      // 3. FORCE UPPERCASE FORMATTING for names
      const firstName = (data.firstName || "").trim().toUpperCase();
      const surname = (data.surname || "").trim().toUpperCase();
      const fullName = `${firstName} ${surname}`;
      const nokName = (nextOfKinName || "").trim().toUpperCase();
      const mobileMoneyName = (momoName || "").trim().toUpperCase();

      // 4. Build Structured Profile
      const profile = {
        uid: user.uid, id: user.uid, name: fullName, firstName: firstName, surname: surname,
        dob: dob || "", gender: gender || "", email: email, phone: phone, whatsapp: whatsapp || "",
        momoName: mobileMoneyName, nrc: nrc, occupation: occupation || "",
        address: address, city: city || "", nextOfKinName: nokName, nextOfKinPhone: nextOfKinPhone || "",
        role: 'client', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };

      // 5. Save to Database
      await firebase.database().ref(`clients/${user.uid}`).set(profile);

      // 6. Initialize Session & Sync Push Token
      this.saveSession(user, 'client');
      await this.syncPendingFCMToken(user.uid);

      return { user, role: 'client' };
    },

    /**
     * Signs the user out and wipes device push tokens.
     */
    async signOut() {
      try {
        const user = firebase.auth().currentUser;
        if (user) {
          // Security: Only remove THIS specific device's token from the database list
          const activeToken = localStorage.getItem("stallz_active_fcm_token");
          if (activeToken) {
            const sessRole = (this.getSession && this.getSession()?.role) || null;
            const rootPath = (sessRole === 'admin') ? `admins/${user.uid}/fcmTokens` : `clients/${user.uid}/fcmTokens`;

            const tokenKey = (function fnv1a(str){
              let h = 2166136261;
              for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i);
                h = (h + (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24)) >>> 0;
              }
              return 't_' + h.toString(16);
            })(String(activeToken));

            try { await firebase.database().ref(`${rootPath}/${tokenKey}`).remove(); } catch (_) {}
          }
        }
        await firebase.auth().signOut();
      } catch (e) {
        console.warn("Firebase signout failed, clearing local storage anyway.");
      }

      localStorage.removeItem("stallz_test_session");
      localStorage.removeItem("stallz_last_active");
      localStorage.removeItem("stallz_client_profile"); // Clear client cache

      // CLEARS THE PIN so the user can create a new one next time
      localStorage.removeItem("stallz_app_pin");
      localStorage.removeItem("stallz_pending_fcm_token"); // Failsafe
      localStorage.removeItem("stallz_active_fcm_token"); // Clear the active token memory
    },

    /* ==========================================
       3.0 | UTILITIES
       ========================================== */

    /**
     * Global Utility: Validates if a given Date of Birth makes the user 18 or older.
     */
    isOver18(dateString) {
        if (!dateString) return false;

        const dob = new Date(dateString);
        const today = new Date();

        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            age--;
        }

        return age >= 18;
    },

    /**
     * Fetches the complete profile data for a given UID.
     */
    async getProfile(uid, role) {
      const path = (role === 'admin') ? `admins/${uid}` : `clients/${uid}`;
      const snap = await firebase.database().ref(path).get();
      return snap.exists() ? snap.val() : null;
    },

    /**
     * HELPER: Restores session if LocalStorage is empty but Firebase is logged in.
     * Useful for the Client Portal refresh logic.
     */
    async syncSessionFromUser(user) {
        if(!user) return null;

        let role = 'client';
        // Quick check if they are an admin
        const adminSnap = await firebase.database().ref(`admins/${user.uid}`).get();
        if (adminSnap.exists()) role = 'admin';

        this.saveSession(user, role);
        return this.getSession();
    },

    /**
     * Helper to wait for the initial Firebase Auth state.
     */
    onceAuthState() {
      return new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
          unsubscribe();
          resolve(user);
        });
      });
    }
  };
  // Expose to Global Window
  window.StallzAuth = StallzAuth;
})();