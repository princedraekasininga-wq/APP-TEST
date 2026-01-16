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
// 2. GREETING LOGIC
// ==========================================
function setDynamicGreeting() {
    const hour = new Date().getHours();
    const greetingEl = document.getElementById('greetingText');

    if (hour < 12) greetingEl.innerText = "Good Morning,";
    else if (hour < 18) greetingEl.innerText = "Good Afternoon,";
    else greetingEl.innerText = "Good Evening,";
}

// ==========================================
// 3. PAGE INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 3.1 Set Greeting
    setDynamicGreeting();

    // 3.2 Get Client ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const clientId = urlParams.get('id');

    if (!clientId) {
        document.getElementById('portalClientName').innerText = "Error: No ID Found";
        console.error("No Client ID in URL");
        return;
    }

    // 3.3 Load Data
    loadClientData(clientId);
    loadLoansData(clientId);
});

// ==========================================
// 4. DATA FETCHING & UI UPDATES
// ==========================================

// --- 4.1 Load Client Profile ---
function loadClientData(id) {
    db.collection('clients').doc(id).get().then((doc) => {
        if (doc.exists) {
            const data = doc.data();
            // Header Name
            document.getElementById('portalClientName').innerText = data.name;

            // Modal Details
            document.getElementById('modalPhone').innerText = data.phone || "Not set";
            document.getElementById('modalID').innerText = data.idNumber || "Not set";
            document.getElementById('modalAddress').innerText = data.address || "Not set";
        } else {
            document.getElementById('portalClientName').innerText = "Client Not Found";
        }
    }).catch((error) => {
        console.error("Error fetching client:", error);
    });
}

