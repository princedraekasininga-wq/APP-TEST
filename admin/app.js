/**
 * ============================================================================
 * STALLZ LOANS MANAGER - APP.JS
 * v2.0 | All Fixes: Syntax Cleanup & Stability
 * ============================================================================
 */

/* ============================================================================
 * 1.0 | APP CONFIGURATION & CONSTANTS
 * ============================================================================ */

const APP_VERSION = (window.STALLZ_APP_VERSION || "0");
const OFFLINE_TEST_MODE = (new URLSearchParams(location.search).get("test") === "1") || (localStorage.getItem("stallz_force_test_mode") === "true");

// Prevent feedback loop when reacting to shared RTDB updates
let __suppressSharedSync = false;

// Planning & Interest Constants
const INTEREST_BY_PLAN = {
  "Weekly": 0.20,
  "2 Weeks": 0.30,
  "3 Weeks": 0.35,
  "Monthly": 0.40
};

const DAYS_BY_PLAN = {
  "Weekly": 7,
  "2 Weeks": 14,
  "3 Weeks": 21,
  "Monthly": 0
};

// Wizard Configuration
const LOAN_STEPS = [
  { key: "clientName", label: "Client Name", icon: "👤", type: "text", placeholder: "e.g. John Banda", required: true, helper: "Who is taking the loan?" },
  { key: "clientPhone", label: "Client Phone", icon: "📱", type: "text", placeholder: "e.g. 097...", required: false, helper: "Optional but useful for follow-up." },
  { key: "collateralItem", label: "Collateral Item", icon: "🎒", type: "text", placeholder: "e.g. Samsung A24, HP Laptop", required: true, helper: "What item are they leaving with you?" },
  { key: "collateralValue", label: "Collateral Value", icon: "💰", type: "number", placeholder: "Resale value (e.g. 3000)", required: false, helper: "How much can you realistically sell it for?" },
  { key: "amount", label: "Loan Amount", icon: "💵", type: "number", placeholder: "How much are you giving? (e.g. 1000)", required: true, helper: "Remember: short loans, strong profit, low risk." },
  { key: "plan", label: "Plan", icon: "🕒", type: "select", options: ["Weekly", "2 Weeks", "3 Weeks", "Monthly"], required: true, helper: "Pick the repayment period." },
  { key: "customInterest", label: "Negotiated Interest % (Optional)", icon: "🤝", type: "number", placeholder: "e.g. 15 (Leave empty for standard)", required: false, helper: "Enter a number to override the standard plan rate." },
  { key: "startDate", label: "Start Date", icon: "📅", type: "date", required: true, helper: "The date you give out the money." },
  { key: "notes", label: "Notes (optional)", icon: "📝", type: "textarea", placeholder: "ID, condition, extra details...", required: false, helper: "Extra info for this loan." }
];

const _modalTimers = {}; // Tracks active close timers

/* ============================================================================
 * 2.0 | FIREBASE SETUP & PERSISTENCE
 * ============================================================================ */

// Safety Flag
let isSafeToSave = true;

let db, dataRef;
let _remoteCache = null;

try {
  if (typeof firebase !== "undefined") {
    if (!firebase.apps || !firebase.apps.length) {
      try { window.STALLZ_FIREBASE?.init?.(); } catch(e) {}
    }
    try { firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch(e) {}
    db = firebase.database();
    dataRef = db.ref("loanManagerData_v5");
  } else {
    console.warn("Firebase SDK not loaded. Offline mode only.");
  }
} catch (e) {
  console.error("Firebase Init Error:", e);
}

/* ============================================================================
 * 3.0 | GLOBAL STATE MANAGEMENT
 * ============================================================================ */

const state = {
  dataLoaded: false,
  loans: [],
  nextId: 1,
  startingCapital: 0,
  startingCapitalSetDate: null,
  capitalTxns: [],
  capital: [],
  nextCapitalTxnId: 1,
  repayments: [],
  nextRepaymentId: 1,
  admins: [],
  nextAdminId: 1,
  user: null,
  isLoggedIn: false,
  currentUserProfile: null,
  loanHistoryFilter: "PAST",
  loanHistorySearch: ""
};

// Global Variables
let currentClientView = 'active';
let clientSearchQuery = '';

// Wizard State
let wizardStep = 0;
let wizardDraft = {};
// Filter State
let activeFilters = { status: 'ACTIVE', plan: 'All' };

// Action Modal State
const ACTION = { NONE: "NONE", PAY: "PAY", NOTE: "NOTE", WRITEOFF: "WRITEOFF" };
let currentAction = ACTION.NONE;
let currentLoanId = null;

// --- ADMIN DIALOG (PROMPT/CONFIRM) ---
let __adminDialogCallback = null;

window.showAdminDialog = function(options) {
    const modal = document.getElementById('adminDialogModal');
    if(!modal) return;

    document.getElementById('adminDialogTitle').textContent = options.title || 'Confirm';
    document.getElementById('adminDialogMessage').textContent = options.message || '';

    const inputEl = document.getElementById('adminDialogInput');
    if (options.isPrompt) {
        inputEl.style.display = 'block';
        inputEl.value = '';
        inputEl.placeholder = options.placeholder || '';
        setTimeout(() => inputEl.focus(), 100);
    } else {
        inputEl.style.display = 'none';
    }

    const btn = document.getElementById('adminDialogConfirmBtn');
    if (!btn) { console.warn('adminDialogConfirmBtn is missing from DOM'); return; }
    btn.className = 'btn ' + (options.btnClass || 'btn-primary');
    btn.textContent = options.btnText || 'Confirm';

    __adminDialogCallback = options.onConfirm;

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.remove('modal-hidden'), 10);
};

window.closeAdminDialog = function() {
    const modal = document.getElementById('adminDialogModal');
    if(modal) {
        modal.classList.add('modal-hidden');
        setTimeout(() => modal.style.display = 'none', 300);
    }
    __adminDialogCallback = null;
};

document.getElementById('adminDialogConfirmBtn')?.addEventListener('click', () => {
    const inputEl = document.getElementById('adminDialogInput');
    const val = inputEl.style.display === 'block' ? inputEl.value : null;

    if (inputEl.style.display === 'block' && !String(val).trim()) {
        showToast("This field is required", "error");
        if(typeof vibrate === "function") vibrate([50]);
        return;
    }

    closeAdminDialog();
    if (__adminDialogCallback) __adminDialogCallback(val);
});

/* ============================================================================
 * 4.0 | UTILITIES & HELPER FUNCTIONS
 * ============================================================================ */

function el(id) { return document.getElementById(id); }

window.forceHideLoader = function() {
  const loader = el("loadingOverlay");
  try { const em = localStorage.getItem("stallz_last_email"); if (em && el("loginEmail") && !el("loginEmail").value) el("loginEmail").value = em; } catch(e) {}
  if (loader) loader.style.display = "none";
}

