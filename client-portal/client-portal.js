// ==========================================================================
// STALLZ LOANS - CLIENT PORTAL SCRIPT
// ==========================================================================

const ENABLE_NRC_UPLOAD = false;

const firebaseConfig = (window.STALLZ_FIREBASE && window.STALLZ_FIREBASE.config) ? window.STALLZ_FIREBASE.config : {};

let currentUserUid = null;
let currentUserPhone = null;
let selectedRate = 0.20;
let __lastLoansCache = [];
let __lastClientProfileCache = null;
let __statementFilter = 'ALL';
let __reqPanelBusy = false;
let currentContactAction = '';
let __confirmCallback = null;
let __notifFilter = 'ALL';

function escapeHTML(input = "") {
    const s = String(input ?? "");
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return s.replace(/[&<>"']/g, (ch) => map[ch]);
}

function __fmtMoney(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return "K0.00";
    return "K" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function __safeDate(d) {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt;
}


/* ==========================================================================
   ADVANCED UX HELPERS (Skeleton • Haptics • Status Theme • Trust Ring)
   ========================================================================== */
let __stallzFirstDataLoaded = false;
let __stallzContextBubbleBound = false;

function __haptic(type = "tap") {
    try {
        if (!navigator || typeof navigator.vibrate !== "function") return;
        const patterns = {
            tap: [8],
            soft: [6],
            success: [10, 18, 10],
            warning: [18],
            modalOpen: [10],
            modalClose: [6],
            alert: [14, 18, 14]
        };
        navigator.vibrate(patterns[type] || patterns.tap);
    } catch(_) {}
}

function __successPop(originEl) {
    try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const rect = originEl && originEl.getBoundingClientRect ? originEl.getBoundingClientRect() : null;
        const x = rect ? rect.left + rect.width / 2 : (window.innerWidth / 2);
        const y = rect ? rect.top + rect.height / 2 : (window.innerHeight / 2);

        const pieces = 14;
        for (let i = 0; i < pieces; i++) {
            const p = document.createElement('div');
            p.className = 'stallz-confetti-piece';
            const angle = (Math.PI * 2) * (i / pieces);
            const spread = 70 + Math.random() * 35;
            const dx = Math.cos(angle) * spread;
            const dy = Math.sin(angle) * spread - (20 + Math.random() * 18);

            p.style.left = `${x}px`;
            p.style.top = `${y}px`;
            p.style.setProperty('--dx', `${dx}px`);
            p.style.setProperty('--dy', `${dy}px`);
            p.style.animationDelay = `${Math.random() * 60}ms`;

            document.body.appendChild(p);
            setTimeout(() => p.remove(), 900);
        }
    } catch(_) {}
}

function __setSkeletonLoading(on) {
    document.body.classList.toggle('is-skeleton', !!on);

    // If loans list is empty while loading, show skeleton cards.
    const list = document.getElementById('portalLoansList');
    if (on && list && !list.dataset.real) {
        list.innerHTML = `
            <div class="skeleton-loans">
                ${[1,2,3].map(() => `
                    <div class="skeleton-loan-card">
                        <div class="skeleton-row">
                            <div class="skeleton-block skeleton-line"></div>
                            <div class="skeleton-block skeleton-pill"></div>
                        </div>
                        <div class="skeleton-block skeleton-big"></div>
                        <div class="skeleton-block skeleton-bar"></div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    if (!on && list) {
        // mark future real renders
        list.dataset.real = "1";
    }
}

function __applyStatusTheme(isOverdue) {
    document.body.classList.toggle('status-warning', !!isOverdue);
}

function __setCircleProgress(circleEl, fraction, radius) {
    if (!circleEl) return;
    const r = Number(radius);
    const c = 2 * Math.PI * r;
    circleEl.style.strokeDasharray = c;
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    circleEl.style.strokeDashoffset = (1 - f) * c;
}

function __updateRingGradientFromTheme() {
    try {
        const root = getComputedStyle(document.body);
        const primary = (root.getPropertyValue('--primary') || '').trim() || '#4ade80';

        const lightenHex = (hex, amt) => {
            const h = String(hex || '').trim();
            const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
            if (!m) return primary;
            let c = m[1];
            if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
            const num = parseInt(c, 16);
            const r = (num >> 16) & 255;
            const g = (num >> 8) & 255;
            const b = num & 255;
            const mix = (v) => Math.round(v + (255 - v) * amt);
            const rr = mix(r), gg = mix(g), bb = mix(b);
            return `#${((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1)}`;
        };

        const hi = lightenHex(primary, 0.42);

        const stop1 = document.querySelector('.ring-stop-1');
        const stop2 = document.querySelector('.ring-stop-2');
        if (stop1) stop1.setAttribute('stop-color', hi);
        if (stop2) stop2.setAttribute('stop-color', primary);
    } catch(_) {}
}


function __computeTrustScore(loansData) {
    // A simple, explainable heuristic: progress + repayment history – overdue penalty.
    const loans = Array.isArray(loansData) ? loansData : [];
    if (loans.length === 0) return 35;

    const now = Date.now();
    let activeProgressSum = 0;
    let activeCount = 0;
    let goodClosures = 0;
    let overdueCount = 0;

    for (const l of loans) {
        const status = String(l.status || '').toUpperCase();
        const total = Number(l.totalDue || 0);
        const paid = Number(l.paid || 0);
        const due = __safeDate(l.dueDate);

        if (status === 'ACTIVE' || status === 'OVERDUE') {
            activeCount++;
            const p = total > 0 ? Math.min(1, Math.max(0, paid / total)) : 0;
            activeProgressSum += p;
            if (status === 'OVERDUE') overdueCount++;
        } else if (status === 'PAID' || status === 'CLOSED' || status === 'COMPLETED') {
            // On-time closure bonus if we can compare timestamps
            const closedAt = __safeDate(l.closedAt || l.paidAt || l.updatedAt || l.endDate);
            if (due && closedAt && closedAt.getTime() <= due.getTime() + (6 * 60 * 60 * 1000)) {
                goodClosures++;
            } else if (!due && closedAt) {
                goodClosures += 0.5;
            }
        }
    }

    const avgProgress = activeCount > 0 ? (activeProgressSum / activeCount) : 0;

    let score = 40;
    score += avgProgress * 45;           // up to +45
    score += Math.min(25, goodClosures * 6); // up to +25
    score -= overdueCount > 0 ? 18 : 0;

    // Slight time factor (older account tends to be more trusted) if we have any timestamps
    const anyStart = loans.map(l => __safeDate(l.startDate)).find(Boolean);
    if (anyStart) {
        const days = Math.max(0, Math.floor((now - anyStart.getTime()) / 86400000));
        score += Math.min(10, days / 40); // up to +10
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

// Trigger client logout (used by drawer button)
window.triggerClientLogout = function() {
    if (typeof closeProfileModal === 'function') closeProfileModal(); // Close the sidebar

    // Show the custom confirm with exactly 2 arguments: (Message, Function)
    if (window.showCustomConfirm) {
        window.showCustomConfirm("Are you sure you want to log out?", async () => {
            try {
                // Wait for Firebase to securely sign out
                if (typeof firebase !== 'undefined' && firebase.auth) {
                    await firebase.auth().signOut();
                }
                // Clear all local session data
                localStorage.clear();
                sessionStorage.clear();

                // Redirect to the login screen after a tiny delay for smoothness
                setTimeout(() => {
                    window.location.replace("../index.html");
                }, 300);
            } catch(e) {
                console.error("Logout Error:", e);
                window.location.replace("../index.html");
            }
        });
    } else {
        // Fallback in case the modal fails
        if (typeof firebase !== 'undefined' && firebase.auth) firebase.auth().signOut();
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace("../index.html");
    }
};

function __updateTrustUI(trustScore) {
    const trustVal = document.getElementById('trustScoreValue');
    if (trustVal) trustVal.textContent = `${Number(trustScore) || 0}`;

    const trustCircle = document.getElementById('trustCircle');
    __setCircleProgress(trustCircle, (Number(trustScore) || 0) / 100, 58);
}

function __updateMiniPreview(loan) {
    const wrap = document.getElementById('amortPreview');
    const txt = document.getElementById('amortPreviewText');
    if (!wrap || !txt) return;

    if (!loan || !loan.dueDate) {
        wrap.style.display = 'none';
        return;
    }

    const due = __safeDate(loan.dueDate);
    const balance = Number(loan.balance || 0);
    if (!due || !Number.isFinite(balance) || balance <= 0) {
        wrap.style.display = 'none';
        return;
    }

    const now = new Date();
    const days = Math.ceil((due.getTime() - now.getTime()) / 86400000);
    if (days <= 0) {
        txt.textContent = `Overdue • Balance ${__fmtMoney(balance)}`;
        wrap.style.display = 'block';
        return;
    }

    const perDay = balance / Math.max(1, days);
    const dueStr = due.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    txt.textContent = `To clear by ${dueStr}: ${__fmtMoney(perDay)}/day`;
    wrap.style.display = 'block';
}

function __updateContextBubble(options) {
    const bubble = document.getElementById('contextActionBubble');
    const text = document.getElementById('contextBubbleText');
    if (!bubble || !text) return;

    if (!options || !options.show) {
        bubble.style.display = 'none';
        bubble.dataset.action = '';
        return;
    }

    text.textContent = options.text || '';
    bubble.dataset.action = options.action || 'pay';
    bubble.style.display = 'flex';
}

function __bindContextBubble() {
    if (__stallzContextBubbleBound) return;
    __stallzContextBubbleBound = true;

    const bubble = document.getElementById('contextActionBubble');
    if (!bubble) return;

    const trigger = () => {
        __haptic('soft');
        const action = bubble.dataset.action || 'pay';
        if (action === 'support' && typeof openSupportModal === 'function') return openSupportModal();
        if (typeof openPayModal === 'function') return openPayModal();
    };

    bubble.addEventListener('click', trigger);
    bubble.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            trigger();
        }
    });
}

function __wireHaptics() {
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (!t) return;
        // lightweight haptics on primary taps
        if (t.closest('.action-card,.nav-item,.icon-btn,.profile-btn,.btn-full,.submit-btn')) {
            __haptic('tap');
        }
    }, { passive: true });
}


window.copyToClipboard = function(text, label) {
    navigator.clipboard.writeText(text).then(() => {
        showCustomAlert("Copied " + label, true);
    }).catch(err => {
        console.error('Copy failed', err);
    });
};

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

function bootstrapSharedSession() {
    (async () => {
        try {
            console.log("⏳ Starting Portal...");
            const user = await window.StallzAuth?.onceAuthState?.();

            if (!user) {
                window.location.replace("../index.html");
                return;
            }

            currentUserUid = user.uid;

            // --- PUSH NOTIFICATION AUTO-START ---
            // If the user already granted permission, start listening for foreground messages
            if ('Notification' in window && Notification.permission === 'granted') {
                // Prefer shared push glue (shared/push.js)
                if (window.StallzPush?.initPushNotifications) {
                    window.StallzPush.initPushNotifications({ forcePrompt: false });
                } else if (typeof initPushNotifications === 'function') {
                    initPushNotifications(false);
                }
            }
            // ------------------------------------

            __stallzFirstDataLoaded = false;
            __setSkeletonLoading(true);
            __updateRingGradientFromTheme();

            // Check for Offline/Cache to reveal instantly, otherwise wait for Firebase
            const isOffline = !navigator.onLine || (typeof window.isAppOffline === "function" && window.isAppOffline());
            if (isOffline && __lastClientProfileCache) {
                console.warn("Offline detected. Opening cached portal.");
                hideAppLoader();
            } else {
                const hint = document.getElementById('clientBootHint');
                if (hint) hint.textContent = "Syncing with database...";
            }

            if (typeof firebase !== "undefined") {
                const userRef = firebase.database().ref(`clients/${currentUserUid}`);

                userRef.on('value', (snapshot) => {
                    const val = snapshot.val() || {};

                    updateHeaderGreeting(val);
                    try { window.__STALLZ_REVEAL_PORTAL && window.__STALLZ_REVEAL_PORTAL("profile"); } catch(_) {}
                    currentUserPhone = val.phone || "";
                    localStorage.setItem("stallz_client_profile", JSON.stringify(val));
                    __lastClientProfileCache = val;

                    if (val.loans) {
                        const myLoans = Object.values(val.loans).filter(l => l && typeof l === "object");
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
                        try { renderLoanRequestProgressPanel(); } catch(e) {}
                    } else {
                        renderLoansTable([]);
                        try { renderLoanRequestProgressPanel(); } catch(e) {}
                    }

                    // ==========================================================
                    // 🧠 SMART CLOUD-BASED SYNC DETECTOR
                    // ==========================================================
                    const hasLoans = val.loans && Object.keys(val.loans).length > 0;
                    const hasDismissed = val.syncPromptDismissed === true;

                    // Only popup if they have NO loans AND have NOT explicitly clicked "I am a new client"
                    if (!hasLoans && !hasDismissed) {
                        setTimeout(() => {
                            const syncModal = document.getElementById('firstTimeSyncModal');
                            if(syncModal) syncModal.style.display = 'flex';
                        }, 1000);
                    }
                    // ==========================================================
                    __updateRingGradientFromTheme();
                    if (!__stallzFirstDataLoaded) {
                        __stallzFirstDataLoaded = true;
                        setTimeout(() => __setSkeletonLoading(false), 220);
                    } else {
                        __setSkeletonLoading(false);
                    }
                    hideAppLoader();
                    try { window.__STALLZ_REVEAL_PORTAL && window.__STALLZ_REVEAL_PORTAL("fallback"); } catch(_) {}
}, (error) => {
                    // Catch Permission Denied and network errors
                    console.error("Firebase read error:", error);
                    __setSkeletonLoading(false);
                    hideAppLoader();
                    try { window.__STALLZ_REVEAL_PORTAL && window.__STALLZ_REVEAL_PORTAL("fallback"); } catch(_) {}
if (typeof showCustomAlert === "function") {
                        showCustomAlert("Access denied. Please check your connection or contact support.");
                    } else {
                        alert("Access denied. Please check your connection or contact support.");
                    }
                });
            }

            if(window.StallzShared?.ensureSeed) window.StallzShared.ensureSeed();
            if(window.StallzShared?.subscribe) {
                window.StallzShared.subscribe(() => {
                    renderSharedNotifications();
                    try { renderLoanRequestProgressPanel(true); } catch(e) {}
                });
            }

        } catch (e) {
            console.error("Session Error:", e);
            hideAppLoader();
                    try { window.__STALLZ_REVEAL_PORTAL && window.__STALLZ_REVEAL_PORTAL("fallback"); } catch(_) {}
}
    })();
    // Watchdog: keep loader visible if boot is slow; show a gentle hint instead of hiding.
    setTimeout(() => {
        try {
            const loader = document.getElementById('appLoader');
            const hint = document.getElementById('clientBootHint');
            if (loader && !loader.classList.contains('hidden')) {
                if (hint) hint.textContent = 'Still syncing… just a moment';
            }
        } catch (_) {}
    }, 6000);

}


