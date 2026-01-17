// ==========================================================================
// 1. FIREBASE CONFIGURATION
// ==========================================================================
// !!! PASTE YOUR ACTUAL KEYS HERE !!!
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase (Singleton pattern)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// ==========================================================================
// 2. THEME & GREETING LOGIC (FIXED)
// ==========================================================================
function setDynamicGreeting() {
    const hour = new Date().getHours();
    const greetingEl = document.getElementById('greetingText');
    const body = document.body;

    // 1. Set the Text (Morning vs Afternoon vs Evening)
    if (hour < 12) {
        greetingEl.innerText = "Good Morning,";
    } else if (hour < 18) {
        greetingEl.innerText = "Good Afternoon,";
    } else {
        greetingEl.innerText = "Good Evening,";
    }

    // 2. Set the Theme (Day vs Night)
    // Day Mode active between 6 AM (6) and 6 PM (18)
    if (hour >= 6 && hour < 18) {
        body.classList.add('day-mode');
        console.log("☀️ Setting Day Theme");
    } else {
        body.classList.remove('day-mode');
        console.log("🌙 Setting Night Theme");
    }
}


// ==========================================================================
// 3. MAIN INITIALIZATION
// ==========================================================================
let isTestMode = false;
let selectedRate = 0.20; // Default Calculator Rate

document.addEventListener('DOMContentLoaded', () => {
    // 3.1 Initialize Theme
    setDynamicGreeting();

    // 3.2 Initialize Calculator
    const rangeInput = document.getElementById('calcRange');
    if(rangeInput) {
        rangeInput.addEventListener('input', updateCalculator);
        setupDurationButtons();
        updateCalculator();
    }

    // 3.3 Check URL & Load Data
    const urlParams = new URLSearchParams(window.location.search);
    const clientId = urlParams.get('id');
    const mode = urlParams.get('mode');

    // Handle Test Mode
    if (mode === 'test') {
        isTestMode = true;
        enableTestModeUI();
        loadTestData();
        return;
    }

    // Handle Real User
    if (!clientId) {
        document.getElementById('portalClientName').innerText = "Error: No ID Found";
        return;
    }
    loadClientData(clientId);
    loadLoansData(clientId);
});

function enableTestModeUI() {
    const badge = document.createElement('div');
    badge.innerHTML = "TEST MODE";
    badge.style.cssText = "position:absolute; top:10px; left:50%; transform:translateX(-50%); background:#f97316; color:white; padding:4px 12px; border-radius:12px; font-size:0.7rem; font-weight:bold; z-index:9999;";
    document.body.appendChild(badge);
}

// ==========================================================================
// 4. DATA LOADING LAYER
// ==========================================================================

// 4.1 Real Data
function loadClientData(id) {
    db.collection('clients').doc(id).get().then((doc) => {
        if (doc.exists) {
            const data = doc.data();
            // Note: The 'text-gradient' class in HTML handles the styling.
            // innerText just updates the content safely.
            document.getElementById('portalClientName').innerText = data.name;

            // Profile Modal Data
            document.getElementById('modalPhone').innerText = data.phone || "--";
            document.getElementById('modalID').innerText = data.idNumber || "--";
            document.getElementById('modalAddress').innerText = data.address || "--";
        } else {
            document.getElementById('portalClientName').innerText = "Client Not Found";
        }
    });
}

function loadLoansData(id) {
    db.collection('loans').where('clientId', '==', id).onSnapshot((snapshot) => {
        const loans = [];
        snapshot.forEach(doc => loans.push(doc.data()));
        renderLoansTable(loans);
    });
}

// 4.2 Test Data (Dummy)
function loadTestData() {
    document.getElementById('portalClientName').innerText = "John Doe (Test)";
    document.getElementById('modalPhone').innerText = "0977-000-000";
    document.getElementById('modalID').innerText = "123456/10/1";
    document.getElementById('modalAddress').innerText = "123 Test Street, Lusaka";

    const fakeLoans = [
        {
            date: new Date().toISOString(),
            amount: 500, interestRate: 20, amountPaid: 0,
            dueDate: new Date(Date.now() + 86400000 * 5).toISOString() // 5 days from now
        },
        {
            date: "2025-10-01", amount: 1000, interestRate: 20, amountPaid: 1200,
            dueDate: "2025-11-01"
        }
    ];
    renderLoansTable(fakeLoans);
}

