// ==========================================
// STALLZ Client Portal Settings
// ==========================================
const ENABLE_NRC_UPLOAD = false; // Set to FALSE to skip upload validation & logic


// ==========================================
// 0. SAFE HTML UTILS
// ==========================================
function escapeHTML(input = "") {
  const s = String(input ?? "");
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (ch) => map[ch]);
}

// ==========================================
// 1. CONFIGURATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyBRMITHX8gm0jKpEXuC4iePGWoYON85BDU",
    authDomain: "stallz-loans.firebaseapp.com",
    projectId: "stallz-loans",
    storageBucket: "stallz-loans.firebasestorage.app",
    messagingSenderId: "496528682",
    appId: "1:496528682:web:26066f0ca7d440fb854253"
};

// Global Variables
let currentUserPhone = null;
let selectedRate = 0.20;
let currentUserUid = null;


// UI Caches
let __clientLoansCache = [];
let __latestLoanRequest = null;
// ==========================================================================
// 2. SHARED SESSION BOOTSTRAP (With Splash Screen & Race Condition Fix)
// ==========================================================================
function bootstrapSharedSession() {
    (async () => {
        try {
            console.log("⏳ Starting Portal...");
            const user = await window.StallzAuth?.onceAuthState?.();

            if (!user) {
                window.location.href = "../index.html";
                return;
            }

            currentUserUid = user.uid;

            if (typeof firebase !== "undefined") {
                // Listen to the specific client's secure node
                const userRef = firebase.database().ref(`clients/${currentUserUid}`);

                userRef.on('value', (snapshot) => {
                    const val = snapshot.val() || {};

                    // Update name and greeting
                    updateHeaderGreeting(val);
                    currentUserPhone = val.phone || "";
                    localStorage.setItem("stallz_client_profile", JSON.stringify(val));

                    // FIX: Ensure loans array is always correctly parsed
                    // If val.loans is an object (Firebase format), convert to Array
                    if (val.loans) {
                        const myLoans = Object.values(val.loans).filter(l => l && typeof l === "object");

                        // De-dupe by loan.id (keeps the most recently updated copy)
                        const byId = new Map();
                        myLoans.forEach((ln) => {
                          const key = (ln && ln.id !== undefined && ln.id !== null) ? String(ln.id) : "";
                          if (!key) return;
                          const t = Date.parse(ln.updatedAt || ln.createdAt || "");
                          const ts = isNaN(t) ? 0 : t;
                          const prev = byId.get(key);
                          if (!prev || ts >= prev.ts) byId.set(key, { loan: ln, ts });
                        });

                        const deduped = Array.from(byId.values()).map(x => x.loan);
                        renderLoansTable(deduped);
                        renderLoanRequestProgress(val.requests || null);
                    } else {
                        renderLoansTable([]); // Triggers empty state UI
                        renderLoanRequestProgress(val.requests || null);
                    }

                    hideAppLoader();
                });
            }

            if(window.StallzShared?.ensureSeed) window.StallzShared.ensureSeed();
            if(window.StallzShared?.subscribe) {
                window.StallzShared.subscribe(() => {
                    renderSharedNotifications();
                });
            }

        } catch (e) {
            console.error("Session Error:", e);
            hideAppLoader();
        }
    })();

    setTimeout(hideAppLoader, 5000);
}
// --- LOADER UTILS ---
function hideAppLoader() {
    const loader = document.getElementById("appLoader");
    if (loader) {
        loader.classList.add("hidden");
        // Remove from DOM after transition to free up memory
        setTimeout(() => { loader.style.display = 'none'; }, 700);
    }
}

// ==========================================================================
// 3. MAIN INITIALIZATION (ON LOAD)
// ==========================================================================
function initClientPortal() {
    // 3.1 Initialize Calculator Listeners
    const rangeInput = document.getElementById('calcRange');
    if(rangeInput) {
        rangeInput.addEventListener('input', updateCalculator);
        setupDurationButtons();
        updateCalculator();
    }

    // 3.2 THEME LOGIC
    const savedTheme = localStorage.getItem('stallz-theme');
    const currentHour = new Date().getHours();

    if (savedTheme === 'day') {
        document.body.classList.add('day-mode');
    } else if (savedTheme === 'night') {
        document.body.classList.remove('day-mode');
    } else if (currentHour >= 6 && currentHour < 18) {
        document.body.classList.add('day-mode');
    }

    // 3.3 Boot shared session
    bootstrapSharedSession();

    // 3.4 Close modals if user clicks outside
    window.onclick = function(event) {
        if (event.target.className === 'modal-overlay' || event.target.className === 'drawer-overlay') {
            event.target.style.display = 'none';
        }
        if (!event.target.closest('.notification-wrapper')) {
            const dropdown = document.getElementById('notificationDropdown');
            if (dropdown) dropdown.style.display = 'none';
        }
    }
}
// ==========================================================================
// 4. HEADER & NOTIFICATIONS
// ==========================================================================

function toggleNotifications() {
    const dropdown = document.getElementById("notificationDropdown");
    const list = document.getElementById("notificationList");

    if (!dropdown || !list) return;

    const isVisible = dropdown.style.display === "flex";
    dropdown.style.display = isVisible ? "none" : "flex";

    if (!isVisible) {
        renderSharedNotifications();
    }
}