function formatMoney(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "K0.00";
  return "K" + Number(amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

const DATE_FMT = new Intl.DateTimeFormat("en-ZM", { year: "2-digit", month: "short", day: "numeric" });

function escapeHTML(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function parseDateSmart(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

function toDateOnly(dt) {
  if (!dt) return "";
  const d = new Date(dt.getTime());
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonthsSafe(dt, months) {
  const d = new Date(dt.getTime());
  d.setHours(0, 0, 0, 0);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = parseDateSmart(dateStr);
  if (!d) return "-";
  return DATE_FMT.format(d);
}

function getLocalDateVal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthKey(dateStr) {
  const d = parseDateSmart(dateStr);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatWhatsApp(phone) {
  if (!phone) return "";
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '260' + p.substring(1);
  if (p.length === 9) p = '260' + p;
  return p;
}

function getInitials(name) {
  if (!name) return "??";
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

/* admin/app.js */

function checkAppVersion() {
  // DISABLED: This check is now handled exclusively by shared/firebase-init.js
  // This prevents the "constant toast notification" loop.
  return;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function showToast(message, type = "success") {
  const container = el("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type || "success"}`;
  toast.textContent = String(message ?? "");
  container.appendChild(toast);

  // Subtle feedback (only vibrate on error)
  if (type === "error" && typeof vibrate === "function") vibrate([20]);

  const ttl = (type === "error") ? 2600 : 1800;

  setTimeout(() => {
    toast.style.animation = "toastFadeOut 0.35s forwards";
    setTimeout(() => toast.remove(), 360);
  }, ttl);
}

function vibrate(pattern = [15]) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function animateValue(obj, start, end, duration) {
  if (!obj) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);
    obj.innerHTML = "K" + value.toLocaleString();
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      obj.innerHTML = formatMoney(end);
    }
  };
  window.requestAnimationFrame(step);
}

function checkTimeBasedTheme() {
  const toggle = document.getElementById("themeToggle");
  const stored = localStorage.getItem("stallz_theme_preference");

  if (stored) {
    if (stored === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      if (toggle) toggle.checked = false;
    } else {
      document.documentElement.removeAttribute("data-theme");
      if (toggle) toggle.checked = true;
    }
    return;
  }
  const hour = new Date().getHours();
  const isDayTime = hour >= 6 && hour < 18;
  if (isDayTime) {
    document.documentElement.setAttribute("data-theme", "light");
    if (toggle) toggle.checked = false;
  } else {
    document.documentElement.removeAttribute("data-theme");
    if (toggle) toggle.checked = true;
  }
}

let __lastActivityWrite = 0;
function updateSessionActivity() {
  const now = Date.now();
  if (now - __lastActivityWrite < 15000) return;
  __lastActivityWrite = now;
  try { localStorage.setItem("stallz_last_active", now); } catch (e) {}
}
document.addEventListener("click", updateSessionActivity);
document.addEventListener("keydown", updateSessionActivity);
document.addEventListener("touchstart", updateSessionActivity);

/* ============================================================================
 * 5.0 | BUSINESS LOGIC & DATA PROCESSING
 * ============================================================================ */

function computeDerivedFields(loan, today) {
  if (!today) {
    today = new Date();
    today.setHours(0, 0, 0, 0);
  }

  let rate = INTEREST_BY_PLAN[loan.plan] || 0;
  if (loan.customInterest !== undefined && loan.customInterest !== null) {
    rate = Number(loan.customInterest) / 100;
  }

  const startDate = loan.startDate ? (parseDateSmart(loan.startDate) || today) : today;

  let dueDate;
  if (loan.dueDate && typeof loan.dueDate === 'string') {
    dueDate = parseDateSmart(loan.dueDate);
  } else {
    dueDate = new Date(startDate.getTime());
    dueDate.setHours(0, 0, 0, 0);

    if (loan.plan === "Monthly") {
      dueDate = addMonthsSafe(dueDate, 1);
    } else {
      const days = DAYS_BY_PLAN[loan.plan] || 0;
      if (days > 0) dueDate.setDate(dueDate.getDate() + days);
    }
  }

  const totalDue = Number(((loan.amount || 0) * (1 + rate)).toFixed(2));
  const paid = Number(loan.paid || 0);
  const sale = Number(loan.saleAmount || 0);
  const totalIn = paid + sale;
  const balance = Number((totalDue - totalIn).toFixed(2));

  loan.profitCollected = Math.max(0, totalIn - (loan.amount || 0));

  let status = "ACTIVE";
  if (balance <= 0.01) {
    status = "PAID";
  } else if (loan.isDefaulted) {
    status = "DEFAULTED";
  } else if (dueDate && today.getTime() > dueDate.getTime()) {
    status = "OVERDUE";
  }

  const daysOverdue = (dueDate && today.getTime() > dueDate.getTime() && status !== "PAID")
    ? Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  loan.rate = rate;
  loan.dueDate = toDateOnly(dueDate);
  loan.totalDue = totalDue;
  loan.balance = balance;
  loan.status = status;
  loan.daysOverdue = daysOverdue;
}

function recomputeAllLoans() {
  if (!state.loans) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  state.loans.forEach(loan => computeDerivedFields(loan, today));
}

/* Fix ID Collision Risk */
function generateLoanId() {
    // Timestamp + Random Number to prevent collisions
    return Date.now() + Math.floor(Math.random() * 1000);
}

// FIX: Use Timestamp + Random to prevent collision if multiple admins save at exact same ms
function generateRepaymentId() {
    return Date.now() + Math.floor(Math.random() * 100);
}

function generateCapitalTxnId() {
    return Date.now() + Math.floor(Math.random() * 100);
}
// Database Sync Logic
function loadFromFirebase() {
  if (typeof initializeMissingNodes === "function") {
    initializeMissingNodes();
  }

  setTimeout(() => {
    const loader = document.getElementById("loadingOverlay");
    if (loader && loader.style.display !== "none") {
      console.warn("Database connection slow. Forcing UI open in offline/cached mode.");
      loader.style.display = "none";
      if (!state.dataLoaded) {
        applyData({ loans: [], nextId: 1, admins: [] });
      }
    }
  }, 3000);

  if (typeof OFFLINE_TEST_MODE !== "undefined" && OFFLINE_TEST_MODE) {
    setTimeout(() => {
      try {
        const localData = localStorage.getItem("stallz_test_data");
        let parsed = localData ? JSON.parse(localData) : null;
        if (!parsed) {
          parsed = {
            loans: [],
            nextId: 1,
            admins: [{ id: 1, name: "Test Owner", email: "test@admin.com", role: "Owner" }]
          };
        }
        applyData(parsed);
      } catch (e) {
        applyData({ loans: [], nextId: 1, admins: [] });
      }
    }, 500);
    return;
  }

  if (!dataRef) {
    applyData({});
    return;
  }

  dataRef.on("value", (snapshot) => {
    if(typeof isSafeToSave !== 'undefined') isSafeToSave = true;
    const val = snapshot.val() || {};
    if(typeof _remoteCache !== 'undefined') _remoteCache = val;
    applyData(val);
  }, (error) => {
    console.error("Firebase read failed:", error);
  });

  setInterval(() => {
    if(document.visibilityState === 'visible') {
        dataRef.get().then(s => applyData(s.val()||{})).catch(e=>{});
    }
  }, 60000);
}

function applyData(parsed) {
  const loader = document.getElementById("loadingOverlay");
  if (loader) loader.style.display = "none";

  state.dataLoaded = true;

  // Track the current RTDB container shape for loans (array vs object)
  try {
    state.__loansContainerType = Array.isArray(parsed?.loans) ? 'array' : (parsed?.loans && typeof parsed.loans === 'object' ? 'object' : 'array');
  } catch(e) { state.__loansContainerType = 'array'; }

  // 1. Parse Loans (Preserve RTDB key path + de-duplicate by loan.id)
  const rawLoans = [];
  try {
    const src = parsed.loans;
    if (Array.isArray(src)) {
      src.forEach((v, idx) => {
        if (v && typeof v === "object") rawLoans.push(Object.assign({}, v, { __loanPath: `loans/${idx}` }));
      });
    } else if (src && typeof src === "object") {
      Object.entries(src).forEach(([k, v]) => {
        if (v && typeof v === "object") rawLoans.push(Object.assign({}, v, { __loanPath: `loans/${k}` }));
      });
    }
  } catch (e) {}

  // Group by loan.id and keep the most recently updated copy
  const byId = new Map();
  rawLoans.forEach((l) => {
    const idKey = (l && l.id !== undefined && l.id !== null) ? String(l.id) : String(l.__loanPath);
    const existing = byId.get(idKey);
    const t = Date.parse(l.updatedAt || l.createdAt || "");
    const ts = isNaN(t) ? 0 : t;

    if (!existing) {
      byId.set(idKey, { loan: l, paths: [l.__loanPath], ts });
    } else {
      existing.paths.push(l.__loanPath);

      // Prefer "full" records over accidental thin duplicates
      const isThinLoan = (ln) => {
        if (!ln || typeof ln !== "object") return true;
        const has = (v) => v !== undefined && v !== null && v !== "";
        const hasCore = (
          has(ln.amount) ||
          has(ln.totalDue) ||
          has(ln.totalPayable) ||
          has(ln.plan) ||
          has(ln.startDate) ||
          has(ln.dueDate)
        );
        return !hasCore;
      };

      const prevLoan = existing.loan;
      const prevThin = isThinLoan(prevLoan);
      const candThin = isThinLoan(l);

      const chooseCandidate = () => { existing.loan = l; existing.ts = ts; };

      if (prevThin && !candThin) {
        chooseCandidate();
      } else if (!prevThin && candThin) {
        // keep the richer previous record
      } else if (ts > existing.ts) {
        chooseCandidate();
      } else if (ts === existing.ts) {
        const getPaid = (ln) => Number(ln?.paid || 0) + Number(ln?.saleAmount || 0);
        const getTotal = (ln) => Number(ln?.totalDue || ln?.totalPayable || 0);

        const prevPaid = getPaid(prevLoan);
        const candPaid = getPaid(l);
        const prevTotal = getTotal(prevLoan);
        const candTotal = getTotal(l);

        const prevIsPaid = String(prevLoan?.status || "").toUpperCase() === "PAID" || (prevTotal > 0 && prevPaid >= (prevTotal - 0.01));
        const candIsPaid = String(l?.status || "").toUpperCase() === "PAID" || (candTotal > 0 && candPaid >= (candTotal - 0.01));

        if (candIsPaid && !prevIsPaid) {
          chooseCandidate();
        } else if (!candIsPaid && prevIsPaid) {
          // keep prev
        } else {
          const prevRatio = prevTotal > 0 ? (prevPaid / prevTotal) : prevPaid;
          const candRatio = candTotal > 0 ? (candPaid / candTotal) : candPaid;

          if (candRatio > prevRatio) {
            chooseCandidate();
          } else if (candRatio === prevRatio) {
            if (Object.keys(l || {}).length > Object.keys(prevLoan || {}).length) {
              chooseCandidate();
            }
          }
        }
      }
    }
  });

  state.loans = Array.from(byId.values()).map((entry) => {
    const winner = entry.loan || {};
    winner.__loanPaths = (entry.paths || []).filter(Boolean);
    winner.__primaryLoanPath = winner.__loanPath || winner.__loanPaths[0] || null;
    return winner;
  });

  // Sort newest first (fallback 0 when id is missing)
  state.loans.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

  // =========================================================================
  // 🧹 AUTO-FIX: Schedule cleanup of "Thin" duplicates if any exist
  // =========================================================================
  if (!OFFLINE_TEST_MODE && dataRef) {
      const pathsToDelete = {};
      let cleanupCount = 0;

      state.loans.forEach(l => {
          if (l.__loanPaths && l.__loanPaths.length > 1) {
              // Keep the primary, delete the rest
              l.__loanPaths.forEach(path => {
                  if (path !== l.__primaryLoanPath) {
                      pathsToDelete[path] = null; // Prepare delete
                      cleanupCount++;
                  }
              });
              // Reset local paths so we don't try to delete again
              l.__loanPaths = [l.__primaryLoanPath];
          }
      });

      if (cleanupCount > 0) {
          console.log(`🧹 Cleaning up ${cleanupCount} duplicate loan records...`);
          // Run quietly in background
          dataRef.update(pathsToDelete).catch(e => console.warn("Cleanup warning:", e));
      }
  }
  // =========================================================================

  // 2. Parse Capital History
  if (parsed.capitalTxns && typeof parsed.capitalTxns === 'object') {
      state.capitalTxns = Object.values(parsed.capitalTxns);
  } else {
      state.capitalTxns = parsed.capitalTxns || [];
  }

  // Sort Capital by Newest Date First
  if (state.capitalTxns.length > 0) {
      state.capitalTxns.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // 3. Load Other Data Variables
  state.nextId = parsed.nextId || 1;
  state.startingCapital = Number(parsed.startingCapital || 0);
  state.startingCapitalSetDate = parsed.startingCapitalSetDate || null;
  state.nextCapitalTxnId = parsed.nextCapitalTxnId || 1;

  state.capital = parsed.capital || []; // Legacy support

  // Robust Repayments Parsing
  if (parsed.repayments && typeof parsed.repayments === 'object') {
      state.repayments = Object.values(parsed.repayments).filter(r => r && typeof r === "object");
  } else {
      state.repayments = (parsed.repayments || []).filter?.(r => r && typeof r === "object") || (parsed.repayments || []);
  }
  // Sort newest first
  if (state.repayments.length > 1) {
      state.repayments.sort((a, b) => Date.parse(b.createdAt || b.date || "") - Date.parse(a.createdAt || a.date || ""));
  }
  state.nextRepaymentId = parsed.nextRepaymentId || 1;

  state.admins = parsed.admins || [];
  state.nextAdminId = parsed.nextAdminId || 1;

  // 4. Refresh UI & Perform Critical Sync
  try {
    refreshUI();
    updateWelcomeUI();

    if (state.loans && state.loans.length > 0) {
        const force = !state.__initialClientSyncDone;
        distributeLoansToClients(state.loans, force);
        state.__initialClientSyncDone = true;
    }

    if (!state.__initialPaymentMethodsSyncDone) {
        try { syncPaymentMethodsToClients(true); } catch(e) {}
        state.__initialPaymentMethodsSyncDone = true;
    }

    try { window.StallzShared?.ensureSeed?.(); } catch(e) {}
    try { window.StallzShared?.syncAdminSnapshot?.(state.loans || []); } catch(e) {}

  } catch (e) {
    console.error("Render error:", e);
  }
}

async function initializeMissingNodes() {
  if (OFFLINE_TEST_MODE || !dataRef) return;
  try {
    await dataRef.transaction((currentData) => {
      if (currentData === null) {
        return {
          loans: [],
          nextId: 1,
          startingCapital: 0,
          startingCapitalSetDate: null,
          capitalTxns: [],
          nextCapitalTxnId: 1,
          repayments: [],
          nextRepaymentId: 1,
          admins: [],
          nextAdminId: 1,
          lastWrite: firebase.database.ServerValue.TIMESTAMP
        };
      }
      return;
    });
    // NOTE: Your RTDB rules set /stallzShared_v1 root to .read:false, so root-level transactions will fail.
    // We only "touch" a readable/writable child to avoid permission spam.
    const adminNotifsRef = firebase.database().ref("stallzShared_v1/notifications/admin");
    try {
      const s = await adminNotifsRef.get();
      if (!s.exists()) await adminNotifsRef.set({});
    } catch(e) {
      // If rules block this path, ignore — the app can still function without seeding.
    }
  } catch (error) {
    console.error("Auto-init failed:", error);
  }
}


async function saveState() {
  // 1. Safety Check: Only proceed if data is loaded
  if (!state.dataLoaded) return;

  // 2. THE FIX: Only run full state saves in Offline Test Mode.
  // This prevents cloud-connected admins from accidentally overwriting each other's changes.
  if (OFFLINE_TEST_MODE) {
    const payload = {
      loans: state.loans || [],
      nextId: state.nextId || 1, // Legacy counter (loans use timestamps now)
      startingCapital: state.startingCapital || 0,
      startingCapitalSetDate: state.startingCapitalSetDate || null,
      capitalTxns: state.capitalTxns || [],
      nextCapitalTxnId: state.nextCapitalTxnId || 1,
      repayments: state.repayments || [],
      nextRepaymentId: state.nextRepaymentId || 1,
      admins: state.admins || [],
      nextAdminId: state.nextAdminId || 1,
      lastWrite: new Date().toISOString()
    };

    localStorage.setItem("stallz_test_data", JSON.stringify(payload));

    if (window.StallzShared?.syncAdminSnapshot) {
       window.StallzShared.syncAdminSnapshot(state.loans);
    }

    showToast("Saved locally (Test Mode)", "success");
    return;
  }

  // 3. Cloud Mode Protection
  // Cloud writes are now handled by Atomic Updates in saveNewLoan() and the Action Modal.
  if (!dataRef) {
    showToast("Database Disconnected", "error");
    return;
  }

  console.warn("Full saveState blocked in Cloud Mode to prevent data loss. Use atomic updates.");
}
/* ============================================================================
 * AUTH GATE & UI
 * ============================================================================ */

async function ensureAdminAccess() {
  const gate = document.getElementById("authGate");
  if (gate) gate.style.display = "flex";

  if (typeof OFFLINE_TEST_MODE !== 'undefined' && OFFLINE_TEST_MODE) {
    state.user = { email: "offline@stallz.local", uid: "offline-admin" };
    state.isLoggedIn = true;
    state.currentUserProfile = { name: "OFFLINE ADMIN", role: "TESTER" };
    if (gate) gate.style.display = "none";
    loadFromFirebase();
    updateWelcomeUI();
    return true;
  }

  try {
    const user = await window.StallzAuth?.onceAuthState?.();
    if (!user) {
      window.location.replace("../index.html");
      return false;
    }

    // NEW: Explicitly fetch and wait for profile BEFORE clearing the loading gate
    // This ensures "Hi, Admin" doesn't flicker before the real name appears
    let foundProfile = null;
    try {
      const rootSnap = await firebase.database().ref(`admins/${user.uid}`).get();
      if (rootSnap.exists()) {
        foundProfile = rootSnap.val();
      }
    } catch(e) {
      console.log("Root admin check failed, trying database list...");
    }

    if (!foundProfile) {
        const snap = await dataRef.child("admins").get();
        const adminsList = snap.val() || [];
        const listArray = Array.isArray(adminsList) ? adminsList : Object.values(adminsList);
        foundProfile = listArray.find(admin =>
          admin.email && admin.email.toLowerCase() === user.email.toLowerCase()
        );
    }

    if (!foundProfile) {
      console.warn("User not authorized as Admin.");
      await window.StallzAuth?.signOut?.();
      window.location.replace("../index.html");
      return false;
    }

    // Set state and update UI immediately
    state.user = user;
    state.isLoggedIn = true;
    state.currentUserProfile = foundProfile;
    updateWelcomeUI();

    if (gate) gate.style.display = "none";

    loadFromFirebase();
    return true;

  } catch(e) {
    console.error("Auth Check Failed:", e);
    if (window.location.pathname.includes("admin.html")) {
        window.location.replace("../index.html");
    }
    return false;
  }
}

function updateWelcomeUI() {
  if (!state.currentUserProfile && !state.user) return;

  let profile = state.currentUserProfile;

  if (!profile && state.admins && state.user) {
     const email = state.user.email.toLowerCase();
     profile = state.admins.find(a => a.email && a.email.toLowerCase() === email);
  }

  let firstName = "ADMIN";
  let fullName = "STALLZ ADMIN";
  let role = "OWNER";

  if (profile) {
    if (profile.name) {
      fullName = profile.name.toUpperCase();
      firstName = fullName.split(' ')[0];
    } else if (profile.firstname) {
       firstName = profile.firstname.toUpperCase();
       fullName = (profile.firstname + " " + (profile.surname||"")).toUpperCase();
    }

    if (profile.role) role = profile.role.toUpperCase();
  }

  const headerEl = document.getElementById("headerUsername");
  if (headerEl) headerEl.textContent = firstName;

  const sbName = document.getElementById("sidebarName");
  const sbRole = document.getElementById("sidebarEmail");
  const sbAvatar = document.getElementById("sidebarAvatar");

  if (sbName) sbName.textContent = fullName;
  if (sbRole) sbRole.textContent = role;
  if (sbAvatar) {
    sbAvatar.textContent = fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }
}

/* ============================================================================
 * 7.0 | UI RENDERING (DASHBOARD & TABLES)
 * ============================================================================ */

let __hasAutoLinked = false;

function linkOrphanedLoans() {
  if (__hasAutoLinked || !state.loans || !window.StallzShared) return;

  const users = window.StallzShared.listUsers("client");
  if (!users || users.length === 0) return;

  const updates = {};
  let count = 0;

  state.loans.forEach(l => {
    if (!l.clientUid && l.clientPhone) {
      const cleanLoanPhone = String(l.clientPhone).replace(/\D/g, "").replace(/^0/, "260");

      const match = users.find(u => {
          const cleanUserPhone = String(u.phone).replace(/\D/g, "").replace(/^0/, "260");
          return cleanUserPhone === cleanLoanPhone && cleanUserPhone.length > 9;
      });

      if (match && match.uid) {
        // SECURITY LOG:
        console.warn(`⚠️ SECURITY: Auto-linking Loan #${l.id} (${l.clientName}) to User UID: ${match.uid}`);

        l.clientUid = match.uid;

        // ✅ FIX: write to the *real* RTDB key for this loan (array index vs object key)
        const __paths = (Array.isArray(l.__loanPaths) && l.__loanPaths.length)
          ? l.__loanPaths.slice()
          : (l.__loanPath ? [l.__loanPath] : [`loans/${l.id}`]);
        const __primary = l.__primaryLoanPath || l.__loanPath || __paths[0];

        // Update clientUid everywhere (so whichever copy is displayed later is linked)
        __paths.forEach(p => { if (p) updates[`${p}/clientUid`] = match.uid; });

        // Only bump updatedAt on the primary copy (prevents "thin" duplicates from winning)
        updates[`${__primary}/updatedAt`] = new Date().toISOString();

        count++;
      }
    }
  });

  if (count > 0) {
    if (!OFFLINE_TEST_MODE && dataRef) {
       dataRef.update(updates);
       // Force sync immediately to secure the data
       distributeLoansToClients(state.loans, true);
    }
    showToast(`Linked ${count} loans to registered accounts`, "success");
  }

  __hasAutoLinked = true;
}

/* refreshUI (Final Integration: Smart Notifs + Admin Profiles) */

/* admin/app.js - REPLACE YOUR EXISTING refreshUI FUNCTION WITH THIS */

function refreshUI() {
  try { linkOrphanedLoans(); } catch(e) {}
  try { recomputeAllLoans(); } catch (e) { console.error("Error computing loans:", e); }

  const overdueLoans = (state.loans || []).filter(l => l.status === "OVERDUE");
  const bellBadge = document.getElementById("bellBadge");
  const notifList = document.getElementById("notifList");

  let sharedNotifs = [];
  try {
    window.StallzShared?.ensureSeed?.();
    sharedNotifs = window.StallzShared?.getAdminNotifications?.() || [];
  } catch (e) {
    sharedNotifs = [];
  }

  // ✅ SMART FILTER: Hide "Due Soon" alerts if the loan is effectively paid
  sharedNotifs = sharedNotifs.filter(n => {
    // Check if this is a loan-related alert
    if (n.type === "DUE_SOON" && n.meta && n.meta.loanId) {
      // Find the actual loan in our latest data
      const loan = state.loans.find(l => String(l.id) === String(n.meta.loanId));

      if (loan) {
        // 1. Check Status
        const isClosed = (loan.status === "PAID" || loan.status === "DEFAULTED");
        // 2. Check Balance (Extra safety: if balance is 0 or less, it's paid)
        const isZeroBalance = (Number(loan.balance || 0) <= 0.01);

        // If either is true, this alert is stale -> HIDE IT
        if (isClosed || isZeroBalance) {
          return false;
        }
      }
    }
    // Keep valid alerts
    return true;
  });

  const hasAny = (sharedNotifs.length + overdueLoans.length) > 0;
  if (bellBadge) bellBadge.classList.toggle("show", hasAny);

  if (notifList) {
    if (!hasAny) {
        notifList.innerHTML = `<div style="padding:20px; text-align:center; color:#94a3b8; font-size:0.8rem;">All caught up! No alerts.</div>`;
    } else {
        const sharedHtml = sharedNotifs.map(n => {
        const icon = n.type === "LOAN_REQUEST" ? "📝"
            : n.type === "NEW_CLIENT" ? "🆕"
            : n.type === "MESSAGE" ? "💬"
            : n.type === "DUE_SOON" ? "⏳"
            : "🔔";
        const sub = n.body ? `<div style="opacity:0.7;">${escapeHTML(n.body)}</div>` : "";
        const click = n.type === "LOAN_REQUEST" ? `window.openLoanRequestModal(${Number(n.meta?.requestId) || 0})`
            : n.type === "MESSAGE" ? `window.openAdminMessageModal('${String(n.meta?.clientUid || "")}')`
            : n.type === "NEW_CLIENT" ? `openPopup('clientsModal')`
            : n.type === "DUE_SOON" ? (n.meta?.loanId ? `openActionModal('PAY', ${Number(n.meta.loanId)})` : `openPopup('clientsModal')`)
            : `void 0`;
        return `
            <div class="notif-item" onclick="${click}">
            <span style="margin-right:8px;">${icon}</span>
            <div>
                <div style="font-weight:600;">${escapeHTML(n.title || "Notification")}</div>
                ${sub}
            </div>
            </div>`;
        }).join("");

        const overdueHtml = overdueLoans.map(l => `
            <div class="notif-item" onclick="openActionModal('PAY', ${l.id})">
                <span style="color:#ef4444; margin-right:8px;">⚠️</span>
                <div>
                    <div style="font-weight:600;">Overdue: ${escapeHTML(l.clientName)}</div>
                    <div style="opacity:0.7;">Due: ${formatDate(l.dueDate)} • ${formatMoney(l.balance)}</div>
                </div>
            </div>
        `).join("");

        notifList.innerHTML = sharedHtml + overdueHtml;
    }
  }

  // ✅ SIDEBAR UPDATE: Render Clickable Admin Rows for Profiles
  const tbody = document.getElementById("sidebarAdminsBody");
  if (tbody) {
    tbody.innerHTML = (state.admins || []).map(a => `
        <tr onclick="openAdminProfile('${a.uid || a.email}')" style="cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
            <td style="font-weight:600; padding:12px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div class="avatar avatar-${(a.name.length)%5}" style="width:28px; height:28px; font-size:0.75rem;">${getInitials(a.name)}</div>
                    <div>${escapeHTML(a.name)}</div>
                </div>
            </td>
            <td style="font-size:0.75rem; opacity:0.7; text-align:right; padding:12px;">
                <span style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">${(a.role||"Admin").toUpperCase()}</span>
            </td>
        </tr>`).join("");
  }

  try { renderDashboard(); } catch (e) { console.error("Dash Error:", e); }
  try { renderLoansTable(); } catch (e) { console.error("Loans Table Error:", e); }
  try { renderRepaymentsTable(); } catch (e) { console.error("Repay Table Error:", e); }
  try { renderMonthlyTable(); } catch (e) { console.error("Monthly Table Error:", e); }
  try { renderClientsTable(); } catch (e) { console.error("Clients Table Error:", e); }
  try { renderCapitalHistory(); } catch (e) { console.error("Cap History Error:", e); }
}
// Global flag to prevent re-animating numbers every 15 seconds
let __dashboardAnimRan = false;


function renderCapitalHistory() {
  const tbody = document.getElementById("capitalHistoryBody");
  if (!tbody) return;

  const list = state.capitalTxns || [];

  if (list.length === 0) {
     tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted); font-style:italic;">No capital history records found.</td></tr>`;
     return;
  }

  tbody.innerHTML = list.map(t => {
      const d = new Date(t.date);
      // Format Date
      const dateStr = d.toLocaleDateString("en-ZM", { day: 'numeric', month: 'short', year: '2-digit' });
      // Format Time
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });

      // Determine User Name (Fallback to 'Admin' for old records)
      let user = t.recordedBy || "Admin";
      // Try to shorten long emails to just the name part
      if(user.includes("@")) user = user.split("@")[0];

      return `
        <tr>
          <td style="font-size:0.85rem; color:var(--text-main);">${dateStr}</td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${timeStr}</td>
          <td style="font-size:0.85rem; font-weight:600;">${escapeHTML(user.toUpperCase())}</td>
          <td style="text-align:right; color:var(--success); font-weight:700;">+${formatMoney(t.amount)}</td>
        </tr>
      `;
  }).join("");

/* ==========================================================================
   LOANS HISTORY (Modal) — works like Capital Ledger History
   ========================================================================== */

function _loanThinScore(ln){
  try {
    if (!ln || typeof ln !== "object") return 0;
    const keys = Object.keys(ln).filter(k => ln[k] !== undefined && ln[k] !== null);
    return keys.length;
  } catch(e){ return 0; }
}

function dedupeLoansById(list){
  const byId = new Map();
  (list || []).forEach((ln) => {
    if (!ln || typeof ln !== "object") return;
    const id = (ln.id !== undefined && ln.id !== null) ? String(ln.id) : "";
    if (!id) return;

    const status = String(ln.status || "ACTIVE").toUpperCase();
    const statusRank = (status === "PAID") ? 4 : (status === "DEFAULTED") ? 3 : (status === "OVERDUE") ? 2 : 1;

    const t = Date.parse(ln.updatedAt || ln.paidAt || ln.startDate || "");
    const ts = isNaN(t) ? 0 : t;

    const thin = _loanThinScore(ln); // prevents "thin duplicates" (e.g., only clientUid) from winning

    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ln, statusRank, ts, thin });
      return;
    }

    // Prefer: richer record > higher status rank > newer updatedAt > higher paid
    const prevPaid = Number(prev.ln?.paid || 0);
    const thisPaid = Number(ln.paid || 0);

    const better =
      (thin > prev.thin) ||
      (thin === prev.thin && statusRank > prev.statusRank) ||
      (thin === prev.thin && statusRank === prev.statusRank && ts > prev.ts) ||
      (thin === prev.thin && statusRank === prev.statusRank && ts === prev.ts && thisPaid > prevPaid);

    if (better) byId.set(id, { ln, statusRank, ts, thin });
  });
  return Array.from(byId.values()).map(x => x.ln);
}

function isLoanPast(ln){
  const s = String(ln?.status || "ACTIVE").toUpperCase();
  return (s === "PAID" || s === "DEFAULTED");
}

function _fmtDateShort(d){
  try{
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "--";
    return dt.toLocaleDateString("en-ZM", { day:"2-digit", month:"short", year:"2-digit" });
  } catch(e){ return "--"; }
}

function _fmtMoney(n){
  const v = Number(n || 0);
  return formatMoney(isNaN(v) ? 0 : v);
}

function isModalOpen(id){
  const m = document.getElementById(id);
  if (!m) return false;
  return m.style.display !== "none" && !m.classList.contains("modal-hidden");
}

window.openLoanHistoryModal = function(){
  openPopup("loanHistoryModal");
  // prime search value
  const input = document.getElementById("loanHistorySearchInput");
  if (input) {
    input.value = state.loanHistorySearch || "";
    setTimeout(() => { try { input.focus(); } catch(_){} }, 120);
  }
  renderLoanHistory();
};

window.setLoanHistoryFilter = function(mode, btn){
  state.loanHistoryFilter = String(mode || "PAST").toUpperCase();
  // chip active styling
  try{
    const wrap = btn?.parentElement;
    if (wrap) {
      wrap.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      if (btn) btn.classList.add("active");
    }
  } catch(e){}
  renderLoanHistory();
};

function renderLoanHistory(){
  const tbody = document.getElementById("loanHistoryBody");
  if (!tbody) return;

  // Only render while modal exists; safe to render even when closed
  const listAll = dedupeLoansById(state.loans || []);
  const q = String(state.loanHistorySearch || "").trim().toLowerCase();
  const mode = String(state.loanHistoryFilter || "PAST").toUpperCase();

  let list = listAll;

  if (mode === "PAST") {
    list = list.filter(isLoanPast);
  } else if (mode === "ACTIVE") {
    list = list.filter(l => String(l.status || "ACTIVE").toUpperCase() === "ACTIVE");
  } else if (mode === "OVERDUE") {
    list = list.filter(l => String(l.status || "ACTIVE").toUpperCase() === "OVERDUE");
  } // ALL => no filter

  if (q) {
    list = list.filter(l => {
      const id = String(l.id ?? "");
      const client = String(l.clientName ?? "");
      const phone = String(l.clientPhone ?? "");
      const item = String(l.collateralItem ?? "");
      return (id.toLowerCase().includes(q) ||
              client.toLowerCase().includes(q) ||
              phone.toLowerCase().includes(q) ||
              item.toLowerCase().includes(q));
    });
  }

  // Sort newest first: updatedAt > paidAt > startDate > id
  list.sort((a,b)=>{
    const ta = Date.parse(a.updatedAt || a.paidAt || a.startDate || "") || 0;
    const tb = Date.parse(b.updatedAt || b.paidAt || b.startDate || "") || 0;
    if (tb !== ta) return tb - ta;
    return Number(b.id || 0) - Number(a.id || 0);
  });

  if (!list.length){
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:22px; color:var(--text-muted); font-style:italic;">No loan history records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(l => {
    const status = String(l.status || "ACTIVE").toUpperCase();
    const statusBadge =
      status === "PAID" ? `<span class="pill paid">PAID</span>` :
      status === "OVERDUE" ? `<span class="pill overdue">OVERDUE</span>` :
      status === "DEFAULTED" ? `<span class="pill defaulted">CLOSED</span>` :
      `<span class="pill active">ACTIVE</span>`;

    const updated = _fmtDateShort(l.updatedAt || l.paidAt || l.startDate);

    const amount = _fmtMoney(l.amount);
    const total = _fmtMoney(l.totalDue);
    const paid = _fmtMoney(l.paid);
    const bal = _fmtMoney(l.balance);

    return `
      <tr>
        <td style="font-weight:800; color:var(--text-main);">#${escapeHTML(String(l.id ?? "--"))}</td>
        <td style="font-weight:700;">${escapeHTML(String(l.clientName || "Unknown"))}<div style="font-size:.78rem; color:var(--text-muted);">${escapeHTML(String(l.clientPhone || ""))}</div></td>
        <td style="color:var(--text-main);">${escapeHTML(String(l.collateralItem || "Personal Loan"))}</td>
        <td style="text-align:right; font-weight:700;">${amount}</td>
        <td style="text-align:right; color:var(--accent-blue); font-weight:800;">${total}</td>
        <td style="text-align:right; color:var(--success); font-weight:800;">${paid}</td>
        <td style="text-align:right; font-weight:800;">${bal}</td>
        <td>${statusBadge}</td>
        <td style="font-size:.82rem; color:var(--text-muted);">${updated}</td>
      </tr>
    `;
  }).join("");
}


}