function initClientPortal() {
    try { window.StallzShared?.enableNoBackNavigation?.(); } catch(e) {}

    const rangeInput = document.getElementById('calcRange');
    if(rangeInput) {
        rangeInput.addEventListener('input', updateCalculator);
        setupDurationButtons();
        updateCalculator();
    }

    // --- Hook up the Live Request Calculator ---
    const reqAmountInput = document.getElementById('reqAmount');
    if(reqAmountInput) {
        reqAmountInput.addEventListener('input', window.updateRequestCalculator);
    }

    const savedTheme = localStorage.getItem('stallz-theme');
    const currentHour = new Date().getHours();

    if (savedTheme === 'day') {
        document.body.classList.add('day-mode');
    } else if (savedTheme === 'night') {
        document.body.classList.remove('day-mode');
    } else if (currentHour >= 6 && currentHour < 18) {
        document.body.classList.add('day-mode');
    }

    __wireHaptics();
    __bindContextBubble();

    // ====== INSTANT CACHE HYDRATION ======
    try {
        const cachedProfile = localStorage.getItem("stallz_client_profile");
        if (cachedProfile) {
            const parsedProfile = JSON.parse(cachedProfile);
            __lastClientProfileCache = parsedProfile;
            if (typeof updateHeaderGreeting === 'function') {
                updateHeaderGreeting(parsedProfile);
                try { window.__STALLZ_REVEAL_PORTAL && window.__STALLZ_REVEAL_PORTAL("cache"); } catch(_) {}
            }
        }
    } catch(e) { console.warn("Cache hydration skipped", e); }

    bootstrapSharedSession();

    // ====== FINAL REVEAL (Client) — Bridge for Firebase Data Sync ======
    window.__STALLZ_REVEAL_PORTAL = hideAppLoader;

    window.onclick = function(event) {
        // Vibrate and close modals when clicking the overlay
        if (event.target.classList.contains('modal-overlay') || event.target.classList.contains('drawer-overlay')) {
            if ('vibrate' in navigator) navigator.vibrate(15);
            if (typeof closeAnimatedModal === 'function') {
                closeAnimatedModal(event.target.id);
            } else {
                event.target.style.display = 'none';
            }
        }

        // Close notification dropdown when clicking outside
        if (!event.target.closest('.notification-wrapper')) {
            const dropdown = document.getElementById('notificationDropdown');
            if (dropdown && dropdown.classList.contains('active')) {
                dropdown.classList.remove('active');
                setTimeout(() => {
                    if (!dropdown.classList.contains('active')) dropdown.style.display = 'none';
                }, 300);
            }
        }
    };
}

window.__STALLZ_PORTAL_REVEALED = false;

function hideAppLoader() {
    if (window.__STALLZ_PORTAL_REVEALED) return;
    window.__STALLZ_PORTAL_REVEALED = true;

    const loader = document.getElementById("portalLoader") || document.getElementById("appLoader");
    const shell = document.querySelector(".portal-shell");

    if (loader) {
        loader.style.transition = "opacity 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        loader.style.opacity = "0";
        setTimeout(() => { loader.style.display = "none"; }, 400);
    }
    if (shell) {
        shell.style.visibility = "visible";
        shell.style.opacity = "1";
    }

    // Ensure ring gradients look correct after the reveal
    setTimeout(__updateRingGradientFromTheme, 50);
}

function runAllInit() {
    if (typeof initClientPortal === 'function') initClientPortal();
}

if (document.readyState === 'loading') {
    try { window.StallzAuth?.enforceSessionTTL?.(); } catch(e) {}

document.addEventListener('DOMContentLoaded', runAllInit);
} else {
    runAllInit();
}

function toggleTheme() {
    const isDay = document.body.classList.toggle('day-mode');
    localStorage.setItem('stallz-theme', isDay ? 'day' : 'night');
    syncThemeUI();
}

function syncThemeUI() {
    const isDay = document.body.classList.contains('day-mode');
    const themeIcon = document.getElementById('themeIcon');
    const themeToggle = document.getElementById('themeToggleState');

    if (themeIcon) themeIcon.className = isDay ? 'fas fa-sun' : 'fas fa-moon';
    if (themeToggle) {
        themeToggle.className = isDay ? 'fas fa-toggle-off' : 'fas fa-toggle-on';
        themeToggle.style.color = isDay ? '#94a3b8' : 'var(--primary)';
    }
}

window.addEventListener('click', (e) => {
    if(e.target.closest('.profile-btn')) {
        syncThemeUI();
    }
});

function updateHeaderGreeting(profile) {
    if (!profile) return;
    const headerTitle = document.getElementById('headerGreeting');
    const sidebarName = document.getElementById('sidebarUserName');
    const rawName = profile.name || profile.email || "CLIENT";
    const firstName = (profile.firstName || rawName.split(" ")[0]).toUpperCase();
    const fullName = rawName.toUpperCase();

    if (headerTitle) {
        headerTitle.innerHTML = `Hi, <span id="headerUserName" style="color:var(--primary); font-weight:bold;">${firstName}</span>`;
    }
    if (sidebarName) sidebarName.textContent = fullName;
}

