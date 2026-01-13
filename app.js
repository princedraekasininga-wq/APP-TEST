// ==========================================
// APP VERSION CONTROL
// ==========================================
const APP_VERSION = "1.6.5"; // Bumped version


// ==========================================
// 1. FIREBASE CONFIGURATION & SETUP
// ==========================================

const TEST_MODE = false; // FIXED: Set to FALSE for live database

// SAFETY FLAG: Prevents overwriting DB if app loads in "Offline/Timeout" mode
let isSafeToSave = true;

const firebaseConfig = {
  apiKey: "AIzaSyBRMITHX8gm0jKpEXuC4iePGWoYON85BDU",
  authDomain: "stallz-loans.firebaseapp.com",
  databaseURL: "https://stallz-loans-default-rtdb.firebaseio.com",
  projectId: "stallz-loans",
  storageBucket: "stallz-loans.firebasestorage.app",
  messagingSenderId: "496528682",
  appId: "1:496528682:web:26066f0ca7d440fb854253",
  measurementId: "G-ZELECKK94M"
};

let db, dataRef;

try {
  if (typeof firebase !== "undefined") {
    firebase.initializeApp(firebaseConfig);
    // Use LOCAL persistence so users stay logged in
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((error) => console.error("Auth Persistence Error:", error));

    db = firebase.database();
    dataRef = db.ref("loanManagerData_v5");
    console.log("Firebase initialized.");
  } else {
    console.warn("Firebase SDK not loaded. Running in Offline/Test Mode.");
  }
} catch (e) {
  console.error("Firebase Init Error:", e);
}

// ==========================================
// 2. HELPER FUNCTIONS & CONSTANTS
// ==========================================

function el(id) { return document.getElementById(id); }

// --- EXPOSED TO WINDOW FOR HTML BUTTONS ---
window.forceHideLoader = function() {
    const loader = el("loadingOverlay");
    if (loader) loader.style.display = "none";
}

