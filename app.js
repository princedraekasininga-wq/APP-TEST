// ==========================================
// APP VERSION CONTROL
// ==========================================
const APP_VERSION = "1.9.1"; // Force Refresh for New UI


// ==========================================
// 1. FIREBASE CONFIGURATION & SETUP
// ==========================================

const TEST_MODE = true; // ENABLED AS REQUESTED

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

function updateWelcomeUI() {
  if (!state.user || !state.user.email) return;

  // 1. Get User Name (Check Admin List first, fallback to Email)
  let displayName = state.user.email.split('@')[0]; // Default to email prefix

  // Search for the admin profile that matches the logged-in email
  if (state.admins && state.admins.length > 0) {
      const adminProfile = state.admins.find(a => a.email && a.email.toLowerCase() === state.user.email.toLowerCase());
      if (adminProfile && adminProfile.name) {
          displayName = adminProfile.name.split(' ')[0]; // Use first name only (optional)
          // To use full name instead, just use: displayName = adminProfile.name;
      }
  }

  const formattedName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  // 2. Determine Time-Based Greeting
  const hour = new Date().getHours();
  let greeting = "Welcome";
  if (hour < 12) greeting = "Good Morning";
  else if (hour < 18) greeting = "Good Afternoon";
  else greeting = "Good Evening";

  // 3. Construct Message
  const msg = `${greeting}, ${formattedName}`;

  // 4. Update UI
  const pc = document.getElementById("welcomeDesktop");
  const mob = document.getElementById("welcomeMobile");

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
  if (storedVersion !== APP_VERSION) {
    console.log("New version detected. Clearing old session.");
    localStorage.removeItem("stallz_test_session");
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

// ==========================================
// UPDATED FILTER LOGIC (Paste in Section 4)
// ==========================================

let activeFilters = { status: 'ACTIVE', plan: 'All' };

window.setFilter = function(type, value, btnElement) {
  // 1. Feedback
  if (typeof vibrate === "function") vibrate([15]);

  // 2. Update State
  activeFilters[type] = value;

  // 3. Update Visual Buttons (Remove active from siblings, add to clicked)
  const parent = btnElement.parentElement;
  if (parent) {
    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btnElement.classList.add('active');
  }

  // 4. Refresh the Table
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

  if (loginBtn) {
    // Clone button to remove old event listeners
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

      try {
        if (typeof firebase === "undefined") throw new Error("Firebase not loaded");

        // Explicitly set persistence to LOCAL before signing in
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        await firebase.auth().signInWithEmailAndPassword(email, password);

        updateSessionActivity();
        updateWelcomeUI();
        showToast(`Login Successful`, "success");
        // Screen hiding is handled by onAuthStateChanged below
      } catch (error) {
        if (loader) loader.style.display = "none";
        errorMsg.textContent = "Login failed: " + error.message;
        if (typeof vibrate === "function") vibrate([50, 50, 50]);
      }
    };
  }

  // --- CHANGED: REMOVED THE 30-MINUTE TIMEOUT CHECK HERE ---

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
      // This listener fires automatically if a user is already logged in from a previous session
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          updateSessionActivity();
          state.user = user;
          state.isLoggedIn = true;
          screen.style.display = "none";
          if (loader) { loader.style.display = "flex"; loader.style.opacity = "1"; }
          loadFromFirebase();
        } else {
          // Only show login screen if strictly no user is found
          if (loader) loader.style.display = "none";
          screen.style.display = "flex";
        }
      });
  } else {
      if (loader) loader.style.display = "none";
      screen.style.display = "flex";
  }
}

function loadFromFirebase() {
  setTimeout(() => {
      const loader = el("loadingOverlay");
      if (loader && loader.style.display !== "none") {
          console.warn("Loader timeout! Forcing UI open.");
          loader.style.display = "none";
          if (!state.dataLoaded) {
              console.log("Initializing defaults (OFFLINE/SLOW MODE)...");

              // FIXED: Removed 'isSafeToSave = false' so you can still save data even if connection is slow.
              // We want users to be able to work offline.

              showToast("Connection slow. Loaded in Offline Mode.", "error");
              applyData({ loans: [], nextId: 1, admins: [] });
          }
      }
  }, 8000); // FIXED: Increased timeout from 3500 to 8000ms to give slow networks a chance

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

  dataRef.on("value", (snapshot) => {
    isSafeToSave = true;
    applyData(snapshot.val() || {});
  });
}

