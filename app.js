// ==========================================
// APP VERSION CONTROL
// ==========================================
const APP_VERSION = "2.1"; // Updated for Sidebar Menu


// ==========================================
// 1. FIREBASE CONFIGURATION & SETUP
// ==========================================

const TEST_MODE = true;
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
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((error) => console.error("Auth Persistence Error:", error));

    db = firebase.database();
    dataRef = db.ref("loanManagerData_v5");
  } else {
    console.warn("Firebase SDK not loaded.");
  }
} catch (e) {
  console.error("Firebase Init Error:", e);
}

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

function el(id) { return document.getElementById(id); }

function getLocalDateVal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function checkTimeBasedTheme() {
  // Check for override first
  const override = localStorage.getItem("stallz_theme_override");
  const themeLabel = el("menuThemeLabel");

  if (override) {
      document.documentElement.setAttribute("data-theme", override);
      if(themeLabel) themeLabel.textContent = override === "light" ? "Light" : "Dark";
      return;
  }

  // Fallback to time
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 18;
  const theme = isDay ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute("content", isDay ? "#f1f5f9" : "#0f172a");

  if(themeLabel) themeLabel.textContent = "Auto";
}

function formatWhatsApp(phone) {
  if (!phone) return "";
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '260' + p.substring(1);
  if (p.length === 9) p = '260' + p;
  return p;
}

function updateWelcomeUI() {
  if (!state.user || !state.user.email) return;
  let displayName = state.user.email.split('@')[0];
  if (state.admins && state.admins.length > 0) {
      const adminProfile = state.admins.find(a => a.email && a.email.toLowerCase() === state.user.email.toLowerCase());
      if (adminProfile && adminProfile.name) displayName = adminProfile.name.split(' ')[0];
  }
  const formattedName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  // Sidebar Name Update
  if(el("sidebarUserName")) el("sidebarUserName").textContent = formattedName;

  const hour = new Date().getHours();
  let greeting = hour < 12 ? "Good Morning" : (hour < 18 ? "Good Afternoon" : "Good Evening");
  const msg = `${greeting}, ${formattedName}`;
  const pc = el("welcomeDesktop");
  const mob = el("welcomeMobile");
  if(pc) pc.textContent = msg;
  if(mob) mob.textContent = msg;
}