function getLocalDateVal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function checkTimeBasedTheme() {
  const hour = new Date().getHours();
  const isDayTime = hour >= 6 && hour < 18;
  if (isDayTime) {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function formatWhatsApp(phone) {
  if (!phone) return "";
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '260' + p.substring(1);
  if (p.length === 9) p = '260' + p;
  return p;
}

// --- Helper to Update Welcome Message ---
function updateWelcomeUI() {
  if (!state.user || !state.user.email) return;

  const name = state.user.email.split('@')[0];
  const formattedName = name.charAt(0).toUpperCase() + name.slice(1);
  const msg = `Welcome back, ${formattedName}`;

  const pc = document.getElementById("welcomeDesktop");
  const mob = document.getElementById("welcomeMobile");

  if(pc) pc.textContent = msg;
  if(mob) mob.textContent = msg + " 👋";
}

// --- TOAST NOTIFICATION ---
function showToast(message, type = "success") {
  const container = el("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  if (type === "success" && typeof vibrate === "function") vibrate([20]);
  if (type === "error" && typeof vibrate === "function") vibrate([30, 30]);

  setTimeout(() => {
    toast.style.animation = "toastFadeOut 0.4s forwards";
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

function updateSessionActivity() {
  localStorage.setItem("stallz_last_active", Date.now());
}
document.addEventListener("click", updateSessionActivity);
document.addEventListener("keydown", updateSessionActivity);
document.addEventListener("touchstart", updateSessionActivity);

function checkAppVersion() {
  const storedVersion = localStorage.getItem("stallz_app_version");
  const subtitle = document.querySelector(".welcome-subtitle");
  if (subtitle) {
      subtitle.textContent = `Secure Admin Login (v${APP_VERSION})`;
  }
  // Auto-clear cache on version bump
  if (storedVersion !== APP_VERSION) {
    console.log("New version detected. Clearing old session.");
    localStorage.removeItem("stallz_test_session"); // Force re-login on update
    localStorage.setItem("stallz_app_version", APP_VERSION);
    setTimeout(() => {
        showToast(`App Updated to v${APP_VERSION}`, "success");
        if(typeof vibrate === "function") vibrate([50, 50, 50]);
    }, 1500);
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

const INTEREST_BY_PLAN = { "Weekly": 0.20, "2 Weeks": 0.30, "3 Weeks": 0.35, "Monthly": 0.40 };
const DAYS_BY_PLAN = { "Weekly": 7, "2 Weeks": 14, "3 Weeks": 21, "Monthly": 30 };

const state = {
  dataLoaded: false,
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
  user: null,
  isLoggedIn: false
};

let activeFilters = { status: 'ACTIVE', plan: 'All' };

// FIXED: Attached to window for onclick in HTML
window.setFilter = function(type, value, btnElement) {
  activeFilters[type] = value;
  const parent = btnElement.parentElement;
  parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btnElement.classList.add('active');
  renderLoansTable();
}

function getInitials(name) {
  if(!name) return "??";
  return name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
}

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

let wizardStep = 0;
let wizardDraft = {};

const ACTION = { NONE: "NONE", PAY: "PAY", NOTE: "NOTE", WRITEOFF: "WRITEOFF" };
let currentAction = ACTION.NONE;
let currentLoanId = null;

// ==========================================
// 3. AUTHENTICATION & CLOUD SYNC
// ==========================================

function showWelcomeScreen() {
  const screen = el("welcomeScreen");
  const loginBtn = el("authLoginBtn");
  const errorMsg = el("authError");
  const loader = el("loadingOverlay");

  // --- 1. SETUP LOGIN BUTTON ---
  if (loginBtn) {
    const newBtn = loginBtn.cloneNode(true);
    loginBtn.parentNode.replaceChild(newBtn, loginBtn);

    newBtn.onclick = async () => {
      const email = el("loginEmail").value.trim();
      const password = el("loginPassword").value.trim();

      if (!email || !password) {
        errorMsg.textContent = "Please enter both email and password.";
        if (typeof vibrate === "function") vibrate([50, 50]);
        return;
      }
      if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }

      // A. TEST MODE
      if (TEST_MODE) {
        setTimeout(() => {
          localStorage.setItem("stallz_test_session", "true");
          state.user = { email: email || "test@admin.com", uid: "test-user-123" };
          state.isLoggedIn = true;
          updateSessionActivity();

          screen.style.display = "none";
          loadFromFirebase();

          updateWelcomeUI();
          showToast(`Welcome back!`, "success");
        }, 500);
        return;
      }

      // B. REAL FIREBASE
      try {
        if (typeof firebase === "undefined") throw new Error("Firebase not loaded");
        await firebase.auth().signInWithEmailAndPassword(email, password);
        updateSessionActivity();
        updateWelcomeUI();
        showToast(`Login Successful`, "success");
      } catch (error) {
        if (loader) loader.style.display = "none";
        errorMsg.textContent = "Login failed: " + error.message;
        if (typeof vibrate === "function") vibrate([50, 50, 50]);
      }
    };
  }

  // --- 2. CHECK SESSION TIMEOUT ---
  const lastActive = localStorage.getItem("stallz_last_active");
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;

  if (lastActive && (now - lastActive > THIRTY_MINUTES)) {
    console.log("Session expired. Logging out.");
    if (typeof firebase !== "undefined" && firebase.auth) firebase.auth().signOut();
    localStorage.removeItem("stallz_last_active");
    localStorage.removeItem("stallz_test_session");

    if (loader) loader.style.display = "none";
    screen.style.display = "flex";
    return;
  }

  // --- 3. AUTO-LOGIN ---
  const testSession = localStorage.getItem("stallz_test_session");

  if (TEST_MODE) {
    if (testSession === "true") {
       state.user = { email: "test@admin.com", uid: "test-user-123" };
       state.isLoggedIn = true;
       updateSessionActivity();

       screen.style.display = "none";
       if (loader) loader.style.display = "flex";
       loadFromFirebase();
    } else {
       if (loader) loader.style.display = "none";
       screen.style.display = "flex";
    }
  }
  else if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          updateSessionActivity();
          state.user = user;
          state.isLoggedIn = true;
          screen.style.display = "none";
          if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }
          loadFromFirebase();
        } else {
          if (loader) loader.style.display = "none";
          screen.style.display = "flex";
        }
      });
  } else {
      if (loader) loader.style.display = "none";
      screen.style.display = "flex";
  }
}

// --- UPDATED: ROBUST LOADER WITH EMERGENCY EXIT ---
function loadFromFirebase() {
  // SAFETY VALVE: If app takes > 3s, assume connection issue.
  setTimeout(() => {
      const loader = el("loadingOverlay");
      if (loader && loader.style.display !== "none") {
          console.warn("Loader timeout! Forcing UI open.");
          loader.style.display = "none"; // FORCE HIDE

          // FIXED: If we have to force load, DO NOT allow saving back to DB
          // This prevents overwriting your real DB with empty data.
          if (!state.dataLoaded) {
              console.log("Initializing defaults (READ ONLY MODE)...");
              isSafeToSave = false; // <--- LOCK THE DB
              showToast("Connection slow. Loaded in READ-ONLY mode.", "error");
              applyData({ loans: [], nextId: 1, admins: [] });
          }
      }
  }, 3500); // 3.5s timeout

  if (TEST_MODE) {
    setTimeout(() => {
      try {
        const localData = localStorage.getItem("stallz_test_data");
        let parsed = localData ? JSON.parse(localData) : null;
        if (!parsed) parsed = { loans: [], nextId: 1, admins: [{ id: 1, name: "Test Owner", email: "test@admin.com", role: "Owner" }] };
        applyData(parsed);
      } catch(e) {
          console.error("Data Corrupt. Resetting.", e);
          applyData({ loans: [], nextId: 1, admins: [] });
      }
    }, 500);
    return;
  }

  if (!dataRef) {
      console.warn("No DB connection.");
      applyData({});
      return;
  }

  // Real DB Connection
  dataRef.on("value", (snapshot) => {
    isSafeToSave = true; // Connection successful, safe to save
    applyData(snapshot.val() || {});
  });
}

function applyData(parsed) {
  // 1. Hide Loader IMMEDIATELY
  const loader = el("loadingOverlay");
  if (loader) {
     loader.style.display = "none";
  }

  // 2. Load Data
  state.dataLoaded = true;
  state.loans = parsed.loans || [];
  state.nextId = parsed.nextId || 1;
  state.startingCapital = parsed.startingCapital || 0;
  state.startingCapitalSetDate = parsed.startingCapitalSetDate || null;
  state.capitalTxns = parsed.capitalTxns || [];
  state.nextCapitalTxnId = parsed.nextCapitalTxnId || 1;
  state.repayments = parsed.repayments || [];
  state.nextRepaymentId = parsed.nextRepaymentId || 1;
  state.admins = parsed.admins || [];
  state.nextAdminId = parsed.nextAdminId || 1;

  // 3. Render
  try {
      refreshUI();
      updateWelcomeUI();
  } catch(e) {
      console.error("Render error:", e);
  }
}

function saveState() {
  if (!state.dataLoaded) return;

  // FIXED: The Critical Safety Check
  if (!isSafeToSave && !TEST_MODE) {
      console.warn("SAVE BLOCKED: App is in read-only/offline mode to prevent data loss.");
      showToast("Cannot save: Offline/Read-Only Mode", "error");
      return;
  }

  const payload = {
    loans: state.loans,
    nextId: state.nextId,
    startingCapital: state.startingCapital,
    startingCapitalSetDate: state.startingCapitalSetDate,
    capitalTxns: state.capitalTxns,
    nextCapitalTxnId: state.nextCapitalTxnId,
    repayments: state.repayments,
    nextRepaymentId: state.nextRepaymentId,
    admins: state.admins,
    nextAdminId: state.nextAdminId
  };

  if (TEST_MODE) {
    localStorage.setItem("stallz_test_data", JSON.stringify(payload));
  } else {
    if (dataRef) {
        dataRef.set(payload).catch((e) => {
            console.error("Save failed:", e);
            showToast("Save Failed: Check Connection", "error");
        });
    }
  }
}

// ==========================================
// 4. LOGIC & FORMATTERS
// ==========================================

function formatMoney(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "K0.00";
  return "K" + Number(amount).toFixed(2);
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-ZM", { year: "2-digit", month: "short", day: "numeric" });
}

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function computeDerivedFields(loan) {
  const today = new Date();
  let rate = INTEREST_BY_PLAN[loan.plan] || 0;
  if (loan.customInterest) rate = Number(loan.customInterest) / 100;

  const days = DAYS_BY_PLAN[loan.plan] || 0;
  const startDate = loan.startDate ? new Date(loan.startDate) : today;
  const dueDate = new Date(startDate.getTime());
  if (days > 0) dueDate.setDate(dueDate.getDate() + days);

  const totalDue = (loan.amount || 0) * (1 + rate);
  const paid = loan.paid || 0;
  const sale = loan.saleAmount || 0;
  const balance = totalDue - (paid + sale);

  let status = "ACTIVE";
  if (balance <= 1) status = "PAID";
  else if (loan.isDefaulted) status = "DEFAULTED";
  else if (today > dueDate) status = "OVERDUE";

  const daysOverdue = (today > dueDate && status !== "PAID")
    ? Math.floor((today - dueDate) / (1000 * 60 * 60 * 24))
    : 0;

  loan.rate = rate;
  loan.dueDate = dueDate.toISOString();
  loan.totalDue = totalDue;
  loan.balance = balance;
  loan.status = status;
  loan.daysOverdue = daysOverdue;
  loan.profitCollected = Math.max(0, (paid + sale) - loan.amount);
}

function recomputeAllLoans() {
  if (!state.loans) return;
  state.loans.forEach(loan => computeDerivedFields(loan));
}

function generateLoanId() { return state.nextId++; }
function generateRepaymentId() { return state.nextRepaymentId++; }
function generateCapitalTxnId() { return state.nextCapitalTxnId++; }

// FIXED: Attached to window
window.openReceipt = function(loanId) {
  const loan = state.loans.find(l => l.id == loanId);
  if (!loan) return;

  const printWindow = window.open('', '', 'width=400,height=600');
  printWindow.document.write(`
    <html>
      <head>
        <style>
          body { font-family: monospace; padding: 20px; text-align: center; }
          .header { font-size: 1.2em; font-weight: bold; margin-bottom: 10px; border-bottom: 2px dashed #000; padding-bottom: 10px; }
          .row { display: flex; justify-content: space-between; margin: 5px 0; }
          .footer { margin-top: 20px; border-top: 1px solid #000; padding-top: 10px; font-size: 0.8em; }
        </style>
      </head>
      <body>
        <div class="header">STALLZ LOANS<br>OFFICIAL RECEIPT</div>
        <div class="row"><span>Date:</span> <span>${new Date().toLocaleDateString()}</span></div>
        <div class="row"><span>Loan ID:</span> <span>#${loan.id}</span></div>
        <div class="row"><span>Client:</span> <span>${loan.clientName}</span></div>
        <br>
        <div class="row"><span>Principal:</span> <span>${formatMoney(loan.amount)}</span></div>
        <div class="row"><span>Plan:</span> <span>${loan.plan}</span></div>
        <div class="row"><span>Total Due:</span> <span>${formatMoney(loan.totalDue)}</span></div>
        <div class="row"><span>Paid So Far:</span> <span>${formatMoney(loan.paid)}</span></div>
        <br>
        <div class="row" style="font-weight:bold; font-size:1.1em;"><span>BALANCE:</span> <span>${formatMoney(loan.balance)}</span></div>
        <div class="footer">
          Generated by: ${state.user ? state.user.email : 'System'}<br>
          Thank you for your business.
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ==========================================
// 6. UI RENDERING
// ==========================================

function refreshUI() {
  try { recomputeAllLoans(); } catch(e) { console.error("Error computing loans:", e); }
  try { renderDashboard(); } catch(e) { console.error("Dash Error:", e); }
  try { renderLoansTable(); } catch(e) { console.error("Loans Table Error:", e); }
  try { renderRepaymentsTable(); } catch(e) { console.error("Repay Table Error:", e); }
  try { renderMonthlyTable(); } catch(e) { console.error("Monthly Table Error:", e); }
  try { renderClientsTable(); } catch(e) { console.error("Clients Table Error:", e); }
  try { renderAdminsTable(); } catch(e) { console.error("Admins Table Error:", e); }
}

function renderDashboard() {
  const container = el("dashboardStats");
  if (!container) return;

  const loans = state.loans || [];
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

  const cashEl = el("cashOnHandValue");
  if(cashEl) {
    cashEl.textContent = formatMoney(cashOnHand);
    if (cashOnHand < 0) cashEl.classList.add("text-danger-glow");
    else cashEl.classList.remove("text-danger-glow");
  }

  if (state.startingCapital > 0) {
      if(el("startingCapitalSetupRow")) el("startingCapitalSetupRow").style.display = "none";
      if(el("startingCapitalInfoRow")) {
          el("startingCapitalInfoRow").style.display = "block";
          el("startingCapitalInfoValue").textContent = formatMoney(state.startingCapital);
          el("startingCapitalInfoDate").textContent = formatDate(state.startingCapitalSetDate || new Date().toISOString());
      }
      if(el("startingCapitalValue")) el("startingCapitalValue").textContent = formatMoney(state.startingCapital);
  } else {
      if(el("startingCapitalSetupRow")) el("startingCapitalSetupRow").style.display = "block";
      if(el("startingCapitalInfoRow")) el("startingCapitalInfoRow").style.display = "none";
      if(el("startingCapitalValue")) el("startingCapitalValue").textContent = "Not set";
  }

  const capBody = el("capitalTableBody");
  if(capBody) {
     capBody.innerHTML = (state.capitalTxns || []).map(t => `
        <tr><td>${formatDate(t.date)}</td><td>${formatMoney(t.amount)}</td><td class="subtle">${t.note || '-'}</td></tr>
     `).join("");
  }

  container.innerHTML = `
    <div class="stat-card" style="border-color: var(--primary);">
      <div class="stat-label">Active Deals</div>
      <div class="stat-value" style="font-size: 1.8rem;">${activeCount}</div>
      <div class="stat-sub">Clients with open balances</div>
    </div>
    <div class="stat-card stat-purple">
      <div class="stat-label">Total Loaned</div>
      <div class="stat-value" id="statLoaned">K0.00</div>
      <div class="stat-sub">Lifetime capital deployed</div>
    </div>
    <div class="stat-card stat-orange">
      <div class="stat-label">Outstanding</div>
      <div class="stat-value" id="statOutstanding">K0.00</div>
      <div class="stat-sub">Pending collection (Excl. Bad Debt)</div>
    </div>
    <div class="stat-card stat-green">
      <div class="stat-label">Profit Made</div>
      <div class="stat-value" id="statProfit">K0.00</div>
      <div class="stat-sub">Total realized gains collected</div>
    </div>
  `;

  animateValue(el("statLoaned"), 0, totalLoaned, 1500);
  animateValue(el("statOutstanding"), 0, totalOutstanding, 2000);
  animateValue(el("statProfit"), 0, totalProfit, 2500);
}

function renderLoansTable() {
  const overdueCount = (state.loans || []).filter(l => l.status === "OVERDUE").length;
  const badge = el("clientBadge");

  if (badge) {
    if (overdueCount > 0) badge.classList.add("show");
    else badge.classList.remove("show");
  }

  const tbody = el("loansTableBody");
  if (!tbody) return;

  const search = (el("searchInput")?.value || "").toLowerCase();
  const statusFilter = activeFilters.status;
  const planFilter = activeFilters.plan;

  const visibleLoans = (state.loans || []).filter(l => {
     const matchSearch = !search || (l.clientName && l.clientName.toLowerCase().includes(search));
     const matchStatus = statusFilter === "All" || l.status === statusFilter;
     const matchPlan = planFilter === "All" || l.plan === planFilter;
     return matchSearch && matchStatus && matchPlan;
  });

  if (el("loansCountLabel")) el("loansCountLabel").textContent = `${visibleLoans.length} records`;
  if(el("emptyState")) {
      const shouldShow = state.dataLoaded && visibleLoans.length === 0;
      el("emptyState").style.display = shouldShow ? "block" : "none";
  }

  tbody.innerHTML = visibleLoans.map((l, index) => {
    const percent = Math.min(100, Math.round(((l.paid || 0) / (l.totalDue || 1)) * 100));
    let progressColor = "var(--primary)";
    if (percent >= 100) progressColor = "#22c55e";
    else if (l.status === "OVERDUE") progressColor = "#ef4444";
    else if (l.status === "DEFAULTED") progressColor = "#64748b";

    const isOverdue = l.status === "OVERDUE";
    const balanceStyle = isOverdue ? 'class="text-danger-glow" style="font-weight:bold;"' : 'style="font-weight:bold;"';
    const avatarClass = `avatar-${l.id % 5}`;

    const waNumber = formatWhatsApp(l.clientPhone);
    const waMsg = encodeURIComponent(`Hi ${l.clientName}, friendly reminder from Stallz Loans. Your balance of ${formatMoney(l.balance)} was due on ${formatDate(l.dueDate)}. Please make payment today.`);
    const waLink = waNumber ? `https://wa.me/${waNumber}?text=${waMsg}` : "#";
    const waStyle = waNumber ? "color:#4ade80;" : "color:#64748b; cursor:not-allowed;";

    const isClosed = l.status === "PAID" || l.status === "DEFAULTED";

    // FIXED: Added onclicks that point to the window-exposed functions
    return `
    <tr class="row-${(l.status || 'active').toLowerCase()}">
      <td data-label="ID"><span style="opacity:0.5; font-size:0.8rem;">#${l.id}</span></td>
      <td data-label="Client">
        <div class="client-flex">
          <div class="avatar ${avatarClass}">${getInitials(l.clientName)}</div>
          <div>
            <div style="font-weight:600; color:var(--text-main);">${l.clientName}</div>
            <div class="subtle" style="font-size:0.75rem;">${l.clientPhone||''}</div>
          </div>
        </div>
      </td>
      <td data-label="Item"><span style="color:var(--text-muted);">${l.collateralItem || '-'}</span></td>
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
      <td data-label="Status"><span class="status-pill status-${(l.status||'active').toLowerCase()}">${l.status}</span></td>
      <td data-label="Actions" style="text-align:right; white-space:nowrap;">
        <button class="btn-icon" onclick="openReceipt(${l.id})" title="Print Receipt">🧾</button>
        <a href="${waLink}" target="_blank" class="btn-icon" style="${waStyle}; text-decoration:none; display:inline-block;" title="Send WhatsApp Reminder">💬</a>
        <button class="btn-icon" onclick="openActionModal('PAY', ${l.id})" title="Pay" style="color:#38bdf8;" ${isClosed ? 'disabled style="opacity:0.3"' : ''}>💵</button>
        <button class="btn-icon" onclick="openActionModal('WRITEOFF', ${l.id})" title="Write Off (Bad Debt)" style="color:#f87171;" ${isClosed ? 'disabled style="opacity:0.3"' : ''}>🚫</button>
        <button class="btn-icon" onclick="openActionModal('NOTE', ${l.id})" title="Edit Note">✏️</button>
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
       <td data-label="Recorder">${r.recordedBy||'System'}</td>
       <td data-label="Amount" style="color:#34d399">+${formatMoney(r.amount)}</td>
     </tr>`;
  }).join("");
}

function renderMonthlyTable() {
  const tbody = el("monthlyTableBody");
  if (!tbody) return;
  const map = {};
  (state.loans || []).forEach(loan => {
    const key = getMonthKey(loan.startDate);
    if (!key) return;
    if (!map[key]) map[key] = { loansOut: 0, in: 0 };
    map[key].loansOut += Number(loan.amount || 0);
  });
  (state.repayments || []).forEach(r => {
    const key = getMonthKey(r.date);
    if (!key) return;
    if (!map[key]) map[key] = { loansOut: 0, in: 0 };
    map[key].in += Number(r.amount || 0);
  });
  const keys = Object.keys(map).sort().reverse();
  tbody.innerHTML = keys.map(key => {
    const row = map[key];
    const net = row.in - row.loansOut;
    const [y, m] = key.split("-");
    const dateLabel = new Date(y, m-1).toLocaleDateString("en-ZM", { month: 'short', year: 'numeric' });
    return `
    <tr>
      <td data-label="Month">${dateLabel}</td>
      <td data-label="Loans Out">${formatMoney(row.loansOut)}</td>
      <td data-label="Money In">${formatMoney(row.in)}</td>
      <td data-label="Sales">-</td>
      <td data-label="Net Flow" style="color:${net >= 0 ? '#34d399' : '#f87171'}">${formatMoney(net)}</td>
    </tr>`;
  }).join("");
}

function renderClientsTable() {
  const tbody = el("clientsTableBody");
  if (!tbody) return;
  const clientMap = {};
  (state.loans || []).forEach(loan => {
    const name = (loan.clientName || "Unknown").trim();
    if (!clientMap[name]) {
        clientMap[name] = { name: name, phone: loan.clientPhone, loans: [], defaults: 0, overdues: 0 };
    }
    clientMap[name].loans.push(loan);
    if (loan.status === "DEFAULTED") clientMap[name].defaults++;
    if (loan.status === "OVERDUE") clientMap[name].overdues++;
  });

  const clientRows = Object.values(clientMap).map(c => {
    const borrowed = c.loans.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const paid = c.loans.reduce((s, l) => s + (Number(l.paid) || 0), 0);
    const balance = c.loans.reduce((s, l) => s + (Number(l.balance) || 0), 0);
    const activeCount = c.loans.filter(l => l.status === "ACTIVE" || l.status === "OVERDUE").length;
    let score = 100;
    score -= (c.defaults * 50);
    score -= (c.overdues * 15);
    let stars = "⭐⭐⭐⭐⭐";
    let ratingColor = "#4ade80";
    if (score < 50) { stars = "⚠️ RISKY"; ratingColor = "#ef4444"; }
    else if (score < 70) { stars = "⭐⭐"; ratingColor = "#fbbf24"; }
    else if (score < 90) { stars = "⭐⭐⭐"; ratingColor = "#facc15"; }
    else if (score < 100) { stars = "⭐⭐⭐⭐"; ratingColor = "#a3e635"; }
    return { ...c, borrowed, paid, balance, activeCount, stars, ratingColor };
  });

  tbody.innerHTML = clientRows.map(c => {
    const statusHtml = c.activeCount > 0
        ? '<span class="status-pill status-active">Active</span>'
        : '<span class="status-pill status-paid">Clear</span>';
    return `
    <tr>
      <td data-label="Client">
        <div style="font-weight:bold;">${c.name}</div>
        <div style="font-size:0.75rem; color:${c.ratingColor}; margin-top:2px;">${c.stars}</div>
      </td>
      <td data-label="Phone">${c.phone||"-"}</td>
      <td data-label="History">
        <div style="font-size:0.8rem;">${c.loans.length} Loans</div>
        <div style="font-size:0.7rem; opacity:0.7;">${c.defaults} Defaults</div>
      </td>
      <td data-label="Borrowed">${formatMoney(c.borrowed)}</td>
      <td data-label="Paid">${formatMoney(c.paid)}</td>
      <td data-label="Balance" style="${c.balance > 0 ? 'color:var(--primary); font-weight:bold;' : ''}">${formatMoney(c.balance)}</td>
      <td data-label="Status">${statusHtml}</td>
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
    <td data-label="Phone">${a.phone||'-'}</td>
  </tr>`).join("");
}

// ==========================================
// 8. MOBILE UX
// ==========================================
function vibrate(pattern = [15]) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function setupMobileUX() {
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = el("installAppBtn");
    if (btn) {
      btn.style.display = "inline-flex";
      btn.addEventListener('click', () => {
        vibrate([30]);
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

  let longPressTimer;
  const touchDuration = 800;
  document.addEventListener("touchstart", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const idCell = row.querySelector("td[data-label='ID'] span");
    if (!idCell) return;
    const idText = idCell.textContent.replace('#', '');
    const loanId = parseInt(idText);
    if (loanId) {
      longPressTimer = setTimeout(() => {
        vibrate([40, 40]);
        openActionModal("PAY", loanId);
      }, touchDuration);
    }
  }, { passive: true });

  document.addEventListener("touchend", () => clearTimeout(longPressTimer));
  document.addEventListener("touchmove", () => clearTimeout(longPressTimer));

  function checkIosInstall() {
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isStandalone = window.navigator.standalone === true;
    if (isIos && !isStandalone) {
        setTimeout(() => {
            const modal = document.getElementById("iosInstallModal");
            if(modal) modal.classList.remove("modal-hidden");
        }, 2000);
    }
  }
  document.getElementById("closeIosModalBtn")?.addEventListener("click", () => {
    document.getElementById("iosInstallModal").classList.add("modal-hidden");
  });
  checkIosInstall();
}

// --- NEW: Toggle between Dashboard and Loans tabs ---
// This function is now explicitly attached to window to ensure clickability
window.switchOverviewTab = function(tabName, btnElement) {
  // 1. Haptic Feedback (Mobile feel)
  if (typeof vibrate === "function") vibrate([15]);

  // 2. Get Sections
  const dash = document.getElementById("tab-dashboard");
  const loans = document.getElementById("tab-loans");

  // 3. Reset Classes (to allow re-animation)
  if(dash) { dash.style.display = "none"; dash.classList.remove("animate-in"); }
  if(loans) { loans.style.display = "none"; loans.classList.remove("animate-in"); }

  // 4. Show & Animate Target
  const target = document.getElementById("tab-" + tabName);
  if (target) {
    target.style.display = "block";
    // Small delay to trigger animation
    setTimeout(() => target.classList.add("animate-in"), 10);
  }

  // 5. Update Buttons (Visual Pop)
  const buttons = document.querySelectorAll(".sketch-btn");
  buttons.forEach(b => b.classList.remove("active"));
  if (btnElement) btnElement.classList.add("active");
};


// --- NEW MODAL CONTROLS ---

// Used by the bottom nav buttons to open sections as popups
window.openPopup = function(id) {
    // 1. Close other popups first (optional, but cleaner)
    window.closeAllModals();

    // 2. Open the requested one
    const modal = document.getElementById(id);
    if(modal) {
        modal.classList.remove("modal-hidden");
        // Haptic feedback
        if (typeof vibrate === "function") vibrate([15]);
    }
}

window.closePopup = function(id) {
    const modal = document.getElementById(id);
    if(modal) modal.classList.add("modal-hidden");
}

window.closeAllModals = function() {
    // Closes Monthly, Clients, Admins
    ['monthlyModal', 'clientsModal', 'adminsModal'].forEach(id => {
        const m = document.getElementById(id);
        if(m) m.classList.add("modal-hidden");
    });
    // Haptic for "Overview" button
    if (typeof vibrate === "function") vibrate([10]);
}

// ==========================================
// 9. INIT
// ==========================================
function init() {

  // NOTE: Bottom Nav click listeners are now inline in HTML (onclick="...")
  // This simplifies the logic significantly.

  el("openLoanModalBtn")?.addEventListener("click", () => {
    if (typeof vibrate === "function") vibrate([10]);
    wizardStep=0;
    wizardDraft={};
    updateWizard();
    el("loanModal").classList.remove("modal-hidden");
  });

  el("modalCloseBtn")?.addEventListener("click", () => el("loanModal").classList.add("modal-hidden"));
  el("modalNextBtn")?.addEventListener("click", () => {
      if (typeof vibrate === "function") vibrate([10]);
      handleWizardNext();
  });
  el("modalBackBtn")?.addEventListener("click", () => {
      if (typeof vibrate === "function") vibrate([10]);
      handleWizardBack();
  });

  el("actionModalCloseBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));
  el("actionModalCancelBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));

  el("actionModalConfirmBtn")?.addEventListener("click", () => {
     if (typeof vibrate === "function") vibrate([20]);
     const loan = state.loans.find(l => l.id === currentLoanId);
     if (currentAction === "PAY" && loan) {
        const inputAmt = Number(el("actAmount").value);
        const maxPay = loan.balance;
        const safeAmt = Math.min(inputAmt, maxPay);
        if (safeAmt > 0) {
            loan.paid = (loan.paid || 0) + safeAmt;
            state.repayments.unshift({
                id: generateRepaymentId(),
                loanId: loan.id,
                amount: safeAmt,
                date: el("actDate").value,
                recordedBy: state.user ? (state.user.email || "Admin") : "System"
            });
        }
     }
     else if (currentAction === "NOTE" && loan) {
        loan.notes = el("actNote").value;
     }
     else if (currentAction === "WRITEOFF" && loan) {
        loan.isDefaulted = true;
        loan.status = "DEFAULTED";
        const reason = el("actNote").value;
        if(reason) loan.notes = (loan.notes ? loan.notes + "\n" : "") + "[Write-Off]: " + reason;
     }
     saveState();
     refreshUI();
     el("actionModal").classList.add("modal-hidden");
     if (currentAction === "PAY") showToast("Payment recorded!", "success");
     else if (currentAction === "WRITEOFF") showToast("Loan written off as Bad Debt", "error");
     else showToast("Note updated!", "success");
  });

  document.querySelectorAll('.mini-tab').forEach(b => {
      b.addEventListener('click', () => {
          if (typeof vibrate === "function") vibrate([10]);
          document.querySelectorAll('.mini-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          b.classList.add('active');
          el(b.dataset.target).classList.add('active');
      });
  });

  el("setStartingCapitalBtn")?.addEventListener("click", () => {
      const val = Number(el("startingCapitalInitial").value);
      if (val > 0) { state.startingCapital = val; state.startingCapitalSetDate = new Date().toISOString(); saveState(); refreshUI(); }
  });

  el("addCapitalBtn")?.addEventListener("click", () => {
      const input = el("addCapitalInput");
      const val = Number(input.value);
      if (val <= 0) {
          showToast("Enter a valid positive amount", "error");
          return;
      }
      state.capitalTxns.unshift({ id: generateCapitalTxnId(), amount: val, date: new Date().toISOString(), note: "Manual Add" });
      input.value = "";
      saveState(); refreshUI();
      showToast("Capital added successfully!", "success");
  });

  el("fabAddBtn")?.addEventListener("click", () => {
    if (typeof vibrate === "function") vibrate([20]);
    wizardStep=0;
    wizardDraft={};
    updateWizard();
    el("loanModal").classList.remove("modal-hidden");
  });

  el("exportBtn")?.addEventListener("click", () => {
     if (typeof vibrate === "function") vibrate([20]);
     try {
       const loansData = state.loans.map(l => ({
           ID: l.id,
           Client: l.clientName,
           Phone: l.clientPhone,
           Amount: l.amount,
           Plan: l.plan,
           Start: l.startDate ? l.startDate.split('T')[0] : '-',
           Due: l.dueDate ? l.dueDate.split('T')[0] : '-',
           Balance: l.balance,
           Status: l.status
       }));
       const ws = XLSX.utils.json_to_sheet(loansData);
       const wb = XLSX.utils.book_new();
       XLSX.utils.book_append_sheet(wb, ws, "Loans");
       XLSX.writeFile(wb, "Stallz_Loans.xlsx");
     } catch (e) {
         showToast("Export failed. Check internet connection.", "error");
         console.error(e);
     }
  });

  ["searchInput", "statusFilter", "planFilter"].forEach(id => el(id)?.addEventListener("input", renderLoansTable));

  checkTimeBasedTheme();
  setInterval(checkTimeBasedTheme, 60000);

  showWelcomeScreen();
  checkAppVersion();
  setupMobileUX();
}

document.addEventListener("DOMContentLoaded", init);

// NOTE: setActiveView function removed as it is no longer used.
// updateWizard(), handleWizardNext(), etc. remain the same.