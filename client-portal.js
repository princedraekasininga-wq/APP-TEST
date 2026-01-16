// ==========================================
// CLIENT PORTAL JS
// ==========================================

// --- 1. FIREBASE CONFIG ---
// !!! PASTE YOUR KEYS HERE from your main app.js !!!
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

// --- 2. GREETING LOGIC ---
function setDynamicGreeting() {
    const hour = new Date().getHours();
    const greetingEl = document.getElementById('greetingText');

    if (hour < 12) greetingEl.innerText = "Good Morning,";
    else if (hour < 18) greetingEl.innerText = "Good Afternoon,";
    else greetingEl.innerText = "Good Evening,";
}

// --- 3. PAGE LOAD LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    setDynamicGreeting();

    const urlParams = new URLSearchParams(window.location.search);
    const clientId = urlParams.get('id');

    if (!clientId) {
        document.getElementById('portalClientName').innerText = "Error: No ID";
        return;
    }

    loadClientData(clientId);
    loadLoansData(clientId);
});

// --- 4. FETCH DATA ---
function loadClientData(id) {
    db.collection('clients').doc(id).get().then((doc) => {
        if (doc.exists) {
            const data = doc.data();
            document.getElementById('portalClientName').innerText = data.name;

            // Fill Modal Data
            document.getElementById('modalPhone').innerText = data.phone || "Not set";
            document.getElementById('modalID').innerText = data.idNumber || "Not set";
            document.getElementById('modalAddress').innerText = data.address || "Not set";
        } else {
            document.getElementById('portalClientName').innerText = "Client Not Found";
        }
    });
}

function loadLoansData(id) {
    const tableBody = document.getElementById('portalLoansTable');
    let totalDebt = 0;
    let totalPaid = 0;
    let activeCount = 0;

    db.collection('loans').where('clientId', '==', id).onSnapshot((snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#aaa;">No active loan history found.</td></tr>';
            return;
        }

        tableBody.innerHTML = ''; // Clear loading text

        snapshot.forEach((doc) => {
            const loan = doc.data();

            // Math
            const principal = parseFloat(loan.amount);
            const interest = loan.interestAmount ? parseFloat(loan.interestAmount) : (principal * (loan.interestRate || 20) / 100);
            const totalDue = principal + interest;
            const paid = parseFloat(loan.amountPaid || 0);
            const balance = totalDue - paid;

            // Stats Aggregation
            totalDebt += balance;
            totalPaid += paid;
            if (balance > 1) activeCount++;

            // Status Badge Logic
            let statusClass = 'status-active';
            let statusText = 'Active';
            if (balance <= 1) { statusClass = 'status-paid'; statusText = 'Paid'; }
            else if (new Date() > new Date(loan.dueDate)) { statusClass = 'status-overdue'; statusText = 'Overdue'; }

            const row = `
                <tr>
                    <td>${new Date(loan.date).toLocaleDateString()}</td>
                    <td>${principal.toFixed(2)}</td>
                    <td>${totalDue.toFixed(2)}</td>
                    <td>${paid.toFixed(2)}</td>
                    <td style="font-weight:bold; color: ${balance <= 1 ? '#4ade80' : 'white'}">${balance.toFixed(2)}</td>
                    <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });

        // Update Header Stats
        document.getElementById('portalTotalDebt').innerText = 'K' + totalDebt.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('portalTotalPaid').innerText = 'K' + totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('portalActiveCount').innerText = activeCount;
    });
}

// --- 5. MODAL FUNCTIONS ---
function openProfileModal() {
    document.getElementById('profileModal').style.display = 'flex';
}
function closeProfileModal() {
    document.getElementById('profileModal').style.display = 'none';
}
// Close on outside click
window.onclick = function(event) {
    const modal = document.getElementById('profileModal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
}