function renderLoansTable(loansData) {
    const container = document.getElementById('portalLoansList') || document.getElementById('portalLoansTable');
    if (!container) return;

    if (!document.getElementById("stallzPremiumLoanCardStyle")) {
        const style = document.createElement("style");
        style.id = "stallzPremiumLoanCardStyle";
        style.innerHTML = `
            .p-loan-card { background: linear-gradient(145deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 24px; padding: 24px; margin-bottom: 20px; box-shadow: 0 16px 35px rgba(0, 0, 0, 0.25); position: relative; overflow: hidden; }
            .p-loan-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, var(--primary, #4ade80), #22c55e); }
            .p-loan-card.is-overdue::before { background: linear-gradient(90deg, #f87171, #ef4444); }
            .p-loan-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .p-loan-id { font-size: 0.85rem; color: rgba(255,255,255,0.6); font-weight: 700; letter-spacing: 0.5px; }
            .p-loan-badge { padding: 6px 14px; border-radius: 12px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.5px; }
            .p-loan-badge.active { background: rgba(74, 222, 128, 0.15); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); }
            .p-loan-badge.overdue { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
            .p-loan-balance-label { font-size: 0.85rem; color: rgba(255,255,255,0.7); margin-bottom: 4px; font-weight: 600; }
            .p-loan-balance-val { font-size: 2.08rem; font-weight: 800; color: #ffffff; letter-spacing: -1px; display: flex; align-items: baseline; gap: 4px; line-height: 1.1; margin-bottom: 8px; }
            .p-loan-balance-val small { font-size: 1.4rem; color: rgba(255,255,255,0.5); font-weight: 700; }
            .p-loan-total { font-size: 0.85rem; color: rgba(255,255,255,0.45); margin-bottom: 26px; font-weight: 500; line-height: 1.6; }
            .p-loan-total-sub { font-size: 0.75rem; opacity: 0.8; font-weight: 600; color: var(--primary, #4ade80); }
            .p-loan-progress-wrap { margin-bottom: 24px; }
            .p-loan-progress-labels { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 10px; font-weight: 700; color: rgba(255,255,255,0.85); }
            .p-loan-progress-track { height: 10px; background: rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2); }
            .p-loan-progress-fill { height: 100%; border-radius: 12px; transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1); }
            .p-loan-progress-fill.active { background: linear-gradient(90deg, #4ade80, #22c55e); box-shadow: 0 0 12px rgba(74,222,128,0.5); }
            .p-loan-progress-fill.overdue { background: linear-gradient(90deg, #f87171, #ef4444); box-shadow: 0 0 12px rgba(239,68,68,0.5); }
            .p-loan-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 18px; }
            .p-loan-meta { display: flex; flex-direction: column; gap: 5px; }
            .p-loan-meta-label { font-size: 0.75rem; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 800; }
            .p-loan-meta-val { font-size: 1rem; color: rgba(255,255,255,0.95); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 145px; }
            body.day-mode .p-loan-card { background: #ffffff; border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 16px 45px rgba(0,0,0,0.05); }
            body.day-mode .p-loan-id { color: #64748b; }
            body.day-mode .p-loan-balance-label { color: #64748b; }
            body.day-mode .p-loan-balance-val { color: #0f172a; }
            body.day-mode .p-loan-balance-val small { color: #94a3b8; }
            body.day-mode .p-loan-total { color: #64748b; }
            body.day-mode .p-loan-total-sub { color: #16a34a; }
            body.day-mode .p-loan-progress-labels { color: #334155; }
            body.day-mode .p-loan-progress-track { background: #f1f5f9; box-shadow: inset 0 1px 3px rgba(0,0,0,0.04); }
            body.day-mode .p-loan-footer { border-top: 1px solid rgba(0,0,0,0.06); }
            body.day-mode .p-loan-meta-label { color: #94a3b8; }
            body.day-mode .p-loan-meta-val { color: #1e293b; }
        `;
        document.head.appendChild(style);
    }

    let totalDebt = 0;
    let totalPaid = 0;
    let earliestDueDate = null;

    container.innerHTML = '';
    container.dataset.real = "1";

    const activeLoans = (loansData || []).filter(loan => {
        const status = String(loan.status || '').toUpperCase();
        return status === 'ACTIVE' || status === 'OVERDUE';
    });

    if (activeLoans.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 40px 20px; color:var(--text-muted); background: rgba(255,255,255,0.02); border-radius: 16px; border: 1px dashed rgba(150,150,150,0.2);">
                <div style="font-size:3rem; margin-bottom:15px; opacity:0.3;">💸</div>
                <div style="font-size:1.1rem; font-weight:800; color:var(--text-main); margin-bottom:8px;">No active loans found</div>
                <div style="font-size:0.85rem; opacity:0.7; max-width:250px; margin:0 auto 20px auto; line-height:1.5;">
                    Tap <strong>"Request Loan"</strong> below to get started.
                </div>
                <button class="btn-full" style="width: 100%; max-width: 220px; margin: 0 auto; background: transparent; border: 1px solid var(--primary); color: var(--primary); font-size: 0.75rem; padding: 10px;" onclick="openFirstTimeSync()">
                    <i class="fas fa-sync-alt" style="margin-right: 5px;"></i> Missing Data? Sync Now
                </button>
            </div>
        `;
        if(document.getElementById('portalTotalDebt')) document.getElementById('portalTotalDebt').innerText = 'K0.00';
        if(document.getElementById('portalTotalPaid')) document.getElementById('portalTotalPaid').innerText = 'K0.00';
        if(document.getElementById('paymentProgressDisplay')) document.getElementById('paymentProgressDisplay').innerText = "0%";
        updateCountdownRing(null, 0);

        __applyStatusTheme(false);
        __updateTrustUI(__computeTrustScore(loansData));
        __updateMiniPreview(null);
        __updateContextBubble({ show: false });
        __updateRingGradientFromTheme();
        return;
    }

    activeLoans.sort((a, b) => {
        if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
        if (a.status !== 'OVERDUE' && b.status === 'OVERDUE') return 1;
        return b.id - a.id;
    });

    __lastLoansCache = activeLoans.map(l => ({...l}));

    const hasOverdue = activeLoans.some(l => String(l.status || '').toUpperCase() === 'OVERDUE');
    __applyStatusTheme(hasOverdue);
    __updateRingGradientFromTheme();

    const ringLoan = activeLoans.reduce((best, l) => {
        const ls = String(l.status || '').toUpperCase();
        const bs = best ? String(best.status || '').toUpperCase() : '';
        if (!best) return l;
        // Overdue takes priority
        if (ls === 'OVERDUE' && bs !== 'OVERDUE') return l;
        if (ls !== 'OVERDUE' && bs === 'OVERDUE') return best;

        const ld = __safeDate(l.dueDate);
        const bd = __safeDate(best.dueDate);
        if (ld && bd) return ld < bd ? l : best;
        if (ld && !bd) return l;
        return best;
    }, null);

    container.innerHTML = activeLoans.map(loan => {
        const total = Number(loan.totalDue || 0);
        const paid = Number(loan.paid || 0);
        const balance = Number(loan.balance || 0);
        const percent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

        let interestRate = loan.customInterest !== undefined ? loan.customInterest : (loan.rate ? (loan.rate * 100) : 0);
        let interestDisplay = interestRate > 0 ? `${interestRate}%` : "N/A";
        let planDisplay = loan.plan || "Standard";

        totalDebt += balance;
        totalPaid += paid;

        if (loan.dueDate) {
            const due = new Date(loan.dueDate);
            if (!earliestDueDate || due < earliestDueDate) earliestDueDate = due;
        }

        const statusClass = (loan.status || 'ACTIVE').toLowerCase();
        let statusLabel = loan.status;

        return `
            <div class="p-loan-card ${statusClass === 'overdue' ? 'is-overdue' : ''}">
                <div class="p-loan-header">
                    <div class="p-loan-id"><i class="fas fa-file-invoice-dollar" style="margin-right:6px; opacity:0.8;"></i>Loan #${loan.id}</div>
                    <div class="p-loan-badge ${statusClass}">${statusLabel}</div>
                </div>
                <div class="p-loan-balance-label">Remaining Balance</div>
                <div class="p-loan-balance-val"><small>K</small>${balance.toLocaleString()}</div>
                <div class="p-loan-total">
                    Principal: K${Number(loan.amount).toLocaleString()} &nbsp;•&nbsp; Total Due: K${total.toLocaleString()}<br>
                    <span class="p-loan-total-sub"><i class="fas fa-percentage" style="font-size:0.65rem; margin-right:2px;"></i> Interest: ${interestDisplay} &nbsp;•&nbsp; <i class="fas fa-calendar-alt" style="font-size:0.65rem; margin-right:2px; margin-left:4px;"></i> Duration: ${escapeHTML(planDisplay)}</span>
                </div>
                <div class="p-loan-progress-wrap">
                    <div class="p-loan-progress-labels">
                        <span>Paid: K${paid.toLocaleString()}</span>
                        <span>${percent}%</span>
                    </div>
                    <div class="p-loan-progress-track">
                        <div class="p-loan-progress-fill ${statusClass}" style="width: ${percent}%;"></div>
                    </div>
                </div>
                <div class="p-loan-footer">
                    <div class="p-loan-meta">
                        <span class="p-loan-meta-label">Collateral</span>
                        <span class="p-loan-meta-val">${escapeHTML(loan.collateralItem || 'Personal Loan')}</span>
                    </div>
                    <div class="p-loan-meta" style="text-align: right;">
                        <span class="p-loan-meta-label">Issued On</span>
                        <span class="p-loan-meta-val">${new Date(loan.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    if(document.getElementById('portalTotalDebt')) animateValue(document.getElementById('portalTotalDebt'), 0, totalDebt, 1000);
    if(document.getElementById('portalTotalPaid')) document.getElementById('portalTotalPaid').innerText = `K${totalPaid.toLocaleString()}`;

    const totalActiveDue = totalDebt + totalPaid;
    const healthPercent = totalActiveDue > 0 ? (totalPaid / totalActiveDue) : 0;

    const progDisplay = document.getElementById('paymentProgressDisplay');
    if(progDisplay) {
         progDisplay.innerText = Math.round(healthPercent * 100) + "%";
    }

    if (earliestDueDate) {
        updateCountdownRing(earliestDueDate, healthPercent);
    } else {
        updateCountdownRing(null, 0);
    }
    const trustScore = __computeTrustScore(loansData);
    __updateTrustUI(trustScore);

    // Smart action bubble + mini preview
    if (ringLoan) {
        const total = Number(ringLoan.totalDue || 0);
        const paid = Number(ringLoan.paid || 0);
        const balance = Number(ringLoan.balance || 0);
        const frac = total > 0 ? (paid / total) : 0;
        const due = __safeDate(ringLoan.dueDate);
        const days = due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null;

        if (hasOverdue) {
            __updateContextBubble({ show: true, text: `Overdue • Tap to pay now`, action: 'pay' });
        } else if (frac >= 0.90 && balance > 0) {
            __updateContextBubble({ show: true, text: `Almost there! Tap to settle final ${__fmtMoney(balance)}`, action: 'pay' });
        } else if (days !== null && days <= 2 && balance > 0) {
            const suggest = Math.min(balance, Math.max(50, Math.ceil(balance / 2)));
            __updateContextBubble({ show: true, text: `Due soon • Pay ${__fmtMoney(suggest)} today`, action: 'pay' });
        } else {
            __updateContextBubble({ show: false });
        }

        __updateMiniPreview(ringLoan);
    } else {
        __updateContextBubble({ show: false });
        __updateMiniPreview(null);
    }

    __bindContextBubble();
}

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

async function renderLoanRequestProgressPanel(force = false) {
  if (!window.__stallz_reqPanelState) window.__stallz_reqPanelState = { busy: false, lastMs: 0 };
  const st = window.__stallz_reqPanelState;
  const now = Date.now();
  if (!force && now - st.lastMs < 1200) return;

  if (window.__stallz_req_panel_dismissed === true && !force) {
      const panel = document.getElementById("loanRequestProgressPanel");
      if (panel) panel.style.display = 'none';
      return;
  }

  if (st.busy) return;
  st.busy = true;

  try {
    const panel = document.getElementById("loanRequestProgressPanel");
    const body = document.getElementById("loanRequestBody");
    const meta = document.getElementById("loanRequestMeta");
    if (!panel || !body) return;

    if (!document.getElementById("stallzLoanReqStatusStyle")) {
      const css = `
#loanRequestProgressPanel.request-progress-panel{ background: rgba(30, 41, 59, 0.78); border: 1px solid rgba(255,255,255,0.10); border-radius: 22px; box-shadow: 0 18px 40px rgba(0,0,0,0.22); }
#loanRequestProgressPanel .rp-header{ padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
#loanRequestProgressPanel .rp-icon{ background: rgba(74, 222, 128, 0.14); border: 1px solid rgba(74, 222, 128, 0.28); }
#loanRequestProgressPanel .rp-title{ font-size: 0.98rem; font-weight: 900; }
#loanRequestProgressPanel .rp-meta{ font-weight: 800; }
.lr-wrap{ display:flex; flex-direction:column; gap: 18px; margin-top: 12px; }
.lr-amount-card{ background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 18px 16px; text-align: center; box-shadow: 0 12px 28px rgba(0,0,0,0.18); }
.lr-amount{ font-size: 2.0rem; font-weight: 850; letter-spacing: -0.9px; color: var(--text-main, #f8fafc); }
.lr-item-pill{ display:inline-block; margin-top: 10px; padding: 8px 14px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10); color: rgba(255,255,255,0.75); font-weight: 900; font-size: .78rem; letter-spacing: .3px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-timeline{ position: relative; padding-top: 6px; }
.lr-bar{ position:absolute; left: 28px; right: 28px; top: 34px; height: 16px; border-radius: 999px; background: rgba(74, 222, 128, 0.18); overflow: hidden; box-shadow: 0 10px 30px rgba(74, 222, 128, 0.10); }
.lr-bar-fill{ height: 100%; width: 0%; border-radius: 999px; transition: width .45s ease; }
.lr-steps{ display:flex; justify-content: space-between; align-items:flex-start; gap: 10px; position: relative; z-index: 2; }
.lr-step{ width: 33.333%; display:flex; flex-direction: column; align-items:center; gap: 10px; }
.lr-circle{ width: 58px; height: 58px; border-radius: 999px; display:flex; align-items:center; justify-content:center; font-size: 1.35rem; color: #fff; background: rgba(148,163,184,0.22); border: 6px solid rgba(15, 23, 42, 0.9); box-shadow: 0 16px 40px rgba(0,0,0,0.22); transition: transform .25s ease, box-shadow .25s ease, background .25s ease; }
.lr-label{ font-size: .78rem; font-weight: 800; letter-spacing: .6px; text-transform: uppercase; color: rgba(255,255,255,0.78); }
.lr-step.done .lr-circle{ background: var(--primary, #4ade80); box-shadow: 0 0 0 8px rgba(74,222,128,0.10), 0 20px 55px rgba(74,222,128,0.45); }
.lr-step.current .lr-circle{ background: rgba(34,197,94,0.95); box-shadow: 0 0 0 10px rgba(74,222,128,0.14), 0 22px 60px rgba(74,222,128,0.55); transform: translateY(-1px); }
.lr-step.rejected .lr-circle{ background: rgba(239,68,68,0.95); box-shadow: 0 0 0 10px rgba(239,68,68,0.14), 0 22px 60px rgba(239,68,68,0.45); }
.lr-message{ background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 18px 16px; text-align: center; }
.lr-msg-title{ font-size: 1.35rem; font-weight: 600; margin-bottom: 6px; }
.lr-msg-body{ color: rgba(255,255,255,0.72); font-weight: 400; line-height: 1.0; }
body.day-mode #loanRequestProgressPanel.request-progress-panel{ background: rgba(25,25,255,0.92); border: 20px solid rgba(2,6,23,0.10); box-shadow: 0 18px 45px rgba(2,6,23,0.10); }
body.day-mode #loanRequestProgressPanel .rp-header{ border-bottom: 1px solid rgba(2,6,23,0.08); }
body.day-mode #loanRequestProgressPanel .rp-title, body.day-mode #loanRequestProgressPanel .rp-meta{ color: rgba(2,6,23,0.88); }
body.day-mode .lr-amount-card{ background: #ffffff; border: 1px solid rgba(2,6,23,0.10); box-shadow: 0 16px 45px rgba(2,6,23,0.08); }
body.day-mode .lr-amount{ color: #0f172a; }
body.day-mode .lr-item-pill{ background: rgba(2,6,23,0.04); border: 1px solid rgba(2,6,23,0.08); color: rgba(2,6,23,0.72); }
body.day-mode .lr-bar{ background: rgba(34,197,94,0.22); box-shadow: 0 12px 40px rgba(34,197,94,0.18); }
body.day-mode .lr-circle{ border: 6px solid #ffffff; box-shadow: 0 16px 45px rgba(2,6,23,0.10); }
body.day-mode .lr-label{ color: rgba(2,6,23,0.70); }
body.day-mode .lr-message{ background: #ffffff; border: 1px solid rgba(2,6,23,0.10); box-shadow: 0 10px 30px rgba(2,6,23,0.06); }
body.day-mode .lr-msg-body{ color: rgba(2,6,23,0.62); }
.rp-empty { text-align: center; padding: 20px 10px; }
.rp-empty-icon { font-size: 2.5rem; margin-bottom: 10px; opacity: 0.8; }
.rp-empty-title { font-weight: 800; font-size: 1.1rem; color: var(--text-main); margin-bottom: 5px; }
.rp-empty-sub { font-size: 0.85rem; color: var(--text-muted); }
@media (max-width: 380px){
  .lr-card{ padding: 12px 12px; border-radius: 18px; }
  .lr-wrap{ gap: 12px; }
  .lr-amount-card{ padding: 12px; border-radius: 16px; }
  .lr-amount{ font-size: 1.8rem; }
  .lr-item-pill{ font-size: .82rem; padding: 6px 10px; }
  .lr-circle{ width: 48px; height: 48px; border-width: 4px; font-size: 1.1rem; }
  .lr-bar{ left: 22px; right: 22px; top: 29px; height: 12px; }
  .lr-label{ font-size: .72rem; }
  .lr-message{ padding: 12px; border-radius: 16px; }
  .lr-msg-title{ font-size: 1.1rem; }
  .lr-msg-body{ font-size: .85rem; }
}
      `;
      const styleEl = document.createElement("style");
      styleEl.id = "stallzLoanReqStatusStyle";
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }

    const uid = window.__stallz_current_uid || (window.currentUser && window.currentUser.uid) || (window.firebase && window.firebase.auth && window.firebase.auth().currentUser && window.firebase.auth().currentUser.uid) || null;
    let reqs = [];

    try {
      if (window.StallzShared && typeof window.StallzShared.listLoanRequestsForClient === "function" && uid) {
        reqs = await window.StallzShared.listLoanRequestsForClient(uid);
      }
    } catch (_) {}

    if ((!reqs || !reqs.length) && uid && window.firebase && window.firebase.database) {
      try {
        const snap = await window.firebase.database().ref(`clients/${uid}/requests`).once("value");
        const val = snap.val() || {};
        reqs = Object.keys(val).map(k => ({ id: k, ...val[k] }));
      } catch (_) {}
    }

    reqs.sort((a, b) => {
      const getMs = (val) => {
        if (!val) return 0;
        const tsStr = val.createdAt || val.submittedAt || val.ts;
        if (!tsStr) return 0;
        if (typeof tsStr === 'number') return tsStr;
        const parsed = Date.parse(tsStr);
        return isNaN(parsed) ? 0 : parsed;
      };
      return getMs(a) - getMs(b);
    });

    const req = reqs[reqs.length - 1] || {};

    const raw = (req.status || req.requestStatus || req.state || req.stage || "").toString().trim().toUpperCase();
    const isApproved = ["APPROVED", "ACCEPTED", "ACTIVE", "APPROVE"].includes(raw);
    const isRejected = ["REJECTED", "DECLINED", "DENIED", "CANCELLED", "CANCELED"].includes(raw);
    const isReviewing = ["PENDING", "REVIEWING", "UNDER_REVIEW", "IN_REVIEW", "PROCESSING"].includes(raw);
    const isSubmitted = ["SUBMITTED", "NEW", "REQUESTED", ""].includes(raw);

    let reqTimeMs = 0;
    const tsField = req.createdAt || req.submittedAt || req.ts;
    if (typeof tsField === 'number') reqTimeMs = tsField;
    else if (tsField) reqTimeMs = Date.parse(tsField);

    const isExpired = (isApproved || isRejected) && reqTimeMs > 0 && (Date.now() - reqTimeMs) > 86400000;

    if (!reqs.length || isExpired) {
        panel.style.display = 'block';
        if (meta) meta.textContent = "";

        body.innerHTML = `
            <div class="rp-empty">
                <div class="rp-empty-icon">📝</div>
                <div class="rp-empty-title">No loan request yet</div>
                <div class="rp-empty-sub">Tap <strong>Request Loan</strong> below to submit your request.</div>
            </div>
        `;
        st.lastMs = Date.now();
        return;
    }

    panel.style.display = 'block';

    const ts = Number(req.createdAt || req.submittedAt || req.ts || 0);
    if (meta) {
      if (ts) {
        const d = new Date(ts);
        meta.textContent = d.toLocaleDateString("en-GB");
      } else if (req.createdAt) {
          const d = new Date(req.createdAt);
          meta.textContent = isNaN(d) ? "" : d.toLocaleDateString("en-GB");
      } else {
        meta.textContent = "";
      }
    }

    const amount = Number(req.amount ?? req.loanAmount ?? req.principal ?? req.requestedAmount ?? 0) || 0;
    const item = (req.itemName || req.item || req.assetName || req.collateral || req.collateralItem || req.productName || req.purpose || req.title || "").toString().trim();

    let stage = 1;
    if (isApproved || isRejected) stage = 3;
    else if (isReviewing) stage = 2;
    else if (isSubmitted) stage = 1;

    const fillWidth = stage === 1 ? "15%" : stage === 2 ? "55%" : "100%";

    let fillColor = "linear-gradient(90deg, rgba(34,197,94,0.2), rgba(74,222,128,0.95))";
    let fillGlow = "rgba(74,222,128,0.55)";
    if (isRejected) {
      fillColor = "linear-gradient(90deg, rgba(239,68,68,0.25), rgba(239,68,68,0.95))";
      fillGlow = "rgba(239,68,68,0.55)";
    }

    let title = "Submitted!";
    let message = "Your loan request has been received. We’ll start reviewing it shortly.";
    let titleColor = "var(--primary, #4ade80)";

    if (isReviewing) {
      title = "Reviewing…";
      message = "Your request is being reviewed. We’ll notify you as soon as a decision is made.";
      titleColor = "#22c55e";
    }
    if (isApproved) {
      title = "Application Approved!";
      message = "Congratulations! Your loan has been approved and is now active.";
      titleColor = "#22c55e";
    }
    if (isRejected) {
      const reason = (req.rejectionReason || req.reason || req.note || "").toString().trim();
      title = "Application Rejected";
      message = reason ? `Reason: <b>${escapeHTML(reason)}</b>` : "Your request was declined. Please contact support for details.";
      titleColor = "#ef4444";
    }

    const step1Class = "done";
    const step2Class = stage >= 2 ? "done" : "current";
    const step3Class = isApproved ? "done" : isRejected ? "rejected" : stage === 3 ? "current" : "current";

    const step2Icon = stage >= 2 ? "check" : "hourglass-half";
    const step3Icon = isApproved ? "handshake" : isRejected ? "times" : "hourglass-half";

    body.innerHTML = `
      <div class="lr-wrap">
        <div class="lr-amount-card">
          <div class="lr-amount">${__fmtMoney(amount)}</div>
          <div class="lr-item-pill">${escapeHTML(item || "Loan request")}</div>
        </div>
        <div class="lr-timeline">
          <div class="lr-bar">
            <div class="lr-bar-fill" style="width:${fillWidth}; background:${fillColor}; box-shadow: 0 0 35px ${fillGlow};"></div>
          </div>
          <div class="lr-steps">
            <div class="lr-step ${step1Class}">
              <div class="lr-circle"><i class="fas fa-check"></i></div>
              <div class="lr-label">Submitted</div>
            </div>
            <div class="lr-step ${step2Class}">
              <div class="lr-circle"><i class="fas fa-${step2Icon}"></i></div>
              <div class="lr-label">Reviewing</div>
            </div>
            <div class="lr-step ${step3Class}">
              <div class="lr-circle"><i class="fas fa-${step3Icon}"></i></div>
              <div class="lr-label">Approved</div>
            </div>
          </div>
        </div>
        <div class="lr-message">
          <div class="lr-msg-title" style="color:${titleColor}">${title}</div>
          <div class="lr-msg-body">${message}</div>
        </div>
      </div>
    `;

    st.lastMs = Date.now();
  } catch (err) {
    console.warn("Loan Request Status panel error:", err);
  } finally {
    st.busy = false;
  }
}

function timeAgo(ms) {
    const seconds = Math.floor((Date.now() - ms) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function toggleNotifications(forceOpen = null) {
    const dropdown = document.getElementById("notificationDropdown");
    const overlay = document.getElementById("notifOverlay");
    if (!dropdown) return;

    const isMobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    const isVisible = dropdown.classList.contains("active");
    const shouldOpen = (forceOpen === null) ? !isVisible : !!forceOpen;

    const close = (silent = false) => {
        dropdown.classList.remove("active");
        if (overlay) { overlay.classList.remove("active"); overlay.setAttribute("aria-hidden","true"); }
        document.body.classList.remove("modal-open");
        document.body.style.overflow = "";
        setTimeout(() => {
            if(!dropdown.classList.contains("active")) dropdown.style.display = "none";
        }, 250);

        if (!silent && window.history.state && window.history.state.__stallzNotifOpen) {
            // Go back one entry so gestures/back behave naturally
            history.back();
        }
        document.removeEventListener("keydown", window.__stallzNotifKeyHandler, true);
        document.removeEventListener("click", window.__stallzNotifOutsideHandler, true);
        window.removeEventListener("popstate", window.__stallzNotifPopHandler, true);
    };

    const open = () => {
        __notifFilter = 'ALL';
        dropdown.style.display = "flex";
        if (overlay && isMobile) { overlay.classList.add("active"); overlay.setAttribute("aria-hidden","false"); }
        document.body.style.overflow = isMobile ? "hidden" : "";
        setTimeout(() => dropdown.classList.add("active"), 10);
        renderSharedNotifications();

        // Back/gesture close support
        if (isMobile) {
            try {
                const st = window.history.state || {};
                if (!st.__stallzNotifOpen) history.pushState({ ...st, __stallzNotifOpen: true }, "");
            } catch(e){}
        }

        // Close on outside click
        window.__stallzNotifOutsideHandler = (ev) => {
            if (!dropdown.classList.contains("active")) return;
            const hitDropdown = dropdown.contains(ev.target);
            const hitBell = (ev.target && (ev.target.closest && ev.target.closest(".notification-btn")));
            if (!hitDropdown && !hitBell) close(true);
        };
        document.addEventListener("click", window.__stallzNotifOutsideHandler, true);

        // Close on ESC
        window.__stallzNotifKeyHandler = (ev) => {
            if (ev.key === "Escape") close(true);
        };
        document.addEventListener("keydown", window.__stallzNotifKeyHandler, true);

        // Close on back/gesture
        window.__stallzNotifPopHandler = () => {
            if (dropdown.classList.contains("active")) close(true);
        };
        window.addEventListener("popstate", window.__stallzNotifPopHandler, true);

        // Close when overlay clicked
        if (overlay) {
            overlay.onclick = () => close(true);
        }
    };

    if (shouldOpen) { try { __haptic('soft'); } catch(_) {} open(); }
    else { try { __haptic('soft'); } catch(_) {} close(true); }
}

function setNotifFilter(filter, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    __notifFilter = filter;
    renderSharedNotifications();
}

async function markNotificationRead(notifId, event) {
    if (event) event.stopPropagation();
    if (!notifId || notifId === 'PENDING_UI') return;

    try {
        const uid = currentUserUid || window.StallzAuth?.getSession?.()?.uid;
        if (!uid) return;

        const updates = {};
        updates[`stallzShared_v1/notifications/users/${uid}/${notifId}/read`] = true;
        updates[`clients/${uid}/notifications/${notifId}/read`] = true;

        await firebase.database().ref().update(updates).catch(async () => {
            try { await firebase.database().ref(`stallzShared_v1/notifications/users/${uid}/${notifId}/read`).set(true); } catch(_) {}
            try { await firebase.database().ref(`clients/${uid}/notifications/${notifId}/read`).set(true); } catch(_) {}
        });

        renderSharedNotifications();

        // ✅ If a notif was tapped in the dropdown, hide it immediately for a clean UX
        try {
            const dd = document.getElementById('notificationDropdown');
            if (dd && dd.classList.contains('active')) {
                // keep the dropdown open on desktop, but on mobile it feels better to close
                const isMobile = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
                if (isMobile) toggleNotifications(false);
            }
        } catch(_) {}

    } catch(e) { console.error(e); }
}

async function markAllNotificationsRead(event) {
    if (event) event.stopPropagation();

    try {
        const uid = currentUserUid || window.StallzAuth?.getSession?.()?.uid;
        if (!uid) return;

        const notifs = window.StallzShared?.getUserNotifications?.(uid) || [];
        const updates = {};

        notifs.forEach(n => {
            if (n && n.id && !n.read) {
                updates[`stallzShared_v1/notifications/users/${uid}/${n.id}/read`] = true;
                updates[`clients/${uid}/notifications/${n.id}/read`] = true;
            }
        });

        if (Object.keys(updates).length > 0) {
            await firebase.database().ref().update(updates);
            renderSharedNotifications();
        }
    } catch(e) { console.error(e); }
}

function renderSharedNotifications() {
    const list = document.getElementById("notificationList");
    const badge = document.getElementById("clientBellBadge");
    if (!list) return;

    const uid = currentUserUid || window.StallzAuth?.getSession?.()?.uid;
    if (!uid) {
        list.innerHTML = `<div class="notify-empty">Please sign in again.</div>`;
        return;
    }

    let notifs = [];
    let pendingReqs = [];
    try {
        const allReqs = window.StallzShared?.listLoanRequestsForClient?.(uid) || [];
        pendingReqs = allReqs.filter(r => String(r.status || "").toUpperCase() === "PENDING");
        notifs = window.StallzShared?.getUserNotifications?.(uid) || [];
    } catch (e) { console.error("Notif Error", e); }

    const unreadCount = pendingReqs.length + notifs.filter(n => !n.read).length;
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = String(unreadCount > 99 ? '99+' : unreadCount);
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    try {
        const markAllBtn = document.getElementById('markAllBtn');
        if (markAllBtn) markAllBtn.style.display = (unreadCount > 0 ? 'block' : 'none');
    } catch(_) {}

    const dropdownHeader = document.querySelector(".dropdown-header");

    if (dropdownHeader && !dropdownHeader.querySelector('.notif-filters')) {
        dropdownHeader.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:12px;">
                <span style="font-weight:900; font-size:1.1rem; letter-spacing:0.5px;">Activity</span>
                <button id="viewAllNotifBtn" onclick="openNotificationHistoryModal()" style="background:none; border:none; color:rgba(226,232,240,0.75); font-size:0.75rem; font-weight:900; cursor:pointer; padding:0; margin-right:10px;">View all</button>
                <button id="markAllBtn" onclick="markAllNotificationsRead(event)" style="background:none; border:none; color:var(--primary); font-size:0.75rem; font-weight:800; cursor:pointer; padding:0; display: ${unreadCount > 0 ? 'block' : 'none'};">Mark all read</button>
            </div>
            <div class="notif-filters" style="display:flex; background:rgba(255,255,255,0.05); padding:4px; border-radius:12px; width:100%; gap: 4px;">
                <button id="filterBtnAll" style="flex:1; text-align:center; padding: 6px; border-radius: 8px; border: none; font-weight: 700; font-size: 0.75rem; transition: all 0.2s;" onclick="setNotifFilter('ALL', event)">All</button>
                <button id="filterBtnAlerts" style="flex:1; text-align:center; padding: 6px; border-radius: 8px; border: none; font-weight: 700; font-size: 0.75rem; transition: all 0.2s;" onclick="setNotifFilter('ALERTS', event)">Alerts</button>
            </div>
        `;
    }

    const btnAll = document.getElementById('filterBtnAll');
    const btnAlerts = document.getElementById('filterBtnAlerts');
    const markBtn = document.getElementById("markAllBtn");

    if (markBtn) markBtn.style.display = unreadCount > 0 ? "block" : "none";

    if (btnAll && btnAlerts) {
        btnAll.className = __notifFilter === 'ALL' ? 'active' : '';
        btnAlerts.className = __notifFilter === 'ALERTS' ? 'active' : '';

        btnAll.style.background = __notifFilter === 'ALL' ? 'rgba(255,255,255,0.1)' : 'transparent';
        btnAll.style.color = __notifFilter === 'ALL' ? '#fff' : 'var(--text-muted)';

        btnAlerts.style.background = __notifFilter === 'ALERTS' ? 'rgba(255,255,255,0.1)' : 'transparent';
        btnAlerts.style.color = __notifFilter === 'ALERTS' ? '#fff' : 'var(--text-muted)';
    }

    let displayList = [];
    const NOW = Date.now();
    const THIRTY_TWO_HOURS = 32 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    if (__notifFilter === 'ALL') {
        pendingReqs.forEach(r => {
            displayList.push({
                id: 'PENDING_UI',
                type: 'PENDING_UI',
                title: 'Reviewing Request',
                body: `Your K${Number(r.amount).toLocaleString()} request is pending.`,
                createdAt: r.createdAt || Date.now(),
                icon: '<i class="fas fa-circle-notch fa-spin"></i>',
                bg: 'rgba(59, 130, 246, 0.15)',
                color: '#60a5fa'
            });
        });

        notifs.forEach(n => {
            // ✅ Dropdown should show ONLY unread (history modal shows everything)
            const age = NOW - new Date(n.createdAt).getTime();
            const isRead = !!n.read;
            if (!isRead && age < SEVEN_DAYS) {
                displayList.push(n);
            }
        });

    } else if (__notifFilter === 'ALERTS') {
        const criticalTypes = ["REQUEST_REJECTED", "DUE_SOON", "URGENT"];
        notifs.forEach(n => {
            if (criticalTypes.includes(n.type)) {
                const age = NOW - new Date(n.createdAt).getTime();
                const isRead = !!n.read;
                if (!isRead && age < SEVEN_DAYS) {
                    displayList.push(n);
                }
            }
        });
    }

    displayList.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (displayList.length === 0) {
        list.innerHTML = `
            <div class="notify-empty" style="padding: 30px 10px;">
                ${__notifFilter === 'ALERTS'
                    ? '<i class="fas fa-check-circle" style="display:block; font-size:1.8rem; margin-bottom:12px; color: var(--primary); opacity:0.6;"></i>No urgent alerts. All good!'
                    : '<i class="fas fa-bell-slash" style="display:block; font-size:1.8rem; margin-bottom:12px; opacity:0.2;"></i>You\'re all caught up!'}
            </div>`;
        return;
    }

    list.innerHTML = displayList.map((n, index) => {
        let icon = '<i class="fas fa-bell"></i>';
        let bg = 'rgba(255,255,255,0.05)';
        let color = '#fff';

        if (n.type === 'PENDING_UI') { icon = n.icon; bg = n.bg; color = n.color; }
        else if (n.type === 'REQUEST_APPROVED') { icon = '<i class="fas fa-check"></i>'; bg = 'rgba(16, 185, 129, 0.15)'; color = '#34d399'; }
        else if (n.type === 'REQUEST_REJECTED') { icon = '<i class="fas fa-times"></i>'; bg = 'rgba(239, 68, 68, 0.15)'; color = '#f87171'; }
        else if (n.type === 'DUE_SOON') { icon = '<i class="fas fa-exclamation-triangle"></i>'; bg = 'rgba(245, 158, 11, 0.15)'; color = '#fbbf24'; }
        else if (n.type === 'MESSAGE' || n.type === 'ADMIN_MESSAGE') { icon = '<i class="fas fa-comment-dots"></i>'; bg = 'rgba(59, 130, 246, 0.15)'; color = '#60a5fa'; }

        let cleanTitle = escapeHTML(n.title || '').replace(/[✅❌📝💬⏳🔔🎉]/g, '').trim();
        let cleanBody = escapeHTML(n.body || '').replace(/[✅❌📝💬⏳🔔🎉]/g, '').trim();

        const isUnread = !n.read && n.type !== 'PENDING_UI';
        const delay = index * 0.05;

        return `
            <div class="notify-item ${isUnread ? 'unread' : ''}"
                 onclick="markNotificationRead('${n.id}', event)"
                 style="animation-delay: ${delay}s; border-bottom: 1px solid rgba(255,255,255,0.06); padding: 12px 10px; margin-bottom: 0; border-radius: 0;">
                <div class="notif-icon-circle" style="background: ${bg}; color: ${color}; width: 36px; height: 36px; font-size: 1rem;">
                    ${icon}
                </div>
                <div class="notif-content">
                    <div class="notif-title" style="${isUnread ? 'color:#fff;' : 'color:#cbd5e1;'} font-size: 0.85rem;">${cleanTitle}</div>
                    <div class="notif-body" style="font-size: 0.75rem;">${cleanBody}</div>
                    <div class="notif-time" style="margin-top: 4px;">${timeAgo(new Date(n.createdAt).getTime())}</div>
                </div>
                ${isUnread ? '<div class="unread-indicator" style="top: 15px;"></div>' : ''}
            </div>
        `;
    }).join("");
}

window.openNotificationHistoryModal = function() {
    closeProfileModal();
    const modal = document.getElementById('notificationHistoryModal');
    if (modal) {
        modal.style.display = 'flex';
        try { ensureHistoryControls(); } catch(_) {}
        const content = modal.querySelector('.modal-glass');
        if (content) content.style.animation = 'slideUp 0.3s ease forwards';
        renderNotificationHistoryArchive();
    }
};

window.closeNotificationHistoryModal = function() {
    const modal = document.getElementById('notificationHistoryModal');
    if (modal) {
        const content = modal.querySelector('.modal-glass');
        if (content) {
            content.style.animation = 'slideDown 0.3s ease forwards';
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        } else {
            modal.style.display = 'none';
        }
    }
};


// ================================
// Notification History Controls
// ================================
let __histTab = 'ALL';      // ALL | UNREAD
let __histCat = 'ALL';      // ALL | LOANS | PAYMENTS | SYSTEM
let __histQuery = '';

function ensureHistoryControls() {
    const modal = document.getElementById('notificationHistoryModal');
    if (!modal) return;
    const glass = modal.querySelector('.modal-glass');
    if (!glass) return;

    // already mounted
    if (glass.querySelector('.hist-controls')) return;

    const controls = document.createElement('div');
    controls.className = 'hist-controls';
    controls.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin:0 0 12px;';

    controls.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
        <div style="display:flex;gap:6px;background:rgba(255,255,255,0.06);padding:4px;border-radius:12px;">
          <button type="button" id="histTabAll" style="padding:8px 10px;border-radius:10px;border:none;font-weight:900;font-size:0.78rem;background:rgba(255,255,255,0.10);color:#e2e8f0;cursor:pointer;">All</button>
          <button type="button" id="histTabUnread" style="padding:8px 10px;border-radius:10px;border:none;font-weight:900;font-size:0.78rem;background:transparent;color:rgba(226,232,240,0.75);cursor:pointer;">Unread</button>
        </div>
        <select id="histCat" style="padding:9px 10px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(2,6,23,0.45);color:#e2e8f0;font-weight:800;font-size:0.78rem;">
          <option value="ALL">All types</option>
          <option value="LOANS">Loans</option>
          <option value="PAYMENTS">Payments</option>
          <option value="SYSTEM">System</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="histSearch" type="search" placeholder="Search notifications…" style="flex:1;min-width:0;padding:11px 12px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(2,6,23,0.45);color:#e2e8f0;outline:none;">
        <button type="button" id="histMarkAllRead" style="padding:11px 12px;border-radius:14px;border:1px solid rgba(74,222,128,0.20);background:rgba(74,222,128,0.12);color:#bbf7d0;font-weight:900;font-size:0.78rem;cursor:pointer;white-space:nowrap;">Mark all read</button>
      </div>
    `;

    const header = glass.querySelector('.modal-header');
    if (header) header.insertAdjacentElement('afterend', controls);
    else glass.insertAdjacentElement('afterbegin', controls);

    function syncTabs() {
        const allBtn = controls.querySelector('#histTabAll');
        const unBtn  = controls.querySelector('#histTabUnread');
        if (!allBtn || !unBtn) return;

        if (__histTab === 'UNREAD') {
            allBtn.style.background = 'transparent';
            allBtn.style.color = 'rgba(226,232,240,0.75)';
            unBtn.style.background = 'rgba(255,255,255,0.10)';
            unBtn.style.color = '#e2e8f0';
        } else {
            unBtn.style.background = 'transparent';
            unBtn.style.color = 'rgba(226,232,240,0.75)';
            allBtn.style.background = 'rgba(255,255,255,0.10)';
            allBtn.style.color = '#e2e8f0';
        }
    }

    controls.querySelector('#histTabAll')?.addEventListener('click', () => { __histTab = 'ALL'; syncTabs(); renderNotificationHistoryArchive(); });
    controls.querySelector('#histTabUnread')?.addEventListener('click', () => { __histTab = 'UNREAD'; syncTabs(); renderNotificationHistoryArchive(); });

    controls.querySelector('#histCat')?.addEventListener('change', (e) => { __histCat = String(e.target.value || 'ALL'); renderNotificationHistoryArchive(); });
    controls.querySelector('#histSearch')?.addEventListener('input', (e) => { __histQuery = String(e.target.value || ''); renderNotificationHistoryArchive(); });

    controls.querySelector('#histMarkAllRead')?.addEventListener('click', async () => {
        try { await markAllNotificationsRead(); } catch(_) {}
        renderNotificationHistoryArchive();
        renderSharedNotifications();
    });

    syncTabs();
}
function renderNotificationHistoryArchive() {
    const list = document.getElementById("historyNotificationList");
    if (!list) return;

    const uid = currentUserUid || window.StallzAuth?.getSession?.()?.uid;
    if (!uid) {
        list.innerHTML = `<div class="notify-empty">Please sign in again.</div>`;
        return;
    }

    let notifs = [];
    try {
        notifs = window.StallzShared?.getUserNotifications?.(uid) || [];
    } catch (e) { console.error("Archive Error", e); }

    notifs.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Apply controls
    const q = String(__histQuery || "").trim().toLowerCase();
    const tab = String(__histTab || "ALL").toUpperCase();
    const cat = String(__histCat || "ALL").toUpperCase();

    const isLoanType = (t) => /LOAN|REQUEST|DUE|OVERDUE/i.test(String(t || ""));
    const isPaymentType = (t) => /PAY|PAYMENT/i.test(String(t || ""));
    const isSystemType = (t) => /SYSTEM|SECURITY|KYC|INFO/i.test(String(t || ""));

    notifs = notifs.filter(n => {
        if (tab === "UNREAD" && n.read) return false;

        if (cat !== "ALL") {
            const t = n.type || "";
            if (cat === "LOANS" && !isLoanType(t)) return false;
            if (cat === "PAYMENTS" && !isPaymentType(t)) return false;
            if (cat === "SYSTEM" && !isSystemType(t)) return false;
        }

        if (q) {
            const hay = `${n.title || ""} ${n.body || ""} ${n.type || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    if (notifs.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding: 30px 16px; color:var(--text-muted);">
                <i class="fas fa-bell-slash" style="font-size: 2rem; opacity: 0.4;"></i>
                <p style="margin-top: 15px; font-weight: 700;">No notifications found</p>
                <p style="margin: 0; font-size: 0.9rem;">Try changing filters or search.</p>
            </div>
        `;
        return;
    }

    // Date grouping
    const now = new Date();
    function dayLabel(d) {
        const dt = new Date(d);
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startThat = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
        const diffDays = Math.round((startToday - startThat) / 86400000);
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    let html = '';
    let lastGroup = '';
    notifs.forEach((n, idx) => {
        const grp = dayLabel(n.createdAt || Date.now());
        if (grp !== lastGroup) {
            lastGroup = grp;
            html += `<div style="padding:10px 6px 6px; font-weight:900; font-size:0.82rem; opacity:0.85;">${escapeHTML(grp)}</div>`;
        }

        const isUnread = !n.read;
        const title = escapeHTML(n.title || "Notification");
        const body = escapeHTML(n.body || "");

        html += `
          <div class="notify-item ${isUnread ? 'unread' : ''}" style="border-radius:14px; margin:6px 0; border:1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.03); padding: 12px 12px;"
               onclick="markNotificationRead('${n.id}', event)">
            <div class="notif-icon-circle" style="width: 36px; height: 36px; font-size: 1rem;">
              <i class="fas fa-bell"></i>
            </div>
            <div class="notif-content">
              <div class="notif-title" style="${isUnread ? 'color:#fff;' : 'color:#cbd5e1;'} font-size: 0.9rem;">${title}</div>
              <div class="notif-body" style="font-size:0.82rem; opacity:0.9;">${body}</div>
              <div class="notif-time" style="margin-top:6px; font-size:0.72rem; opacity:0.65;">
                ${new Date(n.createdAt || Date.now()).toLocaleString()}
              </div>
            </div>
          </div>
        `;
    });

    list.innerHTML = html;
}

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

// --- Live Request Calculator Logic ---
window.updateRequestCalculator = function() {
    const amountInput = document.getElementById('reqAmount');
    const planInput = document.getElementById('reqPlan');
    const resultBox = document.getElementById('reqCalcResult');

    if (!amountInput || !planInput || !resultBox) return;

    const amount = parseFloat(amountInput.value);
    const plan = planInput.value;

    // Hide the box if there's no valid amount or if a plan hasn't been selected yet
    if (isNaN(amount) || amount <= 0 || !plan) {
        resultBox.style.display = 'none';
        return;
    }

    let rate = 0;
    let rateText = "0%";

    // Match these rates to your estimator's rates
    if (plan === 'Weekly') {
        rate = 0.20;
        rateText = "20%";
    } else if (plan === 'Two Weeks') {
        rate = 0.30;
        rateText = "30%";
    } else if (plan === 'Three Weeks') {
        rate = 0.35;
        rateText = "35%";
    } else if (plan === 'Monthly') {
        rate = 0.40;
        rateText = "40%";
    }

    const interestAmt = amount * rate;
    const totalRepay = amount + interestAmt;

    // Update the DOM elements
    document.getElementById('reqCalcRate').innerText = rateText;

    // Format as Zambian Kwacha (K)
    document.getElementById('reqCalcInterestAmt').innerText = "K" + interestAmt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('reqCalcTotalAmt').innerText = "K" + totalRepay.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

    // Reveal the calculator box
    resultBox.style.display = 'block';
};

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

function selectOption(inputId, value, btnElement) {
    document.getElementById(inputId).value = value;
    const parent = btnElement.parentElement;
    parent.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');

    if (inputId === 'reqPlan') {
        if (typeof window.updateRequestCalculator === 'function') {
            window.updateRequestCalculator();
        }
    }
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

function showRequestError(message) {
    const errBox = document.getElementById('requestModalError');
    const errText = document.getElementById('requestModalErrorText');
    if (errBox && errText) {
        errText.textContent = message;
        errBox.style.display = 'block';
    } else {
        showCustomAlert(message);
    }
}

function hideRequestError() {
    const errBox = document.getElementById('requestModalError');
    if (errBox) errBox.style.display = 'none';
}

// --- NEW WIZARD LOGIC FOR LOAN REQUESTS ---
let currentReqStep = 1;

function validateReqStep(step) {
    let isValid = true;
    const err = document.getElementById('reqError' + step);
    if(err) err.style.display = 'none';

    let reqFields = [];
    // Added 'reqPlan' to ensure they picked a button
    if (step === 1) reqFields = ['reqAmount', 'reqPlan', 'reqCollateralItem', 'reqCollateralValue'];
    if (step === 2) reqFields = ['reqNrcNumber'];

    const fieldNames = {
        'reqAmount': 'Loan Amount',
        'reqPlan': 'Repayment Plan', // User-friendly error label
        'reqCollateralItem': 'Collateral Item',
        'reqCollateralValue': 'Collateral Value',
        'reqNrcNumber': 'NRC Number'
    };

    for (let id of reqFields) {
        const el = document.getElementById(id);
        if (!el.value.trim() || (el.type === 'number' && Number(el.value) <= 0)) {
            isValid = false;
            if(el.type !== 'hidden') el.style.borderColor = '#ef4444';
            if(err) {
                err.textContent = `Please provide a valid ${fieldNames[id]}.`;
                err.style.display = 'block';
            }
            if(el.type !== 'hidden') el.focus();
            break;
        }
    }
    return isValid;
}
window.nextReqStep = function(step) {
    if (step > currentReqStep && !validateReqStep(currentReqStep)) return;

    currentReqStep = step;
    const slider = document.getElementById('reqSliderContainer');

    // Width is 200%, so step 2 shifts by -50% to show the second half
    const translateValue = (step - 1) * -50;
    slider.style.transform = `translateX(${translateValue}%)`;

    document.getElementById('reqWizardStepText').textContent = `Step ${step} of 2`;
    const titles = {1: "Loan Details", 2: "Verification & Consent"};
    document.getElementById('reqWizardTitle').textContent = titles[step];

    document.getElementById('reqDot1').classList.toggle('active', step === 1);
    document.getElementById('reqDot2').classList.toggle('active', step === 2);
};

async function submitLoanApplication(event) {
  const btn = event?.target;
  const oldTxt = btn ? btn.innerText : "";

  // Target the Step 2 error block specifically
  const err2 = document.getElementById('reqError2');
  if (err2) err2.style.display = 'none';

  const showError = (msg) => {
      if (err2) {
          err2.textContent = msg;
          err2.style.display = 'block';
      } else {
          showCustomAlert(msg);
      }
  };

  try {
    const uid = currentUserUid || window.StallzAuth?.getSession?.()?.uid;
    if (!uid) { showError("Session expired. Please sign in again."); return; }

    const el = (id) => document.getElementById(id);
    const val = (id) => String(el(id)?.value ?? "").trim();

    let profile = typeof __lastClientProfileCache !== 'undefined' ? __lastClientProfileCache : {};

    if (!profile.name) {
        try {
            const savedProfile = localStorage.getItem("stallz_client_profile");
            if (savedProfile) profile = JSON.parse(savedProfile);
        } catch (e) {}
    }

    if (!profile.firstName && !profile.name && !profile.email) {
        profile = window.StallzShared?.getUser?.(uid) || {};
    }

    if (!profile.name && !profile.firstName && !profile.email) {
        showError("Profile still syncing... please wait a second and try again.");
        return;
    }

    const amount = Number(String(el("reqAmount")?.value ?? "").trim().replace(/[^0-9.]/g, ""));
    const plan = String(el("reqPlan")?.value ?? "Monthly").trim();
    const purpose = val("reqPurpose");
    const collateralItem = val("reqCollateralItem");
    const collateralValue = Number(String(el("reqCollateralValue")?.value ?? "").trim().replace(/[^0-9.]/g, ""));

    // Grab the new fields
    const nrcNumber = val("reqNrcNumber");
    const nokName = val("loanNokName");
    const nokPhone = val("loanNokPhone");
    const termsChecked = el("reqTerms")?.checked;

    if (!nrcNumber) {
        el("reqNrcNumber").style.borderColor = '#ef4444';
        showError("Your NRC number is required.");
        return;
    }

    const expectedNrc = String(profile.nrc || "").trim();
    const cleanEnteredNrc = nrcNumber.replace(/[^a-zA-Z0-9]/g, "");
    const cleanExpectedNrc = expectedNrc.replace(/[^a-zA-Z0-9]/g, "");

    if (expectedNrc && cleanEnteredNrc !== cleanExpectedNrc) {
        el("reqNrcNumber").style.borderColor = '#ef4444';
        showError("Security Error: The NRC number entered does not match the one registered to your account.");
        return;
    }

    if (!termsChecked) { showError("You must agree to the Terms and Conditions to proceed."); return; }

    if (profile.loans) {
        const hasUnpaidLoan = Object.values(profile.loans).some(l =>
            l && typeof l === "object" &&
            (String(l.status).toUpperCase() === "ACTIVE" || String(l.status).toUpperCase() === "OVERDUE")
        );

        if (hasUnpaidLoan) {
            showError("You currently have an unpaid loan. Please clear your balance first, thank you.");
            return;
        }
    }

    try {
        const pendingReqs = window.StallzShared?.listLoanRequestsForClient?.(uid) || [];
        const hasPending = pendingReqs.some(r => String(r.status || "").toUpperCase() === "PENDING");
        if (hasPending) {
            showError("You already have a pending loan request awaiting approval.");
            return;
        }
    } catch (e) {}

    let clientName = profile.name || profile.fullName || "Unknown Client";
    if (!profile.name && profile.firstName) {
         clientName = profile.firstName + (profile.surname ? " " + profile.surname : "");
    } else if (!profile.name && profile.email) {
         clientName = profile.email.split('@')[0];
    }

    const clientPhone = profile.phone || (typeof currentUserPhone !== 'undefined' ? currentUserPhone : "");
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
      nokName,      // Save Next of Kin Name
      nokPhone,     // Save Next of Kin Phone
      nrcFrontUrl: "",
      nrcBackUrl: ""
    });

    closeRequestModal();
    if (typeof renderSharedNotifications === 'function') renderSharedNotifications();
    showCustomAlert("Request submitted — awaiting approval", true);
    __haptic("success");
    __successPop(btn || document.getElementById("reqSubmitBtn"));

    // Reset the dismissed panel memory and force it to show status
    window.__stallz_req_panel_dismissed = false;
    if (typeof renderLoanRequestProgressPanel === 'function') {
        renderLoanRequestProgressPanel(true);
    }

  } catch (e) {
    console.error(e);
    showError(e.message);
  } finally {
    if (btn) btn.innerText = oldTxt || "Submit Application";
  }
}

window.closeLoanRequestPanel = function() {
    const panel = document.getElementById('loanRequestProgressPanel');
    if (panel) {
        panel.classList.add('rp-closing');

        // FIX: Use window variable so it resets naturally on page refresh
        window.__stallz_req_panel_dismissed = true;

        setTimeout(() => {
            panel.style.display = 'none';
            panel.classList.remove('rp-closing');
        }, 350);
    }
};

function openStatementsModal() {
    if (typeof window.openStatementsModal === 'function') return window.openStatementsModal();
    const m = document.getElementById('statementsModal');
    if (!m) return;
    m.classList.remove('closing');
    m.style.display = 'flex';
    void m.offsetWidth;
    m.classList.add('active');
    renderStatementsModal().catch(() => {});
}

function closeStatementsModal() {
    if (typeof window.closeStatementsModal === 'function') return window.closeStatementsModal();
    const m = document.getElementById('statementsModal');
    if (!m) return;
    m.classList.add('closing');
    m.classList.remove('active');
    setTimeout(() => {
        m.style.display = 'none';
        m.classList.remove('closing');
    }, 300);
}

function setStatementFilter(filter) {
    __statementFilter = String(filter || "ALL").toUpperCase();
    document.querySelectorAll('.stmt-filter').forEach(btn => {
        const f = (btn.getAttribute('data-filter') || '').toUpperCase();
        btn.classList.toggle('active', f === __statementFilter);
    });
    renderStatementsModal().catch(() => {});
}

async function renderStatementsModal() {
    const ledger = document.getElementById('statementLedger');
    if (!ledger) return;

    ledger.innerHTML = `<div class="ledger-loading" style="animation: fadeIn 0.3s ease;"><i class="fas fa-circle-notch fa-spin" style="margin-right:10px; color: var(--primary);"></i>Updating Statement...</div>`;

    if (!currentUserUid || typeof firebase === "undefined") {
        ledger.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-muted);">Session required.</div>`;
        return;
    }

    const snap = await firebase.database().ref(`clients/${currentUserUid}`).once('value');
    const profile = snap.val() || __lastClientProfileCache || {};

    const loans = Object.values(profile.loans || {}).filter(Boolean);
    const repayments = Object.values(profile.repayments || {}).filter(Boolean);

    const totalBorrowed = loans.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const totalPaid = repayments.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const currentBalance = loans
      .filter(l => ["ACTIVE", "OVERDUE"].includes(String(l.status || "").toUpperCase()))
      .reduce((sum, l) => sum + Number(l.balance || 0), 0);

    document.getElementById("stmtTotalBorrowed").textContent = __fmtMoney(totalBorrowed);
    document.getElementById("stmtTotalPaid").textContent = __fmtMoney(totalPaid);
    document.getElementById("stmtCurrentBalance").textContent = __fmtMoney(currentBalance);

    const events = [];

    loans.forEach(l => {
        const dt = __safeDate(l.startDate || l.createdAt);
        if (!dt) return;
        events.push({
            type: "LOAN",
            date: dt,
            title: `Loan Issued (#${l.id})`,
            sub: `Item: ${l.collateralItem || "Personal"}`,
            detail: "Principal Amount",
            amount: Number(l.amount || 0)
        });
    });

    repayments.forEach(r => {
        const dt = __safeDate(r.date || r.createdAt);
        if (!dt) return;
        events.push({
            type: "PAYMENT",
            date: dt,
            title: `Payment Received`,
            sub: `Loan Ref: #${r.loanId || '—'}`,
            detail: r.note ? `Note: ${r.note}` : "Balance Reduction",
            amount: -Number(r.amount || 0)
        });
    });

    const f = __statementFilter || "ALL";
    const filtered = events
      .filter(e => f === "ALL" ? true : (f === "LOANS" ? e.type === "LOAN" : e.type === "PAYMENT"))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    if (filtered.length === 0) {
        ledger.innerHTML = `<div style="padding:40px 16px; text-align:center; color:var(--text-muted); font-size:0.85rem;">No transaction history found.</div>`;
        return;
    }

    ledger.innerHTML = filtered.map((ev, index) => {
        const isLoan = ev.type === "LOAN";
        const amt = Math.abs(ev.amount);
        const iconClass = isLoan ? "icon-loan" : "icon-pay";
        const amtClass = isLoan ? "amt-neg" : "amt-pos";
        const icon = isLoan ? "fa-hand-holding-usd" : "fa-receipt";
        const delay = index * 0.05;

        return `
            <div class="stmt-entry" style="animation-delay: ${delay}s;">
                <div class="stmt-left">
                    <div class="stmt-icon ${iconClass}">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="stmt-info">
                        <div class="stmt-title">${escapeHTML(ev.title)}</div>
                        <div class="stmt-date">${ev.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                        <div class="stmt-detail-row">${escapeHTML(ev.sub)}</div>
                    </div>
                </div>
                <div class="stmt-right">
                    <div class="stmt-amt ${amtClass}">${isLoan ? '+' : '-'}${__fmtMoney(amt)}</div>
                    <div class="stmt-sub-label">${escapeHTML(ev.detail)}</div>
                </div>
            </div>
        `;
    }).join("");
}

function openHistoryModal() {
    if (typeof window.openHistoryModal === 'function' && window.openHistoryModal !== openHistoryModal) return window.openHistoryModal();
    const m = document.getElementById('historyModal');
    if (!m) return;
    m.classList.remove('closing');
    m.style.display = 'flex';
    void m.offsetWidth;
    m.classList.add('active');
    renderLoanHistoryModal().catch(() => {});
}

function closeHistoryModal() {
    if (typeof window.closeHistoryModal === 'function' && window.closeHistoryModal !== closeHistoryModal) return window.closeHistoryModal();
    const m = document.getElementById('historyModal');
    if (!m) return;
    m.classList.add('closing');
    m.classList.remove('active');
    setTimeout(() => {
        m.style.display = 'none';
        m.classList.remove('closing');
    }, 300);
}

async function renderLoanHistoryModal() {
    const body = document.getElementById('loanHistoryBody');
    if (!body) return;

    body.innerHTML = `<div class="ledger-loading" style="animation: fadeIn 0.3s ease;"><i class="fas fa-circle-notch fa-spin" style="margin-right:10px; color: var(--primary);"></i>Syncing Records...</div>`;

    if (!currentUserUid || typeof firebase === "undefined") return;

    try {
        const snap = await firebase.database().ref(`clients/${currentUserUid}/loans`).once('value');
        const loansObj = snap.val() || {};
        const loans = Object.values(loansObj).filter(Boolean)
            .sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));

        if (loans.length === 0) {
            body.innerHTML = `<div style="padding:40px 20px; text-align:center; color:var(--text-muted); font-size:0.85rem;">No previous records found.</div>`;
            return;
        }

        body.innerHTML = loans.map((l, index) => {
            const status = String(l.status || "PENDING").toUpperCase();
            const amt = Number(l.amount || 0);
            const dt = __safeDate(l.startDate || l.createdAt);

            let icon = "fa-clock";
            let iconClass = "icon-loan";
            let statusLabel = "Processing";
            let statusColor = "var(--text-muted)";

            if (status === "PAID" || status === "CLOSED") {
                icon = "fa-check-circle";
                iconClass = "icon-pay";
                statusLabel = "Fully Settled";
                statusColor = "#4ade80";
            } else if (status === "OVERDUE") {
                icon = "fa-exclamation-triangle";
                iconClass = "icon-red";
                statusLabel = "Overdue Payment";
                statusColor = "#f87171";
            } else if (status === "ACTIVE") {
                icon = "fa-sync-alt";
                iconClass = "icon-loan";
                statusLabel = "Active Loan";
                statusColor = "#60a5fa";
            }

            const delay = index * 0.05;

            return `
                <div class="stmt-entry h-entry" style="animation-delay: ${delay}s;">
                    <div class="stmt-left">
                        <div class="stmt-icon ${iconClass}">
                            <i class="fas ${icon}"></i>
                        </div>
                        <div class="stmt-info">
                            <div class="stmt-title">Loan Record #${l.id}</div>
                            <div class="stmt-date">${dt ? dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                            <div class="stmt-detail-row" style="color: ${statusColor}; font-weight: 800; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px;">
                                ${statusLabel}
                            </div>
                        </div>
                    </div>
                    <div class="stmt-right">
                        <div class="stmt-amt" style="color: #fff; font-weight: 900; font-size: 1rem;">${__fmtMoney(amt)}</div>
                        <div class="stmt-sub-label" style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-top: 3px;">
                            ${escapeHTML(l.collateralItem || 'Personal')}
                        </div>
                    </div>
                </div>
            `;
        }).join("");

    } catch (e) {
        console.error("History modal error:", e);
        body.innerHTML = `<div style="padding:20px; text-align:center; color:#f87171;">Error loading history.</div>`;
    }
}

async function fetchAndRenderPaymentMethods() {
    const listEl = document.getElementById('paymentMethodsList');
    if (!listEl) return;

    listEl.innerHTML = `
        <div style="text-align:center; padding: 20px; color: var(--text-muted);">
            <i class="fas fa-circle-notch fa-spin" style="font-size: 1.5rem; color: var(--primary); margin-bottom: 10px;"></i>
            <p>Loading payment details...</p>
        </div>
    `;

    try {
        const snapshot = await firebase.database().ref('paymentMethods').once('value');
        const methods = snapshot.val() || {};
        const methodKeys = Object.keys(methods);

        if (methodKeys.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding:15px; color:#ef4444;">No payment methods available right now.</div>`;
            return;
        }

        let html = '';
        methodKeys.forEach(key => {
            const method = methods[key];
            const name = method.name || method.firstname || 'Admin';
            const phone = method.phone || method.phoneNumber || '';

            if (!phone || phone.trim() === '') return;

            const cleanPhone = phone.replace(/\D/g, '');
            let network = "Mobile Money";
            let themeClass = "mtn-theme";
            let iconBg = "#333";
            let iconText = "#fff";

            if (cleanPhone.match(/^(260|0)?(96|76)/)) {
                network = "MTN Money";
                themeClass = "mtn-theme";
                iconBg = "#ffcc00"; iconText = "#000";
            } else if (cleanPhone.match(/^(260|0)?(97|77)/)) {
                network = "Airtel Money";
                themeClass = "airtel-theme";
                iconBg = "#ff0000"; iconText = "#fff";
            } else if (cleanPhone.match(/^(260|0)?(95|75)/)) {
                network = "Zamtel Kwacha";
                themeClass = "zamtel-theme";
                iconBg = "#009933"; iconText = "#fff";
            }

            let displayPhone = phone;
            if (cleanPhone.length >= 9) {
                const local = cleanPhone.slice(-9);
                displayPhone = `0${local.substring(0,2)} ${local.substring(2,5)} ${local.substring(5)}`;
            }

            html += `
                <div class="pay-provider-card ${themeClass}" onclick="copyToClipboard('${cleanPhone}', '${escapeHTML(name)}\\'s Number')"
                     style="cursor:pointer; display:flex; align-items:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:12px 15px; border-radius:12px; gap:15px; transition: background 0.2s;">
                    <div class="provider-icon" style="background:${iconBg}; color:${iconText}; width:48px; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.8rem; box-shadow:0 4px 10px rgba(0,0,0,0.3);">
                        ${network.split(' ')[0]}
                    </div>
                    <div class="provider-info" style="flex:1;">
                        <h4 style="margin:0; font-size:1rem; color:var(--text-main); font-weight: 700;">${network}</h4>
                        <p style="margin:2px 0 0 0; font-family:monospace; font-size:1.1rem; font-weight:700; color:var(--text-main); letter-spacing: 0.5px;">${displayPhone}</p>
                        <span class="provider-name" style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">${escapeHTML(name)}</span>
                    </div>
                    <div style="opacity:0.5; color:var(--text-main);">
                        <i class="fas fa-copy" style="font-size:1.2rem;"></i>
                    </div>
                </div>
            `;
        });

        listEl.innerHTML = html === '' ? `<div style="text-align:center; padding:15px; color:var(--text-muted);">No payment numbers have been added by admins yet.</div>` : html;

    } catch (error) {
        console.error("Error fetching payment methods:", error);
        const errText = String(error && (error.code || error.message) || error);
        const isPerm = errText.toLowerCase().includes("permission") || errText.toLowerCase().includes("denied");
        const msg = isPerm ? `Payment methods are blocked by database rules. Ask the admin to allow read access to <b>/paymentMethods</b>.` : `Failed to load payment numbers.`;
        listEl.innerHTML = `<div style="text-align:center; padding:15px; color:#ef4444;">${msg}</div>`;
    }
}

/* ==========================================================================
   UNIVERSAL MODAL ANIMATION HELPERS (Handles all 15 Windows)
   ========================================================================== */

// --- About Us & Feedback Modals ---
window.openAboutModal = function() {
    // Sync the version number from the sidebar to the About page
    const v1 = document.getElementById('clientAppVersion');
    const v2 = document.getElementById('aboutAppVersion');
    if (v1 && v2) v2.textContent = v1.textContent;
    openAnimatedModal('aboutModal');
};
window.closeAboutModal = function() { closeAnimatedModal('aboutModal'); };

window.openFeedbackModal = function() {
    const txt = document.getElementById('feedbackText');
    if(txt) txt.value = ''; // Clear old text
    openAnimatedModal('feedbackModal');
};
window.closeFeedbackModal = function() { closeAnimatedModal('feedbackModal'); };

window.submitFeedback = function() {
    const txt = document.getElementById('feedbackText');
    if (!txt || !txt.value.trim()) {
        showCustomAlert("Please type some feedback first.");
        return;
    }

    const btn = document.getElementById('submitFeedbackBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending...';

    // Simulate sending to the server, then show success
    setTimeout(() => {
        btn.innerHTML = originalText;
        closeFeedbackModal();
        showCustomAlert("Thank you! Your feedback has been received.", true);
    }, 800);
};

window.openAnimatedModal = function(modalId) {
    const m = document.getElementById(modalId);
    if (!m) return;
    try { __haptic('modalOpen'); } catch(_) {}
    m.classList.remove('closing');
    m.style.display = 'flex';
    document.body.classList.add('modal-open');
    void m.offsetWidth; // Force a browser reflow
    m.classList.add('active');
};

window.closeAnimatedModal = function(modalId, onCompleteCallback) {
    const m = document.getElementById(modalId);
    if (!m) return;
    try { __haptic('modalClose'); } catch(_) {}
    m.classList.remove('active');
    m.classList.add('closing');
    setTimeout(() => {
        m.style.display = 'none';
        m.classList.remove('closing');
        const hasOpenModal = !!document.querySelector('.modal-overlay.active, .drawer-overlay.active');
        if (!hasOpenModal) document.body.classList.remove('modal-open');
        if (typeof onCompleteCallback === 'function') onCompleteCallback();
    }, 300);
};

// 1. Profile Drawer
window.openProfileModal = function() { openAnimatedModal('profileModal'); try{ updatePushPermissionUI(); }catch(_){} };
window.closeProfileModal = function() { closeAnimatedModal('profileModal');
// 1b. Push Permission UI (Profile Drawer)
window.handleEnablePushClick = async function() {
    try { __haptic('tap'); } catch(_) {}
    if (window.StallzPush?.initPushNotifications) {
        await window.StallzPush.initPushNotifications({ forcePrompt: true });
    } else {
        await initPushNotifications(true);
    }
};

window.updatePushPermissionUI = function() {
    try {
        const btn = document.getElementById("enablePushBtn");
        const badge = document.getElementById("enablePushBadge");
        if (!btn) return;

        const perm = (typeof Notification !== "undefined") ? Notification.permission : "unsupported";
        if (perm === "granted") {
            btn.classList.add("is-enabled");
            if (badge) badge.textContent = "Enabled";
        } else if (perm === "denied") {
            btn.classList.remove("is-enabled");
            if (badge) badge.textContent = "Blocked";
        } else {
            btn.classList.remove("is-enabled");
            if (badge) badge.textContent = "Off";
        }
    } catch(_) {}
};
 };

// 2. Notification History
window.openNotificationHistoryModal = function() {
    closeProfileModal();
    openAnimatedModal('notificationHistoryModal');
    renderNotificationHistoryArchive();
};
window.closeNotificationHistoryModal = function() { closeAnimatedModal('notificationHistoryModal'); };

// 3. Loan History
window.openHistoryModal = function() {
    openAnimatedModal('historyModal');
    renderLoanHistoryModal().catch(err => console.error(err));
};
window.closeHistoryModal = function() { closeAnimatedModal('historyModal'); };

// 4. Make a Payment
window.openPayModal = function() {
    openAnimatedModal('payModal');
    fetchAndRenderPaymentMethods();
};
window.closePayModal = function() { closeAnimatedModal('payModal'); };

// 5. Statement
window.openStatementsModal = function() {
    openAnimatedModal('statementsModal');
    renderStatementsModal().catch(err => {
        const ledger = document.getElementById('statementLedger');
        if (ledger) ledger.innerHTML = `<div style="padding:16px; text-align:center; color:#ef4444;">Failed to load.</div>`;
    });
};
window.closeStatementsModal = function() { closeAnimatedModal('statementsModal'); };

// 6. Help Center
window.openSupportModal = function() { openAnimatedModal('supportModal'); };
window.closeSupportModal = function() { closeAnimatedModal('supportModal'); };

// 7. Loan Estimator
window.openCalcModal = function() { openAnimatedModal('calcModal'); };
window.closeCalcModal = function() { closeAnimatedModal('calcModal'); };

// 8. Apply for Loan
window.openRequestModal = function() {
    const planInput = document.getElementById('reqPlan');
    if (planInput) planInput.value = '';
    const resultBox = document.getElementById('reqCalcResult');
    if (resultBox) resultBox.style.display = 'none';

    if (typeof window.nextReqStep === 'function') {
        currentReqStep = 1;
        const slider = document.getElementById('reqSliderContainer');
        if(slider) slider.style.transform = `translateX(0%)`;
        const st = document.getElementById('reqWizardStepText');
        if(st) st.textContent = `Step 1 of 2`;
        const tit = document.getElementById('reqWizardTitle');
        if(tit) tit.textContent = "Loan Details";
        const d1 = document.getElementById('reqDot1');
        if(d1) d1.classList.add('active');
        const d2 = document.getElementById('reqDot2');
        if(d2) d2.classList.remove('active');
    }
    openAnimatedModal('requestModal');
};

window.closeRequestModal = function() {
    closeAnimatedModal('requestModal', () => {
        ['reqError1', 'reqError2', 'reqCalcResult'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = 'none';
        });
        ['reqAmount', 'reqCollateralItem', 'reqCollateralValue', 'reqNrcNumber', 'loanNokName', 'loanNokPhone'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.style.borderColor = 'var(--glass-border)'; }
        });
        const terms = document.getElementById('reqTerms');
        if(terms) terms.checked = false;
    });
};

// 9. Receipt Viewer
window.openClientReceiptModal = function() { openAnimatedModal('clientReceiptModal'); };
window.closeClientReceiptModal = function() { closeAnimatedModal('clientReceiptModal'); };

// 10. Upload Proof
window.openUploadModal = function() { openAnimatedModal('uploadModal'); };
window.closeUploadModal = function() { closeAnimatedModal('uploadModal'); };

// 11. Admin Contact / Choose Admin
window.openAdminContactModal = function(actionType) {
    currentContactAction = actionType;
    const fabMenu = document.getElementById('fabMenu');
    if (fabMenu) fabMenu.classList.remove('active');

    const titleEl = document.getElementById('adminContactTitle');
    if(titleEl) {
        titleEl.innerHTML = actionType === 'whatsapp'
            ? '<i class="fab fa-whatsapp" style="color:#25D366; margin-right:8px;"></i> WhatsApp'
            : '<i class="fas fa-phone" style="color:#3b82f6; margin-right:8px;"></i> Call Us';
    }
    openAnimatedModal('adminContactModal');
    fetchAndRenderAdmins();
};
window.closeAdminContactModal = function() { closeAnimatedModal('adminContactModal'); };
async function fetchAndRenderAdmins() {
    const listEl = document.getElementById('adminContactList');
    if (!listEl) return;
    listEl.innerHTML = `
        <div style="text-align:center; padding: 30px; color: var(--text-muted);">
            <i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; margin-bottom: 10px; color: var(--primary);"></i>
            <p>Loading admins...</p>
        </div>
    `;

    try {
        const snapshot = await firebase.database().ref('admins').once('value');
        const adminsData = snapshot.val() || {};
        const adminKeys = Object.keys(adminsData);

        if (adminKeys.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">No admins currently available.</div>`;
            return;
        }

        let html = '';
        adminKeys.forEach(key => {
            const admin = adminsData[key];

            let name = 'Support Agent';
            if (admin.fullName) {
                name = admin.fullName;
            } else if (admin.firstName || admin.lastName) {
                name = `${admin.firstName || ''} ${admin.lastName || ''}`.trim();
            } else if (admin.firstname || admin.lastname) {
                name = `${admin.firstname || ''} ${admin.lastname || ''}`.trim();
            } else if (admin.name) {
                name = admin.name;
            }

            const role = admin.role || 'Admin';
            const phone = admin.phone || admin.phoneNumber || "";

            if (phone.trim() !== "") {
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
            }
        });

        if (html === '') {
            listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">No admins have contact numbers set.</div>`;
        } else {
            listEl.innerHTML = html;
        }

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

    let cleanPhone = phone.replace(/[^0-9+]/g, '');
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '+260' + cleanPhone.substring(1);
    }

    if (currentContactAction === 'whatsapp') {
        let waPhone = cleanPhone.replace('+', '');
        window.open(`https://wa.me/${waPhone}`, '_blank');
    } else if (currentContactAction === 'call') {
        window.location.href = `tel:${cleanPhone}`;
    }

    closeAdminContactModal();
}

function toggleFabMenu(forceOpen) {
    const fabMenu = document.getElementById('fabMenu');
    if (!fabMenu) return;

    const shouldOpen = (typeof forceOpen === 'boolean')
        ? forceOpen
        : !fabMenu.classList.contains('active');

    fabMenu.classList.toggle('active', shouldOpen);

    const fabBtn = document.getElementById('fabButton') || document.querySelector('.fab-main');
    if (fabBtn) fabBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

(function initFabGlobalCloseHandlers(){
    if (window.__stallzFabHandlersInit) return;
    window.__stallzFabHandlersInit = true;

    document.addEventListener('click', (e) => {
        const fabMenu = document.getElementById('fabMenu');
        const fabBtn  = document.getElementById('fabButton') || document.querySelector('.fab-main');
        if (!fabMenu || !fabBtn) return;
        if (!fabMenu.classList.contains('active')) return;

        const clickedInside = fabMenu.contains(e.target) || fabBtn.contains(e.target);
        if (!clickedInside) {
            fabMenu.classList.remove('active');
            fabBtn.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const fabMenu = document.getElementById('fabMenu');
        const fabBtn  = document.getElementById('fabButton') || document.querySelector('.fab-main');
        if (!fabMenu || !fabBtn) return;
        if (fabMenu.classList.contains('active')) {
            fabMenu.classList.remove('active');
            fabBtn.setAttribute('aria-expanded', 'false');
        }
    });
})();

// 12. Custom Alert
window.showCustomAlert = function(message, isSuccess = false) {
    try { __haptic(isSuccess ? 'success' : 'alert'); } catch(_) {}
    const iconEl = document.getElementById('customAlertIcon');
    const msgEl = document.getElementById('customAlertMessage');
    const titleEl = document.getElementById('customAlertTitle');

    if(iconEl) {
        iconEl.innerHTML = isSuccess
            ? '<i class="fas fa-check-circle" style="color: #4ade80; filter: drop-shadow(0 0 10px rgba(74, 222, 128, 0.4));"></i>'
            : '<i class="fas fa-exclamation-circle" style="color: #ef4444; filter: drop-shadow(0 0 10px rgba(239, 68, 68, 0.4));"></i>';
    }
    if(msgEl) msgEl.textContent = message;
    if(titleEl) titleEl.textContent = isSuccess ? "Success" : "Notice";

    openAnimatedModal('customAlertModal');
};
window.closeCustomAlert = function() { closeAnimatedModal('customAlertModal'); };

// 13. Custom Confirm
window.showCustomConfirm = function(message, callback) {
    try { __haptic('warning'); } catch(_) {}
    document.getElementById('customConfirmMessage').textContent = message;
    __confirmCallback = callback;
    openAnimatedModal('customConfirmModal');
};
window.closeCustomConfirm = function() {
    closeAnimatedModal('customConfirmModal', () => { __confirmCallback = null; });
};
window.executeCustomConfirm = function() {
    const callbackToRun = __confirmCallback;
    closeCustomConfirm(); // Play the bouncy close animation
    if (typeof callbackToRun === 'function') {
        callbackToRun();
    }
};

// 14. My Details
window.openClientDetailsModal = function() {
    closeProfileModal();
    const profile = typeof __lastClientProfileCache !== 'undefined' && __lastClientProfileCache ? __lastClientProfileCache : {};
    const el = (id) => document.getElementById(id);
    const maskNRC = (nrc) => {
        if (!nrc || nrc === 'NOT SET') return 'Not Set';
        const str = String(nrc).trim();
        if (str.length < 5) return str;
        return '******' + str.slice(-4);
    };
    if (el('cdFullName')) el('cdFullName').textContent = profile.name || profile.fullName || profile.firstName || 'Not Set';
    if (el('cdPhone')) el('cdPhone').textContent = profile.phone || 'Not Set';
    if (el('cdEmail')) el('cdEmail').textContent = profile.email || 'Not Set';
    if (el('cdNrc')) el('cdNrc').textContent = maskNRC(profile.nrc || profile.nrcNumber);
    if (el('cdAddress')) el('cdAddress').textContent = profile.address || profile.city || 'Not Set';

    openAnimatedModal('clientDetailsModal');
};
window.closeClientDetailsModal = function() { closeAnimatedModal('clientDetailsModal'); };

// 15. First Time Sync
window.openFirstTimeSync = function() { openAnimatedModal('firstTimeSyncModal'); };
window.closeFirstTimeSync = function(permanentlyDismiss = false) {
    closeAnimatedModal('firstTimeSyncModal', () => {
        if (permanentlyDismiss && currentUserUid && typeof firebase !== "undefined") {
            firebase.database().ref(`clients/${currentUserUid}/syncPromptDismissed`).set(true);
        }
    });
};

/* ==========================================================================
   SMART STALLZ ADVICE GENERATOR (SEQUENTIAL MEMORY)
   ========================================================================== */
function setSmartStallzAdvice() {
    const adviceElement = document.getElementById('stallzDynamicAdvice');
    if (!adviceElement) return;

    const tips = [
        "Small, frequent payments are easier to manage than one large lump sum at the end of the month.",
        "Stallz will never ask for your password via phone or WhatsApp. Keep your account secure.",
        "Repaying your loan on time increases your internal trust score for future, larger requests.",
        "Ensure your collateral details are accurate to speed up your approval process to under 30 minutes.",
        "Quick. Easy. Reliable. That’s our promise to you. Need help? Use the chat icon below.",
        "Borrow only what you need. Keeping your loan amounts manageable ensures stress-free repayments.",
        "Did you know? You can make partial payments anytime before your due date to reduce your final burden.",
        "Always verify you are communicating with an official Stallz Admin before making mobile money transfers.",
        "Keep your next of kin details updated so we can easily assist you in case of emergencies.",
        "Use the Loan Estimator tool to calculate your expected repayment before you even request a loan.",
        "Checking your statement regularly helps you track your payments and remaining balance.",
        "A perfect repayment history means faster approvals and lower collateral requirements in the future.",
        "Experiencing difficulties? Don't hide. Reach out to our support team early so we can help you find a solution."
    ];

    let lastTipIndex = localStorage.getItem('stallz_last_tip_index');
    let nextIndex = 0;

    if (lastTipIndex !== null) {
        nextIndex = parseInt(lastTipIndex) + 1;
        if (nextIndex >= tips.length) {
            nextIndex = 0;
        }
    }

    adviceElement.textContent = tips[nextIndex];
    localStorage.setItem('stallz_last_tip_index', nextIndex);
}

document.addEventListener('DOMContentLoaded', setSmartStallzAdvice);

if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(setSmartStallzAdvice, 100);
}

/* ==========================================================================
   CLIENT PROFILE DETAILS VIEWER (WITH ANIMATIONS)
   ========================================================================== */

window.openClientDetailsModal = function() {
    closeProfileModal();

    const modal = document.getElementById('clientDetailsModal');
    if (!modal) return;

    const profile = typeof __lastClientProfileCache !== 'undefined' && __lastClientProfileCache
        ? __lastClientProfileCache
        : {};

    const el = (id) => document.getElementById(id);

    const maskNRC = (nrc) => {
        if (!nrc || nrc === 'NOT SET') return 'Not Set';
        const str = String(nrc).trim();
        if (str.length < 5) return str;
        return '******' + str.slice(-4);
    };

    if (el('cdFullName')) el('cdFullName').textContent = profile.name || profile.fullName || profile.firstName || 'Not Set';
    if (el('cdPhone')) el('cdPhone').textContent = profile.phone || 'Not Set';
    if (el('cdEmail')) el('cdEmail').textContent = profile.email || 'Not Set';
    if (el('cdNrc')) el('cdNrc').textContent = maskNRC(profile.nrc || profile.nrcNumber);
    if (el('cdAddress')) el('cdAddress').textContent = profile.address || profile.city || 'Not Set';

    // Animate In
    modal.classList.remove('closing');
    modal.style.display = 'flex';
        try { ensureHistoryControls(); } catch(_) {}

    // A tiny delay ensures the browser processes the display change before animating
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
};

window.closeClientDetailsModal = function() {
    const modal = document.getElementById('clientDetailsModal');
    if (!modal) return;

    // Trigger CSS Closing Animation
    modal.classList.remove('active');
    modal.classList.add('closing');

    // Wait for the animation to finish before hiding the element completely
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('closing');
    }, 300); // 300ms matches the CSS animation duration
};

// ==========================================================================
// FIREBASE PUSH NOTIFICATIONS (FOREGROUND)
// ==========================================================================
async function initPushNotifications(forcePrompt = false) {
    if (typeof firebase === 'undefined' || !firebase.messaging) return false;
    if (typeof Notification === "undefined") {
        showCustomAlert("This device/browser doesn't support push notifications.", true);
        return false;
    }

    try {
        // 1) Ask for permission (only on user action)
        if (Notification.permission !== 'granted') {
            if (!forcePrompt) return false; // don't auto-prompt
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                showCustomAlert("Notifications are off. Enable them in your browser settings to receive alerts.", true);
                return false;
            }
        }

        // 2) Ensure Service Worker is registered and ready
        let swReg = null;
        try {
            if ('serviceWorker' in navigator) {
                // If SW is not registered yet (deep link), register it now
                const regPath = (location.pathname.includes('/client-portal/') || location.pathname.includes('/admin/')) ? '../sw.js' : 'sw.js';
                swReg = await navigator.serviceWorker.getRegistration();
                if (!swReg) swReg = await navigator.serviceWorker.register(regPath);
                swReg = await navigator.serviceWorker.ready;
            }
        } catch (e) {
            console.warn("Service worker not ready for messaging:", e);
        }

        const messaging = firebase.messaging();

        // 3) Get (or refresh) the FCM token
        const vapidKey = window.STALLZ_FIREBASE?.config?.vapidKey || window.STALLZ_APP_CONFIG?.firebase?.active?.vapidKey;
        if (!vapidKey) console.warn("Missing VAPID key (STALLZ_FIREBASE.config.vapidKey). Push may fail.");

        const token = await messaging.getToken({
            vapidKey: vapidKey,
            serviceWorkerRegistration: swReg || undefined
        });

        if (!token) {
            showCustomAlert("Couldn't enable notifications on this device. Please try again.", true);
            return false;
        }

        // Save token for the auth handoff
        const prevActive = localStorage.getItem("stallz_active_fcm_token");
        if (prevActive !== token) {
            localStorage.setItem("stallz_pending_fcm_token", token);
        }
        localStorage.setItem("stallz_active_fcm_token", token);

        // If logged in already, sync immediately (no need to wait for next login)
        try {
            const user = firebase.auth().currentUser;
            if (user && window.StallzAuth?.syncPendingFCMToken) {
                await window.StallzAuth.syncPendingFCMToken(user.uid);
            }
        } catch (_) {}

        // 4) Foreground message handler (guarded so we don't bind twice)
        if (!window.__STALLZ_FOREGROUND_PUSH_BOUND) {
            window.__STALLZ_FOREGROUND_PUSH_BOUND = true;
            messaging.onMessage((payload) => {
                console.log('[Foreground] Push received: ', payload);

                // No sound (user request)

                // Haptics
                if (typeof __haptic === 'function') __haptic('success');

                // NO in-app popup — user requested dropdown-only experience
                // Refresh the notification dropdown + badge
                if (typeof renderSharedNotifications === 'function') {
                    renderSharedNotifications();
                }
            });
        }

        // Update settings UI if present
        if (typeof updatePushPermissionUI === "function") updatePushPermissionUI();

        // FIX: Only show the popup if the user manually clicked the 'Enable' button
        if (forcePrompt) {
            showCustomAlert("✅ Notifications enabled on this device.", true);
        }

        return true;

    } catch (err) {
        console.error("Failed to initialize push:", err);
        showCustomAlert("Push setup failed. Please try again.", true);
        return false;
    }
}

