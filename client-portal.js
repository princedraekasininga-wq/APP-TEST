// ==========================================================================
// 1. FIREBASE CONFIGURATION & SETUP
// ==========================================================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// Global Variables
let isTestMode = true; // FORCED TRUE for development
let selectedRate = 0.20;

// ==========================================================================
// 2. MAIN INITIALIZATION (ON LOAD)
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {

    // 2.1 Initialize Calculator Listeners
    const rangeInput = document.getElementById('calcRange');
    if(rangeInput) {
        rangeInput.addEventListener('input', updateCalculator);
        setupDurationButtons();
        updateCalculator();
    }

    // 2.2 AUTO DAY/NIGHT MODE LOGIC
    const currentHour = new Date().getHours();
    if (currentHour >= 6 && currentHour < 18) {
        document.body.classList.add('day-mode');
        console.log("☀️ Day Mode Active");
    } else {
        document.body.classList.remove('day-mode');
        console.log("🌙 Night Mode Active");
    }

    // 2.3 FORCE TEST DATA LOADING
    console.log("⚠️ APP IS IN TEST MODE: Using dummy data only.");
    loadTestData();

    // 2.4 Close modals if user clicks outside
    window.onclick = function(event) {
        if (event.target.className === 'modal-overlay' || event.target.className === 'drawer-overlay') {
            event.target.style.display = 'none';
        }
        if (!event.target.closest('.notification-wrapper')) {
            const dropdown = document.getElementById('notificationDropdown');
            if (dropdown) dropdown.style.display = 'none';
        }
    }
});

// ==========================================================================
// 3. HEADER & NOTIFICATION LOGIC
// ==========================================================================

function toggleNotifications() {
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown) return;
    const isVisible = dropdown.style.display === 'flex';
    dropdown.style.display = isVisible ? 'none' : 'flex';
}

function updateHeaderGreeting(name) {
    // SIMPLE GREETING UPDATE:
    const timeGreeting = "Hi";

    const firstName = name ? name.split(' ')[0] : "User";
    const headerTitle = document.getElementById('headerGreeting');
    if (headerTitle) {
        headerTitle.innerHTML = `${timeGreeting}, <span id="headerUserName">${firstName}</span>`;
    }
}

// ==========================================================================
// 4. DATA LOADING LAYER (TEST DATA ONLY)
// ==========================================================================

function loadTestData() {
    // 1. Set Name: Drae
    updateHeaderGreeting("Drae");

    // Profile Mock Data
    if(document.getElementById('modalPhone')) document.getElementById('modalPhone').innerText = "0977-XXX-XXX";
    if(document.getElementById('modalID')) document.getElementById('modalID').innerText = "999999/11/1";
    if(document.getElementById('modalAddress')) document.getElementById('modalAddress').innerText = "Test Mode Address, Zambia";

    // 2. Mock Loan Data
    const fakeLoans = [
        {
            date: "2025-12-20",
            amount: 10000,
            interestRate: 20,
            amountPaid: 8040,
            dueDate: "2026-01-25"
        }
    ];

    renderLoansTable(fakeLoans);
}

// ==========================================================================
// 5. DASHBOARD RENDERING (TABLE & RINGS)
// ==========================================================================

function renderLoansTable(loansData) {
    const tableBody = document.getElementById('portalLoansTable');
    if (!tableBody) return;

    let totalDebt = 0;
    let totalPaid = 0;
    let earliestDueDate = null;

    tableBody.innerHTML = '';

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

    if(document.getElementById('portalTotalDebt')) document.getElementById('portalTotalDebt').innerText = 'K' + totalDebt.toLocaleString();
    if(document.getElementById('portalTotalPaid')) document.getElementById('portalTotalPaid').innerText = 'K' + totalPaid.toLocaleString();

    if(document.getElementById('paymentProgressDisplay')) {
        document.getElementById('paymentProgressDisplay').innerText = "67%";
    }

    updateCountdownRing(earliestDueDate);
}

// ==========================================================================
// 6. GAUGE RING LOGIC (FULL 360 CIRCLE)
// ==========================================================================

function updateCountdownRing(dueDate) {
    const outerCircle = document.getElementById('progressCircle');
    const daysText = document.getElementById('daysRemaining');
    const nextDueText = document.getElementById('nextDueDisplay');

    if (!outerCircle) return;

    // 1. Setup Geometry for Full 360 Circle
    const radius = 70;
    const circumference = 2 * Math.PI * radius;

    outerCircle.style.strokeDasharray = circumference;

    // 2. Handle Text Data
    if (!dueDate) {
        outerCircle.style.strokeDashoffset = circumference;
        if(daysText) daysText.innerText = "--";
        if(nextDueText) nextDueText.innerText = "--";
    } else {
        const diffTime = dueDate - new Date();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if(daysText) daysText.innerText = diffDays > 0 ? diffDays : "0";
        if(nextDueText) nextDueText.innerText = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    // FORCE 67% RING PROGRESS
    let percent = 0.67;
    const offset = circumference - (percent * circumference);

    outerCircle.style.strokeDashoffset = offset;
    outerCircle.style.stroke = "#4ade80";
}

// ==========================================================================
// 7. CALCULATOR LOGIC
// ==========================================================================

function updateCalculator() {
    const amount = parseFloat(document.getElementById('calcRange').value);
    document.getElementById('calcAmountDisplay').innerText = `K${amount}`;
    const interestAmt = amount * selectedRate;
    const total = amount + interestAmt;
    document.getElementById('calcTotalDisplay').innerText = `K${total.toLocaleString()}`;
    document.getElementById('calcInterestDisplay').innerText = `${(selectedRate * 100).toFixed(0)}%`;
}

function setupDurationButtons() {
    const buttons = document.querySelectorAll('.dur-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            buttons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            selectedRate = parseFloat(e.target.dataset.rate);
            updateCalculator();
        });
    });
}

// ==========================================================================
// 8. MODAL & DRAWER UTILITIES
// ==========================================================================

// Profile Drawer
function openProfileModal() { document.getElementById('profileModal').style.display = 'flex'; }
function closeProfileModal() { document.getElementById('profileModal').style.display = 'none'; }

// Calculator Modal
function openCalcModal() { document.getElementById('calcModal').style.display = 'flex'; }
function closeCalcModal() { document.getElementById('calcModal').style.display = 'none'; }

// Request Loan Modal
function openRequestModal() {
    const m = document.getElementById('requestModal');
    if(m) m.style.display = 'flex';
}
function closeRequestModal() {
    const m = document.getElementById('requestModal');
    if(m) m.style.display = 'none';
}

// Upload Proof Modal
function openUploadModal() {
    const m = document.getElementById('uploadModal');
    if(m) m.style.display = 'flex';
}
function closeUploadModal() {
    const m = document.getElementById('uploadModal');
    if(m) m.style.display = 'none';
}

// Pay Now Modal
function openPayModal() {
    const m = document.getElementById('payModal');
    if(m) m.style.display = 'flex';
}
function closePayModal() {
    const m = document.getElementById('payModal');
    if(m) m.style.display = 'none';
}

// Simulation Logic
function simulateSubmit(message) {
    closeRequestModal();
    closeUploadModal();

    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "Processing...";

    setTimeout(() => {
        btn.innerText = originalText;
        alert("✅ " + message);
        closeRequestModal();
        closeUploadModal();
    }, 800);
}