function renderDashboard() {
  const container = document.getElementById("dashboardStats");
  if (!container) return;

  const loans = state.loans || [];

  // 1. Calculate Stats
  const totalLoaned = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => {
    if (l.status === "DEFAULTED") return s;
    return s + Math.max(0, l.balance || 0);
  }, 0);
  const totalProfit = loans.reduce((s, l) => s + (l.profitCollected || 0), 0);
  const activeCount = loans.filter(l => l.status === "ACTIVE" || l.status === "OVERDUE").length;

  const starting = state.startingCapital || 0;
  const added = (state.capitalTxns || []).reduce((s, t) => s + (t.amount || 0), 0);
  const paidIn = loans.reduce((s, l) => s + (l.paid || 0), 0);
  const cashOnHand = starting + added + paidIn - totalLoaned;

  // 2. Update Cash Display
  const cashEl = document.getElementById("cashOnHandValue");
  if (cashEl) {
    cashEl.textContent = formatMoney(cashOnHand);
    if (cashOnHand < 0) cashEl.classList.add("text-danger-glow");
    else cashEl.classList.remove("text-danger-glow");
  }

  // 4. Update Starting Capital Display (Separate Section)
  if (state.startingCapital > 0) {
    if (document.getElementById("startingCapitalSetupRow")) document.getElementById("startingCapitalSetupRow").style.display = "none";
    if (document.getElementById("startingCapitalInfoRow")) {
      document.getElementById("startingCapitalInfoRow").style.display = "block";
      if (document.getElementById("startingCapitalInfoValue")) document.getElementById("startingCapitalInfoValue").textContent = formatMoney(state.startingCapital);
    }
    if (document.getElementById("startingCapitalValue")) document.getElementById("startingCapitalValue").textContent = formatMoney(state.startingCapital);
  } else {
    if (document.getElementById("startingCapitalSetupRow")) document.getElementById("startingCapitalSetupRow").style.display = "block";
    if (document.getElementById("startingCapitalInfoRow")) document.getElementById("startingCapitalInfoRow").style.display = "none";
    if (document.getElementById("startingCapitalValue")) document.getElementById("startingCapitalValue").textContent = "Not set";
  }

  // 5. Render Stat Cards
  container.innerHTML = `
    <div class="stat-card" style="border-color: var(--primary);">
      <div class="stat-label">Active Deals</div>
      <div class="stat-value" style="font-size: 1.8rem;">${activeCount}</div>
      <div class="stat-sub">Clients with open balances</div>
    </div>
    <div class="stat-card stat-purple">
      <div class="stat-label">Total Loaned</div>
      <div class="stat-value" id="statLoaned">${typeof __dashboardAnimRan !== 'undefined' && __dashboardAnimRan ? formatMoney(totalLoaned) : 'K0.00'}</div>
      <div class="stat-sub">Lifetime capital deployed</div>
    </div>
    <div class="stat-card stat-orange">
      <div class="stat-label">Outstanding</div>
      <div class="stat-value" id="statOutstanding">${typeof __dashboardAnimRan !== 'undefined' && __dashboardAnimRan ? formatMoney(totalOutstanding) : 'K0.00'}</div>
      <div class="stat-sub">Pending collection (Excl. Bad Debt)</div>
    </div>
    <div class="stat-card stat-green">
      <div class="stat-label">Profit Made</div>
      <div class="stat-value" id="statProfit">${typeof __dashboardAnimRan !== 'undefined' && __dashboardAnimRan ? formatMoney(totalProfit) : 'K0.00'}</div>
      <div class="stat-sub">Total realized gains collected</div>
    </div>
  `;

  if (typeof __dashboardAnimRan !== 'undefined' && !__dashboardAnimRan) {
      animateValue(document.getElementById("statLoaned"), 0, totalLoaned, 1500);
      animateValue(document.getElementById("statOutstanding"), 0, totalOutstanding, 2000);
      animateValue(document.getElementById("statProfit"), 0, totalProfit, 2500);
      __dashboardAnimRan = true;
  }
}

function renderLoansTable() {
  recomputeAllLoans();
  const tbody = document.getElementById("loansTableBody");
  if (!tbody) return;

  try { wireClientSearchUI(); } catch(e) {}

  const search = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const statusFilter = activeFilters.status;
  const planFilter = activeFilters.plan;

  const visibleLoans = (state.loans || []).filter(l => {
    const matchSearch = !search ||
      (l.clientName && l.clientName.toLowerCase().includes(search)) ||
      (l.id && l.id.toString().includes(search));
    const matchStatus = statusFilter === "All" || l.status === statusFilter;
    const matchPlan = planFilter === "All" || l.plan === planFilter;
    return matchSearch && matchStatus && matchPlan;
  });

  if (document.getElementById("loansCountLabel")) {
    document.getElementById("loansCountLabel").textContent = `${visibleLoans.length} records`;
  }

  if (document.getElementById("emptyState")) {
    const shouldShow = visibleLoans.length === 0;
    document.getElementById("emptyState").style.display = shouldShow ? "block" : "none";
  }

  tbody.innerHTML = visibleLoans.map((l, index) => {
    const percent = Math.min(100, Math.round(((l.paid || 0) / (l.totalDue || 1)) * 100));
    let progressColor = "var(--primary)";
    if (percent >= 100) progressColor = "var(--success)";
    else if (l.status === "OVERDUE") progressColor = "var(--danger)";
    else if (l.status === "DEFAULTED") progressColor = "var(--neutral)";

    const isOverdue = l.status === "OVERDUE";
    const balanceStyle = isOverdue ? 'class="text-danger-glow" style="font-weight:bold;"' : 'style="font-weight:bold;"';
    const avatarClass = `avatar-${l.id % 5}`;
    const isClosed = l.status === "PAID" || l.status === "DEFAULTED";
    const disabledAttr = isClosed ? 'disabled aria-disabled="true"' : '';
    const disabledOpacity = isClosed ? 'opacity:0.3;' : '';

    const waNumber = formatWhatsApp(l.clientPhone);
    const waMsg = encodeURIComponent(`Hi ${l.clientName}, reminder: Balance of ${formatMoney(l.balance)} was due on ${formatDate(l.dueDate)}.`);
    const waLink = waNumber ? `https://wa.me/${waNumber}?text=${waMsg}` : "#";
    const waStyle = waNumber ? "color:#4ade80;" : "color:#64748b; cursor:not-allowed;";

    // FIX APPLIED: Added data-loan-id="${l.id}" for reliable mobile interaction
    return `
    <tr class="row-${(l.status || 'active').toLowerCase()}" data-loan-id="${l.id}" style="animation-delay: ${index * 0.05}s">
      <td data-label="ID"><span style="opacity:0.5; font-size:0.8rem;">#${l.id}</span></td>
      <td data-label="Client">
        <div class="client-flex">
          <div class="avatar ${avatarClass}">${escapeHTML(getInitials(l.clientName))}</div>
          <div>
            <div style="font-weight:600; color:var(--text-main);">${escapeHTML(l.clientName)}</div>
            <div class="subtle" style="font-size:0.75rem;">${escapeHTML(l.clientPhone || '')}</div>
          </div>
        </div>
      </td>
      <td data-label="Item"><span style="color:var(--text-muted);">${escapeHTML(l.collateralItem || '-')}</span></td>
      <td data-label="Progress">
        <div style="min-width: 100px;">
          <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:4px;">
            <span>${percent}%</span>
            <span>${formatMoney(l.paid)} / ${formatMoney(l.totalDue)}</span>
          </div>
          <div style="background:rgba(255,255,255,0.1); height:6px; border-radius:4px; overflow:hidden;">
            <div style="width:${percent}%; background:${progressColor}; height:100%; border-radius:4px; transition: width 1s ease;"></div>
          </div>
        </div>
      </td>
      <td data-label="Start">${formatDate(l.startDate)}</td>
      <td data-label="Due">${formatDate(l.dueDate)}</td>
      <td data-label="Balance" ${balanceStyle}>${formatMoney(l.balance)}</td>
      <td data-label="Status"><span class="status-pill status-${(l.status || 'active').toLowerCase()}">${l.status}</span></td>
      <td data-label="Actions" style="text-align:right; white-space:nowrap;">
        <button class="btn-icon" onclick="openReceipt(${l.id})" title="Print Receipt">🖨️</button>
        <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn-icon" style="${waStyle}; text-decoration:none; display:inline-flex;" title="WhatsApp">💬</a>
        <button class="btn-icon" onclick="openActionModal('PAY', ${l.id})" title="Pay" style="color:#38bdf8; ${disabledOpacity}" ${disabledAttr}>💳</button>
        <button class="btn-icon" onclick="openActionModal('WRITEOFF', ${l.id})" title="Bad Debt" style="color:#f87171; ${disabledOpacity}" ${disabledAttr}>🗑️</button>
        <button class="btn-icon" onclick="openActionModal('NOTE', ${l.id})" title="Note">📝</button>
      </td>
    </tr>
  `}).join("");
}

function renderRepaymentsTable() {
  const tbody = el("repaymentsTableBody");
  if (!tbody) return;
  tbody.innerHTML = (state.repayments || []).map(r => {
    const loan = state.loans.find(l => l.id === r.loanId);
    return `
     <tr>
       <td data-label="Date">${formatDate(r.date)}</td>
       <td data-label="Loan ID">#${r.loanId}</td>
       <td data-label="Client">${loan ? loan.clientName : 'Deleted'}</td>
       <td data-label="Recorder">${r.recordedBy || 'System'}</td>
       <td data-label="Amount" style="color:#34d399">+${formatMoney(r.amount)}</td>
     </tr>`;
  }).join("");
}

function renderMonthlyTable() {
  const tbody = el("monthlyTableBody");
  if (!tbody) return;

  const map = {};
  // Start with today as the minimum range end, work backwards to find true start
  let minDate = new Date();
  const updateMin = (d) => { if (d < minDate) minDate = d; };

  // 1. Aggregate Data & Find Range
  (state.loans || []).forEach(loan => {
    const d = parseDateSmart(loan.startDate);
    if (!d) return;
    updateMin(d);
    const key = getMonthKey(loan.startDate);
    if (!key) return;
    if (!map[key]) map[key] = { loansOut: 0, in: 0 };
    map[key].loansOut += Number(loan.amount || 0);
  });

  (state.repayments || []).forEach(r => {
    const d = parseDateSmart(r.date);
    if (!d) return;
    updateMin(d);
    const key = getMonthKey(r.date);
    if (!key) return;
    if (!map[key]) map[key] = { loansOut: 0, in: 0 };
    map[key].in += Number(r.amount || 0);
  });

  // 2. Generate Continuous List (From Today -> Back to Start)
  const today = new Date();
  let current = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = new Date(minDate.getFullYear(), minDate.getMonth(), 1);

  // Guard against infinite loop if date parsing fails (cap at 5 years back)
  const limitDate = new Date();
  limitDate.setFullYear(limitDate.getFullYear() - 5);
  if (start < limitDate) start.setTime(limitDate.getTime());

  let html = "";

  while (current >= start) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const key = `${y}-${m}`;
    const row = map[key] || { loansOut: 0, in: 0 };
    const net = row.in - row.loansOut;

    const dateLabel = current.toLocaleDateString("en-ZM", { month: 'short', year: 'numeric' });
    const isCurrent = (key === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);

    // Highlight current month with a border
    const borderStyle = isCurrent ? "border-left: 4px solid var(--primary);" : "border-left: 4px solid transparent;";

    html += `
    <tr style="${borderStyle} transition: all 0.2s ease;">
      <td data-label="Month">
        <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-weight:800; font-size:1rem; color:var(--text-main); text-transform:uppercase; letter-spacing:0.5px;">${dateLabel}</span>
            ${isCurrent ? '<span class="status-pill status-active" style="font-size:0.5rem; padding:1px 5px; line-height:1; vertical-align:middle; letter-spacing:0.5px;">CURRENT</span>' : ''}
        </div>
      </td>
      <td data-label="Out" style="font-family:'Courier New', monospace; font-weight:600; color:var(--text-muted); opacity:0.9;">
        ${formatMoney(row.loansOut)}
      </td>
      <td data-label="In" style="font-family:'Courier New', monospace; font-weight:600; color:var(--text-main); opacity:0.9;">
        ${formatMoney(row.in)}
      </td>
      <td data-label="Net Flow">
        <span style="font-family:'Courier New', monospace; font-weight:800; font-size:1.1rem; color:${net >= 0 ? '#4ade80' : '#f87171'}">
          ${net > 0 ? '+' : ''}${formatMoney(net)}
        </span>
      </td>
    </tr>`;

    // Move back one month
    current.setMonth(current.getMonth() - 1);
  }

  // Handle empty history
  if (html === "") {
      html = `<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted); font-style:italic;">No records found yet.</td></tr>`;
  }

  tbody.innerHTML = html;
}
function setClientFilterHint(text) {
    const hint = el("clientFilterHint");
    if (!hint) return;
    hint.textContent = text || "";
}

function wireClientSearchUI() {
    const input = el("clientSearchInput");
    const clearBtn = el("clientSearchClearBtn");

    if (input && !input.__stallzWired) {
        input.__stallzWired = true;
        input.value = clientSearchQuery;

        const onInput = debounce(() => {
            window.setClientSearch(input.value);
        }, 90);

        input.addEventListener("input", onInput);
        input.addEventListener("search", () => {
            window.setClientSearch(input.value);
        });
    }

    if (clearBtn && !clearBtn.__stallzWired) {
        clearBtn.__stallzWired = true;
        clearBtn.addEventListener("click", () => {
            clientSearchQuery = "";
            if (input) input.value = "";
            renderClientsTable();
            try { input?.focus?.(); } catch(e) {}
        });
    }
}

// 👇 INSERT THIS NEW FUNCTION HERE
window.setClientSearch = function(q) {
  clientSearchQuery = q;
  renderClientsTable();
}

window.setClientView = function(view) {
    currentClientView = view;
    const activeTab = document.getElementById('tabActiveClients');
    const registeredTab = document.getElementById('tabRegisteredClients');

    if (activeTab) activeTab.classList.toggle('active', view === 'active');
    if (registeredTab) registeredTab.classList.toggle('active', view === 'registered');

    renderClientsTable();
};

function formatZambianPhone(phone) {
    if (!phone) return "-";
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0')) {
        clean = '260' + clean.substring(1);
    }
    if (clean.startsWith('260') && clean.length === 12) {
        return `+${clean.substring(0,3)} ${clean.substring(3,6)} ${clean.substring(6)}`;
    }
    return phone;
}

/* admin/app.js - renderClientsTable (Green Theme + Bottom Badge Fix) */