function updateHeaderGreeting(profile) {
    if (!profile) return;

    const headerTitle = document.getElementById('headerGreeting');
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarAvatar = document.getElementById('sidebarAvatar');

    // Force Uppercase Logic
    const rawName = profile.name || profile.email || "CLIENT";
    const firstName = (profile.firstName || rawName.split(" ")[0]).toUpperCase();
    const fullName = rawName.toUpperCase();

    // Update Header: "Hi, PRINCE"
    if (headerTitle) {
        headerTitle.innerHTML = `Hi, <span id="headerUserName" style="color:var(--primary); font-weight:bold;">${firstName}</span>`;
    }

    // Update Sidebar
    if (sidebarName) sidebarName.textContent = fullName;
}

// ==========================================================================
// 5. DATA RENDERING
// ==========================================================================

function renderLoansTable(loansData) {
    // We target the new list container (fallback to old table ID just in case)
    const container = document.getElementById('portalLoansList') || document.getElementById('portalLoansTable');
    if (!container) return;

    // Reset Totals
    let totalDebt = 0;
    let totalPaid = 0;
    let earliestDueDate = null;

    __clientLoansCache = Array.isArray(loansData) ? loansData.slice() : [];
    container.innerHTML = '';

    // 1. EMPTY STATE
    if (!loansData || loansData.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 40px 20px; color:var(--text-muted); background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                <div style="font-size:3rem; margin-bottom:15px; opacity:0.2;">💸</div>
                <div style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin-bottom:8px;">No active loans found</div>
                <div style="font-size:0.85rem; opacity:0.7; max-width:250px; margin:0 auto; line-height:1.4;">
                    Your approved loans and payment progress will appear here.
                    Tap <strong>"Request Loan"</strong> below to get started.
                </div>
            </div>
        `;
        // Reset Dashboard Counters
        if(document.getElementById('portalTotalDebt')) document.getElementById('portalTotalDebt').innerText = 'K0.00';
        if(document.getElementById('portalTotalPaid')) document.getElementById('portalTotalPaid').innerText = 'K0.00';
        if(document.getElementById('paymentProgressDisplay')) document.getElementById('paymentProgressDisplay').innerText = "--";
        updateCountdownRing(null, 0);
        return;
    }

    // 2. SORTING (Active first, then by ID)
    loansData.sort((a, b) => {
        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
        if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
        return b.id - a.id;
    });

    // 3. RENDER CARDS
    container.innerHTML = loansData.map(loan => {
        const total = Number(loan.totalDue || 0);
        const paid = Number(loan.paid || 0);
        const balance = Number(loan.balance || 0);
        const percent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

        // Calculate Totals for Dashboard
        if (loan.status === 'ACTIVE' || loan.status === 'OVERDUE') {
            totalDebt += balance;
            totalPaid += paid; // Track what has been paid on active loans
        }

        // Track earliest due date for active loans
        if ((loan.status === 'ACTIVE' || loan.status === 'OVERDUE') && loan.dueDate) {
            const due = new Date(loan.dueDate);
            if (!earliestDueDate || due < earliestDueDate) earliestDueDate = due;
        }

        // Status Styling
        const statusClass = (loan.status || 'ACTIVE').toLowerCase();
        let statusLabel = loan.status;
        if(statusLabel === 'DEFAULTED') statusLabel = 'CLOSED';

        return `
            <div class="m-loan-card status-${statusClass}">
                <div class="m-loan-header">
                    <div class="m-loan-title-group">
                        <span class="m-loan-id">#${loan.id}</span>
                        <span class="m-loan-item">${escapeHTML(loan.collateralItem || 'Personal Loan')}</span>
                        <span class="m-loan-date"><i class="far fa-calendar-alt" style="margin-right:4px;"></i> ${new Date(loan.startDate).toLocaleDateString()}</span>
                    </div>
                    <span class="status-badge ${statusClass}">${statusLabel}</span>
                </div>

                <div class="m-loan-body">
                    <div class="m-loan-row">
                        <span class="m-loan-label">Principal Amount</span>
                        <span class="m-loan-val highlight">K${Number(loan.amount).toLocaleString()}</span>
                    </div>
                    <div class="m-loan-row">
                        <span class="m-loan-label">Total to Repay</span>
                        <span class="m-loan-val">K${total.toLocaleString()}</span>
                    </div>

                    <div style="margin-top: 8px;">
                        <div class="m-loan-row" style="margin-bottom: 4px;">
                            <span class="m-loan-label">Amount Paid (${percent}%)</span>
                            <span class="m-loan-val ${paid > 0 ? 'text-success' : ''}">K${paid.toLocaleString()}</span>
                        </div>
                        <div class="m-loan-progress-bg">
                            <div class="m-loan-progress-fill ${statusClass}" style="width: ${percent}%"></div>
                        </div>
                    </div>
                </div>

                <div class="m-loan-footer">
                    <span class="m-loan-balance-label">Remaining Balance</span>
                    <span class="m-loan-balance-val ${loan.status === 'OVERDUE' ? 'text-danger' : (balance === 0 ? 'text-success' : '')}">
                        K${balance.toLocaleString()}
                    </span>
                </div>

                <div class="m-loan-actions">
                    <button class="mini-btn" onclick="openStatementsModal(${loan.id}); event.stopPropagation();">
                        <i class="fas fa-file-invoice"></i>
                        Statement
                    </button>
                    ${(loan.status === 'ACTIVE' || loan.status === 'OVERDUE') ? `
                    <button class="mini-btn mini-btn-primary" onclick="openPayModal(); event.stopPropagation();">
                        <i class="fas fa-mobile-alt"></i>
                        Pay
                    </button>` : ``}
                </div>
            </div>
        `;
    }).join("");

    // 4. UPDATE DASHBOARD STATS
    if(document.getElementById('portalTotalDebt')) {
        animateValue(document.getElementById('portalTotalDebt'), 0, totalDebt, 1000);
    }
    if(document.getElementById('portalTotalPaid')) {
        document.getElementById('portalTotalPaid').innerText = `K${totalPaid.toLocaleString()}`;
    }

    // 5. UPDATE RING (Next Due Date)
    if (earliestDueDate) {
        // Calculate overall health (Total Paid vs Total Due of ACTIVE loans)
        const totalActiveDue = totalDebt + totalPaid;
        const healthPercent = totalActiveDue > 0 ? (totalPaid / totalActiveDue) : 0;
        updateCountdownRing(earliestDueDate, healthPercent);
    } else {
        updateCountdownRing(null, 0);
    }
}

// Helper for animation (if not already in file)
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
            obj.innerHTML = "K" + end.toLocaleString();
        }
    };
    window.requestAnimationFrame(step);
}
// ==========================================================================
// 6. GAUGE RING LOGIC
// ==========================================================================

function updateCountdownRing(dueDate, percentFraction = 0) {
    const outerCircle = document.getElementById('progressCircle');
    const handleGroup = document.getElementById('ringHandleGroup');
    const daysText = document.getElementById('daysRemaining');
    const nextDueText = document.getElementById('nextDueDisplay');

    if (!outerCircle) return;

    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    outerCircle.style.strokeDasharray = circumference;

    if (!dueDate) {
        outerCircle.style.strokeDashoffset = circumference;
        if(handleGroup) {
            handleGroup.style.transform = `rotate(0deg)`;
            handleGroup.style.opacity = '0';
        }
        if(daysText) daysText.innerText = "--";
        if(nextDueText) nextDueText.innerText = "--";
    } else {
        const diffTime = dueDate - new Date();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if(daysText) daysText.innerText = diffDays > 0 ? diffDays : "0";
        if(nextDueText) nextDueText.innerText = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

        const safeFraction = Math.min(Math.max(percentFraction, 0), 1);
        const offset = circumference - (safeFraction * circumference);

        outerCircle.style.strokeDashoffset = offset;

        if(handleGroup) {
            const degrees = safeFraction * 360;
            handleGroup.style.transform = `rotate(${degrees}deg)`;
            handleGroup.style.opacity = '1';
        }
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

// --- ADMIN CONTACT DIRECTORY LOGIC ---
let currentContactAction = ''; // stores 'whatsapp' or 'call'

function openAdminContactModal(actionType) {
    currentContactAction = actionType;

    // Close the FAB menu if it's open
    const fabMenu = document.getElementById('fabMenu');
    if (fabMenu) fabMenu.classList.remove('active');

    // Update Title based on action
    const titleEl = document.getElementById('adminContactTitle');
    if(titleEl) {
        titleEl.innerHTML = actionType === 'whatsapp'
            ? '<i class="fab fa-whatsapp" style="color:#25D366; margin-right:8px;"></i> WhatsApp'
            : '<i class="fas fa-phone" style="color:#3b82f6; margin-right:8px;"></i> Call Us';
    }

    document.getElementById('adminContactModal').style.display = 'flex';
    fetchAndRenderAdmins();
}

function closeAdminContactModal() {
    document.getElementById('adminContactModal').style.display = 'none';
}

async function fetchAndRenderAdmins() {
    const listEl = document.getElementById('adminContactList');
    listEl.innerHTML = `
        <div style="text-align:center; padding: 30px; color: var(--text-muted);">
            <i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; margin-bottom: 10px; color: var(--primary);"></i>
            <p>Loading admins...</p>
        </div>
    `;

    try {
        // Fetch all admins from the database
        const snapshot = await firebase.database().ref('admins').once('value');
        const admins = snapshot.val() || {};

        const adminKeys = Object.keys(admins);
        if (adminKeys.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">No admins currently available.</div>`;
            return;
        }

        let html = '';
        adminKeys.forEach(uid => {
            const admin = admins[uid];
            const name = admin.name || admin.firstname || 'Support Agent';
            const role = admin.role || 'Admin';
            const phone = admin.phone || admin.phoneNumber || ""; // Checks for phone number

            html += `
                <div class="support-item" onclick="executeAdminContact('${phone}', '${escapeHTML(name)}')" style="cursor:pointer; display:flex; align-items:center; gap:15px; background:rgba(255,255,255,0.03); padding:15px; border-radius:12px; border:1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
                    <div class="drawer-avatar" style="width:45px; height:45px; font-size:1.2rem; background:rgba(255,255,255,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center;">
                        <i class="fas fa-user-tie" style="color:var(--text-main);"></i>
                    </div>
                    <div style="flex:1; text-align:left;">
                        <h4 style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text-main);">${escapeHTML(name)}</h4>
                        <p style="margin:0; font-size:0.85rem; color:var(--text-muted); opacity: 0.8;">${escapeHTML(role)}</p>
                    </div>
                    <div style="color:var(--text-muted); opacity:0.5;"><i class="fas fa-chevron-right"></i></div>
                </div>
            `;
        });

        listEl.innerHTML = html;

    } catch (error) {
        console.error("Error fetching admins:", error);
        listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: #ef4444;">Could not load admin directory.</div>`;
    }
}