function showToast(message, type = "success") {
  const container = el("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  vibrate(type === "error" ? [30,30] : [20]);
  setTimeout(() => {
    toast.style.animation = "toastFadeOut 0.4s forwards";
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

function updateSessionActivity() { localStorage.setItem("stallz_last_active", Date.now()); }
document.addEventListener("click", updateSessionActivity);
document.addEventListener("touchstart", updateSessionActivity);

function checkAppVersion() {
  const storedVersion = localStorage.getItem("stallz_app_version");
  const display = el("menuVersion");
  if(display) display.textContent = APP_VERSION;

  if (storedVersion !== APP_VERSION) {
    localStorage.removeItem("stallz_test_session");
    localStorage.setItem("stallz_app_version", APP_VERSION);
    setTimeout(() => showToast(`App Updated to v${APP_VERSION}`, "success"), 1500);
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
    if (progress < 1) window.requestAnimationFrame(step);
    else obj.innerHTML = formatMoney(end);
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

window.setFilter = function(type, value, btnElement) {
  vibrate([15]);
  activeFilters[type] = value;
  const parent = btnElement.parentElement;
  if (parent) {
    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btnElement.classList.add('active');
  }
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
  const mainApp = el("mainAppShell");

  if (loginBtn) {
    const newBtn = loginBtn.cloneNode(true);
    loginBtn.parentNode.replaceChild(newBtn, loginBtn);
    newBtn.onclick = async () => {
      const email = el("loginEmail").value.trim();
      const password = el("loginPassword").value.trim();
      if (!email || !password) {
        errorMsg.textContent = "Please enter both email and password.";
        vibrate([50, 50]);
        return;
      }
      if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }

      if (TEST_MODE) {
        setTimeout(() => {
          localStorage.setItem("stallz_test_session", "true");
          state.user = { email: email || "test@admin.com", uid: "test-user-123" };
          state.isLoggedIn = true;
          updateSessionActivity();
          screen.style.display = "none";
          mainApp.style.display = "block";
          loadFromFirebase();
          updateWelcomeUI();
          showToast(`Welcome back!`, "success");
        }, 800);
        return;
      }

      try {
        if (typeof firebase === "undefined") throw new Error("Firebase not loaded");
        await firebase.auth().signInWithEmailAndPassword(email, password);
        updateSessionActivity();
        updateWelcomeUI();
        showToast(`Login Successful`, "success");
      } catch (error) {
        if (loader) { loader.style.opacity = "0"; setTimeout(() => loader.style.display = "none", 300); }
        errorMsg.textContent = "Login failed: " + error.message;
        vibrate([50, 50, 50]);
      }
    };
  }

  // Session Check
  const lastActive = localStorage.getItem("stallz_last_active");
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;

  if (lastActive && (now - lastActive > THIRTY_MINUTES)) {
    handleLogout();
    return;
  }

  const testSession = localStorage.getItem("stallz_test_session");
  if (TEST_MODE) {
    if (testSession === "true") {
       state.user = { email: "test@admin.com", uid: "test-user-123" };
       state.isLoggedIn = true;
       updateSessionActivity();
       screen.style.display = "none";
       mainApp.style.display = "block";
       loadFromFirebase();
    } else {
       screen.style.display = "flex";
       mainApp.style.display = "none";
       if (loader) { loader.style.opacity = "0"; setTimeout(() => loader.style.display = "none", 300); }
    }
  }
  else if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          updateSessionActivity();
          state.user = user;
          state.isLoggedIn = true;
          screen.style.display = "none";
          mainApp.style.display = "block";
          loadFromFirebase();
        } else {
          screen.style.display = "flex";
          mainApp.style.display = "none";
          if (loader) { loader.style.opacity = "0"; setTimeout(() => loader.style.display = "none", 300); }
        }
      });
  } else {
      screen.style.display = "flex";
      mainApp.style.display = "none";
      if (loader) { loader.style.opacity = "0"; setTimeout(() => loader.style.display = "none", 300); }
  }
}

function handleLogout() {
    if (typeof firebase !== "undefined" && firebase.auth) firebase.auth().signOut();
    localStorage.removeItem("stallz_last_active");
    localStorage.removeItem("stallz_test_session");
    window.location.reload();
}

function loadFromFirebase() {
  setTimeout(() => {
      const loader = el("loadingOverlay");
      if (loader && loader.style.display !== "none") {
          loader.style.display = "none";
          if (!state.dataLoaded) {
              showToast("Connection slow. Loaded in Offline Mode.", "error");
              applyData({ loans: [], nextId: 1, admins: [] });
          }
      }
  }, 8000);

  if (TEST_MODE) {
    setTimeout(() => {
      try {
        const localData = localStorage.getItem("stallz_test_data");
        let parsed = localData ? JSON.parse(localData) : null;
        if (!parsed) parsed = { loans: [], nextId: 1, admins: [{ id: 1, name: "Test Owner", email: "test@admin.com", role: "Owner" }] };
        applyData(parsed);
      } catch(e) {
          applyData({ loans: [], nextId: 1, admins: [] });
      }
    }, 500);
    return;
  }

  if (!dataRef) { applyData({}); return; }
  dataRef.on("value", (snapshot) => {
    isSafeToSave = true;
    applyData(snapshot.val() || {});
  });
}

function applyData(parsed) {
  const loader = el("loadingOverlay");
  if (loader) loader.style.display = "none";
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
  refreshUI();
  updateWelcomeUI();
}

function saveState() {
  if (!state.dataLoaded) return;
  if (!isSafeToSave && !TEST_MODE) {
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
    if (dataRef) dataRef.set(payload).catch((e) => showToast("Save Failed: Check Connection", "error"));
  }
}

// ==========================================
// 6. UI RENDERING
// ==========================================
function refreshUI() {
  try { recomputeAllLoans(); } catch(e) {}
  const attentionCount = (state.loans || []).filter(l => l.status === "OVERDUE").length;
  const navBadge = document.getElementById("clientAlertBadge");
  if (navBadge) {
      if (attentionCount > 0) navBadge.classList.add("show");
      else navBadge.classList.remove("show");
  }
  renderDashboard();
  renderLoansTable();
  renderRepaymentsTable();
  renderMonthlyTable();
  renderClientsTable();
  renderAdminsTable();
}

function renderDashboard() {
  const container = el("dashboardStats");
  if (!container) return;
  const loans = state.loans || [];
  const totalLoaned = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => { if (l.status === "DEFAULTED") return s; return s + Math.max(0, l.balance || 0); }, 0);
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
          if(el("startingCapitalInfoValue")) el("startingCapitalInfoValue").textContent = formatMoney(state.startingCapital);
      }
      if(el("startingCapitalValue")) el("startingCapitalValue").textContent = formatMoney(state.startingCapital);
  } else {
      if(el("startingCapitalSetupRow")) el("startingCapitalSetupRow").style.display = "block";
      if(el("startingCapitalInfoRow")) el("startingCapitalInfoRow").style.display = "none";
      if(el("startingCapitalValue")) el("startingCapitalValue").textContent = "Not set";
  }

  const capBody = el("capitalTableBody");
  if(capBody) {
     capBody.innerHTML = (state.capitalTxns || []).map(t => `<tr><td>${formatDate(t.date)}</td><td>${formatMoney(t.amount)}</td><td class="subtle">${t.note || '-'}</td></tr>`).join("");
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
    </div>`;
  animateValue(el("statLoaned"), 0, totalLoaned, 1500);
  animateValue(el("statOutstanding"), 0, totalOutstanding, 2000);
  animateValue(el("statProfit"), 0, totalProfit, 2500);
}

function renderLoansTable() {
  recomputeAllLoans();
  const tbody = document.getElementById("loansTableBody");
  if (!tbody) return;
  const search = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const statusFilter = activeFilters.status;
  const planFilter = activeFilters.plan;
  const visibleLoans = (state.loans || []).filter(l => {
     const matchSearch = !search || (l.clientName && l.clientName.toLowerCase().includes(search)) || (l.id && l.id.toString().includes(search));
     const matchStatus = statusFilter === "All" || l.status === statusFilter;
     const matchPlan = planFilter === "All" || l.plan === planFilter;
     return matchSearch && matchStatus && matchPlan;
  });
  if (document.getElementById("loansCountLabel")) document.getElementById("loansCountLabel").textContent = `${visibleLoans.length} records`;
  if(document.getElementById("emptyState")) {
      const shouldShow = visibleLoans.length === 0;
      document.getElementById("emptyState").style.display = shouldShow ? "block" : "none";
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
    const isClosed = l.status === "PAID" || l.status === "DEFAULTED";
    const waNumber = formatWhatsApp(l.clientPhone);
    const waMsg = encodeURIComponent(`Hi ${l.clientName}, reminder: Balance of ${formatMoney(l.balance)} was due on ${formatDate(l.dueDate)}.`);
    const waLink = waNumber ? `https://wa.me/${waNumber}?text=${waMsg}` : "#";
    const waStyle = waNumber ? "color:#4ade80;" : "color:#64748b; cursor:not-allowed;";
    return `
    <tr class="row-${(l.status || 'active').toLowerCase()}">
      <td data-label="ID"><span style="opacity:0.5; font-size:0.8rem;">#${l.id}</span></td>
      <td data-label="Client">
        <div class="client-flex">
          <div class="avatar ${avatarClass}">${getInitials(l.clientName)}</div>
          <div><div style="font-weight:600; color:var(--text-main);">${l.clientName}</div><div class="subtle" style="font-size:0.75rem;">${l.clientPhone||''}</div></div>
        </div>
      </td>
      <td data-label="Item"><span style="color:var(--text-muted);">${l.collateralItem || '-'}</span></td>
      <td data-label="Progress">
        <div style="min-width: 100px;">
          <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:4px;"><span>${percent}%</span><span>${formatMoney(l.paid)} / ${formatMoney(l.totalDue)}</span></div>
          <div style="background:rgba(255,255,255,0.1); height:6px; border-radius:4px; overflow:hidden;"><div style="width:${percent}%; background:${progressColor}; height:100%; border-radius:4px; transition: width 1s ease;"></div></div>
        </div>
      </td>
      <td data-label="Start">${formatDate(l.startDate)}</td>
      <td data-label="Due">${formatDate(l.dueDate)}</td>
      <td data-label="Balance" ${balanceStyle}>${formatMoney(l.balance)}</td>
      <td data-label="Status"><span class="status-pill status-${(l.status||'active').toLowerCase()}">${l.status}</span></td>
      <td data-label="Actions" style="text-align:right; white-space:nowrap;">
        <button class="btn-icon" onclick="openReceipt(${l.id})" title="Print Receipt">🖨️</button>
        <a href="${waLink}" target="_blank" class="btn-icon" style="${waStyle}; text-decoration:none; display:inline-flex;" title="WhatsApp">💬</a>
        <button class="btn-icon" onclick="openActionModal('PAY', ${l.id})" title="Pay" style="color:#38bdf8;" ${isClosed ? 'disabled style="opacity:0.3"' : ''}>💳</button>
        <button class="btn-icon" onclick="openActionModal('WRITEOFF', ${l.id})" title="Bad Debt" style="color:#f87171;" ${isClosed ? 'disabled style="opacity:0.3"' : ''}>🗑️</button>
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
     return `<tr><td data-label="Date">${formatDate(r.date)}</td><td data-label="Loan ID">#${r.loanId}</td><td data-label="Client">${loan ? loan.clientName : 'Deleted'}</td><td data-label="Recorder">${r.recordedBy||'System'}</td><td data-label="Amount" style="color:#34d399">+${formatMoney(r.amount)}</td></tr>`;
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
    return `<tr><td data-label="Month">${dateLabel}</td><td data-label="Loans Out">${formatMoney(row.loansOut)}</td><td data-label="Money In">${formatMoney(row.in)}</td><td data-label="Sales">-</td><td data-label="Net Flow" style="color:${net >= 0 ? '#34d399' : '#f87171'}">${formatMoney(net)}</td></tr>`;
  }).join("");
}