function renderClientsTable() {
    const tbody = document.getElementById("clientsTableBody");
    if (!tbody) return;

    const sharedUsers = window.StallzShared?.listUsers?.("client") || [];
    const allLoans = state.loans || [];

    const normalizePhone = (p) => String(p || "").replace(/\D/g, "").replace(/^0/, "260");

    const clientMap = {};

    const upsert = (key, patch) => {
        if (!clientMap[key]) clientMap[key] = {
            key,
            uid: null,
            name: "CLIENT",
            phone: "",
            email: "",
            nrc: "NOT SET",
            address: "NOT SET",
            createdAt: null,
            hasLoanHistory: false,
            source: "manual"
        };
        Object.assign(clientMap[key], patch || {});
        return clientMap[key];
    };

    sharedUsers.forEach(u => {
        const key = u?.uid ? `uid:${u.uid}` : (u?.email ? `email:${String(u.email).toLowerCase()}` : `name:${String(u.name||"client").toLowerCase()}`);
        upsert(key, {
            uid: u.uid || null,
            name: (u.name || u.email || "Client").toUpperCase(),
            phone: u.phone || "",
            email: u.email || "",
            nrc: u.nrc || "NOT SET",
            address: u.address || u.city || "NOT SET",
            createdAt: u.createdAt || u.createdOn || u.created || null,
            source: "registered"
        });
    });

    allLoans.forEach(loan => {
        const uid = loan?.clientUid ? String(loan.clientUid) : "";
        const phoneN = normalizePhone(loan?.clientPhone);
        const nameN = String(loan?.clientName || "Unknown").trim();

        let entry = null;

        if (uid && clientMap[`uid:${uid}`]) entry = clientMap[`uid:${uid}`];

        if (!entry && phoneN) {
            entry = Object.values(clientMap).find(c => normalizePhone(c.phone) === phoneN) || null;
        }

        if (!entry) {
            const key = phoneN ? `phone:${phoneN}` : `name:${nameN.toLowerCase()}`;
            entry = upsert(key, {
                uid: uid || null,
                name: nameN.toUpperCase(),
                phone: loan?.clientPhone || "",
                address: loan?.clientCity || loan?.city || loan?.address || "NOT SET",
                source: uid ? "registered" : "manual"
            });
        } else if (uid && !entry.uid) {
            entry.uid = uid;
        }

        entry.hasLoanHistory = true;
    });

    let displayList = Object.values(clientMap);

    if (currentClientView === "active") {
        displayList = displayList.filter(c => c.hasLoanHistory === true);
    } else if (currentClientView === "registered") {
        displayList = displayList.filter(c => c.source === "registered" && c.hasLoanHistory === false);
    }

    const totalInView = displayList.length;

    const q = String(clientSearchQuery || "").trim().toLowerCase();
    if (q) {
        displayList = displayList.filter(c => {
            const hay = [
                c.name, c.phone, c.email, c.nrc, c.address, c.uid, c.key
            ].map(v => String(v || "")).join(" ").toLowerCase();
            return hay.includes(q);
        });
    }

    displayList.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    if (q) setClientFilterHint(`Showing ${displayList.length} of ${totalInView} • Search: “${clientSearchQuery.trim()}”`);
    else setClientFilterHint(`Showing ${displayList.length} client${displayList.length === 1 ? "" : "s"}.`);

    if (displayList.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding:24px; text-align:center; color:var(--text-muted); font-style:italic;">
              No clients found in this category.
            </td>
          </tr>`;
        return;
    }

    const avatarIdx = (s) => {
        const str = String(s || "");
        let h = 0;
        for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
        return Math.abs(h) % 5;
    };

    // FIX: Dynamic Theme + Green Accent Border
    const cardStyle = `
        display: block !important;
        width: 100%;
        margin: 0 0 16px 0 !important;
        padding: 16px !important;

        /* 1. Dynamic Background */
        background: var(--card-bg) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;

        /* 2. Dynamic Border */
        border: var(--card-border) !important;
        box-shadow: var(--card-shadow) !important;

        /* 3. Shape */
        border-radius: 16px !important;

        /* 4. Green Accent Theme */
        border-left: 4px solid var(--primary) !important;

        position: relative;
        overflow: hidden;
    `;

    tbody.innerHTML = displayList.map(c => {
        const isActive = !!c.hasLoanHistory;
        const accountPill = isActive
            ? `<span class="status-pill status-active">ACTIVE</span>`
            : `<span class="status-pill status-paid">REGISTERED</span>`;

        const idTag = c.uid ? `#${String(c.uid).substring(0, 6)}` : `MAN-${String(c.key).replace(/[^a-z0-9]/gi,'').substring(0,6).toUpperCase()}`;

        // Manual Badge (Moved to bottom)
        const srcTag = c.source === "manual"
            ? `<span class="status-pill" style="border:1px solid rgba(148,163,184,0.3); color:var(--text-muted); background:rgba(148,163,184,0.05); font-size:0.65rem; padding:2px 8px; letter-spacing:0.5px;">MANUAL</span>`
            : "";

        const phonePretty = c.phone ? formatZambianPhone(c.phone) : "-";
        const emailPretty = c.email ? escapeHTML(c.email) : "-";
        const addressPretty = c.address ? escapeHTML(c.address) : "NOT SET";
        const createdPretty = c.createdAt ? formatDate(c.createdAt) : "";

        return `
          <tr class="client-card" style="${cardStyle}">
            <td data-label="ID"><span style="opacity:0.5; font-size:0.8rem; font-family:'Courier New', monospace; color:var(--text-muted);">${escapeHTML(idTag)}</span></td>

            <td data-label="Client">
              <div class="client-flex">
                <div class="avatar avatar-${avatarIdx(c.uid || c.key)}" style="width:38px; height:38px; font-size:0.85rem; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${escapeHTML(getInitials(c.name))}</div>
                <div style="min-width:0;">
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <div style="font-weight:700; color:var(--text-main); font-size:0.95rem;">${escapeHTML(c.name)}</div>
                    </div>
                  <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                    ${createdPretty ? `Joined: ${escapeHTML(createdPretty)}` : "Client Profile"}
                  </div>
                </div>
              </div>
            </td>

            <td data-label="Contact">
              <div style="text-align:right;">
                <div style="font-weight:600; font-size:0.9rem; font-family:'Courier New', monospace; letter-spacing:-0.5px; color:var(--text-main);">${escapeHTML(phonePretty)}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); opacity:0.8;">${emailPretty}</div>
              </div>
            </td>

            <td data-label="NRC">
              <div style="text-align:right; font-weight:600; font-size:0.85rem; opacity:0.9; color:var(--text-main);">
                ${escapeHTML(c.nrc || "NOT SET")}
              </div>
            </td>

            <td data-label="Address">
              <div style="text-align:right; font-size:0.8rem; opacity:0.8; max-width:150px; margin-left:auto; color:var(--text-muted);">
                ${addressPretty}
              </div>
            </td>

            <td data-label="" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--divider); display:flex !important; justify-content:space-between !important; align-items:center !important; width:100% !important;">
              <div>${srcTag}</div>
              <div>${accountPill}</div>
            </td>
          </tr>`;
    }).join("");
}


function renderAdminsTable() {
  const tbody = el("adminsTableBody");
  if (!tbody) return;
  tbody.innerHTML = (state.admins || []).map(a => `
  <tr>
    <td data-label="ID">#${a.id}</td>
    <td data-label="Name">${a.name}</td>
    <td data-label="Role">${a.role}</td>
    <td data-label="Phone">${a.phone || '-'}</td>
  </tr>`).join("");
}

/* ============================================================================
 * 8.0 | RECEIPT GENERATION
 * ============================================================================ */

/* admin/app.js - Updated openReceipt */

window.openReceipt = function(loanId) {
  const loan = state.loans.find(l => l.id == loanId);
  if (!loan) return;

  // Sort history (not strictly used in this compact receipt, but kept for logic)
  const history = state.repayments
    .filter(r => r.loanId === loan.id)
    .sort((a, b) => (parseDateSmart(b.date)?.getTime() || 0) - (parseDateSmart(a.date)?.getTime() || 0));

  // Determine Status Color
  let statusColor = "#333";
  let statusText = loan.status;
  if (loan.balance <= 0.01) { statusColor = "#16a34a"; statusText = "PAID IN FULL"; }
  else if (loan.status === "OVERDUE") { statusColor = "#dc2626"; }

  // Calculate Interest Percentage
  const interestPercent = ((loan.rate || 0) * 100).toFixed(0);

  const receiptHTML = `
    <div style="font-family: 'Segoe UI', sans-serif; color: #1e293b; padding: 20px; font-size: 10px; background: white;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="../assets/logo_images/my-logo.png" style="height: 32px; width: auto; display:block;" onerror="this.style.display='none'">
            <div>
              <h1 style="margin: 0; font-size: 14px; color: #1e293b; text-transform: uppercase; font-weight:800; letter-spacing: 0.5px;">Stallz Loans</h1>
              <p style="margin: 1px 0 0; font-size: 8px; color: #64748b; font-weight:600;">Quick, Easy, Reliable</p>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="color: #64748b;">Receipt #: <strong style="color: #0f172a;">${loan.id}</strong></div>
            <div style="color: #64748b;">Date: <strong style="color: #0f172a;">${new Date().toLocaleDateString()}</strong></div>
            <div style="margin-top:2px; font-size: 8px; font-weight:700; color:${statusColor}; border:1px solid ${statusColor}; padding:1px 4px; border-radius:3px; display:inline-block;">${statusText}</div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #f1f5f9;">
          <div>
            <div style="font-size: 8px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 2px;">Client</div>
            <div style="font-size: 11px; font-weight: 700; color: #334155;">${escapeHTML(loan.clientName)}</div>
            <div style="font-size: 9px; color: #64748b;">${loan.clientPhone || ''}</div>
          </div>
          <div style="text-align: right;">
             <div style="font-size: 8px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 2px;">Due Date</div>
             <div style="font-size: 11px; font-weight: 700; color: ${statusColor};">${formatDate(loan.dueDate)}</div>
             <div style="font-size: 8px; color: #94a3b8; margin-top:2px;">Item: ${escapeHTML(loan.collateralItem)}</div>
          </div>
        </div>

        <div style="width: 100%; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f1f5f9;">
                <span>Principal</span>
                <span style="font-weight:600;">${formatMoney(loan.amount)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f1f5f9;">
                <span>Interest/Fees (${interestPercent}%)</span>
                <span style="font-weight:600;">${formatMoney(loan.totalDue - loan.amount)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f1f5f9;">
                <span style="font-weight: 700; color: #0f172a;">Total Due</span>
                <span style="font-weight: 700; color: #0f172a;">${formatMoney(loan.totalDue)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f1f5f9; color: #16a34a;">
                <span>Less: Paid</span>
                <span>- ${formatMoney(loan.paid)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #0f172a; margin-top: 2px;">
                <span style="font-weight: 800; font-size:12px;">BALANCE</span>
                <span style="font-weight: 800; font-size:14px; color: ${statusColor};">${formatMoney(loan.balance)}</span>
            </div>

            ${loan.notes ? `
            <div style="margin-top: 12px; padding: 8px; background: #fefce8; border: 1px solid #fef08a; border-radius: 6px;">
                <div style="font-size: 7px; text-transform: uppercase; color: #854d0e; font-weight: 800; margin-bottom: 2px;">Admin Notes</div>
                <div style="font-size: 9px; color: #713f12; font-style: italic; white-space: pre-wrap;">"${escapeHTML(loan.notes)}"</div>
            </div>
            ` : ''}
        </div>

        <div style="margin-top: 5px; border-top: 1px dashed #e2e8f0; padding-top: 8px;">
            <div style="font-size: 7px; color: #94a3b8; text-align: justify; line-height: 1.35;">
            <strong>Terms & Conditions:</strong> By accepting this loan, you agree that failure to repay by the due date may result in the forfeiture and sale of the collateral item listed above to recover the loan amount.
            </div>
            <div style="text-align: center; margin-top: 10px; font-size: 9px; font-weight: 600; color: #1e293b;">Thank you for your business!</div>
            <div style="margin-top: 2px; text-align: center; font-size: 6px; color: #cbd5e1;">Generated by Stallz Loans Admin</div>
        </div>
    </div>
  `;

  const contentBox = document.getElementById("receiptContent");
  if (contentBox) contentBox.innerHTML = receiptHTML;

  // Show Modal
  const modal = document.getElementById("receiptModal");
  if (modal) {
      modal.style.display = "flex";
      setTimeout(() => modal.classList.remove("modal-hidden"), 10);
  }

  // Setup Download Button
  const dlBtn = document.getElementById("downloadImageBtn");
  if (dlBtn) {
      dlBtn.onclick = function() {
        showToast("Generating Image...", "success");

        html2canvas(contentBox, {
          scale: 3,
          backgroundColor: "#ffffff",
          useCORS: true
        }).then(canvas => {
          const link = document.createElement('a');
          link.download = `Receipt_${loan.clientName.replace(/\s/g, '_')}_${loan.id}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
        }).catch(err => {
          console.error(err);
          showToast("Error generating image", "error");
        });
      };
  }
};

/* ============================================================================
 * 9.0 | INTERACTION & UX HANDLERS
 * ============================================================================ */

window.setFilter = function(type, value, btnElement) {
  if (typeof vibrate === "function") vibrate([15]);
  activeFilters[type] = value;
  const parent = btnElement.parentElement;
  if (parent) {
    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btnElement.classList.add('active');
  }
  renderLoansTable();
}

window.switchOverviewTab = function(tabName, btnElement) {
  if (typeof vibrate === "function") vibrate([15]);

  // FIX: Scroll to top when switching so content isn't hidden
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const dash = document.getElementById("tab-dashboard");
  const loans = document.getElementById("tab-loans");

  if (dash) { dash.style.display = "none"; dash.classList.remove("animate-in"); }
  if (loans) { loans.style.display = "none"; loans.classList.remove("animate-in"); }

  const target = document.getElementById("tab-" + tabName);
  if (target) {
    target.style.display = "block";
    void target.offsetWidth;
    target.classList.add("animate-in");
  }

  const buttons = document.querySelectorAll(".sketch-btn");
  buttons.forEach(b => b.classList.remove("active"));

  if (!btnElement) {
      if (tabName === 'dashboard') btnElement = document.querySelector("button[onclick*='dashboard']");
      if (tabName === 'loans') btnElement = document.querySelector("button[onclick*='loans']");
  }

  if (btnElement) btnElement.classList.add("active");
};

// ---------------------------------------------------------------------------
// QUICK NAV: Jump to Loans tab to record a payment (used by Monthly modal)
// ---------------------------------------------------------------------------
window.navToLoansForPay = function() {
  try { if (typeof vibrate === "function") vibrate([20]); } catch(e) {}
  try { if (typeof closePopup === "function") closePopup("monthlyModal"); } catch(e) {}
  try { if (typeof switchOverviewTab === "function") switchOverviewTab("loans"); } catch(e) {}
  try {
    // Scroll toward the loans table so the user can choose a loan to record payment against.
    setTimeout(() => {
      const anchor = document.getElementById("loansTableBody") || document.querySelector("#loansTableBody");
      if (anchor && typeof anchor.scrollIntoView === "function") anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
    if (typeof showToast === "function") showToast("Select a loan to record a payment", "info");
  } catch(e) {}
};

function updateNavHighlight(activeBtnId) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('nav-btn-active');
  });
  const targetBtn = document.getElementById(activeBtnId);
  if (targetBtn) {
    targetBtn.classList.add('nav-btn-active');
  }
}

/* admin/app.js - Fixed closeAllModals to prevent animation conflict */

window.closeAllModals = function(resetNav = true, exceptId = null, immediate = false) {
  const ids = ['monthlyModal', 'clientsModal', 'adminsModal'];

  ids.forEach(id => {
    if (id === exceptId) return;
    const m = document.getElementById(id);
    if (!m) return;

    // Check if visible
    const isVisible = (m.style.display === "flex" || m.style.display === "block") && !m.classList.contains("modal-hidden");
    if (!isVisible) return;

    // 1. CRITICAL FIX: Remove 'switching' class so the Close Animation takes priority
    m.classList.remove("switching");

    // 2. Immediate mode (for fast switching between tabs)
    if (immediate) {
      m.classList.add("modal-hidden");
      m.style.display = "none";
      return;
    }

    // 3. Standard Close (Animates out nicely)
    m.classList.add("modal-hidden");

    // Wait for the CSS animation (smoothSlideOut) to finish
    setTimeout(() => {
      if (m.classList.contains("modal-hidden")) m.style.display = "none";
    }, 350);
  });

  // Always close notifications dropdown
  const dd = document.getElementById("notifDropdown");
  if (dd) dd.classList.remove("show");

  if (resetNav) {
    updateNavHighlight('navMainBtn');
    if (typeof vibrate === "function") vibrate([10]);
  }
}
window.openPopup = function(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  // 1. STOP any pending close timers to prevent glitches
  if (_modalTimers[modalId]) {
      clearTimeout(_modalTimers[modalId]);
      delete _modalTimers[modalId];
  }

  // 2. CHECK: Are we switching between main tabs? (Clients <-> Monthly)
  const navSheets = ['monthlyModal', 'clientsModal', 'adminsModal'];
  const isNavSheet = navSheets.includes(modalId);
  let isSwitching = false;

  if (isNavSheet) {
      // Look for other open sheets
      const otherOpen = navSheets.find(id => {
          if (id === modalId) return false;
          const el = document.getElementById(id);
          // Check if it's currently visible
          return el && el.style.display !== "none" && !el.classList.contains("modal-hidden");
      });
      if (otherOpen) isSwitching = true;
  }

  // 3. TOGGLE LOGIC
  const isOpen = (modal.style.display === "flex" || modal.style.display === "block") && !modal.classList.contains("modal-hidden");
  if (isOpen) {
    window.closePopup(modalId);
    return;
  }

  // 4. PREPARE UI
  // Close notifications dropdown
  const dd = document.getElementById("notifDropdown");
  if (dd) dd.classList.remove("show");

  // ⚡ CRITICAL FIX: If switching, pass 'true' to close others INSTANTLY (No laggy animation)
  window.closeAllModals(false, modalId, isSwitching);

  // 5. OPEN THE NEW MODAL
  modal.style.display = "flex";
  modal.classList.remove("modal-hidden");

  // 6. APPLY "FAST SWITCH" ANIMATION CLASS
  // If switching, we use a lighter fade-in. If opening fresh, we use the nice bounce.
  if (isSwitching) {
      modal.classList.add("switching");
  } else {
      modal.classList.remove("switching");
      // Reset animation for fresh open
      const inner = modal.querySelector(".modal");
      if (inner) {
          inner.style.animation = "none";
          void inner.offsetHeight; // force reflow
          inner.style.animation = "";
      }
  }

  if (typeof vibrate === "function") vibrate([15]);

  // Update Nav Highlights
  if (modalId === 'monthlyModal') updateNavHighlight('navMonthlyBtn');
  if (modalId === 'clientsModal') updateNavHighlight('navClientsBtn');
  if (modalId === 'adminsModal') updateNavHighlight('navAdminsBtn');
}
window.closePopup = function(id) {
  const modal = document.getElementById(id);
  if (modal) {
      modal.classList.add("modal-hidden");
      setTimeout(() => { modal.style.display = "none"; }, 300);
  }
  updateNavHighlight('navMainBtn');
}

window.closeReceiptModal = function() {
    const m = document.getElementById('receiptModal');
    if (m) {
        m.classList.add('modal-hidden');
        setTimeout(() => { m.style.display = 'none'; }, 300);
    }
}


/* Fixed: Removes inline styles so Day Mode works correctly */

window.openActionModal = function(action, loanId) {
  const modal = el("actionModal");
  if (!modal) return;

  // Set global state
  currentAction = action;
  currentLoanId = loanId;

  const titleEl  = el("actionModalTitle");
  const subEl    = el("actionModalSubtitle");
  const bodyEl   = el("actionModalBody");
  const helperEl = el("actionModalHelper");
  const confirmBtn = el("actionModalConfirmBtn");

  const loan = (state.loans || []).find(l => String(l.id) === String(loanId));
  const today = new Date().toISOString().split("T")[0];

  try { if (loan) computeDerivedFields(loan); } catch(e) {}

  // Reset UI
  if (subEl) subEl.textContent = "";
  if (helperEl) helperEl.textContent = "";
  if (bodyEl) bodyEl.innerHTML = "";

  // Helper to create rows
  const makeRow = (label, innerHtml) => `
    <div style="display:flex; flex-direction:column; gap:8px; margin:10px 0;">
      <div style="font-size:.78rem; letter-spacing:.12em; text-transform:uppercase; opacity:.75;">${label}</div>
      ${innerHtml}
    </div>
  `;

  if (action === "PAY") {
    if (titleEl) titleEl.textContent = "Record Payment";
    if (subEl && loan) subEl.textContent = `Loan #${loan.id} • Balance: ${Number(loan.balance || 0).toFixed(2)}`;

    if (confirmBtn) {
      confirmBtn.textContent = "Save Payment";
      confirmBtn.className = "btn btn-primary";
    }

    const balanceVal = loan ? Number(loan.balance || 0).toFixed(2) : "";

    // FIX: Removed 'style="..."' so it uses your CSS Theme (White in Day Mode)
    const body = [
      makeRow("Amount", `<input id="actAmount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${balanceVal}">`),
      makeRow("Date", `<input id="actDate" type="date" value="${today}">`),
      makeRow("Note (optional)", `<textarea id="actNote" rows="3" placeholder="Optional note for this payment..."></textarea>`)
    ].join("");

    if (bodyEl) bodyEl.innerHTML = body;

  } else if (action === "NOTE") {
    if (titleEl) titleEl.textContent = "Add Note";
    if (subEl && loan) subEl.textContent = `Loan #${loan.id} • Client: ${loan.clientName || "—"}`;

    if (confirmBtn) {
      confirmBtn.textContent = "Save Note";
      confirmBtn.className = "btn btn-secondary";
    }

    // FIX: Removed 'style="..."'
    const body = [
      makeRow("Note", `<textarea id="actNote" rows="5" placeholder="Write your note...">${loan?.notes ? escapeHTML(loan.notes) : ""}</textarea>`)
    ].join("");

    if (bodyEl) bodyEl.innerHTML = body;

  } else if (action === "WRITEOFF") {
    if (titleEl) titleEl.textContent = "Write Off Loan";
    if (subEl && loan) subEl.textContent = `Loan #${loan.id} • This marks the loan as BAD DEBT`;

    if (confirmBtn) {
      confirmBtn.textContent = "Confirm Bad Debt";
      confirmBtn.className = "btn btn-danger";
    }

    // FIX: Removed 'style="..."'
    const body = [
      makeRow("Reason (required)", `<textarea id="actNote" rows="5" placeholder="Reason for write-off..."></textarea>`)
    ].join("");

    if (bodyEl) bodyEl.innerHTML = body;
    if (helperEl) helperEl.textContent = "Tip: add a clear reason (e.g., collateral sold, unreachable client).";
  }

  // Show modal
  modal.style.display = "flex";
  modal.classList.remove("modal-hidden");

  // Reset Animation
  const inner = modal.querySelector(".modal");
  if (inner) {
    inner.style.animation = "none";
    void inner.offsetHeight;
    inner.style.animation = "";
  }

  setTimeout(() => {
    const first = modal.querySelector("input, textarea");
    if (first) first.focus();
  }, 50);

  if (typeof vibrate === "function") vibrate([20]);
};


// FIX: New function to properly close the Repayment/Action window
window.closeActionModal = function() {
    const am = document.getElementById("actionModal");
    if(am) {
        am.classList.add("modal-hidden");
        setTimeout(() => { am.style.display = "none"; }, 300);
    }
    currentAction = "NONE";
    currentLoanId = null;
}

function toggleProfileSidebar() {
  const sb = document.getElementById("profileSidebar");
  const ov = document.getElementById("profileOverlay");
  if (sb.classList.contains("open")) {
    sb.classList.remove("open");
    ov.classList.add("hidden");
  } else {
    sb.classList.add("open");
    ov.classList.remove("hidden");
    document.getElementById("notifDropdown")?.classList.remove("show");
  }
}

function toggleNotifications() {
  const dd = document.getElementById("notifDropdown");
  const btn = document.getElementById("notifBtn");
  if (!dd) return;
  dd.classList.toggle("show");
  if (typeof vibrate === "function") vibrate([10]);

  const sidebar = document.getElementById("profileSidebar");
  const overlay = document.getElementById("profileOverlay");
  if (sidebar && sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
      if (overlay) overlay.classList.add("hidden");
  }
}

document.addEventListener("click", function(event) {
  const dd = document.getElementById("notifDropdown");
  const btn = document.getElementById("notifBtn");
  if (dd && dd.classList.contains("show") && !dd.contains(event.target) && !btn.contains(event.target)) {
    dd.classList.remove("show");
  }
});


function setupMobileUX() {
  // 1. Android/Chrome Install Prompt
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = el("installAppBtn");
    if (btn) {
      btn.style.display = "inline-flex";
      btn.addEventListener('click', () => {
        if(typeof vibrate === "function") vibrate([30]);
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            btn.style.display = 'none';
          }
          deferredPrompt = null;
        });
      });
    }
  });

  // 2. Long-Press on Loan Row (Quick Pay) with Jitter Tolerance
  let longPressTimer;
  const touchDuration = 800; // 0.8 seconds
  let startX = 0;
  let startY = 0;

  document.addEventListener("touchstart", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;

    // FIX: Read ID from the robust data attribute
    const rawId = row.getAttribute("data-loan-id");
    if (!rawId) return;

    const loanId = parseInt(rawId);

    // Track touch start position
    if (e.touches && e.touches[0]) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }

    if (loanId) {
      longPressTimer = setTimeout(() => {
        if(typeof vibrate === "function") vibrate([40, 40]); // Double buzz feedback
        openActionModal("PAY", loanId);
      }, touchDuration);
    }
  }, { passive: true });

  // Handle movement (allow small jitter of 10px)
  document.addEventListener("touchmove", (e) => {
      if (!longPressTimer) return;

      if (e.touches && e.touches[0]) {
          const moveX = e.touches[0].clientX;
          const moveY = e.touches[0].clientY;

          // Calculate distance moved
          const diffX = Math.abs(moveX - startX);
          const diffY = Math.abs(moveY - startY);

          // If moved more than 10px, it's a scroll -> cancel timer
          if (diffX > 10 || diffY > 10) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
          }
      } else {
          clearTimeout(longPressTimer);
      }
  }, { passive: true });

  document.addEventListener("touchend", () => clearTimeout(longPressTimer));
  document.addEventListener("touchcancel", () => clearTimeout(longPressTimer));

  // 3. iOS Install Modal Logic
  function checkIosInstall() {
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isStandalone = window.navigator.standalone === true;

    if (isIos && !isStandalone) {
      setTimeout(() => {
        const modal = document.getElementById("iosInstallModal");
        if (modal) {
            modal.style.display = "flex";
            setTimeout(() => modal.classList.remove("modal-hidden"), 10);
        }
      }, 3000); // Delayed slightly to be less intrusive
    }
  }

  document.getElementById("closeIosModalBtn")?.addEventListener("click", () => {
    const modal = document.getElementById("iosInstallModal");
    if (modal) {
        modal.classList.add("modal-hidden");
        setTimeout(() => { modal.style.display = "none"; }, 300);
    }
  });

  checkIosInstall();
}

