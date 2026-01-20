tailwind.config = {
  theme: {
    extend: {
      colors: {
        navy: '#15803d',
      }
    }
  }
};

// Alert Modal System
const AlertModal = {
  modal: null,
  title: null,
  message: null,
  icon: null,
  okBtn: null,
  cancelBtn: null,
  resolve: null,

  init() {
    this.modal = document.getElementById('alertModal');
    this.title = document.getElementById('alert-title');
    this.message = document.getElementById('alert-message');
    this.icon = document.getElementById('alert-icon');
    this.okBtn = document.getElementById('alert-ok-btn');
    this.cancelBtn = document.getElementById('alert-cancel-btn');

    this.okBtn?.addEventListener('click', () => this.close(true));
    this.cancelBtn?.addEventListener('click', () => this.close(false));
  },

  show(options = {}) {
    return new Promise((resolve) => {
      this.resolve = resolve;
      
      const type = options.type || 'info';
      const title = options.title || this.getDefaultTitle(type);
      const message = options.message || '';
      const showCancel = options.showCancel || false;

      this.title.textContent = title;
      this.message.textContent = message;
      this.icon.innerHTML = this.getIcon(type);

      if (showCancel) {
        this.cancelBtn.classList.remove('hidden');
        this.okBtn.textContent = options.okText || 'Yes';
      } else {
        this.cancelBtn.classList.add('hidden');
        this.okBtn.textContent = options.okText || 'OK';
      }

      this.modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    });
  },

  close(result) {
    this.modal.classList.add('hidden');
    document.body.style.overflow = '';
    if (this.resolve) {
      this.resolve(result);
      this.resolve = null;
    }
  },

  getDefaultTitle(type) {
    const titles = {
      info: 'Information',
      error: 'Error',
      warning: 'Warning',
      success: 'Success',
      confirm: 'Confirm Action'
    };
    return titles[type] || 'Alert';
  },

  getIcon(type) {
    const icons = {
      info: '<svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      error: '<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      warning: '<svg class="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
      success: '<svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      confirm: '<svg class="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };
    return icons[type] || icons.info;
  }
};

// Initialize alert modal
AlertModal.init();

async function loadPayrollClasses() {
  try {
    const res = await fetch("/classes");
    const classes = await res.json();

    const select = document.getElementById("payroll-class");

    classes.forEach(cls => {
      const opt = document.createElement("option");
      opt.value = cls.id;   // backend DB id (e.g. hicaddata3)
      opt.textContent = cls.name; // label (e.g. RATINGS A)
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Failed to load payroll classes:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadPayrollClasses);


document.getElementById('login-form').addEventListener('submit', async function(e) {
  e.preventDefault();

  const formData = new FormData(this);
  const loginData = Object.fromEntries(formData.entries());

  console.log(">>> Sending payload:", loginData); // ✅ Debug

  try {
    const res = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData)
    });

    const data = await res.json();
    console.log(">>> Server response:", data);

    if (res.ok) {
      // Show popup
      const popup = document.getElementById("loginSuccessPopup");
      const spinner = document.getElementById("loginSpinner");
      const message = document.getElementById("loginMessage");

      popup.classList.remove("hidden");
      spinner.classList.remove("hidden");
      message.textContent = "Logging you in...";

      setTimeout(() => {
        spinner.classList.add("hidden");
        message.innerHTML = `<span class="text-green-600">✔ Login successful!</span>`;
      }, 1200);

      setTimeout(() => {
        popup.classList.add("hidden");
        window.location.href = "/dashboard.html"; // redirect
      }, 2500);

      // Save token & user info
      localStorage.setItem("token", data.token);
      localStorage.setItem("user_id", data.user.user_id);
      localStorage.setItem("full_name", data.user.full_name);
      localStorage.setItem("role", data.user.role);
      localStorage.setItem("class", data.user.primary_class);
      localStorage.setItem("current_class", data.user.current_class);

    } else {
      await AlertModal.show({
        type: 'error',
        title: 'Login Failed',
        message: data.error
      });
    }
  } catch (err) {
    console.error("❌ Login error:", err);
    await AlertModal.show({
      type: 'error',
      title: 'Connection Error',
      message: 'Server not responding. Please try again.'
    });
  }
});

const passwordInput = document.getElementById("loginPassword");
const togglePassword = document.getElementById("togglePassword");
const eyeOpen = document.getElementById("eyeOpen");
const eyeClosed = document.getElementById("eyeClosed");

togglePassword.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  
  // Toggle SVG display
  eyeOpen.style.display = isPassword ? "none" : "inline";
  eyeClosed.style.display = isPassword ? "inline" : "none";
});



// Forgot Password Link
const isLocal = window.location.hostname === 'localhost';
const BASE_URL = isLocal ? 'http://localhost:5500' : 'https://hicad.ng';