function renderClientsTable() {
  const tbody = el("clientsTableBody");
  if (!tbody) return;
  const clientMap = {};
  (state.loans || []).forEach(loan => {
    const name = (loan.clientName || "Unknown").trim();
    if (!clientMap[name]) clientMap[name] = { name: name, phone: loan.clientPhone, loans: [], defaults: 0, overdues: 0 };
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
    let statusHtml = '';
    if (c.overdues > 0) statusHtml = '<span class="status-pill status-overdue" style="animation:pulseRed 1.5s infinite;">⚠️ Action Needed</span>';
    else if (c.activeCount > 0) statusHtml = '<span class="status-pill status-active">Active</span>';
    else statusHtml = '<span class="status-pill status-paid">Clear</span>';
    const nameAlert = c.overdues > 0 ? '<span style="color:#ef4444; margin-left:6px; font-size:1.2rem; line-height:0; position:relative; top:2px;">•</span>' : '';
    return `<tr><td data-label="Client"><div style="font-weight:bold;">${c.name} ${nameAlert}</div><div style="font-size:0.75rem; color:${c.ratingColor}; margin-top:2px;">${c.stars}</div></td><td data-label="Phone">${c.phone||"-"}</td><td data-label="History"><div style="font-size:0.8rem;">${c.loans.length} Loans</div><div style="font-size:0.7rem; opacity:0.7;">${c.defaults} Defaults</div></td><td data-label="Borrowed">${formatMoney(c.borrowed)}</td><td data-label="Paid">${formatMoney(c.paid)}</td><td data-label="Balance" style="${c.balance > 0 ? 'color:var(--primary); font-weight:bold;' : ''}">${formatMoney(c.balance)}</td><td data-label="Status">${statusHtml}</td></tr>`;
  }).join("");
}

