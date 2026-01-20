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
let isTestMode = true;
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

    // 2.2 THEME LOGIC (Auto + Memory)
    const savedTheme = localStorage.getItem('stallz-theme');
    const currentHour = new Date().getHours();

    // Prioritize saved preference, otherwise use time
    if (savedTheme === 'day') {
        document.body.classList.add('day-mode');
    } else if (savedTheme === 'night') {
        document.body.classList.remove('day-mode');
    } else if (currentHour >= 6 && currentHour < 18) {
        document.body.classList.add('day-mode');
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
    const dropdown = document.getElementById("notificationDropdown");
    const list = document.getElementById("notificationList");

    if (!dropdown || !list) return;

    const isVisible = dropdown.style.display === "flex";
    dropdown.style.display = isVisible ? "none" : "flex";

    if (!isVisible) {
        if (list.innerHTML.trim() === "") {
            list.innerHTML = `
                <div class="notify-item" style="text-align:center; color:var(--text-muted); font-style:italic; padding: 20px;">
                    You don't have any notifications at the moment.
                </div>
            `;
        }
    }
}

function updateHeaderGreeting(name) {
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
    updateHeaderGreeting("Drae");

    if(document.getElementById('modalPhone')) document.getElementById('modalPhone').innerText = "0977-XXX-XXX";
    if(document.getElementById('modalID')) document.getElementById('modalID').innerText = "999999/11/1";
    if(document.getElementById('modalAddress')) document.getElementById('modalAddress').innerText = "Test Mode Address, Zambia";

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

    const radius = 70;
    const circumference = 2 * Math.PI * radius;

    outerCircle.style.strokeDasharray = circumference;

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

function openProfileModal() { document.getElementById('profileModal').style.display = 'flex'; }
function closeProfileModal() { document.getElementById('profileModal').style.display = 'none'; }

function openCalcModal() { document.getElementById('calcModal').style.display = 'flex'; }
function closeCalcModal() { document.getElementById('calcModal').style.display = 'none'; }

function openRequestModal() { document.getElementById('requestModal').style.display = 'flex'; }
function closeRequestModal() { document.getElementById('requestModal').style.display = 'none'; }

function openUploadModal() { document.getElementById('uploadModal').style.display = 'flex'; }
function closeUploadModal() { document.getElementById('uploadModal').style.display = 'none'; }

function openPayModal() { document.getElementById('payModal').style.display = 'flex'; }
function closePayModal() { document.getElementById('payModal').style.display = 'none'; }

function openReferralModal() { document.getElementById('referralModal').style.display = 'flex'; }
function closeReferralModal() { document.getElementById('referralModal').style.display = 'none'; }

function openSupportModal() { document.getElementById('supportModal').style.display = 'flex'; }
function closeSupportModal() { document.getElementById('supportModal').style.display = 'none'; }

function simulateSubmit(message, ev) {
    closeRequestModal();
    closeUploadModal();

    const btn = (ev && ev.target) ? ev.target : null;
    const originalText = btn ? btn.innerText : "";

    if(btn) btn.innerText = "Processing...";

    setTimeout(() => {
        if(btn) btn.innerText = originalText;
        alert("✅ " + message);
        closeRequestModal();
        closeUploadModal();
    }, 800);
}

// ==========================================================================
// 9. FLOATING ACTION BUTTON & THEME
// ==========================================================================

function toggleFabMenu() {
    const menu = document.getElementById('fabMenu');
    if (!menu) return;
    menu.classList.toggle('active');
}

// Close FAB if clicking elsewhere
document.addEventListener('click', (e) => {
    const fabWrap = document.querySelector('.floating-support');
    const menu = document.getElementById('fabMenu');
    if (menu && menu.classList.contains('active') && fabWrap && !fabWrap.contains(e.target)) {
        menu.classList.remove('active');
    }
});

// Toggle Theme Manually
function toggleTheme() {
    const isDay = document.body.classList.toggle('day-mode');
    localStorage.setItem('stallz-theme', isDay ? 'day' : 'night');
}