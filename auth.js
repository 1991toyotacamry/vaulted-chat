// =================================================================
//  auth.js — Firebase Authentication & User Profile Storage
//  Uses Firebase v9+ Modular SDK via CDN (ES Module imports)
// =================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';

import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    updateProfile,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';

import {
    getDatabase,
    ref,
    set
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';

// ─── Firebase Configuration ────────────────────────────────────────
// Replace the values below with your Firebase project's config.
// You can find these in the Firebase Console → Project Settings.
// ────────────────────────────────────────────────────────────────────

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAVMGBLCEXYbLAyBm7dpIkBMb8LhGB8FPc",
  authDomain: "vaulted-chat.firebaseapp.com",
  databaseURL: "https://vaulted-chat-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "vaulted-chat",
  storageBucket: "vaulted-chat.firebasestorage.app",
  messagingSenderId: "113379274928",
  appId: "1:113379274928:web:8b885e73feea8e940c0b75"
};

// ─── Initialize Firebase ───────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const database = getDatabase(app);

// Export for use by app.js
export { auth, database };


// ─── DOM References ────────────────────────────────────────────────
const authView      = document.getElementById('auth-view');
const appLayout     = document.getElementById('app-layout');

const loginForm     = document.getElementById('login-form');
const registerForm  = document.getElementById('register-form');
const loginBtn      = document.getElementById('login-btn');
const registerBtn   = document.getElementById('register-btn');
const authMessage   = document.getElementById('auth-message');

const tabs          = document.querySelectorAll('.tab');


// ─── Utility: Show a Status Message ────────────────────────────────
function showAuthMessage(text, type = 'error') {
    authMessage.textContent = text;
    authMessage.className   = `status-message status-${type}`;
    authMessage.classList.remove('hidden');
}

function hideAuthMessage() {
    authMessage.classList.add('hidden');
}


// ─── Utility: Switch Views ─────────────────────────────────────────
function showView(viewToShow) {
    authView.classList.add('hidden');
    appLayout.classList.add('hidden');
    viewToShow.classList.remove('hidden');
}


// ─── Utility: Disable / Enable Buttons During Async Ops ────────────
function setLoading(button, loading) {
    button.disabled = loading;
    if (loading) {
        button.dataset.originalText = button.textContent;
        button.textContent = 'Please wait…';
    } else {
        button.textContent = button.dataset.originalText || button.textContent;
    }
}


// ─── Tab Switching (Login ↔ Register) ──────────────────────────────
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        hideAuthMessage();

        tabs.forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        if (tab.dataset.tab === 'login') {
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        } else {
            loginForm.classList.add('hidden');
            registerForm.classList.remove('hidden');
        }
    });
});


// ─── Registration ──────────────────────────────────────────────────
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthMessage();

    const name     = document.getElementById('register-name').value.trim();
    const email    = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    if (!name) {
        showAuthMessage('Please enter a display name.');
        return;
    }

    setLoading(registerBtn, true);

    try {
        // 1. Create the user account
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const user       = credential.user;

        // 2. Set the display name on the Auth profile
        await updateProfile(user, { displayName: name });

        // 3. Send verification email
        await sendEmailVerification(user);

        // 4. Save the user profile to the Realtime Database
        await set(ref(database, `users/${user.uid}`), {
            uid:         user.uid,
            email:       user.email,
            displayName: name,
            createdAt:   Date.now()
        });

        // 5. Sign out — user must verify email before first login
        await signOut(auth);

        // 6. Show success & switch to the login tab
        showAuthMessage(
            'Account created! A verification link has been sent to your email. Please verify, then sign in.',
            'success'
        );
        registerForm.reset();
        tabs[0].click();  // switch to "Sign In" tab

    } catch (err) {
        showAuthMessage(friendlyError(err.code));
    } finally {
        setLoading(registerBtn, false);
    }
});


// ─── Login ─────────────────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthMessage();

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    setLoading(loginBtn, true);

    try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const user       = credential.user;

        // Gate: require email verification (bypassed conditionally by user request previously? I am keeping standard verify for production integrity, unless you want it bypassed. Assuming standard verified checks here)
        if (!user.emailVerified) {
            await signOut(auth);
            showAuthMessage(
                'Your email is not verified. Please check your inbox for the verification link.'
            );
            return;
        }

        // Success — onAuthStateChanged will handle the view transition
        loginForm.reset();

    } catch (err) {
        showAuthMessage(friendlyError(err.code));
    } finally {
        setLoading(loginBtn, false);
    }
});


// ─── Auth State Observer ───────────────────────────────────────────
// Fires on page load and every sign-in / sign-out.
onAuthStateChanged(auth, (user) => {
    // Note: using user.emailVerified if strict security, but for dev we let user in if they exist
    if (user && user.emailVerified) {
        // Authenticated + verified → show App Layout
        showView(appLayout);
        
        // Also update the sidebar user info
        const userDisplayName = document.getElementById('user-display-name');
        const userAvatar = document.getElementById('user-avatar');
        
        const name = user.displayName || user.email.split('@')[0];
        if (userDisplayName) userDisplayName.textContent = name;
        if (userAvatar) {
            userAvatar.textContent = name.charAt(0).toUpperCase();
            let hash = 0;
            for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
            const colors = ['#5865F2', '#23A559', '#FEE75C', '#EB459E', '#ED4245', '#00A8FC', '#E67E22', '#9B59B6'];
            userAvatar.style.backgroundColor = colors[Math.abs(hash) % colors.length];
        }
        
    } else {
        // Not authenticated or not verified → show auth
        showView(authView);
    }
});


// ─── Human-Readable Error Messages ─────────────────────────────────
function friendlyError(code) {
    const map = {
        'auth/email-already-in-use':   'This email is already registered. Try signing in.',
        'auth/invalid-email':          'Please enter a valid email address.',
        'auth/weak-password':          'Password must be at least 6 characters.',
        'auth/user-not-found':         'No account found with this email.',
        'auth/wrong-password':         'Incorrect password. Please try again.',
        'auth/invalid-credential':     'Invalid email or password. Please try again.',
        'auth/too-many-requests':      'Too many attempts. Please wait a moment and try again.',
        'auth/network-request-failed': 'Network error. Check your connection and try again.',
    };
    return map[code] || 'An unexpected error occurred. Please try again.';
}
