// Central app configuration — change here to update across the app
// This file runs in BOTH Window and Service Worker contexts.
(function (g) {
  g.STALLZ_APP_CONFIG = g.STALLZ_APP_CONFIG || {};
  const cfg = g.STALLZ_APP_CONFIG;

  // ---------------------------
  // 1) Versioning
  // ---------------------------
  cfg.version = cfg.version || "2.8.2";
  g.STALLZ_APP_VERSION = cfg.version;

  // ---------------------------
  // 2) Firebase Environment
  // ---------------------------
  cfg.firebase = cfg.firebase || {};

  // Allow quick override (optional):
  // - localStorage: stallz_firebase_mode = "main" | "test"
  // - URL param:    ?db=main | ?db=test
  function resolveMode() {
    try {
      // URL override first
      const u = new URL((g.location && g.location.href) ? g.location.href : "https://stallz.local/");
      const db = (u.searchParams.get("db") || "").toLowerCase();
      if (db === "main" || db === "prod") return "main";
      if (db === "test") return "test";
    } catch(_) {}

    try {
      // localStorage override (window only)
      if (typeof g.localStorage !== "undefined") {
        const m = (g.localStorage.getItem("stallz_firebase_mode") || "").toLowerCase();
        if (m === "main" || m === "prod") return "main";
        if (m === "test") return "test";
      }
    } catch(_) {}

    // Default (safe): TEST
    return "test";
  }

  cfg.firebase.mode = cfg.firebase.mode || resolveMode();
  cfg.firebase.testMode = (cfg.firebase.mode === "test");

  // Main + Test configs live here so ALL pages + SW share the same values.
  cfg.firebase.main = cfg.firebase.main || {
    apiKey: "AIzaSyBRMITHX8gm0jKpEXuC4iePGWoYON85BDU",
    authDomain: "stallz-loans.firebaseapp.com",
    databaseURL: "https://stallz-loans-default-rtdb.firebaseio.com",
    projectId: "stallz-loans",
    storageBucket: "stallz-loans.firebasestorage.app",
    messagingSenderId: "496528682",
    appId: "1:496528682:web:26066f0ca7d440fb854253",
    measurementId: "G-ZELECKK94M",
    vapidKey: "BAJVxpS0SEnsSb3wfu1gINXB_qQJ-ZQkYxQB9O-ir63t11UowqKbwFVOwWswjrc1VTgDisDcR3Qg7FT7x3ImnsM"
  };

  cfg.firebase.test = cfg.firebase.test || {
    apiKey: "AIzaSyDEtUyZdmwIvPMewuF9giOcEzXGzbPVNQA",
    authDomain: "answers-8cc49.firebaseapp.com",
    databaseURL: "https://answers-8cc49-default-rtdb.firebaseio.com",
    projectId: "answers-8cc49",
    storageBucket: "answers-8cc49.firebasestorage.app",
    messagingSenderId: "193637729462",
    appId: "1:193637729462:web:ecb256ab87b334fd7c5217",
    measurementId: "G-ZGDSQ62X4R",
    vapidKey: "BAair17OY_TbS6vv26pKFz8zaih15b--Rx_7Hr1p8d68siq1AiZxU971mrwOOhfjazFNYVdRwAnymQIJlGRnTE4"
  };

  cfg.firebase.active = cfg.firebase.testMode ? cfg.firebase.test : cfg.firebase.main;

  // ---------------------------
  // 3) UI Z-index scale (clean + consistent)
  // ---------------------------
  cfg.zIndex = cfg.zIndex || {
    header: 100,
    nav: 200,
    dropdown: 260,
    modal: 300,
    toast: 400
  };

  // ---------------------------
  // 4) Performance tuning knobs
  // ---------------------------
  cfg.ui = cfg.ui || {};
  cfg.ui.mobileGlassBlur = cfg.ui.mobileGlassBlur || 12; // px

  // Export convenience
  g.STALLZ_FIREBASE_MODE = cfg.firebase.testMode ? "TEST" : "MAIN";
})(typeof window !== "undefined" ? window : self);
