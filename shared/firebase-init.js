// Firebase init (Compat SDK) - shared across all pages
// NOTE: This file must be loaded AFTER firebase-app-compat.js
(function(){
  // ============================================================================
  // 🎛️ MASTER CONFIGURATION (Edit this section ONLY)
  // ============================================================================

  // 1. APP VERSION
  const APP_VERSION = "2.1.1";

  // 2. DATA MODE
  // FIX: Set to FALSE to connect to your MAIN database (stallz-loans)
  const TEST_MODE = true;

  // ============================================================================
  // Firebase Configs (Do not edit unless changing projects)
  // ============================================================================
  const FIRST_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBRMITHX8gm0jKpEXuC4iePGWoYON85BDU",
    authDomain: "stallz-loans.firebaseapp.com",
    databaseURL: "https://stallz-loans-default-rtdb.firebaseio.com",
    projectId: "stallz-loans",
    storageBucket: "stallz-loans.firebasestorage.app",
    messagingSenderId: "496528682",
    appId: "1:496528682:web:26066f0ca7d440fb854253",
    measurementId: "G-ZELECKK94M"
  };

  const SECOND_FIREBASE_CONFIG = {
    apiKey: "AIzaSyDEtUyZdmwIvPMewuF9giOcEzXGzbPVNQA",
    authDomain: "answers-8cc49.firebaseapp.com",
    databaseURL: "https://answers-8cc49-default-rtdb.firebaseio.com",
    projectId: "answers-8cc49",
    storageBucket: "answers-8cc49.firebasestorage.app",
    messagingSenderId: "193637729462",
    appId: "1:193637729462:web:ecb256ab87b334fd7c5217",
    measurementId: "G-ZGDSQ62X4R"
  };

  // Pick active config
  const firebaseConfig = TEST_MODE ? SECOND_FIREBASE_CONFIG : FIRST_FIREBASE_CONFIG;

  // Global Exports
  window.STALLZ_APP_VERSION = APP_VERSION;
  window.STALLZ_TEST_MODE = TEST_MODE;
  window.STALLZ_ENV = TEST_MODE ? 'TEST_FIREBASE' : 'LIVE_FIREBASE';

  window.STALLZ_FIREBASE_ENV = TEST_MODE ? "TEST DB" : "MAIN DB";

  // ... (Rest of the file stays exactly the same) ...

// ============================================================================
// 🔁 VERSION CHANGE NOTIFIER (Toast)
// ============================================================================
(function versionNotifier(){
  const KEY = "stallz_app_version";
  let changed = false;
  try {
    const prev = localStorage.getItem(KEY);
    changed = (prev !== APP_VERSION);
    if (changed) {
      localStorage.setItem(KEY, APP_VERSION);
      localStorage.removeItem("stallz_test_session");
    }
  } catch(e) {}

  window.__STALLZ_VERSION_CHECK_RAN = true;

  if (!changed) return;

  function ensureToastStyles(){
    if (document.getElementById("stallzVersionToastStyles")) return;
    const style = document.createElement("style");
    style.id = "stallzVersionToastStyles";
    style.textContent = `
  #stallzVersionToastRoot{
    position:fixed; left:50%; bottom:18px; transform:translateX(-50%);
    z-index:2147483647; display:flex; flex-direction:column; gap:8px; align-items:center;
    pointer-events:none;
  }
  .stallz-vtoast{
    background:rgba(15,23,42,0.64);
    color:rgba(226,232,240,0.92);
    border:1px solid rgba(255,255,255,0.10);
    box-shadow:0 10px 26px rgba(0,0,0,0.22);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border-radius:14px;
    padding:10px 12px;
    font:600 12.5px/1.25 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    max-width:min(92vw, 420px);
    opacity:0; transform:translateY(8px);
    animation:stallzToastIn .28s cubic-bezier(.2,.8,.2,1) forwards;
  }
  .stallz-vtoast b{color:#a7f3d0;}
  @keyframes stallzToastIn{to{opacity:1; transform:translateY(0);}}
  @keyframes stallzToastOut{to{opacity:0; transform:translateY(6px);}}
`;
document.head.appendChild(style);
  }

  function showToast(msg){
    const tryNative = () => {
      try {
        if (typeof window.showToast === "function") {
          window.showToast(msg, "success");
          return true;
        }
      } catch(e){}
      return false;
    };

    if (tryNative()) return;

    setTimeout(() => {
      if (tryNative()) return;

      ensureToastStyles();
      let root = document.getElementById("stallzVersionToastRoot");
      if (!root) {
        root = document.createElement("div");
        root.id = "stallzVersionToastRoot";
        (document.body || document.documentElement).appendChild(root);
      }
      const t = document.createElement("div");
      t.className = "stallz-vtoast";
      t.innerHTML = msg;
      root.appendChild(t);

      setTimeout(() => {
        t.style.animation = "stallzToastOut .32s ease forwards";
        setTimeout(() => t.remove(), 340);
      }, 2200);
    }, 700);
  }

  const run = () => {
    const label = `Updated to v${APP_VERSION}`;
    showToast(label);
  };

  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(run, 800));
  } else {
    setTimeout(run, 800);
  }
})();

  function init(){
    if (typeof firebase === "undefined") return false;
    try {
      if (firebase.apps && firebase.apps.length) return true;
      firebase.initializeApp(firebaseConfig);
      return true;
    } catch (e) {
      try { if (e.message.includes("already exists")) return true; } catch(_){}
      console.error("Firebase init error:", e);
      return false;
    }
  }

  window.STALLZ_FIREBASE = window.STALLZ_FIREBASE || {};
  window.STALLZ_FIREBASE.config = firebaseConfig;
  window.STALLZ_FIREBASE.init = init;
  window.STALLZ_FIREBASE.isReady = function(){ return !!(typeof firebase !== "undefined" && firebase.apps && firebase.apps.length); };

  function mountEnvBadge(){
    // 🟢 HIDE ON MAIN DB: Only show this badge if TEST_MODE is true
    if (!TEST_MODE) return;

    try {
      if (typeof document === "undefined") return;
      if (document.getElementById("stallzEnvBadge")) return;

      const badge = document.createElement("div");
      badge.id = "stallzEnvBadge";

      const envLabel = "TEST";
      const color = "rgba(239, 68, 68, 0.9)"; // Red for Test Mode

      badge.innerHTML = `<span style="opacity:0.8">v${APP_VERSION}</span> • <span style="font-weight:700; color:${color}">${envLabel}</span>`;

      Object.assign(badge.style, {
        position: "fixed", top: "10px", right: "10px", zIndex: "2147483647",
        fontFamily: "system-ui, sans-serif", fontSize: "11px", padding: "6px 10px",
        borderRadius: "20px", background: "rgba(15, 23, 42, 0.85)", color: "#e2e8f0",
        border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(4px)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)", pointerEvents: "none", userSelect: "none"
      });

      const add = () => {
        if (!document.body) return setTimeout(add, 10);
        document.body.appendChild(badge);
      };
      add();
    } catch(e) {}
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountEnvBadge);
    } else {
      mountEnvBadge();
    }
  }

  init();
})();