// --- 4.2 Load Loan History & Countdown Logic ---
function loadLoansData(id) {
    const tableBody = document.getElementById('portalLoansTable');

    // Stats Trackers
    let totalDebt = 0;
    let totalPaid = 0;

    // Countdown Trackers
    let earliestDueDate = null;
    let activeLoansFound = false;

    db.collection('loans').where('clientId', '==', id).onSnapshot((snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No history found.</td></tr>';
            updateCountdown(null); // Reset ring
            return;
        }

        tableBody.innerHTML = '';

        snapshot.forEach((doc) => {
            const loan = doc.data();

            // 1. Math
            const principal = parseFloat(loan.amount);
            const interest = loan.interestAmount ? parseFloat(loan.interestAmount) : (principal * (loan.interestRate || 20) / 100);
            const totalDue = principal + interest;
            const paid = parseFloat(loan.amountPaid || 0);
            const balance = totalDue - paid;

            // 2. Global Stats
            totalDebt += balance;
            totalPaid += paid;

            // 3. Find Earliest Active Due Date
            if (balance > 1) { // If loan is active
                activeLoansFound = true;
                const loanDate = new Date(loan.dueDate); // Ensure this field exists in DB!

                // If this is the first active loan found OR this date is sooner than the stored one
                if (!earliestDueDate || loanDate < earliestDueDate) {
                    earliestDueDate = loanDate;
                }
            }

            // 4. Status Badge Logic
            let statusClass = 'status-active';
            let statusText = 'Active';
            if (balance <= 1) {
                statusClass = 'status-paid'; statusText = 'Paid';
            } else if (loan.dueDate && new Date() > new Date(loan.dueDate)) {
                statusClass = 'status-overdue'; statusText = 'Overdue';
            }

            // 5. Render Table Row
            const row = `
                <tr>
                    <td data-label="Date">${new Date(loan.date).toLocaleDateString()}</td>
                    <td data-label="Amount">K${principal.toFixed(2)}</td>
                    <td data-label="Total Due">K${totalDue.toFixed(2)}</td>
                    <td data-label="Paid">K${paid.toFixed(2)}</td>
                    <td data-label="Balance" style="font-weight:bold; color: ${balance <= 1 ? '#4ade80' : 'white'}">K${balance.toFixed(2)}</td>
                    <td data-label="Status"><span class="status-pill ${statusClass}">${statusText}</span></td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });

        // Update Text Stats
        document.getElementById('portalTotalDebt').innerText = 'K' + totalDebt.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('portalTotalPaid').innerText = 'K' + totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2});

        // Trigger Countdown Update
        updateCountdown(activeLoansFound ? earliestDueDate : null);
    });
}

// --- NEW: COUNTDOWN RING LOGIC ---
function updateCountdown(dueDate) {
    const circle = document.getElementById('progressCircle');
    const daysText = document.getElementById('daysRemaining');
    const labelText = document.getElementById('nextDueDisplay');

    // SVG Geometry (Radius 30) -> Circumference = 2 * PI * 30 ≈ 188.5
    const circumference = 188.5;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;

    if (!dueDate) {
        // No Active Loans
        daysText.innerText = "-";
        labelText.innerText = "No Dues";
        circle.style.strokeDashoffset = circumference; // Empty ring
        circle.className = "progress-ring__circle"; // Remove colors
        return;
    }

    // Calculate Days Remaining
    const now = new Date();
    const diffTime = dueDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Visual Display Logic
    daysText.innerText = diffDays > 0 ? diffDays : "!";
    labelText.innerText = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    // Ring Logic (Assume 30 day loan cycle for progress bar scale)
    // If 30 days left -> Full Ring. If 0 days -> Empty Ring.
    let percent = Math.max(0, Math.min(diffDays, 30)) / 30;
    const offset = circumference - (percent * circumference);
    circle.style.strokeDashoffset = offset;

    // Color Logic
    circle.className = "progress-ring__circle"; // Reset
    if (diffDays <= 0) {
        circle.classList.add('ring-danger'); // Overdue
        labelText.innerText = "Overdue!";
        labelText.style.color = "#f87171";
    } else if (diffDays <= 5) {
        circle.classList.add('ring-warning'); // Due Soon
        labelText.style.color = "#fbbf24";
    } else {
        circle.classList.add('ring-safe'); // Safe
        labelText.style.color = "white";
    }
}


// ==========================================
// 5. PROFILE MODAL LOGIC
// ==========================================
function openProfileModal() {
    document.getElementById('profileModal').style.display = 'flex';
}
function closeProfileModal() {
    document.getElementById('profileModal').style.display = 'none';
}

// ==========================================
// 6. UPLOAD PAYMENT PROOF LOGIC (NEW)
// ==========================================

// --- 6.1 Modal Controls ---
function openUploadModal() {
    document.getElementById('uploadModal').style.display = 'flex';
}
function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    // Reset modal state
    document.getElementById('fileName').innerText = "";
    document.getElementById('dropZone').style.borderColor = "rgba(255, 255, 255, 0.2)";
    document.getElementById('dropZone').style.color = "#94a3b8";
}

// --- 6.2 Drag & Drop Visuals ---
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('paymentFile');

// Trigger file input when clicking the box
dropZone.addEventListener('click', () => fileInput.click());

// Visual feedback when file is selected
fileInput.addEventListener('change', function() {
    if (this.files && this.files[0]) {
        document.getElementById('fileName').innerText = "Selected: " + this.files[0].name;
        dropZone.style.borderColor = "#4ade80"; // Turn Green
        dropZone.style.color = "#4ade80";
        dropZone.style.background = "rgba(74, 222, 128, 0.1)";
    }
});

// --- 6.3 Submit & Redirect ---
function submitPaymentProof() {
    const file = fileInput.files[0];
    if (!file) {
        alert("Please select an image/screenshot first.");
        return;
    }

    const btn = document.getElementById('uploadBtn');
    const originalText = btn.innerText;
    btn.innerText = "Processing...";

    // Simulate upload delay for user experience
    setTimeout(() => {
        const clientName = document.getElementById('portalClientName').innerText;

        // Construct WhatsApp Message
        const msg = `*PAYMENT PROOF SUBMISSION*\n\nClient: ${clientName}\nFile: [Image Attached]\n\nPlease verify my payment.`;

        // Open WhatsApp
        const waLink = `https://wa.me/260970000000?text=${encodeURIComponent(msg)}`;
        window.open(waLink, '_blank');

        // Reset Button
        btn.innerText = "Sent! (Verify in WhatsApp)";

        setTimeout(() => {
            closeUploadModal();
            btn.innerText = originalText;
        }, 1500);
    }, 1000);
}

// ==========================================
// GLOBAL EVENT LISTENER (Close Modals on Outside Click)
// ==========================================
window.onclick = function(event) {
    const profileModal = document.getElementById('profileModal');
    const uploadModal = document.getElementById('uploadModal');

    if (event.target == profileModal) {
        profileModal.style.display = "none";
    }
    if (event.target == uploadModal) {
        closeUploadModal();
    }
}