// ==========================================
// CLIENT PORTAL JS - STALLZ LOANS
// ==========================================

// ==========================================
// 1. FIREBASE CONFIGURATION
// ==========================================
// !!! PASTE YOUR ACTUAL KEYS HERE !!!
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase only once
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// ==========================================
// 2. GREETING & DAY/NIGHT THEME LOGIC
// ==========================================
function setDynamicGreeting() {
    const hour = new Date().getHours();
    const greetingEl = document.getElementById('greetingText');
    const body = document.body;

    // --- Time Logic ---
    // Day Mode: 6 AM (6) to 5:59 PM (17)
    // Night Mode: 6 PM (18) to 5:59 AM (5)

    if (hour >= 6 && hour < 18) {
        // DAYTIME
        greetingEl.innerText = "Good Morning/Afternoon,";
        body.classList.add('day-mode');

        // Optional: Change header icon color or text if needed
        console.log("☀️ Setting Day Theme");
    } else {
        // NIGHTTIME
        if (hour < 12) greetingEl.innerText = "Good Morning,"; // Early AM
        else greetingEl.innerText = "Good Evening,";

        body.classList.remove('day-mode');
        console.log("🌙 Setting Night Theme");
    }
}

// ==========================================
// 3. PAGE INITIALIZATION
// ==========================================
let isTestMode = false;

document.addEventListener('DOMContentLoaded', () => {
    // 3.1 Set Greeting
    setDynamicGreeting();

    // 3.2 Check for URL Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const clientId = urlParams.get('id');
    const mode = urlParams.get('mode'); // Look for ?mode=test

    // 3.3 Enable Test Mode if requested
    if (mode === 'test') {
        isTestMode = true;
        enableTestModeUI();
        loadTestData(); // Skip Firebase, load fake data
        return;
    }

    // 3.4 Regular Firebase Mode
    if (!clientId) {
        document.getElementById('portalClientName').innerText = "Error: No ID Found";
        return;
    }
    loadClientData(clientId);
    loadLoansData(clientId);
});

function enableTestModeUI() {
    // Add an orange badge to the header
    const badge = document.createElement('div');
    badge.innerHTML = "TEST MODE";
    badge.style.cssText = "position:absolute; top:10px; left:50%; transform:translateX(-50%); background:#f97316; color:white; padding:4px 12px; border-radius:12px; font-size:0.7rem; font-weight:bold; z-index:9999;";
    document.body.appendChild(badge);
    console.log("⚠️ STALLZ PORTAL: Test Mode Enabled");
}

// ==========================================
// 4. DATA LOADING (REAL VS TEST)
// ==========================================

// --- 4.1 Test Data Loader (Fake Data) ---
function loadTestData() {
    // Fake Client
    document.getElementById('portalClientName').innerText = "John Doe (Test)";
    document.getElementById('modalPhone').innerText = "0977-000-000";
    document.getElementById('modalID').innerText = "123456/10/1";
    document.getElementById('modalAddress').innerText = "123 Test Street, Lusaka";

    // Fake Loans Array
    const fakeLoans = [
        {
            date: new Date().toISOString(), // Today
            amount: 500,
            interestRate: 20, // 20%
            amountPaid: 0,
            dueDate: new Date(Date.now() + 86400000 * 5).toISOString() // 5 days from now
        },
        {
            date: "2025-10-01",
            amount: 1000,
            interestRate: 20,
            amountPaid: 1200, // Fully Paid
            dueDate: "2025-11-01"
        }
    ];

    renderLoansTable(fakeLoans);
}

