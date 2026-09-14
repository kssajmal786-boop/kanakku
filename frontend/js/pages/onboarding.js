// ============================================================
// Onboarding Page — 4-Step Modern Setup Wizard
// Google Login → Profile Setup → Language → Financial Timeline Sync
// ============================================================

import { t, setLang, getLang } from '../i18n.js';
import { getState, setState, persistSession } from '../store.js';
import { getDB } from '../services/db.js';
import { initiateGoogleLogin, registerWithEmail, loginWithEmail, updateUserProfile } from '../services/apiClient.js';
import { completeAuth } from '../authFlow.js';

let currentStep = 0;
const TOTAL_STEPS = 4;

export function renderOnboarding(initialStep = 0, opts = {}) {
  currentStep = initialStep;
  const shell = document.getElementById('auth-shell');
  shell.innerHTML = '';
  shell.style.display = 'flex';
  document.getElementById('main-shell').style.display = 'none';
  window.scrollTo(0, 0);
  renderStep(shell, currentStep, opts);
}

function renderStep(container, step, opts = {}) {
  container.innerHTML = '';
  window.scrollTo(0, 0);
  switch (step) {
    case 0: renderGoogleLogin(container, opts); break;
    case 1: renderProfileSetup(container); break;
    case 2: renderLanguageSelect(container); break;
    case 3: renderTimelineSync(container); break;
  }
}

function nextStep() {
  currentStep++;
  if (currentStep > TOTAL_STEPS - 1) currentStep = TOTAL_STEPS - 1;
  renderStep(document.getElementById('auth-shell'), currentStep);
}