function executeAdminContact(phone, adminName) {
    if (!phone || phone.trim() === "") {
        showCustomAlert(`${adminName} has not added a contact number to their profile yet.`);
        return;
    }

    // Clean the phone number (strip spaces/dashes)
    let cleanPhone = phone.replace(/[^0-9+]/g, '');

    // Auto-format Zambian numbers starting with '0' to '+260' just to be safe
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '+260' + cleanPhone.substring(1);
    }

    if (currentContactAction === 'whatsapp') {
        // WhatsApp link requires the number without the '+'
        let waPhone = cleanPhone.replace('+', '');
        window.open(`https://wa.me/${waPhone}`, '_blank');
    } else if (currentContactAction === 'call') {
        // Phone app protocol
        window.location.href = `tel:${cleanPhone}`;
    }

    closeAdminContactModal();
}
 // --- DYNAMIC PAYMENT METHODS LOGIC ---
async function fetchAndRenderPaymentMethods() {
    const list = document.getElementById("paymentMethodsList");
    if (!list) return;

    // Helpers
    const safeGet = async (ref) => {
        if (!ref) return null;
        if (typeof ref.get === "function") return await ref.get();
        return await ref.once("value");
    };

    const normalizePhone = (phone) => String(phone || "").trim();
    const guessNetwork = (phone) => {
        const digits = normalizePhone(phone).replace(/\D/g, "");
        if (!digits) return "";
        // Zambia prefixes (rough): Airtel 097/077/076, MTN 096/066, Zamtel 095
        if (/^(260)?97|^(260)?77|^(260)?76/.test(digits)) return "Airtel";
        if (/^(260)?96|^(260)?66/.test(digits)) return "MTN";
        if (/^(260)?95/.test(digits)) return "Zamtel";
        return "Mobile Money";
    };

    const render = (methods, noteHtml = "") => {
        const clean = (methods || [])
            .filter(Boolean)
            .map(m => ({
                name: String(m.name || m.adminName || m.label || "Admin").trim(),
                phone: normalizePhone(m.phone || m.number || m.value || ""),
                network: String(m.network || guessNetwork(m.phone || m.number || m.value || "")).trim()
            }))
            .filter(m => m.phone);

        if (!clean.length) {
            list.innerHTML = `
                <div style="padding:12px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-weight:700; margin-bottom:6px;">No payment methods available</div>
                    <div style="opacity:0.75; font-size:0.9rem;">
                        Ask an admin to open the Admin Dashboard once to sync payment numbers to your account.
                    </div>
                    ${noteHtml || ""}
                </div>
            `;
            return;
        }

        list.innerHTML = clean.map((m) => {
            const phoneEsc = escapeHTML(m.phone);
            const nameEsc = escapeHTML(m.name);
            const netEsc = escapeHTML(m.network || "Mobile Money");

            return `
                <div class="payment-card" onclick="copyToClipboard('${phoneEsc}', 'Copied: ${phoneEsc}')">
                    <div class="payment-card-left">
                        <div class="payment-card-title">${nameEsc}</div>
                        <div class="payment-card-sub">${phoneEsc}</div>
                    </div>
                    <div class="payment-card-right">
                        <span class="payment-badge">${netEsc}</span>
                        <span class="payment-copy">Tap to copy</span>
                    </div>
                </div>
            `;
        }).join("") + (noteHtml || "");
    };

    // Loading state
    list.innerHTML = `<div style="padding:12px; opacity:0.8;">Loading payment methods…</div>`;

    // Must be authenticated
    if (!currentUserUid || typeof firebase === "undefined" || !firebase.database) {
        render([], `<div style="margin-top:10px; opacity:0.8; font-size:0.9rem;">Please sign in again, then try.</div>`);
        return;
    }

    // 1) Preferred (works with strict rules): clients/{uid}/paymentMethods
    try {
        const snap = await safeGet(firebase.database().ref(`clients/${currentUserUid}/paymentMethods`));
        const val = snap && typeof snap.val === "function" ? snap.val() : null;

        if (val) {
            const methods = Array.isArray(val) ? val : Object.values(val);
            render(methods);
            return;
        }
    } catch (e) {
        // fall through to root admins
        console.warn("Client paymentMethods read failed:", e);
    }

    // 2) Fallback: root admins (may be blocked by rules)
    try {
        const snap = await safeGet(firebase.database().ref("admins"));
        const admins = snap && typeof snap.val === "function" ? snap.val() : null;
        const methods = admins ? Object.values(admins) : [];
        render(methods, `<div style="margin-top:12px; opacity:0.8; font-size:0.9rem;">If you still see this error, your Firebase rules may block clients from reading admin contacts.</div>`);
        return;
    } catch (e) {
        console.error("Payment methods load failed:", e);
        const msg = (e && e.message) ? e.message : "Permission denied or offline.";
        render([], `<div style="margin-top:10px; opacity:0.8; font-size:0.9rem;">Reason: ${escapeHTML(msg)}</div>`);
    }
}

