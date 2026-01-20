// ==========================================================================
// 1. FIREBASE CONFIGURATION & SETUP
// ==========================================================================
// REPLACE these values with your specific project keys from the Firebase Console
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase only if it hasn't been already
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// Global Variables
let isTestMode = false;
let selectedRate = 0.20; // Default interest rate (20% for 1 week)

// ==========================================================================
// 2. MAIN INITIALIZATION (ON LOAD)
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {

    // 2.1 Initialize Calculator Listeners
    const rangeInput = document.getElementById('calcRange');
    if(rangeInput) {
        rangeInput.addEventListener('input', updateCalculator);
        setupDurationButtons();
        updateCalculator(); // Run once on load
    }

    // 2.2 Parse URL Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const clientId = urlParams.get('id');
    const mode = urlParams.get('mode');

    // 2.3 Route to Correct Data Source
    if (mode === 'test') {
        isTestMode = true;
        loadTestData();
    } else if (clientId) {
        loadClientData(clientId);
        loadLoansData(clientId);
    } else {
        // Fallback for visitors with no ID
        updateHeaderGreeting("Guest");
    }

    // 2.4 Close modals if user clicks outside of them
    window.onclick = function(event) {
        if (event.target.className === 'modal-overlay') {
            event.target.style.display = 'none';
        }
        // Also close notification dropdown if clicking elsewhere
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
    const hour = new Date().getHours();
    let timeGreeting = "Hello";
    if (hour < 12) timeGreeting = "Good Morning";
    else if (hour < 18) timeGreeting = "Good Afternoon";
    else timeGreeting = "Good Evening";

    const firstName = name ? name.split(' ')[0] : "User";
    const headerTitle = document.getElementById('headerGreeting');
    if (headerTitle) {
        headerTitle.innerHTML = `${timeGreeting}, <span id="headerUserName">${firstName}</span>`;
    }
}

// ==========================================================================
// 4. DATA LOADING LAYER (REAL & TEST)
// ==========================================================================

function loadClientData(id) {
    db.collection('clients').doc(id).get().then((doc) => {
        if (doc.exists) {
            const data = doc.data();
            updateHeaderGreeting(data.name);
            if(document.getElementById('modalPhone')) document.getElementById('modalPhone').innerText = data.phone || "--";
            if(document.getElementById('modalID')) document.getElementById('modalID').innerText = data.idNumber || "--";
            if(document.getElementById('modalAddress')) document.getElementById('modalAddress').innerText = data.address || "--";
        }
    }).catch(err => {
        console.error("Error loading client:", err);
        updateHeaderGreeting("User");
    });
}

function loadLoansData(id) {
    db.collection('loans').where('clientId', '==', id)
      .orderBy('date', 'desc').limit(10)
      .get().then((snapshot) => {
          const loans = [];
          snapshot.forEach(doc => loans.push(doc.data()));
          renderLoansTable(loans);
      });
}

function loadTestData() {
    updateHeaderGreeting("John Doe");
    const fakeLoans = [
        {
            date: new Date().toISOString(),
            amount: 500, interestRate: 20, amountPaid: 0,
            dueDate: new Date(Date.now() + 86400000 * 5).toISOString()
        },
        {
            date: "2025-10-01", amount: 1000, interestRate: 20, amountPaid: 1200,
            dueDate: "2025-11-01"
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

    // 1. Update Stats
    if(document.getElementById('portalTotalDebt')) document.getElementById('portalTotalDebt').innerText = 'K' + totalDebt.toLocaleString();
    if(document.getElementById('portalTotalPaid')) document.getElementById('portalTotalPaid').innerText = 'K' + totalPaid.toLocaleString();

    // 2. HARDCODED 85% TESTING
    if(document.getElementById('paymentProgressDisplay')) {
        document.getElementById('paymentProgressDisplay').innerText = "85%";
    }

    // 3. Update Ring
    updateCountdownRing(earliestDueDate);
}

// ==========================================================================
// 6. GAUGE RING LOGIC (FULL 360 CIRCLE - 85% TEST)
// ==========================================================================

function updateCountdownRing(dueDate) {
    const outerCircle = document.getElementById('progressCircle');
    const daysText = document.getElementById('daysRemaining');
    const nextDueText = document.getElementById('nextDueDisplay');

    if (!outerCircle) return;

    // 1. Setup Geometry for Full 360 Circle
    // SVG Radius = 70. Circumference = 2 * PI * 70
    const radius = 70;
    const circumference = 2 * Math.PI * radius; // approx 439.8

    // Set static dasharray (Total Length)
    outerCircle.style.strokeDasharray = circumference;

    // 2. Handle Text Data
    if (!dueDate) {
        outerCircle.style.strokeDashoffset = circumference; // Empty
        if(daysText) daysText.innerText = "--";
        if(nextDueText) nextDueText.innerText = "--";
    } else {
        const diffTime = dueDate - new Date();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if(daysText) daysText.innerText = diffDays > 0 ? diffDays : "0";
        if(nextDueText) nextDueText.innerText = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    // 3. FORCE 85% PROGRESS FOR TESTING
    let percent = 0.85;

    // Calculate offset
    // 0 offset = Full. circumference offset = Empty.
    const offset = circumference - (percent * circumference);

    outerCircle.style.strokeDashoffset = offset;

    // 4. Color Logic (Stallz Green)
    outerCircle.style.stroke = "#4ade80";
}

// ==========================================================================
// 7. CALCULATOR & MODALS (Standard)
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

function openProfileModal() { document.getElementById('profileModal').style.display = 'flex'; }
function closeProfileModal() { document.getElementById('profileModal').style.display = 'none'; }
function openCalcModal() { document.getElementById('calcModal').style.display = 'flex'; }
function closeCalcModal() { document.getElementById('calcModal').style.display = 'none'; }
function openRequestModal() { const m = document.getElementById('requestModal'); if(m) m.style.display='flex'; }
function openUploadModal() { const m = document.getElementById('uploadModal'); if(m) m.style.display='flex'; }