// ── Step 0: Google OAuth Login ──────────────────────────────────────────────
function renderGoogleLogin(container, opts = {}) {
  container.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-8) var(--space-6);text-align:center;gap:var(--space-8);width:100%;">
      
      <!-- Brand Logo -->
      <div class="animate-fade-in-up" style="display:flex;flex-direction:column;align-items:center;gap:var(--space-4);">
        <div style="width:84px;height:84px;background:var(--gradient-brand);border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:2.4rem;box-shadow:var(--shadow-brand);animation:glow 2.5s ease-in-out infinite;">
          💸
        </div>
        <div>
          <h1 style="font-size:var(--text-3xl);font-weight:var(--weight-extrabold);" class="gradient-text">CashFlow</h1>
          <p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-top:var(--space-2);max-width:320px;">
            Automated personal finance & cash flow tracking with local-first privacy.
          </p>
        </div>
      </div>

      <!-- Feature Bullets -->
      <div class="animate-fade-in-up delay-1" style="display:flex;flex-direction:column;gap:var(--space-3);text-align:left;width:100%;max-width:340px;">
        ${[
          ['⚡', 'Track UPI, Cards, ATM & Cash spending'],
          ['🤖', 'ChatGPT/Claude-style financial assistant'],
          ['📄', 'Deterministic income statements & PDFs'],
          ['🔒', 'Local-first: your data stays on your device'],
        ].map(([icon, text]) => `
          <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-lg);">
            <span style="font-size:1.25rem;">${icon}</span>
            <span style="font-size:var(--text-sm);color:var(--color-text-secondary);font-weight:var(--weight-medium);">${text}</span>
          </div>
        `).join('')}
      </div>

      <!-- Sign-in options: Google OAuth (real) or Email (real) -->
      <div class="animate-fade-in-up delay-2" style="width:100%;max-width:340px;display:flex;flex-direction:column;gap:var(--space-3);">
        <div id="login-error" class="form-error hidden" style="margin-bottom:var(--space-1);"></div>

        <button id="btn-google-login" class="btn btn-lg btn-full ripple-container" style="background:#ffffff;color:#1e293b;font-weight:var(--weight-semibold);gap:var(--space-3);box-shadow:0 4px 14px rgba(0,0,0,0.15);border:1px solid var(--color-border);transition:all var(--transition-normal);">
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M46.6 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.9 7.2v6h7.9c4.6-4.3 7.3-10.6 7.3-18.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.9-6c-2.1 1.4-4.8 2.3-8 2.3-6.1 0-11.3-4.1-13.2-9.7H2.5v6.2C6.5 42.7 14.7 48 24 48z"/><path fill="#FBBC05" d="M10.8 28.8c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5v-6.2H2.5C.9 17 0 20.4 0 24s.9 7 2.5 10.2l8.3-5.4z"/><path fill="#EA4335" d="M24 9.6c3.4 0 6.5 1.2 8.9 3.5l6.6-6.6C35.9 2.7 30.5.4 24 .4 14.7.4 6.5 5.7 2.5 13.8l8.3 6.2C12.7 13.7 17.9 9.6 24 9.6z"/></svg>
          <span>Continue with Google</span>
        </button>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);line-height:1.4;">
          Includes read-only Gmail access for automatic bank & UPI transaction detection.
        </p>

        <div style="display:flex;align-items:center;gap:var(--space-3);margin:var(--space-1) 0;">
          <div style="flex:1;height:1px;background:var(--color-border);"></div>
          <span style="font-size:var(--text-xs);color:var(--color-text-muted);">or</span>
          <div style="flex:1;height:1px;background:var(--color-border);"></div>
        </div>

        <button id="btn-toggle-email" type="button" class="btn btn-secondary btn-lg btn-full" style="font-weight:var(--weight-medium);">
          Continue with Email
        </button>

        <!-- Email form (hidden until "Continue with Email" is tapped) -->
        <div id="email-auth-form" class="hidden" style="display:flex;flex-direction:column;gap:var(--space-3);text-align:left;">
          <div class="form-group" id="email-name-group">
            <label class="form-label" for="inp-email-name">Name</label>
            <input id="inp-email-name" class="form-input" type="text" placeholder="Your name" autocomplete="name" />
          </div>
          <div class="form-group">
            <label class="form-label" for="inp-email-addr">Email</label>
            <input id="inp-email-addr" class="form-input" type="email" placeholder="you@example.com" autocomplete="email" />
          </div>
          <div class="form-group">
            <label class="form-label" for="inp-email-pass">Password</label>
            <input id="inp-email-pass" class="form-input" type="password" placeholder="At least 8 characters" autocomplete="current-password" />
          </div>
          <button id="btn-email-submit" class="btn btn-primary btn-lg btn-full ripple-container">
            <span id="btn-email-submit-label">Create account</span>
          </button>
          <p style="font-size:var(--text-xs);color:var(--color-text-muted);text-align:center;">
            <span id="email-mode-copy">Already have an account?</span>
            <button id="btn-email-mode-switch" type="button" class="btn-link" style="background:none;border:none;color:var(--color-brand-primary);font-weight:var(--weight-medium);cursor:pointer;font-size:inherit;">Sign in</button>
          </p>
          <p style="font-size:var(--text-xs);color:var(--color-text-muted);line-height:1.4;">
            Note: Gmail auto-sync requires Google sign-in. Email accounts can still track cash, cards, and receipts manually.
          </p>
        </div>
      </div>

    </div>
  `;

  setupRipple(container.querySelector('#btn-google-login'));
  setupRipple(container.querySelector('#btn-email-submit'));

  const errorDiv = container.querySelector('#login-error');
  const showError = (msg) => { errorDiv.textContent = msg; errorDiv.classList.remove('hidden'); };
  const clearError = () => errorDiv.classList.add('hidden');

  if (opts && opts.errorMsg) {
    showError(opts.errorMsg);
  }

  // ── Google Sign-in Trigger ─────────────────────────────────
  container.querySelector('#btn-google-login').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-google-login');
    clearError();
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const res = await initiateGoogleLogin();
      if (res && res.isConfigured && res.authUrl) {
        window.location.href = res.authUrl;
        return;
      }
      if (res && res.message) {
        showError(res.message);
      } else if (res && res.offline) {
        showError(res.message || 'Backend server is offline. Please make sure the backend is running.');
      } else {
        showError('Google OAuth is not configured on the backend. Please check backend/.env');
      }
    } catch (err) {
      showError(err.message || 'Could not initiate Google sign-in.');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });

  // ── Toggle email form ───────────────────────────────────────
  let emailMode = 'register'; // 'register' | 'login'

  container.querySelector('#btn-toggle-email').addEventListener('click', () => {
    container.querySelector('#email-auth-form').classList.remove('hidden');
    container.querySelector('#btn-toggle-email').classList.add('hidden');
  });

  container.querySelector('#btn-email-mode-switch').addEventListener('click', () => {
    emailMode = emailMode === 'register' ? 'login' : 'register';
    container.querySelector('#email-name-group').classList.toggle('hidden', emailMode === 'login');
    container.querySelector('#btn-email-submit-label').textContent = emailMode === 'register' ? 'Create account' : 'Sign in';
    container.querySelector('#email-mode-copy').textContent = emailMode === 'register' ? 'Already have an account?' : "Don't have an account?";
    container.querySelector('#btn-email-mode-switch').textContent = emailMode === 'register' ? 'Sign in' : 'Create one';
    clearError();
  });

  // ── Real email/password auth ───────────────────────────────
  container.querySelector('#btn-email-submit').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-email-submit');
    const name = container.querySelector('#inp-email-name')?.value?.trim();
    const email = container.querySelector('#inp-email-addr')?.value?.trim();
    const password = container.querySelector('#inp-email-pass')?.value || '';
    clearError();

    if (emailMode === 'register' && !name) {
      showError('Please enter your name.');
      return;
    }
    if (!email || !email.includes('@')) {
      showError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      showError('Password must be at least 8 characters.');
      return;
    }

    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const authResponse = emailMode === 'register'
        ? await registerWithEmail(name, email, password)
        : await loginWithEmail(email, password);

      const { goTo } = await completeAuth(authResponse, { gmailConnected: false });

      if (goTo === 'main') {
        const { showMainApp } = await import('../app.js');
        showMainApp();
      } else {
        nextStep(); // -> profile setup step
      }
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

// ── Step 1: User Profile Setup ──────────────────────────────────────────────
function renderProfileSetup(container) {
  const currentUser = getState('user') || {};

  container.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;padding:var(--space-8) var(--space-6) var(--space-6);gap:var(--space-6);max-width:480px;margin:0 auto;width:100%;">
      
      <!-- Header -->
      <div class="animate-fade-in-up" style="display:flex;flex-direction:column;gap:var(--space-2);">
        ${stepIndicatorHTML(1)}
        <div style="margin-top:var(--space-4);">
          <div style="font-size:1.8rem;margin-bottom:var(--space-2);">Welcome 👋</div>
          <h2 style="font-size:var(--text-2xl);font-weight:var(--weight-bold);">Let's set up your financial assistant</h2>
          <p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-top:var(--space-1);">
            This helps personalize your reports and cash-flow summaries.
          </p>
        </div>
      </div>

      <!-- Form -->
      <form id="profile-form" class="animate-fade-in-up delay-1" style="flex:1;display:flex;flex-direction:column;gap:var(--space-4);">
        
        <div class="form-group">
          <label class="form-label" for="inp-name">What's your name? <span style="color:var(--color-danger);">*</span></label>
          <input id="inp-name" class="form-input" type="text" placeholder="e.g. Aj or Priya" value="${currentUser.name || ''}" required autocomplete="name" inputmode="text" />
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label" for="inp-age">Your age <span style="color:var(--color-danger);">*</span></label>
            <input id="inp-age" class="form-input" type="text" inputmode="numeric" pattern="[0-9]*" min="16" max="110" maxlength="3" placeholder="18" value="${currentUser.age || ''}" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="inp-phone">Phone number</label>
            <input id="inp-phone" class="form-input" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="10" placeholder="9876543210" value="${currentUser.phone || ''}" autocomplete="tel" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="inp-work">What do you do? <span style="color:var(--color-danger);">*</span></label>
          <select id="inp-work" class="form-select" required>
            <option value="" disabled ${!currentUser.workType ? 'selected' : ''}>Select occupation</option>
            <option value="salaried" ${currentUser.workType === 'salaried' ? 'selected' : ''}>Salaried Employee</option>
            <option value="self_employed" ${currentUser.workType === 'self_employed' ? 'selected' : ''}>Self-employed</option>
            <option value="business" ${currentUser.workType === 'business' ? 'selected' : ''}>Business Owner</option>
            <option value="freelancer" ${currentUser.workType === 'freelancer' ? 'selected' : ''}>Freelancer / Consultant</option>
            <option value="farmer" ${currentUser.workType === 'farmer' ? 'selected' : ''}>Farmer / Agriculture</option>
            <option value="student" ${currentUser.workType === 'student' ? 'selected' : ''}>Student</option>
            <option value="other" ${currentUser.workType === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </div>

        <div id="profile-error" class="form-error hidden"></div>

        <div style="margin-top:auto;padding-top:var(--space-4);">
          <button type="submit" class="btn btn-primary btn-lg btn-full ripple-container">
            <span>Continue</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

      </form>
    </div>
  `;

  setupRipple(container.querySelector('button[type="submit"]'));

  // ── Real-time input restriction ──────────────────────────
  // Name: letters (English + Tamil) and spaces/hyphens/apostrophes only.
  // Age / Phone: digits only. Filtering happens on 'input' so it also
  // catches paste, not just keystrokes.
  const nameInput  = container.querySelector('#inp-name');
  const ageInput   = container.querySelector('#inp-age');
  const phoneInput = container.querySelector('#inp-phone');

  nameInput.addEventListener('input', () => {
    const cleaned = nameInput.value.replace(/[^a-zA-Z\u0B80-\u0BFF\s'-]/g, '');
    if (cleaned !== nameInput.value) nameInput.value = cleaned;
  });

  ageInput.addEventListener('input', () => {
    const cleaned = ageInput.value.replace(/[^0-9]/g, '').slice(0, 3);
    if (cleaned !== ageInput.value) ageInput.value = cleaned;
  });

  phoneInput.addEventListener('input', () => {
    const cleaned = phoneInput.value.replace(/[^0-9]/g, '').slice(0, 10);
    if (cleaned !== phoneInput.value) phoneInput.value = cleaned;
  });

  container.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = container.querySelector('#inp-name').value.trim();
    const age = parseInt(container.querySelector('#inp-age').value, 10);
    const phone = container.querySelector('#inp-phone').value.trim();
    const workType = container.querySelector('#inp-work').value;

    const profileError = container.querySelector('#profile-error');
    const showProfileError = (msg) => {
      if (profileError) {
        profileError.textContent = msg;
        profileError.classList.remove('hidden');
      }
    };
    const clearProfileError = () => profileError?.classList.add('hidden');
    clearProfileError();

    if (!name) {
      showProfileError('Please enter your name');
      return;
    }
    if (!/^[a-zA-Z\u0B80-\u0BFF\s'-]+$/.test(name)) {
      showProfileError('Name can only contain letters');
      return;
    }
    if (!age || age < 16 || age > 110) {
      showProfileError('Please enter a valid age (16+)');
      return;
    }
    if (phone && !/^[0-9]{10}$/.test(phone)) {
      showProfileError('Please enter a valid 10-digit phone number');
      return;
    }
    if (!workType) {
      showProfileError('Please select your occupation');
      return;
    }

    const updatedUser = {
      ...(getState('user') || {}),
      name,
      age,
      phone,
      workType,
      updatedAt: new Date().toISOString(),
    };

    // Save to local reactive store & localStorage
    setState({ user: updatedUser });
    persistSession(updatedUser);

    // Save to local IndexedDB
    try {
      const db = getDB();
      await db.profile.put({
        userId: updatedUser.userId || 'local_user',
        ...updatedUser,
      });
    } catch (_) {}

    // Sync to backend DB
    try {
      updateUserProfile({
        name: updatedUser.name,
        workType: updatedUser.workType,
      }).catch(() => {});
    } catch (_) {}

    nextStep();
  });
}