function openProfileModal() { document.getElementById('profileModal').style.display = 'flex'; }
function closeProfileModal() { document.getElementById('profileModal').style.display = 'none'; }

function openCalcModal() { document.getElementById('calcModal').style.display = 'flex'; }
function closeCalcModal() { document.getElementById('calcModal').style.display = 'none'; }

function openRequestModal() {
    document.getElementById('requestModal').style.display = 'flex';
}
function closeRequestModal() {
    document.getElementById('requestModal').style.display = 'none';
    hideRequestError(); // Clear errors when closed
}

// Helper to show/hide inline errors
function showRequestError(message) {
    const errBox = document.getElementById('requestModalError');
    const errText = document.getElementById('requestModalErrorText');
    if (errBox && errText) {
        errText.textContent = message;
        errBox.style.display = 'block';
    } else {
        showCustomAlert(message); // Fallback just in case
    }
}
function hideRequestError() {
    const errBox = document.getElementById('requestModalError');
    if (errBox) errBox.style.display = 'none';
}

function openUploadModal() { document.getElementById('uploadModal').style.display = 'flex'; }
function closeUploadModal() { document.getElementById('uploadModal').style.display = 'none'; }

function openPayModal() {
    document.getElementById('payModal').style.display = 'flex';
    fetchAndRenderPaymentMethods(); // Fetch the real numbers when opened
}
function closePayModal() { document.getElementById('payModal').style.display = 'none'; }