function renderAdminsTable() {
  const tbody = el("adminsTableBody");
  if (!tbody) return;
  tbody.innerHTML = (state.admins || []).map(a => `<tr><td data-label="ID">#${a.id}</td><td data-label="Name">${a.name}</td><td data-label="Role">${a.role}</td><td data-label="Phone">${a.phone||'-'}</td></tr>`).join("");
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
    if(step.placeholder) input.placeholder = step.placeholder;
    input.setAttribute("autocomplete", "off");

    if (step.key === "clientName") {
       input.setAttribute("list", "clientList");
       const uniqueClients = [...new Set(state.loans.map(l => l.clientName))].sort();
       const dataList = document.getElementById("clientList");
       if(dataList) dataList.innerHTML = uniqueClients.map(name => `<option value="${name}">`).join("");
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
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterdayStr = y.toISOString().split('T')[0];
    chipContainer.appendChild(createChip("Yesterday", yesterdayStr));

    container.appendChild(chipContainer);
  }

  setTimeout(() => input.focus(), 100);

  el("modalBackBtn").style.visibility = wizardStep === 0 ? "hidden" : "visible";
  el("modalNextBtn").textContent = wizardStep === LOAN_STEPS.length - 1 ? "Finish & Save" : "Next →";
}

function handleWizardNext() {
  const step = LOAN_STEPS[wizardStep];
  const input = el("wizardInput");
  const val = input.value.trim();

  if (step.required && !val) {
    input.style.border = "1px solid #ef4444";
    setTimeout(() => input.style.border = "", 2000);
    return;
  }
  wizardDraft[step.key] = val;

  if (wizardStep < LOAN_STEPS.length - 1) {
    wizardStep++;
    updateWizard("next");
  } else {
    saveNewLoan();
  }
}