function applyData(parsed) {
  const loader = el("loadingOverlay");
  if (loader) {
     loader.style.display = "none";
  }
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

  try {
      refreshUI();
      updateWelcomeUI();
  } catch(e) {
      console.error("Render error:", e);
  }
}

function saveState() {
  if (!state.dataLoaded) return;

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

window.openReceipt = function(loanId) {
  const loan = state.loans.find(l => l.id == loanId);
  if (!loan) return;

  // 1. Get Payment History
  const history = state.repayments
      .filter(r => r.loanId === loan.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

  let statusColor = "#333";
  let statusText = loan.status;
  if (loan.balance <= 0) { statusColor = "#16a34a"; statusText = "PAID IN FULL"; }
  else if (loan.status === "OVERDUE") { statusColor = "#dc2626"; }

  // 2. Build the Receipt HTML (Fixed Width Design)
  const receiptHTML = `
    <div style="font-family: 'Segoe UI', sans-serif; color: #1e293b; padding: 30px; width: 100%; box-sizing: border-box;">

        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="my-logo.png" style="height: 45px; width: auto; display:block;" onerror="this.style.display='none'">
            <div>
              <h1 style="margin: 0; font-size: 20px; color: #1e293b; text-transform: uppercase; font-weight:800; letter-spacing: 1px;">Stallz Loans</h1>
              <p style="margin: 2px 0 0; font-size: 10px; color: #64748b; font-weight:600;">Quick, Easy, Reliable</p>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: #64748b;">Receipt #: <strong style="color: #0f172a;">${loan.id}</strong></div>
            <div style="font-size: 11px; color: #64748b;">Date: <strong style="color: #0f172a;">${new Date().toLocaleDateString()}</strong></div>
            <div style="font-size: 10px; margin-top:4px; font-weight:700; color:${statusColor}; border:1px solid ${statusColor}; padding:2px 6px; border-radius:4px; display:inline-block;">${statusText}</div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #f1f5f9;">
          <div>
            <div style="font-size: 9px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 2px;">Client</div>
            <div style="font-size: 14px; font-weight: 700; color: #334155;">${loan.clientName}</div>
            <div style="font-size: 11px; color: #64748b;">${loan.clientPhone || ''}</div>
          </div>
          <div style="text-align: right;">
             <div style="font-size: 9px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 2px;">Due Date</div>
             <div style="font-size: 13px; font-weight: 700; color: ${statusColor};">${formatDate(loan.dueDate)}</div>
             <div style="font-size: 9px; color: #94a3b8; margin-top:4px;">Item: ${loan.collateralItem}</div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
          <tbody>
            <tr><td style="padding: 8px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9;">Principal</td><td style="text-align: right; padding: 8px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9;">${formatMoney(loan.amount)}</td></tr>
            <tr><td style="padding: 8px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9;">Interest/Fees</td><td style="text-align: right; padding: 8px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9;">${formatMoney(loan.totalDue - loan.amount)}</td></tr>
            <tr><td style="padding: 8px 0; font-size: 12px; font-weight:700; color:#0f172a;">Total Due</td><td style="text-align: right; padding: 8px 0; font-size: 12px; font-weight:700; color:#0f172a;">${formatMoney(loan.totalDue)}</td></tr>
            <tr><td style="padding: 8px 0; font-size: 12px; color:#16a34a;">Less: Paid</td><td style="text-align: right; padding: 8px 0; font-size: 12px; color:#16a34a;">- ${formatMoney(loan.paid)}</td></tr>
            <tr>
              <td style="padding-top: 12px; font-size: 13px; font-weight: 800; border-top: 2px solid #0f172a;">BALANCE</td>
              <td style="text-align: right; padding-top: 12px; font-size: 16px; font-weight: 800; color: ${statusColor}; border-top: 2px solid #0f172a;">${formatMoney(loan.balance)}</td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top: 20px; font-size: 8px; color: #94a3b8; text-align: justify; line-height: 1.4; border-top: 1px solid #f1f5f9; padding-top: 10px;">
           <strong>Terms & Conditions:</strong> By accepting this loan, you agree that failure to repay by the due date may result in the forfeiture and sale of the collateral item listed above to recover the loan amount.
        </div>

        ${history.length > 0 ? `
          <div style="margin-top: 20px;">
            <div style="font-size: 9px; font-weight: 700; text-transform: uppercase; color: #94a3b8; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 8px;">Recent Payments</div>
            ${history.map(h => `
              <div style="display: flex; justify-content: space-between; font-size: 10px; color: #64748b; padding: 3px 0; border-bottom: 1px dashed #f1f5f9;">
                <span>${formatDate(h.date)} &mdash; Paid</span><span>${formatMoney(h.amount)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 30px; font-size: 11px; font-weight: 600; color: #1e293b;">Thank you for your business!</div>
        <div style="margin-top: 4px; text-align: center; font-size: 9px; color: #cbd5e1;">Generated by Stallz Loans Admin</div>
    </div>
  `;

  // 3. Inject Content
  const contentBox = document.getElementById("receiptContent");
  contentBox.innerHTML = receiptHTML;

  const modal = document.getElementById("receiptModal");
  modal.classList.remove("modal-hidden");

  // 4. SMART SCALING (The Fix for Mobile)
  // 148mm is approx 560px. We check the user's screen width and shrink the receipt to fit.
  setTimeout(() => {
    const wrapper = document.getElementById("receiptWrapper");
    const receiptWidth = 560; // Approx pixel width of A5
    const screenWidth = window.innerWidth - 30; // 30px padding buffer

    if (screenWidth < receiptWidth) {
      const scale = screenWidth / receiptWidth;
      // We scale the content down to fit
      contentBox.style.transform = `scale(${scale})`;
      contentBox.style.transformOrigin = "top center";
      // We adjust the wrapper height because 'scale' doesn't physically shrink the div flow
      wrapper.style.height = `${contentBox.offsetHeight * scale}px`;
      wrapper.style.width = `${receiptWidth * scale}px`; // Force wrapper to fit scaled width
    } else {
      contentBox.style.transform = "none";
      wrapper.style.height = "auto";
      wrapper.style.width = "auto";
    }
  }, 50);

  // 5. Download PDF Handler
  document.getElementById("downloadPdfBtn").onclick = function() {
      showToast("Generating PDF...", "success");

      const opt = {
        margin: 0,
        filename: `Receipt_${loan.clientName.replace(/\s/g,'_')}_${loan.id}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
      };

      // We pass 'contentBox' (the clean A5 div) to the generator.
      // html2pdf usually ignores the CSS transform scaling, which is exactly what we want.
      // It will print the full high-res receipt.
      html2pdf().from(contentBox).set(opt).save();
  };
};

// ==========================================
// 6. UI RENDERING
// ==========================================

function refreshUI() {
  try { recomputeAllLoans(); } catch(e) { console.error("Error computing loans:", e); }

  // --- UPDATED BADGE LOGIC ---
  const attentionCount = (state.loans || []).filter(l => l.status === "OVERDUE").length;
  // Target the NEW ID "clientAlertBadge" instead of the old "overviewAlertBadge"
  const navBadge = document.getElementById("clientAlertBadge");
  if (navBadge) {
      if (attentionCount > 0) navBadge.classList.add("show");
      else navBadge.classList.remove("show");
  }

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

  // --- 1. Calculate Stats ---
  const totalLoaned = loans.reduce((s, l) => s + (l.amount || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => {
      // Exclude defaulted/bad debt from outstanding expectation
      if (l.status === "DEFAULTED") return s;
      return s + Math.max(0, l.balance || 0);
  }, 0);
  const totalProfit = loans.reduce((s, l) => s + (l.profitCollected || 0), 0);
  const activeCount = loans.filter(l => l.status === "ACTIVE" || l.status === "OVERDUE").length;

  // --- 2. Calculate Cash on Hand ---
  const starting = state.startingCapital || 0;
  const added = (state.capitalTxns || []).reduce((s, t) => s + (t.amount || 0), 0);
  const paidIn = loans.reduce((s, l) => s + (l.paid || 0), 0);
  const cashOnHand = starting + added + paidIn - totalLoaned;

  // --- 3. Update "Cash on Hand" Card ---
  const cashEl = el("cashOnHandValue");
  if(cashEl) {
    cashEl.textContent = formatMoney(cashOnHand);
    if (cashOnHand < 0) cashEl.classList.add("text-danger-glow");
    else cashEl.classList.remove("text-danger-glow");
  }

  // --- 4. Update Capital Setup Section ---
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

  // --- 5. Update Capital Ledger Table ---
  const capBody = el("capitalTableBody");
  if(capBody) {
     capBody.innerHTML = (state.capitalTxns || []).map(t => `
        <tr><td>${formatDate(t.date)}</td><td>${formatMoney(t.amount)}</td><td class="subtle">${t.note || '-'}</td></tr>
     `).join("");
  }

  // --- 6. Render the 4 Overview Stats Cards ---
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

  // --- 7. Trigger Animations ---
  animateValue(el("statLoaned"), 0, totalLoaned, 1500);
  animateValue(el("statOutstanding"), 0, totalOutstanding, 2000);
  animateValue(el("statProfit"), 0, totalProfit, 2500);
}

// ==========================================
// UPDATED TABLE RENDERER (Paste in Section 6)
// ==========================================

function renderLoansTable() {
  // FIXED: Ensure statuses (Overdue/Active) are fresh before filtering
  recomputeAllLoans();

  const tbody = document.getElementById("loansTableBody");
  if (!tbody) return;

  // 1. Get Search & Filter Values
  const search = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const statusFilter = activeFilters.status;
  const planFilter = activeFilters.plan;

  // 2. Filter the Data
  const visibleLoans = (state.loans || []).filter(l => {
     // Search Logic (Name or ID)
     const matchSearch = !search ||
                         (l.clientName && l.clientName.toLowerCase().includes(search)) ||
                         (l.id && l.id.toString().includes(search));

     // Status Logic
     const matchStatus = statusFilter === "All" || l.status === statusFilter;

     // Plan Logic
     const matchPlan = planFilter === "All" || l.plan === planFilter;

     return matchSearch && matchStatus && matchPlan;
  });

  // 3. Update UI Counters
  if (document.getElementById("loansCountLabel")) {
    document.getElementById("loansCountLabel").textContent = `${visibleLoans.length} records`;
  }

  // 4. Show/Hide Empty State
  if(document.getElementById("emptyState")) {
      const shouldShow = visibleLoans.length === 0;
      document.getElementById("emptyState").style.display = shouldShow ? "block" : "none";
  }

  // 5. Generate HTML
  tbody.innerHTML = visibleLoans.map((l, index) => {
    // Progress Calculation
    const percent = Math.min(100, Math.round(((l.paid || 0) / (l.totalDue || 1)) * 100));

    // Color Logic
    let progressColor = "var(--primary)";
    if (percent >= 100) progressColor = "#22c55e"; // Green
    else if (l.status === "OVERDUE") progressColor = "#ef4444"; // Red
    else if (l.status === "DEFAULTED") progressColor = "#64748b"; // Grey

    // Styling logic
    const isOverdue = l.status === "OVERDUE";
    const balanceStyle = isOverdue ? 'class="text-danger-glow" style="font-weight:bold;"' : 'style="font-weight:bold;"';
    const avatarClass = `avatar-${l.id % 5}`;
    const isClosed = l.status === "PAID" || l.status === "DEFAULTED";

    // WhatsApp Message
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
    // --- UPDATED: Show Red Attention Dot if Overdue ---
    let statusHtml = '';
    if (c.overdues > 0) {
        // Red "Needs Attention" pill
        statusHtml = '<span class="status-pill status-overdue" style="animation:pulseRed 1.5s infinite;">⚠️ Action Needed</span>';
    } else if (c.activeCount > 0) {
        statusHtml = '<span class="status-pill status-active">Active</span>';
    } else {
        statusHtml = '<span class="status-pill status-paid">Clear</span>';
    }

    // Also add a red dot next to name if they have issues
    const nameAlert = c.overdues > 0 ? '<span style="color:#ef4444; margin-left:6px; font-size:1.2rem; line-height:0; position:relative; top:2px;">•</span>' : '';

    return `
    <tr>
      <td data-label="Client">
        <div style="font-weight:bold;">${c.name} ${nameAlert}</div>
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

window.switchOverviewTab = function(tabName, btnElement) {
  if (typeof vibrate === "function") vibrate([15]);
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

// --- MODAL CONTROLS & NAV ANIMATION ---

// Helper to switch the active button highlight
function updateNavHighlight(activeBtnId) {
    // 1. Remove 'active' class from ALL nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('nav-btn-active');
    });

    // 2. Add 'active' class to the specific button we clicked
    const targetBtn = document.getElementById(activeBtnId);
    if (targetBtn) {
        targetBtn.classList.add('nav-btn-active');
    }
}

window.openPopup = function(modalId) {
    // 1. Close other modals first
    window.closeAllModals(false); // false = don't reset nav yet

    // 2. Open the requested modal
    const modal = document.getElementById(modalId);
    if(modal) {
        modal.classList.remove("modal-hidden");
        if (typeof vibrate === "function") vibrate([15]);
    }

    // 3. Update the Nav Bar Animation based on which modal opened
    if (modalId === 'monthlyModal') updateNavHighlight('navMonthlyBtn');
    if (modalId === 'clientsModal') updateNavHighlight('navClientsBtn');
    if (modalId === 'adminsModal')  updateNavHighlight('navAdminsBtn');
}

window.closePopup = function(id) {
    const modal = document.getElementById(id);
    if(modal) modal.classList.add("modal-hidden");
    // When closing a specific popup, we assume we go back to Overview
    updateNavHighlight('navMainBtn');
}

window.closeAllModals = function(resetNav = true) {
    // Closes Monthly, Clients, Admins
    ['monthlyModal', 'clientsModal', 'adminsModal'].forEach(id => {
        const m = document.getElementById(id);
        if(m) m.classList.add("modal-hidden");
    });

    if (resetNav) {
        // If we are fully closing everything, highlight "Overview"
        updateNavHighlight('navMainBtn');
        if (typeof vibrate === "function") vibrate([10]);
    }
}


// ==========================================
// 9. INIT
// ==========================================
function init() {

  // 1. SHORTCUT HANDLING (New Loan / Stats from Home Screen)
  // ------------------------------------------------
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');

  if (action === 'new_loan') {
      // Wait a moment for app to render, then open the modal
      setTimeout(() => {
          const btn = el("openLoanModalBtn");
          if (btn) btn.click();
      }, 600);
  }
  else if (action === 'dashboard') {
      setTimeout(() => {
          // Find the dashboard tab button and click it
          const btn = document.querySelector("button[onclick*='switchOverviewTab'][onclick*='dashboard']");
          if (btn) btn.click();
      }, 600);
  }
  // ------------------------------------------------

  // 2. EVENT LISTENERS

  // --- NEW: LOGOUT BUTTON LISTENER ---
  el("logoutBtn")?.addEventListener("click", () => {
    if (confirm("Are you sure you want to log out?")) {
      if (typeof vibrate === "function") vibrate([50]);

      // 1. Sign out of Firebase
      if (typeof firebase !== "undefined" && firebase.auth) {
          firebase.auth().signOut();
      }

      // 2. Clear Session Data
      localStorage.removeItem("stallz_last_active");
      localStorage.removeItem("stallz_test_session");

      // 3. Reload to Force Login Screen
      showToast("Logging out...", "success");
      setTimeout(() => {
          window.location.reload();
      }, 500);
    }
  });

  // --- EXISTING LISTENERS ---
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

  // --- FIXED EXCEL EXPORT ---
  el("exportBtn")?.addEventListener("click", () => {
     if (typeof vibrate === "function") vibrate([20]);

     if (typeof window.XLSX === "undefined") {
         showToast("Export library missing. Check internet.", "error");
         console.warn("XLSX not loaded. CDN blocked or offline.");
         return;
     }

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
         showToast("Export failed. Check console.", "error");
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

// 10. Start the App
document.addEventListener("DOMContentLoaded", init);

function setActiveView(view) {
  // Not used in new navigation but kept for compatibility
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
      <div class="field"><label>Date</label><input type="date" id="actDate" value="${getLocalDateVal()}"></div>
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