// Close the receipt modal (client side)
function closeClientReceiptModal() {
    const m = document.getElementById('clientReceiptModal');
    if (m) m.style.display = 'none';
}

function openSupportModal() { document.getElementById('supportModal').style.display = 'flex'; }
function closeSupportModal() { document.getElementById('supportModal').style.display = 'none'; }

// --- CUSTOM CONFIRM LOGIC ---
let __confirmCallback = null;

function showCustomConfirm(message, callback) {
    const modal = document.getElementById('customConfirmModal');
    if (!modal) return;
    document.getElementById('customConfirmMessage').textContent = message;
    __confirmCallback = callback;
    modal.style.display = 'flex';
}

function closeCustomConfirm() {
    const modal = document.getElementById('customConfirmModal');
    if (modal) modal.style.display = 'none';
    __confirmCallback = null;
}


// --- CUSTOM ALERT (Modal) ---
function showCustomAlert(message, title = "Notice") {
    const modal = document.getElementById('customAlertModal');
    if (!modal) {
        // last-resort fallback
        window.alert(String(message ?? ""));
        return;
    }
    const titleEl = document.getElementById('customAlertTitle');
    const msgEl = document.getElementById('customAlertMessage');
    if (titleEl) titleEl.textContent = String(title ?? "Notice");
    if (msgEl) msgEl.textContent = String(message ?? "");
    modal.style.display = 'flex';
}

function closeCustomAlert() {
    const modal = document.getElementById('customAlertModal');
    if (modal) modal.style.display = 'none';
}
document.getElementById('customConfirmBtn')?.addEventListener('click', () => {
    closeCustomConfirm();
    if (__confirmCallback) __confirmCallback();
});