// ==========================================================================
// 5. UI RENDERING (Table & Countdown)
// ==========================================================================
function renderLoansTable(loansData) {
    const tableBody = document.getElementById('portalLoansTable');
    let totalDebt = 0;
    let totalPaid = 0;
    let earliestDueDate = null;
    let activeLoansFound = false;

    if (loansData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No history found.</td></tr>';
        updateCountdown(null);
        return;
    }

    tableBody.innerHTML = '';

    loansData.forEach((loan) => {
        const principal = parseFloat(loan.amount);
        const interest = loan.interestAmount ? parseFloat(loan.interestAmount) : (principal * (loan.interestRate || 20) / 100);
        const totalDue = principal + interest;
        const paid = parseFloat(loan.amountPaid || 0);
        const balance = totalDue - paid;

        totalDebt += balance;
        totalPaid += paid;

        if (balance > 1) {
            activeLoansFound = true;
            const loanDate = new Date(loan.dueDate);
            if (!earliestDueDate || loanDate < earliestDueDate) earliestDueDate = loanDate;
        }

        let statusClass = 'status-active';
        let statusText = 'Active';
        if (balance <= 1) { statusClass = 'status-paid'; statusText = 'Paid'; }
        else if (loan.dueDate && new Date() > new Date(loan.dueDate)) { statusClass = 'status-overdue'; statusText = 'Overdue'; }

        const balanceColor = balance <= 1 ? '#22c55e' : 'var(--text-main)';
        const balanceWeight = balance <= 1 ? '600' : '700';

        const row = `
            <tr>
                <td data-label="Date">${new Date(loan.date).toLocaleDateString()}</td>
                <td data-label="Amount">K${principal.toFixed(2)}</td>
                <td data-label="Total Due">K${totalDue.toFixed(2)}</td>
                <td data-label="Paid">K${paid.toFixed(2)}</td>
                <td data-label="Balance" style="font-weight:${balanceWeight}; color: ${balanceColor}">K${balance.toFixed(2)}</td>
                <td data-label="Status"><span class="status-pill ${statusClass}">${statusText}</span></td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });

    document.getElementById('portalTotalDebt').innerText = 'K' + totalDebt.toLocaleString(undefined, {minimumFractionDigits: 2});
    document.getElementById('portalTotalPaid').innerText = 'K' + totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2});

    updateCountdown(activeLoansFound ? earliestDueDate : null);
}

function updateCountdown(dueDate) {
    const circle = document.getElementById('progressCircle');
    const daysText = document.getElementById('daysRemaining');
    const labelText = document.getElementById('nextDueDisplay');
    const circumference = 377; // 2 * PI * 60

    circle.style.strokeDasharray = `${circumference} ${circumference}`;

    if (!dueDate) {
        daysText.innerText = "-"; labelText.innerText = "No Dues";
        circle.style.strokeDashoffset = circumference;
        circle.className = "progress-ring__circle";
        labelText.style.color = "var(--text-muted)";
        return;
    }

    const now = new Date();
    const diffTime = dueDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    daysText.innerText = diffDays > 0 ? diffDays : "!";
    labelText.innerText = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    let percent = Math.max(0, Math.min(diffDays, 30)) / 30;
    const offset = circumference - (percent * circumference);
    circle.style.strokeDashoffset = offset;

    circle.className = "progress-ring__circle";
    if (diffDays <= 0) {
        circle.classList.add('ring-danger');
        labelText.innerText = "Overdue!";
        labelText.style.color = "#ef4444";
    } else if (diffDays <= 5) {
        circle.classList.add('ring-warning');
        labelText.style.color = "#f59e0b";
    } else {
        circle.classList.add('ring-safe');
        labelText.style.color = "var(--text-main)";
    }
}

// ==========================================================================
// 6. MODAL MANAGEMENT
// ==========================================================================
// Profile
function openProfileModal() { document.getElementById('profileModal').style.display = 'flex'; }
function closeProfileModal() { document.getElementById('profileModal').style.display = 'none'; }

// Upload
function openUploadModal() { document.getElementById('uploadModal').style.display = 'flex'; }
function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('fileName').innerText = "";
    document.getElementById('dropZone').style.borderColor = "rgba(255, 255, 255, 0.2)";
    document.getElementById('dropZone').style.color = "#94a3b8";
}

// Request Loan
function openRequestModal() { document.getElementById('requestModal').style.display = 'flex'; }
function closeRequestModal() { document.getElementById('requestModal').style.display = 'none'; }

// Calculator
function openCalcModal() { document.getElementById('calcModal').style.display = 'flex'; }
function closeCalcModal() { document.getElementById('calcModal').style.display = 'none'; }

// ==========================================================================
// 7. FORM SUBMISSIONS
// ==========================================================================

// 7.1 Payment Proof Upload
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('paymentFile');

if(dropZone){
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            document.getElementById('fileName').innerText = "Selected: " + this.files[0].name;
            dropZone.style.borderColor = "#4ade80"; dropZone.style.color = "#4ade80";
        }
    });
}

function submitPaymentProof() {
    const file = fileInput.files[0];
    if (!file && !isTestMode) { alert("Please select an image."); return; }

    const btn = document.getElementById('uploadBtn');
    btn.innerText = "Processing...";

    setTimeout(() => {
        const clientName = document.getElementById('portalClientName').innerText;
        const msg = `*PAYMENT PROOF*\nClient: ${clientName}\nFile attached.`;
        window.open(`https://wa.me/260970000000?text=${encodeURIComponent(msg)}`, '_blank');
        btn.innerText = "Sent!";
        setTimeout(() => { closeUploadModal(); btn.innerText = "Submit Proof"; }, 1500);
    }, 1000);
}

