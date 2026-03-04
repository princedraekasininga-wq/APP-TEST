/**
 * ============================================================================
 * STALLZ LOANS - AUTH.JS
 * Optimized v3.2: PIN Reset on Logout Enabled
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

    /* ==========================================
       2.0 | AUTHENTICATION LOGIC
       ========================================== */

    /**
     * Handles user sign-in and determines access level (Admin vs Client).
     * Checks both Root admins and V5 database admins.
     */
    async signIn(email, password) {
      try {
        // 0. FORCE PERSISTENCE (CRITICAL FIX)
        // This ensures the user stays logged in even after closing the app/browser.
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

        // 1. Firebase Login
        const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
        const user = userCredential.user;

        let role = 'client';

        try {
          // 2. Check Root Admin Node (Priority 1)
          const rootSnap = await firebase.database().ref(`admins/${user.uid}`).get();
          if (rootSnap.exists()) {
              role = 'admin';
          } else {
              // 3. Check V5 Admin List (Priority 2)
              const v5Snap = await firebase.database().ref(`loanManagerData_v5/admins`).get();
              const v5Admins = v5Snap.val() || [];

              // Handle both Array and Object structures safely
              const adminList = Array.isArray(v5Admins) ? v5Admins : Object.values(v5Admins);

              const isV5Admin = adminList.some(a =>
                  a.email && a.email.toLowerCase() === email.toLowerCase()
              );

              if (isV5Admin) role = 'admin';
          }
        } catch (e) {
          console.warn("Role check warning (defaulting to client):", e);
        }

        // 4. Save Session
        this.saveSession(user, role);
        return { user, role };

      } catch (error) {
        // Pass error up to the UI to handle
        throw error;
      }
    },

    /**
     * Registers a new client with PROFESSIONAL UPPERCASE NAMING.
     */
    async registerClient(data) {
      const { email, password, phone, nrc, address } = data;

      // 1. FORCE UPPERCASE FORMATTING
      const firstName = (data.firstName || "").trim().toUpperCase();
      const surname = (data.surname || "").trim().toUpperCase();
      const fullName = `${firstName} ${surname}`;

      // 2. Create Firebase Auth Account
      const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // 3. Build Structured Profile
      const profile = {
        uid: user.uid,
        id: user.uid,
        name: fullName,       // Saved as "PRINCE KASININGA"
        firstName: firstName, // Saved as "PRINCE"
        surname: surname,     // Saved as "KASININGA"
        email: email,
        phone: phone,         // Stored in 260XXXXXXXXX format
        nrc: nrc,
        address: address,
        role: 'client',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 4. Save to Database
      await firebase.database().ref(`clients/${user.uid}`).set(profile);

      // 5. Initialize Session
      this.saveSession(user, 'client');
      return { user, role: 'client' };
    },

    /**
     * Signs the user out.
     */
    async signOut() {
      try {
        await firebase.auth().signOut();
      } catch (e) {
        console.warn("Firebase signout failed, clearing local storage anyway.");
      }
      localStorage.removeItem("stallz_test_session");
      localStorage.removeItem("stallz_last_active");
      localStorage.removeItem("stallz_client_profile"); // Clear client cache

      // CLEARS THE PIN so the user can create a new one next time
      localStorage.removeItem("stallz_app_pin");
    },

    /* ==========================================
       3.0 | UTILITIES
       ========================================== */

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