// ── Step 2: Language Selection ──────────────────────────────────────────────
function renderLanguageSelect(container) {
  let selectedLang = getLang();

  container.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-8) var(--space-6);gap:var(--space-8);max-width:440px;margin:0 auto;width:100%;">
      <div class="animate-fade-in-up" style="text-align:center;">
        ${stepIndicatorHTML(2)}
        <h2 style="font-size:var(--text-2xl);font-weight:var(--weight-bold);margin-top:var(--space-6);">Choose your language</h2>
        <p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-top:var(--space-2);">
          Select your preferred language for reports and chat.
        </p>
      </div>

      <div class="animate-fade-in-up delay-1" style="width:100%;display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
        <div class="lang-option ${selectedLang === 'en' ? 'selected' : ''}" data-lang="en" id="lang-en" role="button" tabindex="0">
          <div class="lang-option-name">English</div>
          <div class="lang-option-native" style="color:var(--color-text-secondary);font-size:var(--text-xs);margin-top:4px;">Default</div>
        </div>
        <div class="lang-option ${selectedLang === 'ta' ? 'selected' : ''}" data-lang="ta" id="lang-ta" role="button" tabindex="0">
          <div class="lang-option-name">தமிழ்</div>
          <div class="lang-option-native" style="color:var(--color-text-secondary);font-size:var(--text-xs);margin-top:4px;">Tamil</div>
        </div>
      </div>

      <div class="animate-fade-in-up delay-2" style="width:100%;">
        <button id="btn-lang-next" class="btn btn-primary btn-lg btn-full ripple-container">
          <span>Continue</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>
  `;

  setupRipple(container.querySelector('#btn-lang-next'));

  container.querySelectorAll('.lang-option').forEach(el => {
    el.addEventListener('click', () => {
      selectedLang = el.dataset.lang;
      container.querySelectorAll('.lang-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      setLang(selectedLang);
      try {
        updateUserProfile({ language: selectedLang }).catch(() => {});
      } catch (_) {}
    });
  });

  container.querySelector('#btn-lang-next').addEventListener('click', nextStep);
}

// ── Step 3: Initial Financial Sync Progress ─────────────────────────────────
function renderTimelineSync(container) {
  container.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-8) var(--space-6);gap:var(--space-8);text-align:center;max-width:440px;margin:0 auto;width:100%;">
      
      <div class="animate-fade-in-up">
        <div style="width:84px;height:84px;background:linear-gradient(135deg,#3b82f6,#10b981);border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:2.4rem;margin:0 auto var(--space-5);box-shadow:0 8px 32px rgba(59,130,246,0.35);">
          📊
        </div>
        <h2 style="font-size:var(--text-2xl);font-weight:var(--weight-bold);">Setting up your financial timeline...</h2>
        <p id="sync-status-msg" style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-top:var(--space-2);">
          Scanning financial alerts and preparing your local ledger.
        </p>
      </div>

      <!-- Live Sync Checklist -->
      <div class="animate-fade-in-up delay-1" style="display:flex;flex-direction:column;gap:var(--space-3);text-align:left;width:100%;">
        
        <div id="sync-item-1" class="sync-check-item" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-lg);">
          <span class="sync-icon" id="sync-icon-1">⏳</span>
          <span style="font-size:var(--text-sm);color:var(--color-text-primary);font-weight:var(--weight-medium);">Checking recent financial emails</span>
        </div>

        <div id="sync-item-2" class="sync-check-item" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-lg);opacity:0.5;">
          <span class="sync-icon" id="sync-icon-2">⏳</span>
          <span style="font-size:var(--text-sm);color:var(--color-text-primary);font-weight:var(--weight-medium);">Analyzing transactions</span>
        </div>

        <div id="sync-item-3" class="sync-check-item" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-lg);opacity:0.5;">
          <span class="sync-icon" id="sync-icon-3">⏳</span>
          <span style="font-size:var(--text-sm);color:var(--color-text-primary);font-weight:var(--weight-medium);">Preparing your dashboard</span>
        </div>

      </div>

      <!-- Spinner Progress Bar -->
      <div class="animate-fade-in-up delay-2" style="width:100%;">
        <div class="progress-track" style="height:6px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;">
          <div id="sync-progress-bar" style="width:20%;height:100%;background:var(--gradient-brand);transition:width 0.6s ease;border-radius:99px;"></div>
        </div>
      </div>

    </div>
  `;

  runRealTimelineSync(container);
}