// 7.2 Request Loan
function toggleNRCUploads() {
    const isChecked = document.getElementById('nrcExists').checked;
    const container = document.getElementById('nrcUploadContainer');
    container.style.display = isChecked ? 'none' : 'grid';
}

function submitLoanRequest() {
    const amount = document.getElementById('reqAmount').value;
    const collateral = document.getElementById('reqCollateral').value;
    const value = document.getElementById('reqValue').value;
    const nrcExists = document.getElementById('nrcExists').checked;

    if (!amount || !collateral || !value) { alert("Please fill in all fields."); return; }

    const btn = document.getElementById('requestBtn');
    btn.innerText = "Generating Request...";

    setTimeout(() => {
        const clientName = document.getElementById('portalClientName').innerText;
        let msg = `*NEW LOAN APPLICATION*\nClient: ${clientName}\nAmount: K${amount}\nItem: ${collateral}\nValue: K${value}\n\n`;
        msg += nrcExists ? `[NRC Already on File]` : `[Sending NRC Photos Now...]`;
        msg += `\n[Sending Collateral Photos Now...]`;

        window.open(`https://wa.me/260970000000?text=${encodeURIComponent(msg)}`, '_blank');

        btn.innerText = "Continue in WhatsApp";
        setTimeout(() => { closeRequestModal(); btn.innerText = "Submit Application"; }, 2000);
    }, 1000);
}

// ==========================================================================
// 8. CALCULATOR LOGIC
// ==========================================================================
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

function updateCalculator() {
    const amount = parseFloat(document.getElementById('calcRange').value);
    document.getElementById('calcAmountDisplay').innerText = `K${amount}`;

    const ratePercent = (selectedRate * 100).toFixed(0);
    document.getElementById('calcInterestDisplay').innerText = `${ratePercent}%`;

    const total = amount + (amount * selectedRate);
    document.getElementById('calcTotalDisplay').innerText = `K${total.toLocaleString()}`;
}

function applyFromCalc() {
    const amount = document.getElementById('calcRange').value;
    closeCalcModal();
    openRequestModal();
    document.getElementById('reqAmount').value = amount;
    // Add small delay to allow modal transition before focusing
    setTimeout(() => document.getElementById('reqAmount').focus(), 100);
}

// ==========================================================================
// 9. GLOBAL UTILITIES
// ==========================================================================
// Close Modals on Outside Click
window.onclick = function(event) {
    if (event.target == document.getElementById('profileModal')) closeProfileModal();
    if (event.target == document.getElementById('uploadModal')) closeUploadModal();
    if (event.target == document.getElementById('requestModal')) closeRequestModal();
    if (event.target == document.getElementById('calcModal')) closeCalcModal();
}