// Forgot Password Manager
const ForgotPasswordManager = {
  modal: null,
  verifyStep: null,
  resetStep: null,
  successModal: null,
  verifiedData: null,

  init() {
    this.modal = document.getElementById('forgotPasswordModal');
    this.verifyStep = document.getElementById('verify-step');
    this.resetStep = document.getElementById('reset-step');
    this.successModal = document.getElementById('resetSuccessModal');

    // Load payroll classes for verification
    this.loadPayrollClasses();

    // Bind events
    document.getElementById('close-forgot-modal')?.addEventListener('click', () => this.close());
    document.getElementById('close-reset-modal')?.addEventListener('click', () => this.close());
    document.getElementById('cancel-verify-btn')?.addEventListener('click', () => this.close());
    document.getElementById('back-to-verify-btn')?.addEventListener('click', () => this.backToVerify());
    document.getElementById('close-success-modal')?.addEventListener('click', () => this.closeSuccess());

    // Form submissions
    document.getElementById('verify-identity-form')?.addEventListener('submit', (e) => this.verifyIdentity(e));
    document.getElementById('reset-password-form')?.addEventListener('submit', (e) => this.resetPassword(e));

    // Password matching validation
    document.getElementById('confirm-new-password')?.addEventListener('input', () => this.validatePasswordMatch());
    document.getElementById('new-password')?.addEventListener('input', () => this.validatePasswordMatch());

    // Password toggle
    document.querySelectorAll('.toggle-password-reset').forEach(toggle => {
      toggle.addEventListener('click', function() {
        const targetId = this.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;
        
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        
        const eyeOpen = this.querySelector('.eye-open');
        const eyeClosed = this.querySelector('.eye-closed');
        if (eyeOpen && eyeClosed) {
          eyeOpen.style.display = isPassword ? 'none' : 'inline';
          eyeClosed.style.display = isPassword ? 'inline' : 'none';
        }
      });
    });
  },

  async loadPayrollClasses() {
    try {
      const res = await fetch("/classes");
      const classes = await res.json();

      const select = document.getElementById("verify-payroll-class");

      classes.forEach(cls => {
        const opt = document.createElement("option");
        opt.value = cls.id;   // backend DB id (e.g. hicaddata3)
        opt.textContent = cls.name; // label (e.g. RATE A)
        select.appendChild(opt);
      });
    } catch (err) {
      console.error("❌ Failed to load payroll classes:", err);
    }
  },

  open() {
    this.modal.classList.remove('hidden');
    this.verifyStep.classList.remove('hidden');
    this.resetStep.classList.add('hidden');
    document.body.style.overflow = 'hidden';
    
    // Reset forms
    document.getElementById('verify-identity-form')?.reset();
    document.getElementById('reset-password-form')?.reset();
  },

  close() {
    this.modal.classList.add('hidden');
    document.body.style.overflow = '';
    this.verifiedData = null;
  },

  closeSuccess() {
    this.successModal.classList.add('hidden');
    document.body.style.overflow = '';
  },

  backToVerify() {
    this.verifyStep.classList.remove('hidden');
    this.resetStep.classList.add('hidden');
  },

  validatePasswordMatch() {
    const password = document.getElementById('new-password')?.value || '';
    const confirm = document.getElementById('confirm-new-password')?.value || '';
    const msg = document.getElementById('password-match-msg');
    
    if (!msg) return true;
    
    if (confirm === '') {
      msg.textContent = '';
      msg.className = 'text-xs';
      return true;
    }
    
    if (password === confirm) {
      msg.textContent = '✓ Passwords match';
      msg.className = 'text-xs text-green-600';
      return true;
    } else {
      msg.textContent = '✗ Passwords do not match';
      msg.className = 'text-xs text-red-600';
      return false;
    }
  },

  async verifyIdentity(e) {
    e.preventDefault();
    
    const btn = document.getElementById('verify-btn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    const formData = new FormData(e.target);
    const data = {
      user_id: formData.get('user_id'),
      full_name: formData.get('full_name'),
      email: formData.get('email'),
      primary_class: formData.get('primary_class') || undefined
    };

    try {
      const res = await fetch(`${BASE_URL}/api/users/verify-identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (res.ok) {
        // Store verified data
        this.verifiedData = data;
        
        // Populate hidden fields in reset form
        document.getElementById('reset-user-id').value = data.user_id;
        document.getElementById('reset-full-name').value = data.full_name;
        document.getElementById('reset-email').value = data.email;
        document.getElementById('reset-primary-class').value = data.primary_class || '';

        // Show reset step
        this.verifyStep.classList.add('hidden');
        this.resetStep.classList.remove('hidden');
      } else {
        await AlertModal.show({
          type: 'error',
          title: 'Verification Failed',
          message: result.error || 'Identity verification failed'
        });
      }
    } catch (err) {
      console.error('Verification error:', err);
      await AlertModal.show({
        type: 'error',
        title: 'Connection Error',
        message: 'Failed to connect to server. Please try again.'
      });
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify Identity';
    }
  },

  async resetPassword(e) {
    e.preventDefault();

    // Validate passwords match
    const password = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-new-password').value;

    if (password.length < 6) {
      await AlertModal.show({
        type: 'error',
        title: 'Invalid Password',
        message: 'Password must be at least 6 characters long'
      });
      return;
    }

    if (password !== confirm) {
      await AlertModal.show({
        type: 'error',
        title: 'Password Mismatch',
        message: 'Passwords do not match. Please try again.'
      });
      return;
    }

    const btn = document.getElementById('reset-btn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';

    const data = {
      user_id: document.getElementById('reset-user-id').value,
      full_name: document.getElementById('reset-full-name').value,
      email: document.getElementById('reset-email').value,
      primary_class: document.getElementById('reset-primary-class').value || undefined,
      new_password: password
    };

    try {
      const res = await fetch(`${BASE_URL}/api/users/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (res.ok) {
        // Close forgot password modal
        this.close();
        
        // Show success modal
        this.successModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      } else {
        await AlertModal.show({
          type: 'error',
          title: 'Password Reset Failed',
          message: result.error || 'Password reset failed. Please try again.'
        });
      }
    } catch (err) {
      console.error('Reset error:', err);
      await AlertModal.show({
        type: 'error',
        title: 'Connection Error',
        message: 'Failed to connect to server. Please try again.'
      });
    } finally {
      btn.disabled = false;
      btn.textContent = 'Reset Password';
    }
  }
};

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ForgotPasswordManager.init());
} else {
  ForgotPasswordManager.init();
}

// Expose to global scope so you can call it from login page
window.openForgotPassword = () => ForgotPasswordManager.open();