function showLoanConfirmation() {
    const draft = wizardDraft;

    const clientName = draft.clientName || "Unknown";
    const amount = Number(draft.amount) || 0;
    const item = draft.collateralItem || "Unsecured";
    const plan = draft.plan || "Weekly";
    const interestOverride = draft.customInterest ? Number(draft.customInterest) : null;

    let rate = INTEREST_BY_PLAN[plan] || 0;
    if (interestOverride !== null) rate = interestOverride / 100;

    const totalDue = amount * (1 + rate);

    const start = draft.startDate ? parseDateSmart(draft.startDate) : new Date();
    let due = new Date(start);

    if (plan === "Monthly") {
        due = addMonthsSafe(due, 1);
    } else {
        const days = DAYS_BY_PLAN[plan] || 7;
        due.setDate(due.getDate() + days);
    }

    el("confAmount").textContent = formatMoney(amount);
    el("confClient").textContent = clientName;
    el("confItem").textContent = item;
    el("confDuration").textContent = plan;
    el("confInterest").textContent = (rate * 100).toFixed(0) + "%";
    el("confDueDate").textContent = formatDate(due.toISOString().split('T')[0]);
    el("confTotal").textContent = formatMoney(totalDue);

    openPopup("loanConfirmationModal");
}

function setActiveView(view) {
  document.querySelectorAll("[id^='view-']").forEach(v => v.classList.add("view-hidden"));
  const target = el(`view-${view}`);
  if (target) target.classList.remove("view-hidden");
}

function updateWizard(direction = "next") {
  const step = LOAN_STEPS[wizardStep];
  const wrapper = el("wizardWrapper");

  wrapper.classList.remove("slide-in-right", "slide-out-left", "slide-in-left");
  wrapper.classList.add(direction === "next" ? "slide-in-right" : "slide-in-left");

  el("modalStepLabel").textContent = `Step ${wizardStep + 1} of ${LOAN_STEPS.length}`;
  el("modalFieldLabel").textContent = step.label;
  el("modalHelper").textContent = step.helper;

  el("modalStepDots").innerHTML = LOAN_STEPS.map((_, i) =>
    `<div class="step-dot ${i === wizardStep ? 'active' : ''}"></div>`
  ).join("");

  const container = el("modalFieldContainer");
  container.innerHTML = "";

  let input;
  if (step.type === "select") {
    input = document.createElement("select");
    step.options.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    });
  } else if (step.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 3;
  } else {
    input = document.createElement("input");
    input.type = step.type;
    if (step.placeholder) input.placeholder = step.placeholder;
    input.setAttribute("autocomplete", "off");

    if (step.key === "clientName") {
      input.setAttribute("list", "clientList");

      const historyNames = state.loans.map(l => l.clientName).filter(Boolean);

      let regNames = [];
      try {
          const users = window.StallzShared?.listUsers?.("client") || [];
          regNames = users.map(u => u.name || u.fullName).filter(Boolean);
      } catch(e) {}

      const uniqueClients = [...new Set([...historyNames, ...regNames])].sort();

      const dataList = document.getElementById("clientList");
      if (dataList) {
        dataList.innerHTML = uniqueClients.map(name => `<option value="${name}">`).join("");
      }
    }
  }

  if (wizardDraft[step.key]) input.value = wizardDraft[step.key];

  input.id = "wizardInput";
  container.appendChild(input);

  if (step.type === "date") {
    const chipContainer = document.createElement("div");
    chipContainer.style.cssText = "display:flex; gap:10px; margin-top:12px;";

    const createChip = (text, dateVal) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary btn-sm";
      btn.style.cssText = "padding:6px 12px; font-size:0.75rem; border-radius:20px; border:1px solid var(--primary); color:var(--primary); background:rgba(59, 130, 246, 0.1);";
      btn.textContent = text;
      btn.onclick = () => {
        el("wizardInput").value = dateVal;
        vibrate([20]);
      };
      return btn;
    };

    chipContainer.appendChild(createChip("Today", getLocalDateVal()));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    chipContainer.appendChild(createChip("Yesterday", yesterdayStr));

    container.appendChild(chipContainer);
  }

  setTimeout(() => input.focus(), 100);
  el("modalBackBtn").style.visibility = wizardStep === 0 ? "hidden" : "visible";
  el("modalNextBtn").textContent = wizardStep === LOAN_STEPS.length - 1 ? "Finish & Save" : "Next →";
}

/* admin/app.js - saveNewLoan (With Admin Tracking Fix) */

function saveNewLoan() {
  const draft = wizardDraft;
  const newId = generateLoanId(); // Use the safe generator

  // 1. Get Current Admin Details (The Fix)
  let creatorName = "Admin";
  let creatorEmail = "system@stallz";

  if (state.currentUserProfile) {
      // Use profile name if available
      creatorName = state.currentUserProfile.name || state.currentUserProfile.firstname || "Admin";
      creatorEmail = state.currentUserProfile.email || "";
  } else if (state.user) {
      // Fallback to auth user email
      creatorEmail = state.user.email;
      creatorName = state.user.email.split('@')[0].toUpperCase();
  }

  const newLoan = {
    id: newId,
    clientName: (draft.clientName || "Client").trim(),
    clientPhone: (draft.clientPhone || "").trim(),
    amount: Number(draft.amount),
    plan: draft.plan,
    customInterest: draft.customInterest ? Number(draft.customInterest) : null,
    collateralItem: (draft.collateralItem || "").trim(),
    collateralValue: draft.collateralValue ? Number(draft.collateralValue) : 0,
    startDate: draft.startDate,
    status: "ACTIVE",
    notes: (draft.notes || "").trim(),
    paid: 0,
    saleAmount: 0,
    profitCollected: 0,
    isDefaulted: false,
    clientUid: null,

    // ✅ ADDED: Track who created this loan
    createdBy: creatorName,
    createdEmail: creatorEmail,

    createdAt: new Date().toISOString()
  };

  // 2. Update Local State
  if (!state.loans) state.loans = [];
  state.loans.unshift(newLoan);
  computeDerivedFields(newLoan);

  // 3. ATOMIC CLOUD SAVE (schema-aware: supports legacy array & object nodes)
  if (!OFFLINE_TEST_MODE && dataRef) {
    try {
      const loansShape = state.__loansContainerType || "array";
      // If legacy is an array, append via transaction to avoid creating mixed-key duplicates.
      if (loansShape === "array") {
        dataRef.child("loans").transaction((current) => {
          let arr = current;
          if (Array.isArray(arr)) {
            // ok
          } else if (arr && typeof arr === "object") {
            // If it already became an object (numeric keys), normalize to a compact array
            arr = Object.values(arr).filter(v => v && typeof v === "object");
          } else {
            arr = [];
          }
          arr.push(newLoan);
          return arr;
        }, (error, committed) => {
          if (error || !committed) {
            showToast("Cloud Sync Failed", "error");
            return;
          }
          showToast("Loan Created!", "success");
          if (newLoan.clientUid) syncSingleLoanToClient(newLoan);
        }, false);
      } else {
        // Object map mode: safe to write by id
        newLoan.__loanPath = `loans/${newId}`;
        newLoan.__primaryLoanPath = newLoan.__loanPath;

        const updates = {};
        updates[`loans/${newId}`] = newLoan;

        dataRef.update(updates).then(() => {
          showToast("Loan Created!", "success");
          if (newLoan.clientUid) syncSingleLoanToClient(newLoan);
        }).catch(() => showToast("Cloud Sync Failed", "error"));
      }
    } catch (e) {
      console.error(e);
      showToast("Cloud Sync Failed", "error");
    }
  } else {
    saveState();
  }

  closePopup("loanModal");
  refreshUI();
  switchOverviewTab('loans');
}

function handleWizardNext() {
  const step = LOAN_STEPS[wizardStep];
  const input = el("wizardInput");
  const val = input.value.trim();

  if (step.required && !val) {
    input.style.border = "1px solid #ef4444";
    setTimeout(() => input.style.border = "", 2000);
    if(typeof vibrate === "function") vibrate([50]);
    return;
  }

  wizardDraft[step.key] = val;

  if (step.key === "clientName") {
      const lowerName = val.toLowerCase();
      let foundPhone = null;

      const loanMatch = (state.loans || [])
          .filter(l => l.clientName && l.clientName.toLowerCase() === lowerName)
          .sort((a, b) => (Number(b.id)||0) - (Number(a.id)||0))[0];

      if (loanMatch && loanMatch.clientPhone) foundPhone = loanMatch.clientPhone;

      if (!foundPhone) {
          try {
              const users = window.StallzShared?.listUsers?.("client") || [];
              const userMatch = users.find(u => (u.name || u.fullName || "").toLowerCase() === lowerName);
              if (userMatch && userMatch.phone) foundPhone = userMatch.phone;
          } catch(e) {}
      }

      if (foundPhone) {
          wizardDraft["clientPhone"] = foundPhone;
      }
  }

  if (wizardStep < LOAN_STEPS.length - 1) {
    wizardStep++;
    updateWizard("next");
  } else {
    showLoanConfirmation();
  }
}

function handleWizardBack() {
  if (wizardStep > 0) {
    wizardStep--;
    updateWizard("back");
  }
}

/* ============================================================================
 * 10.0 | APP INITIALIZATION
 * ============================================================================ */

function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');

  if (action === 'new_loan') {
    setTimeout(() => el("openLoanModalBtn")?.click(), 600);
    // Background load dashboard
    switchOverviewTab('dashboard');
  } else {
    // Default to dashboard for 'dashboard' param OR empty param
    // Delay slightly to ensure DOM is ready
    setTimeout(() => switchOverviewTab('dashboard'), 100);
  }

  el("profileToggleBtn")?.addEventListener("click", toggleProfileSidebar);
  el("closeProfileBtn")?.addEventListener("click", toggleProfileSidebar);
  el("profileOverlay")?.addEventListener("click", toggleProfileSidebar);
  el("notifBtn")?.addEventListener("click", toggleNotifications);

  el("themeToggle")?.addEventListener("change", (e) => {
    localStorage.setItem("stallz_theme_preference", e.target.checked ? "dark" : "light");
    checkTimeBasedTheme();
  });

  // ESC closes any open modal/popup (failsafe)
  if (!document.__stallzEscBound) {
    document.__stallzEscBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        try { closeAllModals(); } catch(_) {}
        try { closeAdminMessageModal(); } catch(_) {}
        try { closeAdminDialog(); } catch(_) {}
        try { closeReceiptModal(); } catch(_) {}
      }
    });
  }


  const lastActive = localStorage.getItem("stallz_last_active");
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;

  if (lastActive && (now - lastActive > THIRTY_MINUTES)) {
    console.log("Session expired. Redirecting...");
    window.StallzAuth?.signOut?.();
    localStorage.removeItem("stallz_last_active");
    location.replace("../index.html");
    return;
  }

  window.triggerAdminLogout = function() {
      // Close the sidebar instantly to look clean
      const sidebar = document.getElementById("profileSidebar");
      const overlay = document.getElementById("profileOverlay");
      if (sidebar) sidebar.classList.remove("open");
      if (overlay) overlay.classList.add("hidden");

      showAdminDialog({
          title: 'Log Out',
          message: 'Are you sure you want to log out of the Admin portal?',
          btnText: 'Log Out',
          btnClass: 'btn-danger',
          onConfirm: async () => {
              if (typeof vibrate === "function") vibrate([50]);
              try {
                await window.StallzAuth?.signOut?.();
                localStorage.removeItem("stallz_last_active");
                localStorage.removeItem("stallz_test_session");
                showToast("Logged out successfully.", "success");
                setTimeout(() => { window.location.href = "../index.html"; }, 600);
              } catch(e) { console.error("Logout error:", e); }
          }
      });
  };
  try { window.__STALLZ_WRAP_GLOBALS_ADMIN?.(); } catch(e) {}

  // FIX: Protect against race condition (clicking before DB load)
  el("openLoanModalBtn")?.addEventListener("click", () => {
    if (!state.dataLoaded && !OFFLINE_TEST_MODE) {
        showToast("Please wait, loading data...", "error");
        return;
    }
    vibrate([10]);
    wizardStep = 0;
    wizardDraft = {};
    updateWizard();

    // FIX: Explicitly Show
    const lm = el("loanModal");
    lm.style.display = "flex";
    setTimeout(() => lm?.classList.remove("modal-hidden"), 10);
  });

  el("modalCloseBtn")?.addEventListener("click", () => {
      const lm = el("loanModal");
      lm?.classList.add("modal-hidden");
      setTimeout(() => lm.style.display = "none", 300);
  });

  el("modalNextBtn")?.addEventListener("click", () => { vibrate([10]); handleWizardNext(); });
  el("modalBackBtn")?.addEventListener("click", () => { vibrate([10]); handleWizardBack(); });

  // 🟢 NEW: Listener for the Final Confirmation Button
  el("finalConfirmBtn")?.addEventListener("click", () => {
    vibrate([20]);
    closePopup("loanConfirmationModal");
    saveNewLoan();
  });