// --- 4.2 Real Firebase Data Loaders ---
function loadClientData(id) {
    db.collection('clients').doc(id).get().then((doc) => {
        if (doc.exists) {
            const data = doc.data();
            document.getElementById('portalClientName').innerText = data.name;
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

// ==========================================
// 4.3 SHARED RENDERING LOGIC (Fixed Contrast)
// ==========================================
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
        // Calculations
        const principal = parseFloat(loan.amount);
        const interest = loan.interestAmount ? parseFloat(loan.interestAmount) : (principal * (loan.interestRate || 20) / 100);
        const totalDue = principal + interest;
        const paid = parseFloat(loan.amountPaid || 0);
        const balance = totalDue - paid;

        // Global Stats
        totalDebt += balance;
        totalPaid += paid;

        // Due Date Logic
        if (balance > 1) {
            activeLoansFound = true;
            const loanDate = new Date(loan.dueDate);
            if (!earliestDueDate || loanDate < earliestDueDate) {
                earliestDueDate = loanDate;
            }
        }

        // Status Logic
        let statusClass = 'status-active';
        let statusText = 'Active';
        if (balance <= 1) {
            statusClass = 'status-paid'; statusText = 'Paid';
        } else if (loan.dueDate && new Date() > new Date(loan.dueDate)) {
            statusClass = 'status-overdue'; statusText = 'Overdue';
        }

        // Color Logic: If paid, use Green (#22c55e). If debt, use Theme Text (White/Black).
        const balanceColor = balance <= 1 ? '#22c55e' : 'var(--text-main)';
        const balanceWeight = balance <= 1 ? '600' : '700';

        // Render Row
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

    // Update Header Stats
    document.getElementById('portalTotalDebt').innerText = 'K' + totalDebt.toLocaleString(undefined, {minimumFractionDigits: 2});
    document.getElementById('portalTotalPaid').innerText = 'K' + totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2});

    // Update Countdown
    updateCountdown(activeLoansFound ? earliestDueDate : null);
}

// ==========================================
// 5. COUNTDOWN & UI LOGIC (Updated for Big Hero Ring)
// ==========================================
function updateCountdown(dueDate) {
    const circle = document.getElementById('progressCircle');
    const daysText = document.getElementById('daysRemaining');
    const labelText = document.getElementById('nextDueDisplay');

    // NEW MATH: Radius is now 60px
    // Circumference = 2 * PI * r
    // 2 * 3.14159 * 60 ≈ 377
    const circumference = 377;

    circle.style.strokeDasharray = `${circumference} ${circumference}`;

    if (!dueDate) {
        // No Active Loans
        daysText.innerText = "-";
        labelText.innerText = "No Dues";
        circle.style.strokeDashoffset = circumference;
        circle.className = "progress-ring__circle";
        labelText.style.color = "var(--text-muted)";
        return;
    }

    // Calculate Days
    const now = new Date();
    const diffTime = dueDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    daysText.innerText = diffDays > 0 ? diffDays : "!";

    // Format Date (e.g., "Oct 24, 2025")
    labelText.innerText = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    // Ring Progress Logic (Scale based on 30 days)
    let percent = Math.max(0, Math.min(diffDays, 30)) / 30;
    const offset = circumference - (percent * circumference);
    circle.style.strokeDashoffset = offset;

    // Color Logic
    circle.className = "progress-ring__circle"; // Reset class

    if (diffDays <= 0) {
        // Overdue (Red)
        circle.classList.add('ring-danger');
        labelText.innerText = "Overdue!";
        labelText.style.color = "#ef4444";
    } else if (diffDays <= 5) {
        // Warning (Orange)
        circle.classList.add('ring-warning');
        labelText.style.color = "#f59e0b";
    } else {
        // Safe (Green)
        circle.classList.add('ring-safe');
        labelText.style.color = "var(--text-main)";
    }
}

// ==========================================
// 6. MODALS
// ==========================================
function openProfileModal() { document.getElementById('profileModal').style.display = 'flex'; }
function closeProfileModal() { document.getElementById('profileModal').style.display = 'none'; }
function openUploadModal() { document.getElementById('uploadModal').style.display = 'flex'; }
function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('fileName').innerText = "";
    document.getElementById('dropZone').style.borderColor = "rgba(255, 255, 255, 0.2)";
    document.getElementById('dropZone').style.color = "#94a3b8";
}

// Upload Logic
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('paymentFile');

if(dropZone){
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            document.getElementById('fileName').innerText = "Selected: " + this.files[0].name;
            dropZone.style.borderColor = "#4ade80";
            dropZone.style.color = "#4ade80";
        }
    });
}

function submitPaymentProof() {
    const file = fileInput.files[0];
    if (!file && !isTestMode) {
        alert("Please select an image.");
        return;
    }
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

// Close Modals on Outside Click
window.onclick = function(event) {
    if (event.target == document.getElementById('profileModal')) closeProfileModal();
    if (event.target == document.getElementById('uploadModal')) closeUploadModal();
}

// ==========================================
// 7. LOAN REQUEST LOGIC (NEW)
// ==========================================

function openRequestModal() { document.getElementById('requestModal').style.display = 'flex'; }
function closeRequestModal() { document.getElementById('requestModal').style.display = 'none'; }

// Toggle NRC Uploads based on Checkbox
function toggleNRCUploads() {
    const isChecked = document.getElementById('nrcExists').checked;
    const container = document.getElementById('nrcUploadContainer');

    // Hide upload boxes if "Already Submitted" is checked
    container.style.display = isChecked ? 'none' : 'grid';
}

function submitLoanRequest() {
    // 1. Gather Data
    const amount = document.getElementById('reqAmount').value;
    const collateral = document.getElementById('reqCollateral').value;
    const value = document.getElementById('reqValue').value;
    const nrcExists = document.getElementById('nrcExists').checked;

    // 2. Validation
    if (!amount || !collateral || !value) {
        alert("Please fill in Amount, Collateral, and Value.");
        return;
    }

    const btn = document.getElementById('requestBtn');
    btn.innerText = "Generating Request...";

    setTimeout(() => {
        const clientName = document.getElementById('portalClientName').innerText;

        // 3. Construct Message
        let msg = `*NEW LOAN APPLICATION*\n`;
        msg += `Client: ${clientName}\n`;
        msg += `Amount: K${amount}\n`;
        msg += `Item: ${collateral}\n`;
        msg += `Value: K${value}\n\n`;

        if (nrcExists) {
            msg += `[NRC Already on File]`;
        } else {
            msg += `[Sending NRC Photos Now...]`;
        }

        msg += `\n[Sending Collateral Photos Now...]`;

        // 4. Redirect to WhatsApp
        const waLink = `https://wa.me/260970000000?text=${encodeURIComponent(msg)}`;
        window.open(waLink, '_blank');

        // 5. Reset
        btn.innerText = "Continue in WhatsApp";
        setTimeout(() => {
            closeRequestModal();
            btn.innerText = "Submit Application";
        }, 2000);
    }, 1000);
}

// Update Global Click Listener to include new modal
window.onclick = function(event) {
    if (event.target == document.getElementById('profileModal')) closeProfileModal();
    if (event.target == document.getElementById('uploadModal')) closeUploadModal();
    if (event.target == document.getElementById('requestModal')) closeRequestModal(); // New
}