// --- SUBMIT HANDLER ---
function simulateSubmit(message, ev) {
    const btn = (ev && ev.target) ? ev.target : null;
    const originalText = btn ? btn.innerText : "";

    // 1. Show loading state on the button
    if(btn) btn.innerText = "Processing...";

    // 2. Simulate network delay (800ms), then show success popup
    setTimeout(() => {
        if(btn) btn.innerText = originalText; // Reset button text

        // Close any open modals
        closeRequestModal();
        closeUploadModal();
        closePayModal();

        // Show the new custom glass-morphism success alert
        showCustomAlert(message, true);

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

document.addEventListener('click', (e) => {
    const fabWrap = document.querySelector('.floating-support');
    const menu = document.getElementById('fabMenu');
    if (menu && menu.classList.contains('active') && fabWrap && !fabWrap.contains(e.target)) {
        menu.classList.remove('active');
    }
});

function toggleTheme() {
    const isDay = document.body.classList.toggle('day-mode');
    localStorage.setItem('stallz-theme', isDay ? 'day' : 'night');
}

// ==========================================================================
// 12.0 SHARED NOTIFICATIONS (LIVE)
// ==========================================================================

function renderSharedNotifications() {
    const list = document.getElementById("notificationList");
    const dot = document.querySelector(".notification-dot");

    if (!list) return;

    const uid = currentUserUid || window.StallzAuth?.getSession?.()?.uid;
    if (!uid) {
        list.innerHTML = `<div class="notify-item" style="text-align:center; color:var(--text-muted); padding: 20px;">Please sign in again.</div>`;
        if(dot) dot.style.display = "none";
        return;
    }

    // 1. Check Pending Requests
    let pendingHTML = "";
    let pendingCount = 0;
    try {
        const reqs = window.StallzShared?.listLoanRequestsForClient?.(uid) || [];
        const pending = reqs.filter(r => String(r.status || "").toUpperCase() === "PENDING");
        pendingCount = pending.length;

        if (pendingCount > 0) {
            pendingHTML = `
              <div class="notify-item" style="border-left: 3px solid rgba(56, 189, 248, 0.8);">
                <div style="font-weight:900; margin-bottom:6px;">⏳ Pending approval</div>
                <div style="opacity:0.85; font-size:0.85rem;">
                  ${pending.slice(0,3).map(r => `
                    <div style="margin:4px 0;">
                      Request #${escapeHTML(String(r.id))} • ${escapeHTML(String(r.plan || "Plan"))} • K${Number(r.amount||0).toLocaleString()}
                    </div>
                  `).join("")}
                  ${pendingCount > 3 ? `<div style="opacity:0.7; margin-top:6px;">+${pendingCount-3} more pending</div>` : ``}
                </div>
              </div>
            `;
        }
    } catch (e) {}

    // 2. Check Notifications
    let notifs = [];
    try {
        notifs = window.StallzShared?.getUserNotifications?.(uid) || [];
    } catch (e) { notifs = []; }

    // 3. Toggle Red Dot
    const totalCount = pendingCount + notifs.length;
    if (dot) dot.style.display = totalCount > 0 ? "block" : "none";

    // 4. Empty State
    if (totalCount === 0) {
        list.innerHTML = `<div class="notify-item" style="text-align:center; color:var(--text-muted); font-style:italic; padding: 20px;">No notifications.</div>`;
        return;
    }

    // 5. Render List
    const notifHTML = (notifs || []).slice(0, 25).map(n => {
        const icon = n.type === "REQUEST_APPROVED" ? "✅"
            : n.type === "REQUEST_REJECTED" ? "❌"
            : (n.type === "REQUEST_SUBMITTED" || n.type === "REQUEST_SENT") ? "📝"
            : (n.type === "ADMIN_MESSAGE" || n.type === "MESSAGE") ? "💬"
            : n.type === "DUE_SOON" ? "⏳"
            : "🔔";

        const body = n.body ? `<div style="opacity:0.85; font-size:0.85rem; margin-top:6px;">${escapeHTML(n.body)}</div>` : "";

        return `
          <div class="notify-item">
            <div style="display:flex; gap:10px;">
              <div style="font-size:1.1rem;">${icon}</div>
              <div style="flex:1;">
                <div style="font-weight:800;">${escapeHTML(n.title || "Notification")}</div>
                ${body}
                <div style="opacity:0.55; font-size:0.75rem; margin-top:6px;">${new Date(n.createdAt).toLocaleString()}</div>
              </div>
            </div>
          </div>`;
    }).join("");

    list.innerHTML = pendingHTML + notifHTML;
}

// ==========================================
// 13. REQUEST & LOGOUT
// ==========================================

async function submitLoanApplication(event) {
  const btn = event?.target;
  const oldTxt = btn ? btn.innerText : "";

  // Hide any previous errors before checking again
  hideRequestError();

  try {
    const uid = currentUserUid || window.StallzAuth?.getSession?.()?.uid;
    if (!uid) { showRequestError("Session expired. Please sign in again."); return; }

    const el = (id) => document.getElementById(id);
    const val = (id) => String(el(id)?.value ?? "").trim();

    const amount = Number(String(el("reqAmount")?.value ?? "").trim().replace(/[^0-9.]/g, ""));
    const plan = String(el("reqPlan")?.value ?? "Monthly").trim();
    const purpose = val("reqPurpose");
    const collateralItem = val("reqCollateralItem");
    const collateralValue = Number(String(el("reqCollateralValue")?.value ?? "").trim().replace(/[^0-9.]/g, ""));
    const nrcNumber = val("reqNrcNumber");

    if (amount <= 0) { showRequestError("Please enter a valid loan amount."); return; }
    if (!collateralItem) { showRequestError("Please specify a collateral item."); return; }
    if (collateralValue <= 0) { showRequestError("Please enter an estimated collateral value."); return; }
    if (!nrcNumber) { showRequestError("Your NRC number is required."); return; }

    // 1. Get profile from Local Storage
    let profile = {};
    try {
        const savedProfile = localStorage.getItem("stallz_client_profile");
        if (savedProfile) profile = JSON.parse(savedProfile);
    } catch (e) {}

    // 2. Fallback to shared state
    if (!profile.firstName && !profile.name && !profile.email) {
        profile = window.StallzShared?.getUser?.(uid) || {};
    }

    // 🛑 BLOCK UNPAID LOANS
    if (profile.loans) {
        const hasUnpaidLoan = Object.values(profile.loans).some(l =>
            l && typeof l === "object" &&
            (String(l.status).toUpperCase() === "ACTIVE" || String(l.status).toUpperCase() === "OVERDUE")
        );

        if (hasUnpaidLoan) {
            showRequestError("You currently have an unpaid loan. Please clear your balance first, thank you.");
            if (btn) btn.innerText = oldTxt || "Submit Application";
            return;
        }
    }

    // 🛑 BLOCK MULTIPLE PENDING REQUESTS
    try {
        const pendingReqs = window.StallzShared?.listLoanRequestsForClient?.(uid) || [];
        const hasPending = pendingReqs.some(r => String(r.status || "").toUpperCase() === "PENDING");
        if (hasPending) {
            showRequestError("You already have a pending loan request awaiting approval.");
            if (btn) btn.innerText = oldTxt || "Submit Application";
            return;
        }
    } catch (e) {}

    // 3. Safely construct the name
    let clientName = "Client";
    if (profile.fullName) clientName = profile.fullName;
    else if (profile.name) clientName = profile.name;
    else if (profile.firstName) clientName = profile.firstName + (profile.lastName ? " " + profile.lastName : "");
    else if (profile.email) clientName = profile.email.split('@')[0];

    const clientPhone = profile.phone || currentUserPhone || "";
    const clientEmail = profile.email || "";

    if (btn) btn.innerText = "Submitting...";

    await window.StallzShared.createLoanRequest(uid, {
      clientName,
      clientEmail,
      clientPhone,
      amount,
      plan,
      purpose,
      notes: purpose ? `Purpose: ${purpose}` : "",
      collateralItem,
      collateralValue,
      nrcNumber,
      nrcFrontUrl: "",
      nrcBackUrl: ""
    });

    closeRequestModal();
    renderSharedNotifications();

    // We KEEP the popup alert here because it's the Success message that appears after the modal closes
    showCustomAlert("Request submitted — awaiting approval", true);

    // Clear Form
    ["reqAmount","reqCollateralItem","reqCollateralValue","reqNrcNumber"].forEach(id => {
       const x = el(id); if(x) x.value = "";
    });

  } catch (e) {
    console.error(e);
    showRequestError(e.message);
  } finally {
    if (btn) btn.innerText = oldTxt || "Submit Application";
  }
}


// --------------------------------------------------------------------------
// UPDATED: Wrapped the logout logic in a function to avoid the race condition
// --------------------------------------------------------------------------
function initLogoutButton() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    showCustomConfirm("Are you sure you want to log out?", async () => {
        try {
            await window.StallzAuth?.signOut?.();
            // Added a 600ms delay before redirecting
            setTimeout(() => {
                window.location.href = "../index.html";
            }, 600);
        } catch(e) {}
    });
  });
}