// 1. Action Modal Confirmation Listener (Atomic & Safe)
// 1. Action Modal Confirmation Listener (Validated + Refresh-safe)
el("actionModalConfirmBtn")?.addEventListener("click", async () => {
  vibrate([20]);

  const loan = (state.loans || []).find(l => String(l.id) === String(currentLoanId));
  if (!loan) {
    showToast("Loan not found.", "error");
    return;
  }

  const updates = {};
  const now = new Date().toISOString();

  // Helper: write back to the *real* RTDB key(s) for this loan.
  // Older data was stored as an ARRAY (loans[0], loans[1]...) while newer data is an OBJECT (loans/{loanId}).
  // We preserve the RTDB path(s) in applyData() as __loanPath / __loanPaths so payments update the correct record.
  const applyLoanUpdates = (loanObj, updatesObj, cleanupDuplicates = true) => {
    const paths = (Array.isArray(loanObj?.__loanPaths) && loanObj.__loanPaths.length)
      ? loanObj.__loanPaths.slice()
      : (loanObj?.__loanPath ? [loanObj.__loanPath] : [`loans/${loanObj.id}`]);

    const primary = loanObj?.__primaryLoanPath || loanObj?.__loanPath || paths[0];

    // Update the one we actually display
    updatesObj[primary] = loanObj;

    // Optional: remove duplicates so a stale copy can't stay ACTIVE after you pay
    if (cleanupDuplicates && paths.length > 1) {
      paths.filter(p => p && p !== primary).forEach(p => { updatesObj[p] = null; });
    }

    loanObj.__loanPaths = paths;
    loanObj.__primaryLoanPath = primary;
  };

  // Helper: try to resolve client UID from phone if missing (so client portal updates)
  const resolveClientUidFromPhone = () => {
    try {
      if (loan.clientUid) return loan.clientUid;
      const phone = String(loan.clientPhone || "").replace(/\D/g, "").replace(/^0/, "260");
      if (!phone) return null;
      const users = window.StallzShared?.listUsers?.("client") || window.StallzShared?.listUsers?.() || [];
      const match = users.find(u => {
        const p = String(u.phone || "").replace(/\D/g, "").replace(/^0/, "260");
        return p && p === phone && p.length > 9;
      });
      return match?.uid || null;
    } catch (e) {
      return null;
    }
  };

  // Keep derived fields fresh so balance/status calculations are accurate
  try { computeDerivedFields(loan); } catch(e) {}

  // A. Prepare Data based on Action
  if (currentAction === "PAY") {
    const amtRaw = String(el("actAmount")?.value ?? "").trim();
    const inputAmt = Number(amtRaw);

    if (!Number.isFinite(inputAmt) || inputAmt <= 0) {
      showToast("Enter a valid payment amount.", "error");
      return;
    }

    // Clamp to current balance
    const safeAmt = Number(Math.min(inputAmt, Number(loan.balance || 0)).toFixed(2));

    if (!Number.isFinite(safeAmt) || safeAmt <= 0) {
      showToast("This loan is already fully paid.", "info");
      return;
    }

    // Update Local Loan Object
    loan.paid = Number((Number(loan.paid || 0) + safeAmt).toFixed(2));
    loan.updatedAt = now;

    // Optional note append
    const note = String(el("actNote")?.value ?? "").trim();
    if (note) {
      const stamp = now.split("T")[0];
      loan.notes = (loan.notes ? loan.notes + "\n" : "") + `[Payment ${stamp}]: ${note}`;
    }

    // Recompute so status flips to PAID immediately (and balance becomes 0)
    try { computeDerivedFields(loan); } catch(e) {}

    // Create New Repayment Record
    const repaymentId = generateRepaymentId();
    const newRepayment = {
      id: repaymentId,
      loanId: loan.id,
      amount: safeAmt,
      date: el("actDate")?.value || new Date().toISOString().split("T")[0],
      recordedBy: state.user?.email || "Admin",
      createdAt: now
    };

    // Keep a lightweight repayment trail inside the loan for client statements
    try {
      if (!loan.repayments || typeof loan.repayments !== 'object') loan.repayments = {};
      loan.repayments[String(repaymentId)] = newRepayment;
    } catch(e) {}

    // Update Local State (for immediate UI refresh)
    state.repayments.unshift(newRepayment);

    // Atomic paths (note: your DB schema must match these paths)
    applyLoanUpdates(loan, updates, true);
    updates[`repayments/${repaymentId}`] = newRepayment;

  } else if (currentAction === "NOTE") {
    const note = String(el("actNote")?.value ?? "").trim();
    if (!note) {
      showToast("Write a note first.", "error");
      return;
    }
    loan.notes = note;
    loan.updatedAt = now;
    try { computeDerivedFields(loan); } catch(e) {}
    applyLoanUpdates(loan, updates, true);

  } else if (currentAction === "WRITEOFF") {
    const reason = String(el("actNote")?.value ?? "").trim();
    if (!reason) {
      showToast("Please enter a reason for the write-off.", "error");
      return;
    }
    loan.isDefaulted = true;
    loan.status = "DEFAULTED";
    loan.notes = (loan.notes ? loan.notes + "\n" : "") + "[Write-Off]: " + reason;
    loan.updatedAt = now;
    try { computeDerivedFields(loan); } catch(e) {}
    applyLoanUpdates(loan, updates, true);
  }

  // Guard: prevent fake success toast when nothing is being saved
  if (Object.keys(updates).length === 0) {
    showToast("Nothing to save — please check inputs.", "error");
    return;
  }

  // B. Execute Update
  if (!OFFLINE_TEST_MODE && dataRef) {
    try {
      await dataRef.update(updates);

      // Keep shared snapshot in sync (if used)
      try {
        if (window.StallzShared?.syncAdminSnapshot) {
          // Make sure we sync the already-recomputed loans
          window.StallzShared.syncAdminSnapshot(state.loans);
        }
      } catch (e) {}

      // Ensure we can update the client portal copy too
      const uid = resolveClientUidFromPhone();
      if (uid) {
        loan.clientUid = uid;
        try { await syncSingleLoanToClient(loan); } catch(e) {}
      }

      // Better success message
      if (currentAction === "PAY") {
        showToast(loan.status === "PAID" ? "Payment recorded — Loan is PAID ✅" : "Payment recorded!", "success");
      } else {
        showToast("Update successful!", "success");
      }
    } catch (e) {
      showToast("Save Failed: " + e.message, "error");
    }
  } else {
    saveState(); // Offline/test mode
    showToast("Saved locally (Test Mode)", "success");
  }

  refreshUI();

  // C. Close modal
  if (window.closeActionModal) {
    window.closeActionModal();
  } else {
    const am = el("actionModal");
    if (am) {
      am.classList.add("modal-hidden");
      setTimeout(() => am.style.display = "none", 300);
    }
  }
});


// 2. Wire up Close/Cancel buttons for Action Modal
el("actionModalCloseBtn")?.addEventListener("click", window.closeActionModal);
el("actionModalCancelBtn")?.addEventListener("click", window.closeActionModal);