async function runRealTimelineSync(container) {
  const icon1 = container.querySelector('#sync-icon-1');
  const item2 = container.querySelector('#sync-item-2');
  const icon2 = container.querySelector('#sync-icon-2');
  const item3 = container.querySelector('#sync-item-3');
  const icon3 = container.querySelector('#sync-icon-3');
  const pbar = container.querySelector('#sync-progress-bar');
  const statusSub = container.querySelector('#sync-status-msg');

  const user = getState('user');
  const isGoogle = user?.authProvider === 'google' || user?.gmailConnected;

  if (isGoogle) {
    try {
      const { syncGmail } = await import('../services/gmailSync.js');
      if (pbar) pbar.style.width = '35%';

      const result = await syncGmail({
        onProgress: (p) => {
          if (statusSub && p.message) statusSub.textContent = p.message;
          if (p.status === 'fetching') {
            if (icon1) icon1.textContent = '⏳';
            if (pbar) pbar.style.width = '50%';
          } else if (p.status === 'storing') {
            if (icon1) icon1.textContent = '✅';
            if (item2) item2.style.opacity = '1';
            if (icon2) icon2.textContent = '⏳';
            if (pbar) pbar.style.width = '75%';
          }
        },
      });

      if (icon1) icon1.textContent = '✅';
      if (item2) item2.style.opacity = '1';
      if (icon2) icon2.textContent = '✅';
      if (item3) item3.style.opacity = '1';
      if (icon3) icon3.textContent = '✅';
      if (pbar) pbar.style.width = '100%';
      if (statusSub) {
        statusSub.textContent = result?.newTransactions > 0
          ? `Synced ${result.newTransactions} transactions from Gmail.`
          : 'Gmail synced. Dashboard ready!';
      }
    } catch (err) {
      console.warn('Gmail sync during onboarding:', err);
      if (icon1) icon1.textContent = '✅';
      if (item2) item2.style.opacity = '1';
      if (icon2) icon2.textContent = '✅';
      if (item3) item3.style.opacity = '1';
      if (icon3) icon3.textContent = '✅';
      if (pbar) pbar.style.width = '100%';
    }
  } else {
    // Email user setup
    if (icon1) icon1.textContent = '✅';
    if (item2) item2.style.opacity = '1';
    if (icon2) icon2.textContent = '✅';
    if (item3) item3.style.opacity = '1';
    if (icon3) icon3.textContent = '✅';
    if (pbar) pbar.style.width = '100%';
  }

  setTimeout(() => {
    setState({ isAuthenticated: true, onboardingStep: 4 });
    import('../app.js').then(({ showMainApp }) => showMainApp());
  }, 1000);
}

function stepIndicatorHTML(step) {
  return `
    <div style="display:flex;align-items:center;justify-content:center;gap:var(--space-2);margin-bottom:var(--space-2);">
      ${[1, 2, 3].map((i) => `
        <div style="width:${i === step ? '24px' : '8px'};height:8px;border-radius:99px;background:${i <= step ? 'var(--color-brand-primary)' : 'rgba(255,255,255,0.15)'};transition:all 0.3s ease;"></div>
      `).join('')}
    </div>
  `;
}

function setupRipple(btn) {
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    const rect = btn.getBoundingClientRect();
    const circle = document.createElement('span');
    const diameter = Math.max(rect.width, rect.height);
    const radius = diameter / 2;
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${e.clientX - rect.left - radius}px`;
    circle.style.top = `${e.clientY - rect.top - radius}px`;
    circle.classList.add('ripple');
    const existing = btn.querySelector('.ripple');
    if (existing) existing.remove();
    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (s) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[s]));
}