function handleWizardBack() {
  if (wizardStep > 0) {
    wizardStep--;
    updateWizard("back");
  }
}

function saveNewLoan() {
  const newLoan = {
    id: generateLoanId(),
    ...wizardDraft,
    amount: Number(wizardDraft.amount),
    collateralValue: Number(wizardDraft.collateralValue || 0),
    customInterest: wizardDraft.customInterest ? Number(wizardDraft.customInterest) : null,
    paid: 0, saleAmount: 0, isDefaulted: false,
    createdBy: "Admin", createdAt: new Date().toISOString(),
    history: []
  };

  state.loans.unshift(newLoan);
  saveState();
  el("loanModal").classList.add("modal-hidden");
  wizardStep = 0; wizardDraft = {};
  refreshUI();
  showToast("Loan created successfully!", "success");
}

window.openActionModal = function(action, loanId) {
  currentAction = action;
  currentLoanId = loanId;
  const loan = state.loans.find(l => l.id === loanId);
  if(!loan) return;

  el("actionModal").classList.remove("modal-hidden");
  const body = el("actionModalBody");
  const title = el("actionModalTitle");

  if (action === "PAY") {
    title.textContent = "Record Payment";
    body.innerHTML = `
      <div class="field"><label>Amount</label><input type="number" id="actAmount" value="${Math.ceil(loan.balance)}"></div>
      <div class="field"><label>Date</label><input type=\"date\" id=\"actDate\" value=\"${getLocalDateVal()}\"></div>
    `;
  } else if (action === "NOTE") {
    title.textContent = "Edit Note";
    body.innerHTML = `<div class="field"><label>Note</label><textarea id="actNote">${loan.notes||''}</textarea></div>`;
  } else if (action === "WRITEOFF") {
    title.textContent = "Write Off Loan";
    body.innerHTML = `
      <div style="background:rgba(239, 68, 68, 0.1); border:1px solid #ef4444; padding:12px; border-radius:8px; color:#fca5a5;">
        <strong>⚠️ Warning:</strong> You are about to mark this loan as <strong>Bad Debt</strong>.
        <br><br>
        This will stop the timer and remove the balance from your "Outstanding" assets. This action is final.
      </div>
      <div class="field" style="margin-top:16px;"><label>Reason (Optional)</label><textarea id="actNote" placeholder="e.g. Client relocated, uncontactable..."></textarea></div>
    `;
  }
}