// 3. Mini-Tabs Logic (Dashboard & Client Manager)
document.querySelectorAll('.mini-tab[data-target]').forEach(btn => {
  btn.addEventListener('click', () => {
    vibrate([10]);

    // Only toggle tabs within the same group
    const group = btn.closest('.mini-tabs') || document;
    group.querySelectorAll('.mini-tab[data-target]').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    // Only toggle content inside the same card
    const scope = btn.closest('.card') || document;
    scope.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });

    const targetId = btn.dataset.target;
    const targetContent = el(targetId);
    if (targetContent) {
      targetContent.classList.add('active');
    }
  });
});

  // OPTIMIZED: Direct Update for Capital Setting
  el("setStartingCapitalBtn")?.addEventListener("click", async () => {
  const inputField = el("startingCapitalInitial");
  const val = Number(inputField?.value);
  if (val > 0) {
    state.startingCapital = val;
    const date = new Date().toISOString();
    state.startingCapitalSetDate = date;

    refreshUI();

    if (!OFFLINE_TEST_MODE && dataRef) {
        try {
            // DIRECT WRITE to ensure persistence
            await dataRef.update({
                startingCapital: val,
                startingCapitalSetDate: date,
                lastWrite: firebase.database.ServerValue.TIMESTAMP
            });
            showToast("Starting capital saved!", "success");
        } catch(e) {
            showToast("Save failed", "error");
        }
    }
    inputField.value = "";
  }
});

 // Listener for "Inject New Capital" Button
  el("addCapitalBtn")?.addEventListener("click", async () => {
      const input = el("addCapitalInput");
      const val = Number(input.value);

      if (val <= 0) {
          showToast("Enter a valid positive amount", "error");
          return;
      }

      // 1. Generate Unique ID
      const newId = Date.now() + Math.floor(Math.random() * 1000);

      // 2. GET CURRENT USER NAME (New Feature)
      let recorderName = "Admin";
      if (state.currentUserProfile && state.currentUserProfile.name) {
          recorderName = state.currentUserProfile.name;
      } else if (state.user && state.user.email) {
          recorderName = state.user.email.split('@')[0];
      }

      // 3. Create Transaction Object with 'recordedBy'
      const newTxn = {
          id: newId,
          amount: val,
          date: new Date().toISOString(),
          note: "Manual Add",
          recordedBy: recorderName // <--- SAVING NAME HERE
      };

      // 4. Update Local State (UI)
      if (!state.capitalTxns) state.capitalTxns = [];
      state.capitalTxns.unshift(newTxn);

      input.value = "";
      refreshUI();

      // 5. SAVE TO DATABASE
      if (!OFFLINE_TEST_MODE && dataRef) {
          try {
              await dataRef.child("capitalTxns").child(String(newId)).set(newTxn);
              showToast("Capital added successfully!", "success");
          } catch(e) {
              console.error(e);
              showToast("Save failed", "error");
          }
      } else {
          saveState();
          showToast("Capital added (Local)", "success");
      }
  });

  el("searchInput")?.addEventListener("input", debounce(renderLoansTable, 300));
  ["statusFilter", "planFilter"].forEach(id => el(id)?.addEventListener("input", renderLoansTable));

  el("exportBtn")?.addEventListener("click", () => {
    if (typeof window.XLSX === "undefined") return showToast("Export library missing", "error");
    vibrate([20]);
    try {
      const data = state.loans.map(l => ({ ID: l.id, Client: l.clientName, Amount: l.amount, Balance: l.balance, Status: l.status }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Loans");
      XLSX.writeFile(wb, "Stallz_Loans.xlsx");
    } catch (e) { console.error(e); }
  });

  ensureAdminAccess().then((ok) => {
    if (!ok) return;
    try {
      window.StallzShared?.ensureSeed?.();
      window.StallzShared?.subscribe?.(() => {
        __suppressSharedSync = true;
        try { refreshUI(); } finally { __suppressSharedSync = false; }
      });
    } catch(e) { console.warn("Sync failed:", e); }
  });

  setInterval(() => {
    if (state.isLoggedIn && !__suppressSharedSync) refreshUI();
  }, 15000);

  checkTimeBasedTheme();
  checkAppVersion();
  setupMobileUX();

  // Ensure notification items are reliably clickable (esp. on mobile)
  const _dd = document.getElementById("notifDropdown");
  const _list = document.getElementById("notifList");
  if (_dd && _list && !_list.dataset.clickwired) {
    _list.dataset.clickwired = "1";
    // Close dropdown after selecting an item, without blocking the item's own handler
    _list.addEventListener("click", (e) => {
      if (e.target.closest(".notif-item")) _dd.classList.remove("show");
    }, true);
  }


  // Version label (single source of truth: shared/firebase-init.js)
  try {
    const v = (window.STALLZ_APP_VERSION || APP_VERSION || "0");
    const elV = document.getElementById("stallzVersionInline");
    if (elV) elV.textContent = "v" + String(v);
  } catch(e){}

  // Loan History modal wiring
  try {
    const search = document.getElementById("loanHistorySearchInput");
    if (search && !search.__stallzBound) {
      search.__stallzBound = true;
      search.addEventListener("input", (e) => {
        state.loanHistorySearch = String(e.target.value || "");
        renderLoanHistory();
      });
    }
  } catch(e){}

}

document.addEventListener("DOMContentLoaded", () => window.__STALLZ_SAFE_RUN?.("init", init));
/* ============================================================================
 * 12.0 | SHARED SYSTEM WIRING (Client ↔ Admin)
 * ============================================================================ */

let __activeLoanRequestId = null;
let __activeClientUidForMsg = null;

window.openLoanRequestModal = function(requestId) {
  try {
    const m = document.getElementById("loanRequestModal");
    const body = document.getElementById("loanRequestBody");
    if (!m || !body) return;

    // FIX: Force display flex to override the inline 'display: none' from HTML
    m.style.display = "flex";

    const req = window.StallzShared?.getLoanRequest?.(requestId);
    if (!req) {
      showToast("Request not found", "error");
      return;
    }

    __activeLoanRequestId = requestId;

    const formattedPhone = req.clientPhone ? `+260 ${req.clientPhone.substring(3)}` : "-";

    body.innerHTML = `
      <div style="display:grid; gap:12px; font-size: 0.9rem;">
        <div style="padding-bottom: 8px; border-bottom: 1px solid var(--border);">
            <div style="font-weight:800; color: var(--primary); margin-bottom: 4px;">CLIENT IDENTITY</div>
            <div><strong>Full Name:</strong> ${escapeHTML(req.clientName || "Client")}</div>
            <div><strong>NRC Number:</strong> ${escapeHTML(req.nrcNumber || req.nrc || "-")}</div>
            <div><strong>Address:</strong> ${escapeHTML(req.address || "-")}</div>
        </div>

        <div style="padding-bottom: 8px; border-bottom: 1px solid var(--border);">
            <div style="font-weight:800; color: var(--primary); margin-bottom: 4px;">CONTACT DETAILS</div>
            <div><strong>Phone:</strong> ${escapeHTML(formattedPhone)}</div>
            <div><strong>Email:</strong> ${escapeHTML(req.clientEmail || "-")}</div>
        </div>

        <div>
            <div style="font-weight:800; color: var(--primary); margin-bottom: 4px;">LOAN REQUEST</div>
            <div><strong>Requested Amount:</strong> ${formatMoney(req.amount || 0)}</div>
            <div><strong>Plan:</strong> ${escapeHTML(req.plan || "-")}</div>
            <div><strong>Collateral:</strong> ${escapeHTML(req.collateralItem || "-")}</div>
            <div><strong>Collateral Value:</strong> ${formatMoney(req.collateralValue || 0)}</div>
        </div>

        ${(req.nrcFrontUrl || req.nrcBackUrl) ? `
          <div style="display:grid; gap:8px; padding-top:6px;">
            <div style="font-weight:800;">NRC DOCUMENTATION</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <div>
                <div style="opacity:0.75; font-size:0.75rem; margin-bottom:4px;">Front</div>
                ${req.nrcFrontUrl ? `<a href="${req.nrcFrontUrl}" target="_blank"><img src="${req.nrcFrontUrl}" style="width:100%; border-radius:8px; border:1px solid var(--border);" /></a>` : `<div>-</div>`}
              </div>
              <div>
                <div style="opacity:0.75; font-size:0.75rem; margin-bottom:4px;">Back</div>
                ${req.nrcBackUrl ? `<a href="${req.nrcBackUrl}" target="_blank"><img src="${req.nrcBackUrl}" style="width:100%; border-radius:8px; border:1px solid var(--border);" /></a>` : `<div>-</div>`}
              </div>
            </div>
          </div>
        ` : ``}

        <div style="font-style: italic; opacity: 0.8; font-size: 0.8rem; margin-top: 5px;">
            Requested on: ${formatDate(req.createdAt)}
        </div>
      </div>
    `;
    m.classList.remove("modal-hidden");
  } catch(e) {
    console.error("Error opening loan request:", e);
  }
}

window.closeLoanRequestModal = function(){
  const m = document.getElementById("loanRequestModal");
  if (m) {
      m.classList.add("modal-hidden");
      // FIX: Re-apply display none to ensure it stays hidden
      setTimeout(() => { m.style.display = "none"; }, 300);
  }
  __activeLoanRequestId = null;
}


window.approveLoanRequest = async function(){
  if (!__activeLoanRequestId) return;
  try {
    const sess = window.StallzAuth?.getSession?.();
    const req = window.StallzShared?.getLoanRequest?.(String(__activeLoanRequestId));

    if (!req) {
      showToast("Request not found. Refresh and try again.", "error");
      return;
    }

    // 1) Mark request approved + notify client (non-destructive multi-path update)
    await window.StallzShared?.approveLoanRequest?.(
      sess?.uid || 'admin',
      String(req.id)
    );

    // 2) Create a real loan record linked to this clientUid (so it appears in client portal)
    const newId = Date.now();
    const profile = window.StallzShared?.getUser?.(req.clientUid) || {};

    const newLoan = {
      id: newId,
      clientUid: req.clientUid || null,
      clientName: String((req.clientName !== "Client" ? req.clientName : null) || profile.fullName || profile.name || profile.firstName || profile.email || "Client").trim(),
      clientPhone: String(req.clientPhone || profile.phone || "").trim(),
      amount: Number(req.amount || 0),
      plan: String(req.plan || "Weekly"),
      customInterest: null,
      collateralItem: String(req.collateralItem || "").trim(),
      collateralValue: Number(req.collateralValue || 0),
      startDate: toDateOnly(new Date()),
      status: "ACTIVE",
      notes: `Approved from request #${req.id}`,
      paid: 0,
      saleAmount: 0,
      profitCollected: 0,
      isDefaulted: false,
      requestId: req.id,
      createdAt: new Date().toISOString()
    };

    if (!state.loans) state.loans = [];
    state.loans.unshift(newLoan);
    computeDerivedFields(newLoan);

    if (!OFFLINE_TEST_MODE && dataRef) {
      // ATOMIC multi-path write:
      //  - loanManagerData_v5/loans/{loanId} (admin view)
      //  - clients/{uid}/loans/{loanId}      (client secure view)
      const rootUpdates = {};
      rootUpdates[`loanManagerData_v5/loans/${newId}`] = newLoan;
      if (newLoan.clientUid) {
        rootUpdates[`clients/${newLoan.clientUid}/loans/${newId}`] = newLoan;
      }

      await firebase.database().ref().update(rootUpdates);

      // Optional legacy snapshot sync
      try { window.StallzShared?.syncAdminSnapshot?.(state.loans || []); } catch(e) {}
    } else {
      // Offline fallback
      saveState();
    }

    showToast("Approved ✅ Loan created & client updated.", "success");
    window.closeLoanRequestModal();
    refreshUI();
  } catch(e){
    console.error(e);
    showToast("Approve failed", "error");
  }
}

window.rejectLoanRequest = async function(){
  if (!__activeLoanRequestId) return;

  showAdminDialog({
      title: 'Decline Loan',
      message: 'Please provide a reason for declining this request:',
      isPrompt: true,
      placeholder: 'E.g., Incomplete details, unpaid balance...',
      btnText: 'Decline Request',
      btnClass: 'btn-danger',
      onConfirm: async (reason) => {
          try {
            const sess = window.StallzAuth?.getSession?.();
            await window.StallzShared?.rejectLoanRequest?.(
                sess?.uid || 'admin',
                String(__activeLoanRequestId),
                String(reason).trim()
            );

            showToast("Request rejected & Client notified.", "success");
            window.closeLoanRequestModal();
            refreshUI();
          } catch(e){
            console.error(e);
            showToast("Reject failed", "error");
          }
      }
  });
}

window.openAdminMessageModal = function(clientUid){
  try {
    if (!clientUid) return;
    __activeClientUidForMsg = clientUid;
    const m = document.getElementById("adminMessageModal");
    const title = document.getElementById("adminMessageTitle");
    const thread = document.getElementById("adminMessageThread");

    if (!m || !thread) return;

    // FIX: Force display flex to override the inline 'display: none'
    m.style.display = "flex";
    m.classList.remove("modal-hidden");

    const u = window.StallzShared?.getUser?.(clientUid);
    title.textContent = u ? `Message: ${u.name || u.email || "Client"}` : "Message Client";
    renderAdminMessageThread();

  } catch(e){ console.error(e); }
}

window.closeAdminMessageModal = function(){
  const m = document.getElementById("adminMessageModal");
  if (m) {
      m.classList.add("modal-hidden");
      // FIX: Re-apply display none to ensure it stays hidden
      setTimeout(() => { m.style.display = "none"; }, 300);
  }
  __activeClientUidForMsg = null;
}

function renderAdminMessageThread(){
  const thread = document.getElementById("adminMessageThread");
  if (!thread || !__activeClientUidForMsg) return;
  const msgs = window.StallzShared?.getMessages?.(__activeClientUidForMsg) || [];
  if (!msgs.length) {
    thread.innerHTML = `<div style="opacity:0.7; text-align:center; padding:16px;">No messages yet.</div>`;
    return;
  }
  thread.innerHTML = msgs.map(m => {
    const isAdmin = m.fromRole === "admin";
    return `
      <div style="display:flex; justify-content:${isAdmin ? "flex-end" : "flex-start"}; margin:8px 0;">
        <div style="max-width:80%; padding:10px 12px; border-radius:14px; border:1px solid var(--border);
          background:${isAdmin ? "rgba(34,197,94,0.12)" : "rgba(59,130,246,0.12)"};">
          <div style="font-weight:700; font-size:0.8rem; margin-bottom:4px;">${isAdmin ? "Admin" : "Client"}</div>
          <div style="white-space:pre-wrap;">${escapeHTML(m.text || "")}</div>
          <div style="opacity:0.6; font-size:0.75rem; margin-top:6px;">${new Date(m.createdAt).toLocaleString()}</div>
        </div>
      </div>
    `;
  }).join("");
  thread.scrollTop = thread.scrollHeight;
}

window.sendAdminMessage = function(){
  const input = document.getElementById("adminMessageInput");
  const text = (input?.value || "").trim();
  if (!text || !__activeClientUidForMsg) return;
  try {
    const sess = window.StallzAuth?.getSession?.();
    window.StallzShared?.sendMessage?.({
      clientUid: __activeClientUidForMsg,
      fromUid: sess?.uid || state.user?.uid || "admin",
      fromRole: "admin",
      text
    });
    input.value = "";
    renderAdminMessageThread();
    refreshUI();
  } catch(e){
    console.error(e);
    showToast("Message failed", "error");
  }
};

/* ============================================================================
 * SECURE SYNC: Distribute Loans to Client Folders
 * ============================================================================ */
let __lastDistribute = 0;

/**
 * Immediate secure sync for a SINGLE loan into:
 *   clients/{uid}/loans/{loanId}
 * This avoids relying on the 10s bulk-sync rate limit.
 */
function syncSingleLoanToClient(loan) {
  try {
    if (!loan || !loan.clientUid) return Promise.resolve();
    if (!dataRef || OFFLINE_TEST_MODE) return Promise.resolve();

    const updates = {};
    updates[`clients/${loan.clientUid}/loans/${loan.id}`] = loan;

    return firebase.database().ref().update(updates)
      .catch(e => console.warn("Single loan sync warning:", e));
  } catch (e) {
    console.warn("Single loan sync warning:", e);
    return Promise.resolve();
  }
}

// --------------------------------------------------------------------------
// Payment Methods Sync (fixes client "Failed to load" under strict rules)
// Writes admin payment contacts into each client's node so clients can read it.
// --------------------------------------------------------------------------
let __lastPaymentMethodsSync = 0;

async function syncPaymentMethodsToClients(force = false) {
  try {
    if (OFFLINE_TEST_MODE) return;
    if (!firebase?.database) return;

    const now = Date.now();
    if (!force && now - __lastPaymentMethodsSync < 60 * 60 * 1000) return; // 1h
    __lastPaymentMethodsSync = now;

    // Pull admins from ROOT /admins (public to admins, usually blocked to clients)
    const adminSnap = (firebase.database().ref("admins").get)
      ? await firebase.database().ref("admins").get()
      : await firebase.database().ref("admins").once("value");
    const admins = adminSnap && typeof adminSnap.val === "function" ? (adminSnap.val() || {}) : {};
    const methods = Object.values(admins)
      .filter(a => a && typeof a === "object" && a.phone)
      .map(a => ({
        uid: a.uid || a.id || "",
        name: a.name || a.email || "Admin",
        phone: a.phone,
        network: a.network || ""
      }));

    if (!methods.length) return;

    // Collect client UIDs
    let clientUids = [];
    try {
      clientUids = (window.StallzShared?.listUsers?.("client") || []).map(u => u.uid).filter(Boolean);
    } catch(e) {}

    if (!clientUids.length) {
      const clientsSnap = (firebase.database().ref("clients").get)
        ? await firebase.database().ref("clients").get()
        : await firebase.database().ref("clients").once("value");
      const clientsVal = clientsSnap && typeof clientsSnap.val === "function" ? (clientsSnap.val() || {}) : {};
      clientUids = Object.keys(clientsVal || {});
    }

    if (!clientUids.length) return;

    const updates = {};
    const stamp = new Date().toISOString();
    clientUids.forEach(uid => {
      updates[`clients/${uid}/paymentMethods`] = methods;
      updates[`clients/${uid}/paymentMethodsUpdatedAt`] = stamp;
    });

    await firebase.database().ref().update(updates);
  } catch (e) {
    console.warn("Payment methods sync warning:", e);
  }
}

function distributeLoansToClients(allLoans, force = false) {
  // Rate Limit: Only run this heavy sync every 10 seconds max (unless forced)
  const now = Date.now();
  if (!force && now - __lastDistribute < 10000) return;
  __lastDistribute = now;

  if (!dataRef || OFFLINE_TEST_MODE) return;

  const updates = {};
  let count = 0;

  // 1. Group loans by Client UID
  allLoans.forEach(loan => {
    if (loan.clientUid) {
      // Write to: clients/{uid}/loans/{loanId}
      // This is the ONLY place the Client is allowed to read now.
      updates[`clients/${loan.clientUid}/loans/${loan.id}`] = loan;
      count++;
    }
  });

  // 2. Perform the update if there is data
  if (count > 0) {
    // We use the root ref to update multiple client paths at once
    firebase.database().ref().update(updates)
      .catch(e => console.warn("Sync Distribute Warning:", e));
  }
}

/* ============================================================================
   13.0 | ADMIN PROFILE & COMMISSION LOGIC
   ============================================================================ */

/**
 * Calculates commission with the "Penalty Logic"
 * Standard: 20% of Profit
 * Penalty: If Actual Rate < Standard Rate, Commission drops by same %
 */
function calculateLoanCommission(loan) {
    // 1. Determine Standard Rate for this Plan
    const stdRate = INTEREST_BY_PLAN[loan.plan] || 0.40; // Default to 40% if unknown

    // 2. Determine Actual Rate Given
    const actualRate = (loan.customInterest !== undefined && loan.customInterest !== null)
                       ? (Number(loan.customInterest) / 100)
                       : stdRate;

    // 3. Calculate Profit (Interest portion of Total Due)
    const principal = Number(loan.amount || 0);
    const totalDue = Number(loan.totalDue || 0);
    const profit = Math.max(0, totalDue - principal);

    // 4. Calculate Penalty Factor
    let reductionFactor = 0;

    if (actualRate < stdRate && stdRate > 0) {
        reductionFactor = (stdRate - actualRate) / stdRate;
    }

    // 5. Calculate Final Commission Rate
    // ✅ CHANGED: Base is now 20% (0.20)
    const BASE_COMMISSION = 0.20;
    let finalCommRate = BASE_COMMISSION * (1 - reductionFactor);

    // Safety: Cap at 20% (No bonus for over-charging) and min 0%
    finalCommRate = Math.max(0, Math.min(BASE_COMMISSION, finalCommRate));

    // 6. Calculate Amount
    const commissionAmount = profit * finalCommRate;

    return {
        profit: profit,
        stdRate: stdRate,
        actualRate: actualRate,
        commRate: finalCommRate,
        amount: commissionAmount,
        isPenalized: reductionFactor > 0.01 // True if dropped by >1%
    };
}

window.openAdminProfile = function(identifier) {
    // 1. ✅ CLOSE SIDEBAR IMMEDIATELY
    const sidebar = document.getElementById("profileSidebar");
    const overlay = document.getElementById("profileOverlay");
    if (sidebar) sidebar.classList.remove("open");
    if (overlay) overlay.classList.add("hidden");

    // 2. Find the Admin Data
    const admin = state.admins.find(a =>
        String(a.uid) === String(identifier) ||
        String(a.email) === String(identifier)
    );

    if (!admin) {
        showToast("Admin profile not found", "error");
        return;
    }

    // 3. Check Permissions (The "Prince" Exclusion)
    const nameLower = (admin.name || "").toLowerCase();
    const emailLower = (admin.email || "").toLowerCase();

    const isOwner = nameLower.includes("prince") ||
                    nameLower.includes("kasininga") ||
                    emailLower.includes("prince");

    // 4. Populate Header
    const initials = getInitials(admin.name);
    const elAvatar = document.getElementById("apAvatar");
    elAvatar.textContent = initials;
    const colorIdx = (admin.name.length) % 5;
    elAvatar.className = `avatar avatar-${colorIdx}`;

    document.getElementById("apName").textContent = admin.name;
    document.getElementById("apRole").textContent = (admin.role || "Admin").toUpperCase();
    document.getElementById("apContact").textContent = admin.email || admin.phone || "";

    // 5. Find Associated Loans
    const adminLoans = state.loans.filter(l => {
        const byName = l.createdBy && l.createdBy.toLowerCase() === nameLower;
        const byEmail = l.createdEmail && l.createdEmail.toLowerCase() === emailLower;
        const legacyNyambi = nameLower.includes("nyambi") && l.createdBy === "NYAMBI SITALEKA";

        return byName || byEmail || legacyNyambi;
    });

    // 6. Render "Activity" Tab
    document.getElementById("apLoansCount").textContent = adminLoans.length;

    const recentDiv = document.getElementById("apRecentList");
    recentDiv.innerHTML = adminLoans.slice(0, 10).map(l => `
        <div style="display:flex; justify-content:space-between; padding:10px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
            <div>
                <div style="font-size:0.85rem; font-weight:600;">${escapeHTML(l.clientName)}</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${formatDate(l.createdAt)}</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.85rem; font-weight:700;">${formatMoney(l.amount)}</div>
                <div class="status-pill status-${l.status.toLowerCase()}" style="font-size:0.6rem; padding:2px 6px;">${l.status}</div>
            </div>
        </div>
    `).join("") || `<div style="text-align:center; opacity:0.5; padding:20px;">No loans recorded yet.</div>`;

    // 7. Handle "Commissions" Tab
    const tabBtn = document.getElementById("tabBtnCommissions");
    const tabContent = document.getElementById("ap-tab-commissions");

    if (isOwner) {
        if(tabBtn) tabBtn.style.display = "none";
        if(tabContent) tabContent.style.display = "none";
        switchProfileTab('activity');
    } else {
        if(tabBtn) tabBtn.style.display = "block";

        let totalCommission = 0;
        let weightedRateSum = 0;

        const commRows = adminLoans.map(l => {
            const c = calculateLoanCommission(l);
            totalCommission += c.amount;
            weightedRateSum += c.commRate;

            const rateDisplay = (c.commRate * 100).toFixed(1) + "%";
            const badgeClass = c.isPenalized ? "comm-cut" : "comm-full";
            const profitStr = formatMoney(c.profit);

            const rateComp = c.isPenalized
                ? `${(c.actualRate*100).toFixed(0)}% <span style="opacity:0.5">vs ${(c.stdRate*100).toFixed(0)}%</span>`
                : `<span style="opacity:0.5">Std</span> ${(c.stdRate*100).toFixed(0)}%`;

            return `
                <tr>
                    <td>
                        <div style="font-weight:600;">${escapeHTML(l.clientName)}</div>
                        <div class="rate-info">Profit: ${profitStr}</div>
                    </td>
                    <td style="text-align:right;">
                         ${formatMoney(c.amount)}
                    </td>
                    <td style="text-align:center;">
                        <div style="font-size:0.8rem;">${rateComp}</div>
                        ${c.isPenalized ? '<span style="color:#f87171; font-size:0.65rem;">Interest Cut</span>' : '<span style="color:#34d399; font-size:0.65rem;">Full 20%</span>'}
                    </td>
                    <td style="text-align:right;">
                        <span class="comm-badge ${badgeClass}">${rateDisplay}</span>
                    </td>
                </tr>
            `;
        }).join("");

        document.getElementById("apCommBody").innerHTML = commRows || `<tr><td colspan="4" style="text-align:center; padding:20px; opacity:0.5;">No commissions data.</td></tr>`;

        document.getElementById("apTotalComm").textContent = formatMoney(totalCommission);

        const avgRate = adminLoans.length > 0 ? (weightedRateSum / adminLoans.length) : 0.20;
        document.getElementById("apAvgComm").textContent = (avgRate * 100).toFixed(1) + "%";
    }

    openPopup("adminProfileModal");
};

window.switchProfileTab = function(tabName, btn) {
    document.querySelectorAll(".sketch-tabs .sketch-btn").forEach(b => b.classList.remove("active"));
    if(btn) btn.classList.add("active");
    else {
        if(tabName === 'activity') document.querySelector("button[onclick*='activity']").classList.add("active");
        if(tabName === 'commissions') document.querySelector("button[onclick*='commissions']").classList.add("active");
    }
    document.querySelectorAll(".profile-tab-content").forEach(d => d.style.display = "none");
    document.getElementById("ap-tab-" + tabName).style.display = "block";
};

/* SIDEBAR CLICK-AWAY LISTENER */
document.addEventListener("DOMContentLoaded", function() {
    const overlay = document.getElementById("profileOverlay");
    if (overlay) {
        overlay.addEventListener("click", function() {
            // Close the sidebar when the overlay is clicked
            window.toggleProfileSidebar();
        });
    }
});

/* ============================================================================
   14.0 | EXPENSE & COMMISSION MANAGEMENT (NEW)
   ============================================================================ */

// 1. Initialize Expenses in State
if (!state.expenses) state.expenses = [];

// 2. Load Expenses
const _originalApplyData = applyData;
applyData = function(parsed) {
    if(parsed.expenses) {
        state.expenses = Object.values(parsed.expenses);
    } else {
        state.expenses = [];
    }
    _originalApplyData(parsed);
};

// 3. Open Expense Modal
window.openExpenseModal = function(type, prefillNote = "") {
    const m = document.getElementById("expenseModal");
    if(!m) return;

    document.getElementById("expenseModalTitle").textContent = type === 'Commission' ? "Pay Commission" : "Record Expense";
    document.getElementById("expCategory").value = type === 'Commission' ? "Commission" : "General";
    document.getElementById("expAmount").value = "";
    document.getElementById("expDate").value = new Date().toISOString().split('T')[0];
    document.getElementById("expNote").value = prefillNote;

    // Close other modals if open (like Admin Profile)
    document.getElementById("adminProfileModal").classList.add("modal-hidden");

    openPopup("expenseModal");
};

// 4. Save Expense
window.saveExpense = async function() {
    const amt = Number(document.getElementById("expAmount").value);
    const date = document.getElementById("expDate").value;
    const cat = document.getElementById("expCategory").value;
    const note = document.getElementById("expNote").value.trim();

    if(amt <= 0) { showToast("Enter a valid amount", "error"); return; }

    const newExp = {
        id: Date.now(),
        amount: amt,
        date: date,
        category: cat,
        note: note,
        recordedBy: state.user?.email || "Admin"
    };

    // Update Local State
    if(!state.expenses) state.expenses = [];
    state.expenses.unshift(newExp);

    // Save to DB
    if(!OFFLINE_TEST_MODE && dataRef) {
        await dataRef.child("expenses").child(String(newExp.id)).set(newExp);
    } else {
        saveState();
    }

    showToast("Expense Recorded!", "success");
    closePopup("expenseModal");
    refreshUI();
};

/* ============================================================================
   UPDATED DASHBOARD & CAPITAL RENDERERS
   ============================================================================ */

function renderDashboard() {
  const container = document.getElementById("dashboardStats");
  if (!container) return;

  const loans = state.loans || [];
  const expenses = state.expenses || [];

  // 1. Stats
  const totalLoaned = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => {
      if (l.status === "DEFAULTED") return s;
      return s + Math.max(0, l.balance || 0);
  }, 0);
  const totalProfit = loans.reduce((s, l) => s + (l.profitCollected || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const activeCount = loans.filter(l => l.status === "ACTIVE" || l.status === "OVERDUE").length;

  // 2. Cash on Hand Formula
  const starting = state.startingCapital || 0;
  const capitalIn = (state.capitalTxns || []).reduce((s, t) => s + (t.amount || 0), 0);
  const repaymentsIn = loans.reduce((s, l) => s + (l.paid || 0), 0);

  const cashOnHand = (starting + capitalIn + repaymentsIn) - (totalLoaned + totalExpenses);

  // 3. Update Cash Display
  const cashEl = document.getElementById("cashOnHandValue");
  if (cashEl) {
    cashEl.textContent = formatMoney(cashOnHand);
    if (cashOnHand < 0) cashEl.classList.add("text-danger-glow");
    else cashEl.classList.remove("text-danger-glow");
  }

  // 4. Render Cards
  container.innerHTML = `
    <div class="stat-card" style="border-color: var(--primary);">
      <div class="stat-label">Active Deals</div>
      <div class="stat-value" style="font-size: 1.8rem;">${activeCount}</div>
      <div class="stat-sub">Clients with open balances</div>
    </div>
    <div class="stat-card stat-purple">
      <div class="stat-label">Total Loaned</div>
      <div class="stat-value">${formatMoney(totalLoaned)}</div>
    </div>
    <div class="stat-card stat-orange">
      <div class="stat-label">Outstanding</div>
      <div class="stat-value">${formatMoney(totalOutstanding)}</div>
      <div class="stat-sub">Expected Collection</div>
    </div>
    <div class="stat-card stat-green">
      <div class="stat-label">Net Profit</div>
      <div class="stat-value">${formatMoney(totalProfit)}</div>
      <div class="stat-sub">Interest Collected</div>
    </div>
    <div class="stat-card" style="border-color:#ef4444; background:rgba(239, 68, 68, 0.05);">
      <div class="stat-label" style="color:#ef4444;">Expenses</div>
      <div class="stat-value" style="color:#ef4444;">${formatMoney(totalExpenses)}</div>
      <div class="stat-sub">Commissions & Costs</div>
    </div>
  `;
}

function renderCapitalHistory() {
  const tbody = document.getElementById("capitalHistoryBody");
  if (!tbody) return;

  // Merge Capital IN + Expenses OUT
  const txns = (state.capitalTxns || []).map(t => ({...t, type: 'IN'}));
  const exps = (state.expenses || []).map(e => ({...e, type: 'OUT'}));
  const all = [...txns, ...exps];

  all.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (all.length === 0) {
     tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted); font-style:italic;">No records found.</td></tr>`;
     return;
  }

  tbody.innerHTML = all.map(t => {
      const d = new Date(t.date).toLocaleDateString("en-ZM", { day: 'numeric', month: 'short' });
      const isOut = t.type === 'OUT';
      const color = isOut ? '#ef4444' : '#10b981';
      const sign = isOut ? '-' : '+';
      const note = t.note || t.category || '-';

      return `
        <tr>
          <td style="font-size:0.85rem; color:var(--text-main);">${d}</td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${escapeHTML(note)}</td>
          <td style="text-align:right; color:${color}; font-weight:700;">${sign}${formatMoney(t.amount)}</td>
        </tr>
      `;
  }).join("");
}

/* ============================================================================
   13.0 | ADMIN PROFILE & COMMISSION LOGIC (Final: 25% + Policy Note + Aligned)
   ============================================================================ */

/**
 * Calculates commission with the "Penalty Logic"
 * Standard: 25% of Profit
 * Penalty: If Actual Rate < Standard Rate, Commission drops by same %
 */
function calculateLoanCommission(loan) {
    // 1. Determine Standard Rate for this Plan
    const stdRate = INTEREST_BY_PLAN[loan.plan] || 0.40; // Default to 40% if unknown

    // 2. Determine Actual Rate Given
    const actualRate = (loan.customInterest !== undefined && loan.customInterest !== null)
                        ? (Number(loan.customInterest) / 100)
                        : stdRate;

    // 3. Calculate Profit (Interest portion of Total Due)
    const principal = Number(loan.amount || 0);
    const totalDue = Number(loan.totalDue || 0);
    const profit = Math.max(0, totalDue - principal);

    // 4. Calculate Penalty Factor
    let reductionFactor = 0;

    // Only apply penalty if rate was actually cut (ignore small rounding diffs)
    if (actualRate < (stdRate - 0.01) && stdRate > 0) {
        reductionFactor = (stdRate - actualRate) / stdRate;
    }

    // 5. Calculate Final Commission Rate
    // ✅ BASE: 25% (0.25)
    const BASE_COMMISSION = 0.25;
    let finalCommRate = BASE_COMMISSION * (1 - reductionFactor);

    // Safety: Cap at 25% and min 0%
    finalCommRate = Math.max(0, Math.min(BASE_COMMISSION, finalCommRate));

    // 6. Calculate Amount
    const commissionAmount = profit * finalCommRate;

    return {
        profit: profit,
        stdRate: stdRate,
        actualRate: actualRate,
        commRate: finalCommRate,
        amount: commissionAmount,
        isPenalized: reductionFactor > 0.01
    };
}

window.openAdminProfile = function(identifier) {
    // 1. Force Sidebar to Close
    const sidebar = document.getElementById("profileSidebar");
    const overlay = document.getElementById("profileOverlay");
    if (sidebar) sidebar.classList.remove("open");
    if (overlay) overlay.classList.add("hidden");

    // 2. Find the Admin Data
    const admin = state.admins.find(a =>
        String(a.uid) === String(identifier) ||
        String(a.email) === String(identifier)
    );

    if (!admin) {
        showToast("Admin profile not found", "error");
        return;
    }

    // 3. Check Permissions
    const nameLower = (admin.name || "").toLowerCase();
    const isOwner = nameLower.includes("prince") || nameLower.includes("kasininga");

    // 4. Populate Header
    const initials = getInitials(admin.name);
    const elAvatar = document.getElementById("apAvatar");
    elAvatar.textContent = initials;
    const colorIdx = (admin.name.length) % 5;
    elAvatar.className = `avatar avatar-${colorIdx}`;
    elAvatar.style.width = "80px";
    elAvatar.style.height = "80px";
    elAvatar.style.fontSize = "2rem";
    elAvatar.style.margin = "0 auto 12px auto";

    document.getElementById("apName").textContent = admin.name;
    document.getElementById("apRole").textContent = (admin.role || "Admin").toUpperCase();
    document.getElementById("apContact").textContent = admin.email || admin.phone || "";

    // 5. Find Associated Loans
    const adminLoans = state.loans.filter(l => {
        const creator = (l.createdBy || "").toLowerCase();
        return creator === nameLower || (nameLower.includes("nyambi") && creator === "nyambi sitaleka");
    });

    // 6. Render "Activity" Tab (Recent Loans)
    document.getElementById("apLoansCount").textContent = adminLoans.length;
    const recentDiv = document.getElementById("apRecentList");
    const sortedLoans = [...adminLoans].sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));

    if (sortedLoans.length === 0) {
        recentDiv.innerHTML = `<div style="text-align:center; opacity:0.5; padding:20px;">No loans recorded yet.</div>`;
    } else {
        recentDiv.innerHTML = sortedLoans.slice(0, 10).map(l => `
            <div style="display:flex; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.03); border-radius:10px; border:1px solid rgba(255,255,255,0.05); align-items:center; margin-bottom:6px;">
                <div>
                    <div style="font-size:0.9rem; font-weight:600;">${escapeHTML(l.clientName)}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${formatDate(l.startDate)}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.9rem; font-weight:700;">${formatMoney(l.amount)}</div>
                    <span class="status-pill status-${l.status.toLowerCase()}" style="font-size:0.65rem; padding:2px 8px; margin-top:4px; display:inline-block;">${l.status}</span>
                </div>
            </div>
        `).join("");
    }

    // 7. Handle "Commissions" Tab
    const tabBtn = document.getElementById("tabBtnCommissions");
    const tabContent = document.getElementById("ap-tab-commissions");

    if (isOwner) {
        if(tabBtn) tabBtn.style.display = "none";
        if(tabContent) tabContent.style.display = "none";
        switchProfileTab('activity');
    } else {
        if(tabBtn) tabBtn.style.display = "block";

        // A. Calculate Financials
        let totalEarned = 0;
        let weightedRateSum = 0;

        const commissionRows = adminLoans.map(l => {
            const c = calculateLoanCommission(l);
            totalEarned += c.amount;
            weightedRateSum += c.commRate;
            return { loan: l, ...c };
        });

        const paidComm = (state.expenses || [])
            .filter(e => e.category === 'Commission' && e.note.toLowerCase().includes(nameLower))
            .reduce((s, e) => s + e.amount, 0);

        const pendingComm = Math.max(0, totalEarned - paidComm);

        // B. Render Layout
        // 1. Summary Card
        let html = `
            <div style="background:linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)); padding:20px; border-radius:16px; margin-bottom:20px; border:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:15px;">
                    <div>
                        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Total Earned</div>
                        <div style="font-size:1.1rem; font-weight:700; color:#34d399;">${formatMoney(totalEarned)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Total Paid</div>
                        <div style="font-size:1.1rem; font-weight:700; color:#93c5fd;">${formatMoney(paidComm)}</div>
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <div>
                        <div style="font-size:0.8rem; font-weight:600; color:#fff;">Pending Payout</div>
                        <div style="font-size:0.75rem; color:#94a3b8;">Available to withdraw</div>
                    </div>
                    <div style="font-size:1.4rem; font-weight:800; color:#facc15;">${formatMoney(pendingComm)}</div>
                </div>

                <button onclick="openExpenseModal('Commission', 'Commission Payment for ${escapeHTML(admin.name)}')"
                    style="width:100%; background:#facc15; color:#000; border:none; padding:12px; border-radius:10px; font-weight:700; font-size:0.95rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 15px rgba(250, 204, 21, 0.2);">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                    Pay Commission
                </button>
            </div>
        `;

        // 2. Policy Notice (Restored!)
        html += `
            <div style="background:rgba(59, 130, 246, 0.1); border:1px solid rgba(59, 130, 246, 0.2); padding:12px; border-radius:12px; font-size:0.75rem; color:#93c5fd; margin-bottom:20px; line-height:1.4;">
                <strong>ℹ️ Policy:</strong> Standard commission is 25% of profit. If the loan interest rate is discounted, the commission % is reduced by the same proportion.
            </div>
        `;

        // 3. Detailed Table
        html += `
            <div style="background:rgba(255,255,255,0.02); border-radius:12px; overflow:hidden; border:1px solid rgba(255,255,255,0.05);">
                <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                    <thead>
                        <tr style="background:rgba(255,255,255,0.05); text-align:left;">
                            <th style="padding:12px 15px; color:#94a3b8; font-size:0.75rem; text-transform:uppercase;">Loan Details</th>
                            <th style="padding:12px 10px; text-align:right; color:#94a3b8; font-size:0.75rem; text-transform:uppercase;">Loan Profit</th>
                            <th style="padding:12px 10px; text-align:center; color:#94a3b8; font-size:0.75rem; text-transform:uppercase;">Your Cut</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (commissionRows.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding:30px; opacity:0.5; font-style:italic;">No commission history found.</td></tr>`;
        } else {
            // Sort by Date Descending
            commissionRows.sort((a,b) => new Date(b.loan.startDate) - new Date(a.loan.startDate));

            html += commissionRows.map(row => {
                const profitStr = formatMoney(row.profit);
                const commStr = formatMoney(row.amount);

                // Badge Logic
                let badgeHtml = '';
                if (row.isPenalized) {
                    badgeHtml = `
                        <div style="margin-top:4px; display:flex; justify-content:flex-end;">
                            <span style="background:rgba(239, 68, 68, 0.15); color:#f87171; border:1px solid rgba(239, 68, 68, 0.2); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">
                                ⚠️ Interest Cut
                            </span>
                            <span style="font-size:0.7rem; color:#94a3b8; margin-left:4px;">(${(row.commRate*100).toFixed(0)}%)</span>
                        </div>
                    `;
                } else {
                    badgeHtml = `
                        <div style="margin-top:4px; display:flex; justify-content:flex-end; text-align:right;">
                            <span style="background:rgba(52, 211, 153, 0.15); color:#34d399; border:1px solid rgba(52, 211, 153, 0.2); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">
                                ✔️ 25% Std
                            </span>
                        </div>
                    `;
                }

                return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:12px 15px;">
                        <div style="font-weight:700; color:var(--text-main);">${escapeHTML(row.loan.clientName)}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                           ${formatDate(row.loan.startDate)}
                        </div>
                    </td>
                    <td style="padding:12px 10px; text-align:right;">
                        <div style="font-weight:600; opacity:0.9;">${profitStr}</div>
                        <div style="font-size:0.90rem; color:#94a3b8; text-align:left;">Generated profit</div>
                    </td>
                    <td style="padding:12px 10px; text-align:left;">
                        <div style="font-weight:800; color:#34d399; font-size:0.95rem;">+${commStr}</div>
                        ${badgeHtml}
                    </td>
                </tr>`;
            }).join("");
        }

        html += `</tbody></table></div>`;

        // Update Header Stats
        if(document.getElementById("apTotalComm")) document.getElementById("apTotalComm").textContent = formatMoney(totalEarned);
        if(document.getElementById("apAvgComm")) {
             const avgRate = adminLoans.length > 0 ? (weightedRateSum / adminLoans.length) : 0.25;
             document.getElementById("apAvgComm").textContent = (avgRate * 100).toFixed(1) + "%";
        }

        // Inject Content
        tabContent.innerHTML = html;
    }

    openPopup("adminProfileModal");
};

window.switchProfileTab = function(tabName, btn) {
    document.querySelectorAll(".sketch-tabs .sketch-btn").forEach(b => b.classList.remove("active"));
    if(btn) btn.classList.add("active");
    else {
        if(tabName === 'activity') document.querySelector("button[onclick*='activity']")?.classList.add("active");
        if(tabName === 'commissions') document.querySelector("button[onclick*='commissions']")?.classList.add("active");
    }
    document.querySelectorAll(".profile-tab-content").forEach(d => d.style.display = "none");
    document.getElementById("ap-tab-" + tabName).style.display = "block";
};

// ============================================================================
// PAYMENT METHODS MANAGEMENT (Admin Side)
// ============================================================================

window.openPaymentMethodsModal = function() {
    openPopup('paymentMethodsModal');
    fetchAndRenderAdminPaymentMethods();
};

window.fetchAndRenderAdminPaymentMethods = async function() {
    const tbody = document.getElementById("paymentMethodsBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

    try {
        // Fetch from the root paymentMethods node
        const snapshot = await firebase.database().ref('paymentMethods').once('value');
        const methods = snapshot.val() || {};
        const keys = Object.keys(methods);

        if (keys.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-muted); font-style:italic;">No numbers set up yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = keys.map(key => {
            const m = methods[key];
            return `
            <tr>
                <td style="font-weight:600;">${escapeHTML(m.name)}</td>
                <td style="font-family:monospace; color:var(--primary); font-weight:600;">${escapeHTML(m.phone)}</td>
                <td style="text-align:right;">
                    <button class="btn-icon" style="color:#ef4444; background:rgba(239, 68, 68, 0.1); padding:6px 12px; border-radius:6px; font-size: 0.75rem; font-weight: 700;" onclick="deletePaymentMethod('${key}')">Delete</button>
                </td>
            </tr>
            `;
        }).join("");
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#ef4444;">Failed to load.</td></tr>`;
    }
};

window.addPaymentMethod = async function() {
    const nameEl = document.getElementById("pmName");
    const phoneEl = document.getElementById("pmPhone");
    const name = nameEl.value.trim().toUpperCase();
    const phone = phoneEl.value.trim();

    if (!name || !phone) {
        showToast("Please enter both an account name and a phone number.", "error");
        return;
    }

    // Generate a unique key
    const key = "pm_" + Date.now();
    const newMethod = { name, phone };

    try {
        await firebase.database().ref(`paymentMethods/${key}`).set(newMethod);
        showToast("Payment method added!", "success");
        nameEl.value = "";
        phoneEl.value = "";
        fetchAndRenderAdminPaymentMethods(); // Refresh the list
    } catch (e) {
        showToast("Failed to save.", "error");
    }
};

window.deletePaymentMethod = function(key) {
    showAdminDialog({
        title: 'Delete Number',
        message: 'Are you sure you want to remove this payment number from the Client Portal?',
        btnText: 'Delete',
        btnClass: 'btn-danger',
        onConfirm: async () => {
            try {
                await firebase.database().ref(`paymentMethods/${key}`).remove();
                showToast("Payment method removed", "success");
                fetchAndRenderAdminPaymentMethods(); // Refresh the list
            } catch (e) {
                showToast("Failed to remove", "error");
            }
        }
    });
};

window.confirmAdminDialog = function() {
    const inputEl = document.getElementById('adminDialogInput');
    const val = inputEl.style.display === 'block' ? inputEl.value : null;

    if (inputEl.style.display === 'block' && !String(val).trim()) {
        showToast("This field is required", "error");
        if(typeof vibrate === "function") vibrate([50]);
        return;
    }

    const callbackToRun = __adminDialogCallback; // 1. Save the command FIRST
    closeAdminDialog();                          // 2. Close the window
    if (typeof callbackToRun === 'function') callbackToRun(val); // 3. Run the command
};

// ---------------------------------------------------------------------------
// NEXT-LEVEL PASS: guard all UI entrypoints + prevent default '#' navigation
// ---------------------------------------------------------------------------
(function(){
  const wrappedFlag = "__stallzWrapped";

  function fallbackAlert(msg){
    try { alert(msg); } catch(e) {}
  }

  function wrapFn(name){
    const fn = window[name];
    if (typeof fn !== "function") return;
    if (fn[wrappedFlag]) return;
    window[name] = function(...args){
      try { return fn.apply(this, args); }
      catch(err){
        console.error("[STALLZ][UI][" + name + "] failed:", err);
        try { if (typeof showToast === "function") showToast("Something went wrong (" + name + ")", "error"); else fallbackAlert("Something went wrong."); } catch(e) { fallbackAlert("Something went wrong."); }
      }
    };
    window[name][wrappedFlag] = true;
  }

  window.__STALLZ_WRAP_GLOBALS_ADMIN = function(){
    [
      // Tabs / Navigation
      "switchOverviewTab", "navToLoansForPay",
      // Modals / Popups
      "openPopup", "closePopup", "closeAllModals",
      "openLoanHistoryModal", "setLoanHistoryFilter",
      "openPaymentMethodsModal", "addPaymentMethod", "deletePaymentMethod",
      "openExpenseModal", "saveExpense",
      "openLoanRequestModal", "closeLoanRequestModal", "approveLoanRequest", "rejectLoanRequest",
      "openReceiptModal", "closeReceiptModal",
      // Sidebar / Notifications / Theme
      "toggleProfileSidebar", "toggleNotifications", "checkTimeBasedTheme",
      // Admin messaging + dialogs
      "sendAdminMessage", "closeAdminMessageModal",
      "showAdminDialog", "closeAdminDialog", "confirmAdminDialog",
      // Auth / Logout
      "triggerAdminLogout"
    ].forEach(wrapFn);
  };

  // One-time global hardening
  try {
    window.addEventListener("error", (e) => {
      console.error("[STALLZ][GlobalError]", e?.error || e?.message || e);
      try { if (typeof showToast === "function") showToast("A UI error occurred", "error"); } catch(_) {}
    });
    window.addEventListener("unhandledrejection", (e) => {
      console.error("[STALLZ][PromiseRejection]", e?.reason || e);
      try { if (typeof showToast === "function") showToast("A background error occurred", "error"); } catch(_) {}
    });
  } catch(e) {}

  // Wrap what already exists now, and again after init adds more globals
  try { window.__STALLZ_WRAP_GLOBALS_ADMIN(); } catch(e) {}

})();
