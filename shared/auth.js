/**
 * ============================================================================
 * STALLZ LOANS - AUTH.JS
 * Optimized v4.0: Bank-Grade Rolling Session TTL & Inactivity Tracker
 * ============================================================================
 */

(function() {
  const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

  const StallzAuth = {

    /* ==========================================
       1.0 | SECURE SESSION MANAGEMENT
       ========================================== */

    clearLocalData() {
      try { localStorage.removeItem("stallz_test_session"); } catch(e) {}
      try { localStorage.removeItem("stallz_last_active"); } catch(e) {}
      try { localStorage.removeItem("stallz_client_profile"); } catch(e) {}
    },

    getSession() {
      try {
        const sessRaw = localStorage.getItem("stallz_test_session");
        const sess = sessRaw ? JSON.parse(sessRaw) : null;
        if (!sess) return null;

        const now = Date.now();
        const expiresAt = Number(sess.expiresAt || 0);

        if (now > expiresAt) {
          // Time expired! Clean up.
          this.clearLocalData();
          return null;
        }
        return sess;
      } catch (e) {
        return null;
      }
    },

    saveSession(user, role) {
      const sess = {
        uid: user.uid,
        email: user.email,
        role: role,
        loginTime: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS
      };
      localStorage.setItem("stallz_test_session", JSON.stringify(sess));
      localStorage.setItem("stallz_last_active", Date.now());
    },

    extendSession() {
      try {
        const sess = this.getSession();
        if (sess) {
          // Push the expiration time forward by another 30 mins
          sess.expiresAt = Date.now() + SESSION_TTL_MS;
          localStorage.setItem("stallz_test_session", JSON.stringify(sess));
          localStorage.setItem("stallz_last_active", Date.now());
          this.armAutoLogout(); // Restart the background killer timer
        }
      } catch(e) {}
    },

    bindActivityTracker() {
      if (this.__activityBound) return;
      this.__activityBound = true;

      const resetTimer = () => {
         // Throttle updates to local storage so it doesn't fire 100 times a second on scroll
         if (this.__throttle) return;
         this.__throttle = true;
         setTimeout(() => { this.__throttle = false; }, 3000);

         const sess = this.getSession();
         if (sess) this.extendSession();
      };

      // Listen for any interaction to keep the session alive
      document.addEventListener('click', resetTimer, { passive: true });
      document.addEventListener('touchstart', resetTimer, { passive: true });
      document.addEventListener('keydown', resetTimer, { passive: true });
    },

    armAutoLogout() {
      try {
        const sess = this.getSession();
        if (!sess || !sess.expiresAt) return;

        if (this.__logoutTimer) {
          clearTimeout(this.__logoutTimer);
          this.__logoutTimer = null;
        }

        const ms = Math.max(0, Number(sess.expiresAt) - Date.now());
        this.__logoutTimer = setTimeout(async () => {
          await this.signOut();
          const p = location.pathname || '';
          const loginUrl = (p.includes('/client-portal/') || p.includes('/admin/')) ? '../index.html' : 'index.html';
          location.replace(loginUrl);
        }, ms);
      } catch(e) {}
    },

    enforceSessionTTL() {
      if (!this.getSession()) return false;
      this.extendSession();
      this.bindActivityTracker();
      return true;
    },

    /* ==========================================
       2.0 | THE GATEKEEPER (Checks Firebase + TTL)
       ========================================== */
    onceAuthState() {
      return new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
          unsubscribe();

          const sess = this.getSession();

          if (!user) {
            // Firebase says not logged in
            this.clearLocalData();
            resolve(null);
            return;
          }

          if (!sess) {
            // Firebase remembered them, BUT the 30 min timer expired while the app was closed!
            // We must force Firebase to sign out to protect the account.
            firebase.auth().signOut();
            this.clearLocalData();
            resolve(null);
            return;
          }

          // Both Firebase and Timer are valid. Start the activity listener.
          this.extendSession();
          this.bindActivityTracker();
          resolve(user);
        });
      });
    },

    /* ==========================================
       3.0 | AUTHENTICATION LOGIC & FCM
       ========================================== */

    async syncPendingFCMToken(uid) {
      try {
        const pendingToken = localStorage.getItem("stallz_pending_fcm_token");
        if (!pendingToken || !uid) return;

        const token = String(pendingToken).trim();
        const MAX_LEN = 400;
        const MIN_LEN = 20;
        const SAFE_RE = /^[A-Za-z0-9\-_:]+$/;

        if (token.length < MIN_LEN || token.length > MAX_LEN || !SAFE_RE.test(token)) {
          console.warn("Blocked suspicious FCM token payload.");
          localStorage.removeItem("stallz_pending_fcm_token");
          return;
        }

        const sessRole = (this.getSession && this.getSession()?.role) || null;
        const rootPath = (sessRole === 'admin') ? `admins/${uid}/fcmTokens` : `clients/${uid}/fcmTokens`;
        const tokensRef = firebase.database().ref(rootPath);

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

        try {
          const existing = await tokensRef.child(tokenKey).get();
          if (existing.exists() && existing.val()?.createdAt) meta.createdAt = existing.val().createdAt;
        } catch (_) {}

        await tokensRef.child(tokenKey).set(meta);

        localStorage.setItem("stallz_active_fcm_token", token);
        localStorage.removeItem("stallz_pending_fcm_token");

      } catch (e) {
        console.warn("FCM Token handoff failed:", e);
      }
    },

    async signIn(email, password, isReSync = false) {
      try {
        let user;

        if (!isReSync) {
            await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            user = userCredential.user;
        } else {
            user = firebase.auth().currentUser;
            if (!user) throw new Error("No active session found");
            email = user.email;
        }

        let role = 'client';

        try {
          const rootSnap = await firebase.database().ref(`admins/${user.uid}`).get();
          if (rootSnap.exists()) {
              role = 'admin';
          } else {
              const v5Snap = await firebase.database().ref(`loanManagerData_v5/admins`).get();
              const v5Admins = v5Snap.val() || [];
              const adminList = Array.isArray(v5Admins) ? v5Admins : Object.values(v5Admins);
              const isV5Admin = adminList.some(a => a.email && a.email.toLowerCase() === email.toLowerCase());
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

    async registerClient(data) {
      const { email, password, phone, nrc, address, city, dob, gender, occupation, nextOfKinName, nextOfKinPhone, momoName, whatsapp } = data;
      const firstName = (data.firstName || "").trim().toUpperCase();
      const surname = (data.surname || "").trim().toUpperCase();
      const fullName = `${firstName} ${surname}`;

      const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      const profile = {
        uid: user.uid, id: user.uid, name: fullName, firstName: firstName, surname: surname,
        dob: dob || "", gender: gender || "", email: email, phone: phone, whatsapp: whatsapp || "",
        momoName: (momoName || "").trim().toUpperCase(), nrc: nrc, occupation: occupation || "",
        address: address, city: city || "", nextOfKinName: (nextOfKinName || "").trim().toUpperCase(),
        nextOfKinPhone: nextOfKinPhone || "", role: 'client',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };

      await firebase.database().ref(`clients/${user.uid}`).set(profile);
      this.saveSession(user, 'client');
      await this.syncPendingFCMToken(user.uid);

      return { user, role: 'client' };
    },

    async sendPhoneOTP(phone, appVerifier) {
      let formattedPhone = phone.replace(/\D/g, '');
      if (formattedPhone.startsWith('0')) formattedPhone = '+260' + formattedPhone.substring(1);
      else if (formattedPhone.startsWith('260')) formattedPhone = '+' + formattedPhone;
      else if (!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;

      window.confirmationResult = await firebase.auth().signInWithPhoneNumber(formattedPhone, appVerifier);
      return true;
    },

    async verifyOTPAndRegister(code, data) {
      if (!window.confirmationResult) throw new Error("No OTP request found. Please try again.");

      const { email, password, phone, nrc, address, city, dob, gender, occupation, nextOfKinName, nextOfKinPhone, momoName, whatsapp } = data;
      const result = await window.confirmationResult.confirm(code);
      const user = result.user;

      try {
        const credential = firebase.auth.EmailAuthProvider.credential(email, password);
        await user.linkWithCredential(credential);
      } catch (linkError) {
        throw new Error("This Email Address or Phone Number is already registered. Please log in.");
      }

      const firstName = (data.firstName || "").trim().toUpperCase();
      const surname = (data.surname || "").trim().toUpperCase();
      const fullName = `${firstName} ${surname}`;
      const nokName = (nextOfKinName || "").trim().toUpperCase();
      const mobileMoneyName = (momoName || "").trim().toUpperCase();

      const profile = {
        uid: user.uid, id: user.uid, name: fullName, firstName: firstName, surname: surname,
        dob: dob || "", gender: gender || "", email: email, phone: phone, whatsapp: whatsapp || "",
        momoName: mobileMoneyName, nrc: nrc, occupation: occupation || "",
        address: address, city: city || "", nextOfKinName: nokName, nextOfKinPhone: nextOfKinPhone || "",
        role: 'client', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };

      await firebase.database().ref(`clients/${user.uid}`).set(profile);
      this.saveSession(user, 'client');
      await this.syncPendingFCMToken(user.uid);

      return { user, role: 'client' };
    },

    async signOut() {
      try {
        const user = firebase.auth().currentUser;
        if (user) {
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

      this.clearLocalData();
      localStorage.removeItem("stallz_app_pin");
      localStorage.removeItem("stallz_pending_fcm_token");
      localStorage.removeItem("stallz_active_fcm_token");
    },

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

    async getProfile(uid, role) {
      const path = (role === 'admin') ? `admins/${uid}` : `clients/${uid}`;
      const snap = await firebase.database().ref(path).get();
      return snap.exists() ? snap.val() : null;
    },

    async syncSessionFromUser(user) {
        if(!user) return null;
        let role = 'client';
        const adminSnap = await firebase.database().ref(`admins/${user.uid}`).get();
        if (adminSnap.exists()) role = 'admin';
        this.saveSession(user, role);
        return this.getSession();
    }
  };

  window.StallzAuth = StallzAuth;
})();