function setupMobileUX() {
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = el("menuInstallBtn"); // Updated for Sidebar
    if (btn) {
      btn.style.display = "flex";
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
  document.addEventListener("touchstart", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const idCell = row.querySelector("td[data-label='ID'] span");
    if (!idCell) return;
    const idText = idCell.textContent.replace('#', '');
    const loanId = parseInt(idText);
    if (loanId) {
      longPressTimer = setTimeout(() => { vibrate([40, 40]); openActionModal("PAY", loanId); }, 800);
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
  document.getElementById("closeIosModalBtn")?.addEventListener("click", () => document.getElementById("iosInstallModal").classList.add("modal-hidden"));
  checkIosInstall();
}

window.switchOverviewTab = function(tabName, btnElement) {
  vibrate([15]);
  const dash = document.getElementById("tab-dashboard");
  const loans = document.getElementById("tab-loans");
  if(dash) { dash.style.display = "none"; dash.classList.remove("animate-in"); }
  if(loans) { loans.style.display = "none"; loans.classList.remove("animate-in"); }
  const target = document.getElementById("tab-" + tabName);
  if (target) {
    target.style.display = "block";
    setTimeout(() => target.classList.add("animate-in"), 10);
  }
  const buttons = document.querySelectorAll(".sketch-btn");
  buttons.forEach(b => b.classList.remove("active"));
  if (btnElement) btnElement.classList.add("active");
};

function updateNavHighlight(activeBtnId) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('nav-btn-active'));
    const targetBtn = document.getElementById(activeBtnId);
    if (targetBtn) targetBtn.classList.add('nav-btn-active');
}

window.openPopup = function(modalId) {
    window.closeAllModals(false);
    const modal = document.getElementById(modalId);
    if(modal) {
        modal.classList.remove("modal-hidden");
        vibrate([15]);
    }
    if (modalId === 'monthlyModal') updateNavHighlight('navMonthlyBtn');
    if (modalId === 'clientsModal') updateNavHighlight('navClientsBtn');
    if (modalId === 'adminsModal')  updateNavHighlight('navAdminsBtn');
}

window.closePopup = function(id) {
    const modal = document.getElementById(id);
    if(modal) modal.classList.add("modal-hidden");
    updateNavHighlight('navMainBtn');
}

window.closeAllModals = function(resetNav = true) {
    ['monthlyModal', 'clientsModal', 'adminsModal'].forEach(id => {
        const m = document.getElementById(id);
        if(m) m.classList.add("modal-hidden");
    });
    if (resetNav) {
        updateNavHighlight('navMainBtn');
        vibrate([10]);
    }
}

// ==========================================
// 8. SIDEBAR MENU LOGIC
// ==========================================
function toggleSidebar(open) {
    const sidebar = el("appSidebar");
    const backdrop = el("sidebarBackdrop");
    if (open) {
        sidebar.classList.add("active");
        backdrop.classList.add("active");
        updateSettingsBadges();
        vibrate([10]);
    } else {
        sidebar.classList.remove("active");
        backdrop.classList.remove("active");
    }
}

function updateSettingsBadges() {
    // Theme Badge
    const theme = localStorage.getItem("stallz_theme_override") || "Auto";
    const themeLabel = theme === "light" ? "Light" : (theme === "dark" ? "Dark" : "Auto");
    if(el("menuThemeBadge")) el("menuThemeBadge").textContent = themeLabel;

    // Sound Badge
    const sound = localStorage.getItem("stallz_sound_enabled") !== "false";
    if(el("menuSoundBadge")) el("menuSoundBadge").textContent = sound ? "On" : "Off";

    // User Name
    if(state.user && state.user.email && el("sidebarName")) {
        el("sidebarName").textContent = state.user.email.split("@")[0];
    }
}

function toggleTheme() {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme") || "dark";
    const newTheme = current === "light" ? "dark" : "light";
    root.setAttribute("data-theme", newTheme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = newTheme === "light" ? "#f1f5f9" : "#0f172a";
    localStorage.setItem("stallz_theme_override", newTheme);
    updateSettingsBadges();
    vibrate([10]);
}

function toggleSound() {
    const current = localStorage.getItem("stallz_sound_enabled") !== "false";
    const newState = !current;
    localStorage.setItem("stallz_sound_enabled", newState);
    updateSettingsBadges();
    if(newState) vibrate([30]);
}

// Updated Vibrate Function (Checks preference)
function vibrate(pattern) {
    if (localStorage.getItem("stallz_sound_enabled") === "false") return;
    if (navigator.vibrate) navigator.vibrate(pattern);
}

// ==========================================
// 9. INIT
// ==========================================
function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');
  if (action === 'new_loan') setTimeout(() => { const btn = el("openLoanModalBtn"); if (btn) btn.click(); }, 800);
  else if (action === 'dashboard') setTimeout(() => { const btn = document.querySelector("button[onclick*='switchOverviewTab'][onclick*='dashboard']"); if (btn) btn.click(); }, 800);

  // --- NEW: SIDEBAR LISTENERS ---
  el("menuToggleBtn")?.addEventListener("click", () => toggleSidebar(true));
  el("sidebarCloseBtn")?.addEventListener("click", () => toggleSidebar(false));
  el("sidebarBackdrop")?.addEventListener("click", () => toggleSidebar(false));

  el("menuThemeBtn")?.addEventListener("click", toggleTheme);
  el("menuSoundBtn")?.addEventListener("click", toggleSound);

  el("menuLogoutBtn")?.addEventListener("click", () => {
      toggleSidebar(false);
      setTimeout(() => {
          if(confirm("Are you sure you want to log out?")) handleLogout();
      }, 200);
  });

  el("menuExportBtn")?.addEventListener("click", () => {
     toggleSidebar(false);
     vibrate([20]);
     if (typeof window.XLSX === "undefined") { showToast("Export library missing. Check internet.", "error"); return; }
     try {
       const loansData = state.loans.map(l => ({ ID: l.id, Client: l.clientName, Phone: l.clientPhone, Amount: l.amount, Plan: l.plan, Start: l.startDate ? l.startDate.split('T')[0] : '-', Due: l.dueDate ? l.dueDate.split('T')[0] : '-', Balance: l.balance, Status: l.status }));
       const ws = XLSX.utils.json_to_sheet(loansData);
       const wb = XLSX.utils.book_new();
       XLSX.utils.book_append_sheet(wb, ws, "Loans");
       XLSX.writeFile(wb, "Stallz_Loans.xlsx");
     } catch (e) { showToast("Export failed. Check console.", "error"); console.error(e); }
  });

  el("openLoanModalBtn")?.addEventListener("click", () => { vibrate([10]); wizardStep=0; wizardDraft={}; updateWizard(); el("loanModal").classList.remove("modal-hidden"); });
  el("modalCloseBtn")?.addEventListener("click", () => el("loanModal").classList.add("modal-hidden"));
  el("modalNextBtn")?.addEventListener("click", () => { vibrate([10]); handleWizardNext(); });
  el("modalBackBtn")?.addEventListener("click", () => { vibrate([10]); handleWizardBack(); });
  el("actionModalCloseBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));
  el("actionModalCancelBtn")?.addEventListener("click", () => el("actionModal").classList.add("modal-hidden"));

  el("actionModalConfirmBtn")?.addEventListener("click", () => {
     vibrate([20]);
     const loan = state.loans.find(l => l.id === currentLoanId);
     if (currentAction === "PAY" && loan) {
        const inputAmt = Number(el("actAmount").value);
        const maxPay = loan.balance;
        const safeAmt = Math.min(inputAmt, maxPay);
        if (safeAmt > 0) {
            loan.paid = (loan.paid || 0) + safeAmt;
            state.repayments.unshift({ id: generateRepaymentId(), loanId: loan.id, amount: safeAmt, date: el("actDate").value, recordedBy: state.user ? (state.user.email || "Admin") : "System" });
        }
     }
     else if (currentAction === "NOTE" && loan) { loan.notes = el("actNote").value; }
     else if (currentAction === "WRITEOFF" && loan) {
        loan.isDefaulted = true; loan.status = "DEFAULTED";
        const reason = el("actNote").value;
        if(reason) loan.notes = (loan.notes ? loan.notes + "\n" : "") + "[Write-Off]: " + reason;
     }
     saveState(); refreshUI(); el("actionModal").classList.add("modal-hidden");
     if (currentAction === "PAY") showToast("Payment recorded!", "success");
     else if (currentAction === "WRITEOFF") showToast("Loan written off as Bad Debt", "error");
     else showToast("Note updated!", "success");
  });

  document.querySelectorAll('.mini-tab').forEach(b => {
      b.addEventListener('click', () => {
          vibrate([10]);
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
      if (val <= 0) { showToast("Enter a valid positive amount", "error"); return; }
      state.capitalTxns.unshift({ id: generateCapitalTxnId(), amount: val, date: new Date().toISOString(), note: "Manual Add" });
      input.value = ""; saveState(); refreshUI(); showToast("Capital added successfully!", "success");
  });

  el("exportBtn")?.addEventListener("click", () => {
     vibrate([20]);
     if (typeof window.XLSX === "undefined") { showToast("Export library missing. Check internet.", "error"); return; }
     try {
       const loansData = state.loans.map(l => ({ ID: l.id, Client: l.clientName, Phone: l.clientPhone, Amount: l.amount, Plan: l.plan, Start: l.startDate ? l.startDate.split('T')[0] : '-', Due: l.dueDate ? l.dueDate.split('T')[0] : '-', Balance: l.balance, Status: l.status }));
       const ws = XLSX.utils.json_to_sheet(loansData);
       const wb = XLSX.utils.book_new();
       XLSX.utils.book_append_sheet(wb, ws, "Loans");
       XLSX.writeFile(wb, "Stallz_Loans.xlsx");
     } catch (e) { showToast("Export failed. Check console.", "error"); console.error(e); }
  });

  ["searchInput", "statusFilter", "planFilter"].forEach(id => el(id)?.addEventListener("input", renderLoansTable));

  checkTimeBasedTheme();
  setInterval(checkTimeBasedTheme, 60000);
  showWelcomeScreen();
  checkAppVersion();
  setupMobileUX();
}
document.addEventListener("DOMContentLoaded", init);