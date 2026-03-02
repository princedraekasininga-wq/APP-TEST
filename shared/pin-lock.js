/**
 * shared/pin-lock.js
 * drop-in PIN lock for Stallz Loans
 */

(function() {
    // 1. HTML for the PIN Screen
    const pinHTML = `
    <style>
      #stallz-pin-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: #0f172a; z-index: 9999; display: flex; flex-direction: column;
        align-items: center; justify-content: center; color: white;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      .pin-container { text-align: center; animation: fadeIn 0.3s ease; }
      .pin-title { font-size: 1.2rem; margin-bottom: 20px; color: #94a3b8; }
      .pin-dots { display: flex; gap: 15px; justify-content: center; margin-bottom: 30px; }
      .pin-dot { width: 15px; height: 15px; border-radius: 50%; border: 2px solid #3b82f6; transition: background 0.2s; }
      .pin-dot.filled { background: #3b82f6; box-shadow: 0 0 10px #3b82f6; }
      .numpad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 280px; margin: 0 auto; }
      .num-btn {
        width: 60px; height: 60px; border-radius: 50%; border: 1px solid #334155;
        background: rgba(30, 41, 59, 0.5); color: white; font-size: 1.5rem;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .num-btn:active { background: #3b82f6; border-color: #3b82f6; transform: scale(0.95); }
      .pin-logout { margin-top: 30px; color: #ef4444; font-size: 0.9rem; text-decoration: underline; cursor: pointer; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .shake { animation: shake 0.3s ease-in-out; }
      @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-10px); } 75% { transform: translateX(10px); } }
    </style>

    <div id="stallz-pin-overlay" style="display:none;">
      <div class="pin-container">
        <div class="pin-title" id="pinTitle">Enter App PIN</div>
        <div class="pin-dots">
          <div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>
        </div>
        <div class="numpad">
          <div class="num-btn" data-val="1">1</div><div class="num-btn" data-val="2">2</div><div class="num-btn" data-val="3">3</div>
          <div class="num-btn" data-val="4">4</div><div class="num-btn" data-val="5">5</div><div class="num-btn" data-val="6">6</div>
          <div class="num-btn" data-val="7">7</div><div class="num-btn" data-val="8">8</div><div class="num-btn" data-val="9">9</div>
          <div class="num-btn" style="opacity:0; pointer-events:none;"></div>
          <div class="num-btn" data-val="0">0</div>
          <div class="num-btn" id="pinDel"><i class="fa-solid fa-delete-left"></i></div>
        </div>
        <div class="pin-logout" onclick="firebase.auth().signOut().then(() => location.reload())">Forgot PIN? Log Out</div>
      </div>
    </div>
    `;

    // 2. Inject HTML
    document.body.insertAdjacentHTML('beforeend', pinHTML);

    // 3. Logic
    const overlay = document.getElementById('stallz-pin-overlay');
    const title = document.getElementById('pinTitle');
    const dots = document.querySelectorAll('.pin-dot');
    let currentInput = "";
    let savedPin = localStorage.getItem('stallz_app_pin');
    let isSettingUp = !savedPin;

    function checkAuthAndLock() {
        firebase.auth().onAuthStateChanged(user => {
            if (user) {
                // User is logged in, SHOW LOCK SCREEN
                overlay.style.display = 'flex';
                if (isSettingUp) {
                    title.textContent = "Create a 4-Digit PIN";
                    title.style.color = "#3b82f6";
                }
            } else {
                // User is not logged in, hide lock (let them use normal login form)
                overlay.style.display = 'none';
            }
        });
    }

    function updateDots() {
        dots.forEach((dot, idx) => {
            if (idx < currentInput.length) dot.classList.add('filled');
            else dot.classList.remove('filled');
        });
    }

    function handleInput(val) {
        if (currentInput.length < 4) {
            currentInput += val;
            updateDots();
        }
        if (currentInput.length === 4) {
            setTimeout(verifyPin, 100);
        }
    }

    function verifyPin() {
        if (isSettingUp) {
            // Saving new PIN
            localStorage.setItem('stallz_app_pin', currentInput);
            savedPin = currentInput;
            isSettingUp = false;
            alert("PIN Set! Use this code to unlock app next time.");
            currentInput = "";
            updateDots();
            overlay.style.display = 'none'; // Unlock
        } else {
            // Checking existing PIN
            if (currentInput === savedPin) {
                overlay.style.display = 'none'; // Success! Unlock
                currentInput = "";
                updateDots();
            } else {
                // Wrong PIN
                document.querySelector('.pin-container').classList.add('shake');
                setTimeout(() => {
                    document.querySelector('.pin-container').classList.remove('shake');
                    currentInput = "";
                    updateDots();
                    title.textContent = "Wrong PIN. Try Again.";
                    title.style.color = "#ef4444";
                }, 300);
            }
        }
    }

    // Event Listeners
    document.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const val = btn.dataset.val;
            if (val) handleInput(val);
        });
    });

    document.getElementById('pinDel').addEventListener('click', () => {
        currentInput = currentInput.slice(0, -1);
        updateDots();
    });

    // Run on load
    checkAuthAndLock();

})();