// ==========================================================================
// SAFE EXECUTION BOOTSTRAP (Place this at the very bottom of client-portal.js)
// ==========================================================================
function runAllInit() {
    try { __STALLZ_CLIENT_ONE_TIME_WIRING(); } catch(e) {}
    try { if (typeof initClientPortal === 'function') initClientPortal(); } catch(e) {
        console.error("[STALLZ][Client] initClientPortal failed:", e);
        try { showCustomAlert("Something went wrong while loading your portal. Please refresh.", "Load Error"); } catch(_) { alert("Load Error. Please refresh."); }
    }
    try { initLogoutButton(); } catch(e) {
        console.error("[STALLZ][Client] initLogoutButton failed:", e);
    }
    try { __STALLZ_WRAP_GLOBALS_CLIENT(); } catch(e) {}
}

// Check if the document is already loaded to bypass the race condition
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { try { runAllInit(); } catch(e){ console.error(e);} });
} else {
    runAllInit(); // Document is already ready, run immediately
}

// Options & Previews
function selectOption(inputId, value, btnElement) {
    document.getElementById(inputId).value = value;
    const parent = btnElement.parentElement;
    parent.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
}

function previewUpload(input, iconId, textId) {
    const iconEl = document.getElementById(iconId);
    const textEl = document.getElementById(textId);
    const box = input.parentElement;
    if (input.files && input.files[0]) {
        iconEl.className = "fas fa-check-circle";
        let filename = input.files[0].name;
        if(filename.length > 10) filename = filename.substring(0, 8) + "..";
        textEl.innerText = filename;
        box.classList.add('uploaded');
    }
}

// HELPER: Copy to Clipboard
window.copyToClipboard = function(text, label) {
    navigator.clipboard.writeText(text).then(() => {
        showCustomAlert("Copied " + label, true); // Replaced alert()
    }).catch(err => {
        console.error('Copy failed', err);
    });
}

window.executeCustomConfirm = function() {
    const callbackToRun = __confirmCallback; // 1. Save the command FIRST
    closeCustomConfirm();                    // 2. Close the window
    if (typeof callbackToRun === 'function') callbackToRun(); // 3. Run the saved command
};

// ==========================================================================
// 12. LOAN REQUEST PROGRESS (Dashboard)
// ==========================================================================

function renderLoanRequestProgress(requestsObj) {
    const badge = document.getElementById("requestStatusBadge");
    const body = document.getElementById("requestProgressBody");
    if (!badge || !body) return;

    const reqs = Object.values(requestsObj || {}).filter(Boolean);
    if (!reqs.length) {
        badge.textContent = "--";
        badge.className = "status-badge pending";
        body.innerHTML = `<div class="rpc-empty">No request submitted yet. Tap <strong>Request Loan</strong> below to apply.</div>`;
        __latestLoanRequest = null;
        return;
    }

    reqs.sort((a, b) => {
        const ad = Date.parse(a.createdAt || "") || Number(a.id || 0) || 0;
        const bd = Date.parse(b.createdAt || "") || Number(b.id || 0) || 0;
        return bd - ad;
    });

    const r = reqs[0];
    __latestLoanRequest = r;

    const status = String(r.status || "PENDING").toUpperCase();
    const statusKey = status.toLowerCase();

    badge.textContent = status;
    badge.className = `status-badge ${statusKey}`;

    const created = r.createdAt ? new Date(r.createdAt) : null;
    const createdText = created ? created.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : "—";

    // Step logic
    let s1 = "done"; // submitted always
    let s2 = "active"; // review by default
    let s3 = "pending";

    if (status === "APPROVED") { s2 = "done"; s3 = "done"; }
    if (status === "REJECTED") { s2 = "done"; s3 = "rejected"; }
    if (status === "CANCELLED") { s2 = "cancelled"; s3 = "cancelled"; }

    const amt = Number(r.amount || 0);
    const plan = escapeHTML(r.plan || "—");
    const col = escapeHTML(r.collateralItem || "—");

    body.innerHTML = `
        <div class="rpc-meta">
            <div class="rpc-meta-item"><span>Requested</span><strong>K${amt.toLocaleString()}</strong></div>
            <div class="rpc-meta-item"><span>Plan</span><strong>${plan}</strong></div>
            <div class="rpc-meta-item"><span>Collateral</span><strong>${col}</strong></div>
        </div>

        <div class="rpc-steps">
            <div class="rpc-step ${s1}"><span class="dot"></span><span class="label">Submitted</span></div>
            <div class="rpc-step ${s2}"><span class="dot"></span><span class="label">Review</span></div>
            <div class="rpc-step ${s3}"><span class="dot"></span><span class="label">${status === "REJECTED" ? "Rejected" : "Approved"}</span></div>
        </div>

        <div class="rpc-foot">
            <div class="rpc-small">Submitted: <strong>${createdText}</strong></div>
            <div class="rpc-small">Request ID: <strong>#${escapeHTML(r.id || "")}</strong></div>
        </div>
    `;
}

// ==========================================================================
// 13. STATEMENTS (Client)
// ==========================================================================

