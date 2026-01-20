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

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
// Safe check for firestore in case SDK isn't fully loaded in test mode
const db = (typeof firebase !== 'undefined') ? firebase.firestore() : null;

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
            amountPaid: 6500, // Changed for demonstration (6500/12000 = ~54%)
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
        // Calculate financial details
        const principal = parseFloat(loan.amount);
        const interest = principal * ((loan.interestRate || 20) / 100);
        const totalDue = principal + interest;
        const paid = parseFloat(loan.amountPaid || 0);
        const balance = totalDue - paid;

        totalPaid += paid;

        // Add to total debt if there is still a balance
        if (balance > 1) {
            totalDebt += balance;

            // Determine the earliest due date for active loans
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

    // Update Text Stats
    if(document.getElementById('portalTotalDebt')) document.getElementById('portalTotalDebt').innerText = 'K' + totalDebt.toLocaleString();
    if(document.getElementById('portalTotalPaid')) document.getElementById('portalTotalPaid').innerText = 'K' + totalPaid.toLocaleString();

    // DYNAMIC PROGRESS CALCULATION
    // Formula: (Total Paid / (Total Paid + Outstanding Debt)) * 100
    let progressPercent = 0;
    const totalValue = totalPaid + totalDebt;

    if (totalValue > 0) {
        progressPercent = Math.round((totalPaid / totalValue) * 100);
    }

    if(document.getElementById('paymentProgressDisplay')) {
        document.getElementById('paymentProgressDisplay').innerText = `${progressPercent}%`;
    }

    // Pass the decimal fraction (0.0 - 1.0) to the ring function
    updateCountdownRing(earliestDueDate, progressPercent / 100);
}

// ==========================================================================
// 6. GAUGE RING LOGIC (FULL 360 CIRCLE)
// ==========================================================================

function updateCountdownRing(dueDate, percentFraction = 0) {
    const outerCircle = document.getElementById('progressCircle');
    const handleGroup = document.getElementById('ringHandleGroup'); // GET THE HANDLE
    const daysText = document.getElementById('daysRemaining');
    const nextDueText = document.getElementById('nextDueDisplay');

    if (!outerCircle) return;

    // 1. Setup Circle Dimensions
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    outerCircle.style.strokeDasharray = circumference;

    if (!dueDate) {
        // Empty State
        outerCircle.style.strokeDashoffset = circumference;
        if(handleGroup) handleGroup.style.transform = `rotate(0deg)`; // Reset Handle
        if(daysText) daysText.innerText = "--";
        if(nextDueText) nextDueText.innerText = "--";
    } else {
        // Calculate Days
        const diffTime = dueDate - new Date();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if(daysText) daysText.innerText = diffDays > 0 ? diffDays : "0";
        if(nextDueText) nextDueText.innerText = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

        // Calculate Fill
        const safeFraction = Math.min(Math.max(percentFraction, 0), 1);
        const offset = circumference - (safeFraction * circumference);

        // A. Animate the Line
        outerCircle.style.strokeDashoffset = offset;

        // B. Animate the Handle (Knob)
        if(handleGroup) {
            const degrees = safeFraction * 360;
            handleGroup.style.transform = `rotate(${degrees}deg)`;
        }

        // Remove manual stroke color setting so it keeps the Gradient
        outerCircle.style.stroke = "";
    }
}

// ==========================================================================
// 7. CALCULATOR LOGIC
// ==========================================================================

function updateCalculator() {
    const rangeInput = document.getElementById('calcRange');
    if (!rangeInput) return;

    const amount = parseFloat(rangeInput.value);
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
            // Remove active class from all buttons
            buttons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            e.target.classList.add('active');

            // Update rate and recalculate
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
    // 1. Get the button that was clicked
    const btn = (ev && ev.target) ? ev.target : null;
    const originalText = btn ? btn.innerText : "";

    // 2. Show loading state
    if(btn) btn.innerText = "Processing...";

    // 3. Simulate network delay
    setTimeout(() => {
        if(btn) btn.innerText = originalText;
        alert("✅ " + message);

        // Close all possible modals
        closeRequestModal();
        closeUploadModal();
        closePayModal();
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
    // If menu is active AND click is NOT inside the FAB wrapper
    if (menu && menu.classList.contains('active') && fabWrap && !fabWrap.contains(e.target)) {
        menu.classList.remove('active');
    }
});

// Toggle Theme Manually
function toggleTheme() {
    const isDay = document.body.classList.toggle('day-mode');
    localStorage.setItem('stallz-theme', isDay ? 'day' : 'night');
}