// ==========================================================================
// STALLZ LOANS — Client Portal (TEST MODE SAFE)
// Fixed:
// 1) Removed duplicate modal functions
// 2) simulateSubmit now receives event safely
// 3) Firebase init guarded by isTestMode (prevents white-screen later)
// 4) Improved notification dropdown click-away behavior
// ==========================================================================

// --------------------------------------------------------------------------
// 1) FIREBASE CONFIGURATION (placeholders)
// --------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// --------------------------------------------------------------------------
// 2) GLOBAL STATE
// --------------------------------------------------------------------------
let isTestMode = true; // FORCED TRUE (safe dev mode)
let selectedRate = 0.20;

// Firebase handle (only enabled when not in test mode)
let db = null;
if (!isTestMode) {
  try {
    if (typeof firebase !== "undefined") {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
    } else {
      console.warn("Firebase SDK not found. Running without Firebase.");
    }
  } catch (err) {
    console.error("Firebase init failed:", err);
  }
}

// --------------------------------------------------------------------------
// 3) MAIN INITIALIZATION (ON LOAD)
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Calculator listeners
  const rangeInput = document.getElementById("calcRange");
  if (rangeInput) {
    rangeInput.addEventListener("input", updateCalculator);
    setupDurationButtons();
    updateCalculator();
  }

  // Force test data loading
  console.log("⚠️ APP IS IN TEST MODE: Using dummy data only.");
  loadTestData();

  // Click-away logic for modals + notifications
  window.addEventListener("click", (ev) => {
    // Close modal overlays if clicking the dark overlay background
    const t = ev.target;
    if (t && t.classList && t.classList.contains("modal-overlay")) {
      t.style.display = "none";
    }

    // Close notification dropdown if clicking outside the wrapper/button
    const dropdown = document.getElementById("notificationDropdown");
    const clickedBell = t && t.closest ? t.closest(".notification-btn") : null;
    const clickedWrap = t && t.closest ? t.closest(".notification-wrapper") : null;

    if (dropdown && !clickedBell && !clickedWrap) {
      dropdown.style.display = "none";
    }
  });
});

// --------------------------------------------------------------------------
// 4) HEADER & NOTIFICATION LOGIC
// --------------------------------------------------------------------------
function toggleNotifications() {
  const dropdown = document.getElementById("notificationDropdown");
  if (!dropdown) return;
  const isVisible = dropdown.style.display === "flex";
  dropdown.style.display = isVisible ? "none" : "flex";
}

function updateHeaderGreeting(name) {
  const hour = new Date().getHours();
  let timeGreeting = "Hello";
  if (hour < 12) timeGreeting = "Good Morning";
  else if (hour < 18) timeGreeting = "Good Afternoon";
  else timeGreeting = "Good Evening";

  const firstName = name ? name.split(" ")[0] : "User";
  const headerTitle = document.getElementById("headerGreeting");
  if (headerTitle) {
    headerTitle.innerHTML = `${timeGreeting}, <span id="headerUserName">${firstName}</span>`;
  }
}

// --------------------------------------------------------------------------
// 5) DATA LOADING (TEST DATA ONLY)
// --------------------------------------------------------------------------
function loadTestData() {
  // 1) Set Name: Drae (test)
  updateHeaderGreeting("Drae");

  // Profile mock data
  const phone = document.getElementById("modalPhone");
  const id = document.getElementById("modalID");
  const addr = document.getElementById("modalAddress");
  if (phone) phone.innerText = "0977-XXX-XXX";
  if (id) id.innerText = "999999/11/1";
  if (addr) addr.innerText = "Test Mode Address, Zambia";

  // 2) Mock loan data
  const fakeLoans = [
    {
      date: "2025-12-20",
      amount: 10000,
      interestRate: 20,
      amountPaid: 8040,
      dueDate: "2026-01-25",
    },
  ];

  renderLoansTable(fakeLoans);
}

// --------------------------------------------------------------------------
// 6) DASHBOARD RENDERING (TABLE & RINGS)
// --------------------------------------------------------------------------
function renderLoansTable(loansData) {
  const tableBody = document.getElementById("portalLoansTable");
  if (!tableBody) return;

  let totalDebt = 0;
  let totalPaid = 0;
  let earliestDueDate = null;

  tableBody.innerHTML = "";

  loansData.forEach((loan) => {
    const principal = parseFloat(loan.amount);
    const interest = principal * ((loan.interestRate || 20) / 100);
    const totalDue = principal + interest;
    const paid = parseFloat(loan.amountPaid || 0);
    const balance = totalDue - paid;

    totalPaid += paid;

    if (balance > 1) {
      totalDebt += balance;
      const dDate = new Date(loan.dueDate);
      if (!earliestDueDate || dDate < earliestDueDate) earliestDueDate = dDate;
    }

    const row = `
      <tr>
        <td>${new Date(loan.date).toLocaleDateString()}</td>
        <td>K${principal.toLocaleString()}</td>
        <td>K${totalDue.toLocaleString()}</td>
        <td style="color:#4ade80">K${paid.toLocaleString()}</td>
        <td style="font-weight:bold">K${balance.toLocaleString()}</td>
      </tr>
    `;
    tableBody.innerHTML += row;
  });

  // Update stats
  const debtEl = document.getElementById("portalTotalDebt");
  const paidEl = document.getElementById("portalTotalPaid");
  if (debtEl) debtEl.innerText = "K" + totalDebt.toLocaleString();
  if (paidEl) paidEl.innerText = "K" + totalPaid.toLocaleString();

  // FORCE 67% DISPLAY (your original behavior)
  const progressEl = document.getElementById("paymentProgressDisplay");
  if (progressEl) progressEl.innerText = "67%";

  // Update ring
  updateCountdownRing(earliestDueDate);
}