let __statementSelectedLoanId = null;

function openStatementsModal(loanId = null) {
    const modal = document.getElementById("statementModal");
    const select = document.getElementById("statementLoanSelect");
    const content = document.getElementById("statementContent");
    if (!modal || !select || !content) {
        console.warn("Statement modal missing in HTML.");
        return;
    }

    const loans = Array.isArray(__clientLoansCache) ? __clientLoansCache.slice() : [];
    if (!loans.length) {
        select.innerHTML = "";
        content.innerHTML = `<div class="statement-empty">No loans found yet.</div>`;
        modal.style.display = "flex";
        return;
    }

    // Newest first
    loans.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

    select.innerHTML = loans.map(l => {
        const status = escapeHTML(String(l.status || "—"));
        const amt = Number(l.amount || 0);
        return `<option value="${escapeHTML(l.id)}">#${escapeHTML(l.id)} • K${amt.toLocaleString()} • ${status}</option>`;
    }).join("");

    // Prefer passed id, else ACTIVE/OVERDUE, else newest
    const preferred = loanId
        || loans.find(l => String(l.status || "").toUpperCase() === "ACTIVE")?.id
        || loans.find(l => String(l.status || "").toUpperCase() === "OVERDUE")?.id
        || loans[0].id;

    __statementSelectedLoanId = String(preferred);
    select.value = String(preferred);

    renderStatementForSelectedLoan();
    modal.style.display = "flex";
}

function closeStatementsModal() {
    const modal = document.getElementById("statementModal");
    if (modal) modal.style.display = "none";
}

function renderStatementForSelectedLoan() {
    const select = document.getElementById("statementLoanSelect");
    const content = document.getElementById("statementContent");
    if (!select || !content) return;

    const id = String(select.value || "");
    __statementSelectedLoanId = id;

    const loan = (Array.isArray(__clientLoansCache) ? __clientLoansCache : []).find(l => String(l.id) === id);
    if (!loan) {
        content.innerHTML = `<div class="statement-empty">Loan not found.</div>`;
        return;
    }

    const fmtMoney = (n) => `K${Number(n || 0).toLocaleString()}`;
    const principal = Number(loan.amount || 0);
    const totalDue = Number(loan.totalDue || loan.total || (principal + (principal * 0.4)) || 0);
    const paid = Number(loan.paid || 0);
    const balance = Number(loan.balance || Math.max(0, totalDue - paid));

    const status = escapeHTML(String(loan.status || "—").toUpperCase());
    const plan = escapeHTML(String(loan.plan || "—"));
    const startDate = escapeHTML(String(loan.startDate || "—"));
    const dueDate = escapeHTML(String(loan.dueDate || "—"));

    // Repayments (from new sync in Admin)
    let repayments = [];
    const repSrc = loan.repayments || loan.repayment || loan.paymentHistory;
    if (Array.isArray(repSrc)) repayments = repSrc.filter(Boolean);
    else if (repSrc && typeof repSrc === "object") repayments = Object.values(repSrc).filter(Boolean);

    repayments.sort((a, b) => {
        const ad = Date.parse(a.createdAt || a.date || "") || 0;
        const bd = Date.parse(b.createdAt || b.date || "") || 0;
        return bd - ad;
    });

    const repaymentsHtml = repayments.length ? `
        <div class="statement-section">
            <div class="statement-section-title">Payments</div>
            <div class="statement-table">
                <div class="statement-row head">
                    <div>Date</div><div>Recorded By</div><div class="amt">Amount</div>
                </div>
                ${repayments.map(r => `
                    <div class="statement-row">
                        <div>${escapeHTML(String(r.date || (r.createdAt ? String(r.createdAt).split("T")[0] : "—")))}</div>
                        <div>${escapeHTML(String(r.recordedBy || "—"))}</div>
                        <div class="amt">+${fmtMoney(r.amount)}</div>
                    </div>
                `).join("")}
            </div>
        </div>
    ` : `
        <div class="statement-section">
            <div class="statement-section-title">Payments</div>
            <div class="statement-empty">No payment entries recorded yet.</div>
        </div>
    `;

    content.innerHTML = `
        <div class="statement-summary">
            <div class="ss-top">
                <div class="ss-title">Loan #${escapeHTML(loan.id)}</div>
                <div class="ss-badge">${status}</div>
            </div>
            <div class="ss-grid">
                <div class="ss-item"><span>Plan</span><strong>${plan}</strong></div>
                <div class="ss-item"><span>Start</span><strong>${startDate}</strong></div>
                <div class="ss-item"><span>Due</span><strong>${dueDate}</strong></div>

                <div class="ss-item"><span>Principal</span><strong>${fmtMoney(principal)}</strong></div>
                <div class="ss-item"><span>Total Due</span><strong>${fmtMoney(totalDue)}</strong></div>
                <div class="ss-item"><span>Paid</span><strong>${fmtMoney(paid)}</strong></div>
                <div class="ss-item"><span>Balance</span><strong>${fmtMoney(balance)}</strong></div>
            </div>
        </div>

        ${repaymentsHtml}

        <div class="statement-section">
            <div class="statement-section-title">Notes</div>
            <div class="statement-notes">${escapeHTML(String(loan.notes || "—"))}</div>
        </div>
    `;
}

// Close statement modal when clicking outside the glass
document.addEventListener("click", (e) => {
    const modal = document.getElementById("statementModal");
    if (!modal || modal.style.display === "none") return;
    if (e.target === modal) closeStatementsModal();
});