// --------------------------------------------------------------------------
// 7) GAUGE RING LOGIC (FULL 360 CIRCLE)
// --------------------------------------------------------------------------
function updateCountdownRing(dueDate) {
  const outerCircle = document.getElementById("progressCircle");
  const daysText = document.getElementById("daysRemaining");
  const nextDueText = document.getElementById("nextDueDisplay");
  if (!outerCircle) return;

  const radius = 70;
  const circumference = 2 * Math.PI * radius;

  outerCircle.style.strokeDasharray = circumference;

  if (!dueDate) {
    outerCircle.style.strokeDashoffset = circumference;
    if (daysText) daysText.innerText = "--";
    if (nextDueText) nextDueText.innerText = "--";
  } else {
    const diffTime = dueDate - new Date();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (daysText) daysText.innerText = diffDays > 0 ? String(diffDays) : "0";
    if (nextDueText)
      nextDueText.innerText = dueDate.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
  }

  // FORCE 67% ring progress (your original behavior)
  const percent = 0.67;
  const offset = circumference - percent * circumference;

  outerCircle.style.strokeDashoffset = offset;
  outerCircle.style.stroke = "#4ade80";
}

// --------------------------------------------------------------------------
// 8) CALCULATOR
// --------------------------------------------------------------------------
function updateCalculator() {
  const range = document.getElementById("calcRange");
  if (!range) return;

  const amount = parseFloat(range.value);
  const amountEl = document.getElementById("calcAmountDisplay");
  const totalEl = document.getElementById("calcTotalDisplay");
  const interestEl = document.getElementById("calcInterestDisplay");

  if (amountEl) amountEl.innerText = `K${amount}`;
  const interestAmt = amount * selectedRate;
  const total = amount + interestAmt;

  if (totalEl) totalEl.innerText = `K${total.toLocaleString()}`;
  if (interestEl) interestEl.innerText = `${(selectedRate * 100).toFixed(0)}%`;
}

function setupDurationButtons() {
  const buttons = document.querySelectorAll(".dur-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      buttons.forEach((b) => b.classList.remove("active"));
      ev.currentTarget.classList.add("active");
      selectedRate = parseFloat(ev.currentTarget.dataset.rate);
      updateCalculator();
    });
  });
}

// --------------------------------------------------------------------------
// 9) MODALS (single, non-duplicate definitions)
// --------------------------------------------------------------------------
function openProfileModal() {
  const m = document.getElementById("profileModal");
  if (m) m.style.display = "flex";
}
function closeProfileModal() {
  const m = document.getElementById("profileModal");
  if (m) m.style.display = "none";
}

function openCalcModal() {
  const m = document.getElementById("calcModal");
  if (m) m.style.display = "flex";
}
function closeCalcModal() {
  const m = document.getElementById("calcModal");
  if (m) m.style.display = "none";
}

function openRequestModal() {
  const m = document.getElementById("requestModal");
  if (m) m.style.display = "flex";
}
function closeRequestModal() {
  const m = document.getElementById("requestModal");
  if (m) m.style.display = "none";
}

function openUploadModal() {
  const m = document.getElementById("uploadModal");
  if (m) m.style.display = "flex";
}
function closeUploadModal() {
  const m = document.getElementById("uploadModal");
  if (m) m.style.display = "none";
}

function openPayModal() {
  const m = document.getElementById("payModal");
  if (m) m.style.display = "flex";
}
function closePayModal() {
  const m = document.getElementById("payModal");
  if (m) m.style.display = "none";
}

// --------------------------------------------------------------------------
// 10) SIMULATION LOGIC (fixed: takes event safely)
// --------------------------------------------------------------------------
// IMPORTANT: update HTML to pass `event`:
// onclick="simulateSubmit('Application Submitted!', event)"
function simulateSubmit(message, ev) {
  // Close active modals immediately (as your original behavior)
  closeRequestModal();
  closeUploadModal();

  const btn = ev && ev.target ? ev.target : null;
  const originalText = btn ? btn.innerText : null;

  if (btn) btn.innerText = "Processing...";

  setTimeout(() => {
    if (btn && originalText) btn.innerText = originalText;
    alert("✅ " + message);

    // Ensure closed
    closeRequestModal();
    closeUploadModal();
  }, 800);
}

// ==========================================================================
// 9. FLOATING ACTION BUTTON (FAB)
// ==========================================================================

// Function to toggle the menu open/closed
function toggleFabMenu() {
    const menu = document.getElementById('fabMenu');
    if (!menu) return;

    if (menu.classList.contains('active')) {
        menu.classList.remove('active');
    } else {
        menu.classList.add('active');
    }
}

// Close FAB if clicking elsewhere
document.addEventListener('click', (e) => {
    const fabWrap = document.querySelector('.floating-support');
    const menu = document.getElementById('fabMenu');

    // If menu exists, is open, and the click was NOT inside the floating-support div
    if (menu && menu.classList.contains('active') && fabWrap && !fabWrap.contains(e.target)) {
        menu.classList.remove('active');
    }
});

// Toggle Theme Manually
function toggleTheme() {
    const isDay = document.body.classList.toggle('day-mode');
    // Save preference to memory
    localStorage.setItem('stallz-theme', isDay ? 'day' : 'night');
}