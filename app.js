// =================================================================
//  app.js — E2EE Chat Logic & Two-Column Layout Management
//  CryptoJS AES encrypts all messages before they leave the client.
//  The Firebase database only ever stores ciphertext.
// =================================================================

import { auth, database } from './auth.js';

import {
    onAuthStateChanged,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';

import {
    ref,
    push,
    onChildAdded,
    query,
    limitToLast,
    onValue,
    onDisconnect,
    serverTimestamp,
    set,
    remove,
    get
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';


// ─── State ─────────────────────────────────────────────────────────
let currentUser     = null;   // Firebase User object
let currentRoomId   = null;   // Active Room ID
let currentPassword = null;   // Active Encryption password
let unsubMessages   = null;   // Firebase Listener cleanup function
let unsubTyping     = null;   // Typing listener cleanup
let unsubPresence   = null;   // Presence listener cleanup

// In-memory cache of passwords for the current session so users 
// can switch between sidebar rooms without re-typing passwords constantly.
// This is destroyed when the tab is closed.
const sessionPasswords = {}; 


// ─── DOM References ────────────────────────────────────────────────
const appLayout          = document.getElementById('app-layout');
const sidebarRoomsList   = document.getElementById('sidebar-rooms');
const emptyHint          = document.getElementById('sidebar-empty-hint');

const emptyState         = document.getElementById('empty-state');
const chatArea           = document.getElementById('chat-area');
const chatRoomTitle      = document.getElementById('chat-room-title');
const copyRoomIdBtn      = document.getElementById('copy-room-id-btn');
const messagesContainer  = document.getElementById('messages-container');
const messageForm        = document.getElementById('message-form');
const messageInput       = document.getElementById('message-input');
const backBtn            = document.getElementById('back-btn');
const leaveRoomBtn       = document.getElementById('leave-room-btn');

// Modals
const joinModalOverlay   = document.getElementById('join-modal-overlay');
const joinRoomForm       = document.getElementById('join-room-form');
const joinRoomIdInput    = document.getElementById('join-room-id');
const joinRoomPwdInput   = document.getElementById('join-room-password');
const closeJoinModalBtn  = document.getElementById('close-join-modal');

const createModalOverlay = document.getElementById('create-modal-overlay');
const createRoomForm     = document.getElementById('create-room-form');
const createRoomIdInput  = document.getElementById('create-room-id');
const createRoomPwdInput = document.getElementById('create-room-password');
const closeCreateModalBtn= document.getElementById('close-create-modal');
const generatePwdBtn     = document.getElementById('generate-pwd-btn');

const pwdModalOverlay    = document.getElementById('password-modal-overlay');
const pwdForm            = document.getElementById('password-form');
const pwdRoomNameEl      = document.getElementById('password-modal-room-name');
const pwdInput           = document.getElementById('modal-room-password');
const closePwdModalBtn   = document.getElementById('close-password-modal');

const joinRoomBtn        = document.getElementById('join-room-btn');
const createRoomBtn      = document.getElementById('create-room-btn');
const shareRoomBtn       = document.getElementById('share-room-btn');

const roomPresence       = document.getElementById('room-presence');
const typingIndicator    = document.getElementById('typing-indicator');
const sidebarResizer     = document.getElementById('sidebar-resizer');
const sidebar            = document.getElementById('sidebar');
const logoutBtn          = document.getElementById('logout-btn');
const toast              = document.getElementById('toast');


// ─── Utility ───────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function closeAllModals() {
    joinModalOverlay.classList.add('hidden');
    createModalOverlay.classList.add('hidden');
    pwdModalOverlay.classList.add('hidden');
    joinRoomForm.reset();
    createRoomForm.reset();
    pwdForm.reset();
}


// ─── Clear User Session & Wipe Memory ──────────────────────────────
function clearUserSession() {
    leaveCurrentRoom();
    // Wipe all in-memory passwords so they cannot leak to another user
    for (const key in sessionPasswords) {
        delete sessionPasswords[key];
    }
    // Clear sidebar UI
    if (sidebarRoomsList) {
        sidebarRoomsList.innerHTML = '';
    }
    // Reset view to empty state
    if (chatArea && emptyState) {
        chatArea.classList.add('hidden');
        emptyState.classList.remove('hidden');
    }
    if (appLayout) {
        appLayout.classList.remove('chat-open');
    }
}


// ─── Auth State Tracking ───────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    if (user && user.emailVerified) {
        currentUser = user;
        // Wipe legacy un-scoped storage from older versions
        localStorage.removeItem('vaulted_recent_rooms');
        loadSidebarRooms();
    } else {
        currentUser = null;
        clearUserSession();
    }
});



// ─── Sidebar Resizer ───────────────────────────────────────────────
let isResizing = false;
if (sidebarResizer) {
    sidebarResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        sidebarResizer.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        let newWidth = e.clientX;
        if (newWidth < 180) newWidth = 180;
        if (newWidth > 300) newWidth = 300;
        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            sidebarResizer.classList.remove('is-resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const currentWidth = document.documentElement.style.getPropertyValue('--sidebar-width');
            localStorage.setItem('vaulted_sidebar_width', currentWidth);
        }
    });

    const savedWidth = localStorage.getItem('vaulted_sidebar_width');
    if (savedWidth) {
        document.documentElement.style.setProperty('--sidebar-width', savedWidth);
    }
}

// =====================================================================
//  SIDEBAR & ROOM MANAGEMENT
// =====================================================================

// Open Modals
joinRoomBtn.addEventListener('click', () => {
    joinModalOverlay.classList.remove('hidden');
    joinRoomIdInput.focus();
});

createRoomBtn.addEventListener('click', () => {
    createModalOverlay.classList.remove('hidden');
    createRoomIdInput.focus();
});

closeJoinModalBtn.addEventListener('click', closeAllModals);
closeCreateModalBtn.addEventListener('click', closeAllModals);
closePwdModalBtn.addEventListener('click', closeAllModals);

generatePwdBtn.addEventListener('click', () => {
    const array = new Uint8Array(8);
    window.crypto.getRandomValues(array);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let pwd = '';
    for (let i = 0; i < array.length; i++) {
        pwd += chars[array[i] % chars.length];
    }
    createRoomPwdInput.value = pwd;
});

// Join Room (From Modal)
joinRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomId = joinRoomIdInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    const password = joinRoomPwdInput.value;
    if (!roomId || !password) return;
    closeAllModals();
    verifyAndActivateRoom(roomId, password, false);
});

// Create Room (From Modal)
createRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomId = createRoomIdInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    const password = createRoomPwdInput.value;
    if (!roomId || !password) return;
    closeAllModals();
    verifyAndActivateRoom(roomId, password, true);
});



// Decrypt Existing Room (From Password Prompt Modal)
let pendingRoomIdForDecryption = null;

pwdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = pwdInput.value;
    
    if (!password || !pendingRoomIdForDecryption) return;
    
    closeAllModals();
    verifyAndActivateRoom(pendingRoomIdForDecryption, password, false);
});



/**
 * Verifies password against the room's validator token, or creates one if isCreate=true.
 */
async function verifyAndActivateRoom(roomId, password, isCreate) {
    // We cannot use encryptMessage/decryptMessage directly yet because currentPassword isn't set.
    const validatorRef = ref(database, `rooms/${roomId}/validator`);
    try {
        const snap = await get(validatorRef);
        if (snap.exists()) {
            const ciphertext = snap.val();
            let decrypted = null;
            try {
                const bytes = CryptoJS.AES.decrypt(ciphertext, password);
                decrypted = bytes.toString(CryptoJS.enc.Utf8);
            } catch (e) {
                // Decryption failed
            }
            if (decrypted !== 'VAULTED_VALID_ROOM') {
                showToast('Incorrect room password.');
                return;
            }
            activateRoom(roomId, password);
        } else {
            if (isCreate) {
                // Room doesn't exist, create it with validator
                const token = CryptoJS.AES.encrypt('VAULTED_VALID_ROOM', password).toString();
                await set(validatorRef, token);
                activateRoom(roomId, password);
            } else {
                // Room doesn't exist but user tried to join
                // For privacy, we just create the room anyway so they don't know if it existed
                const token = CryptoJS.AES.encrypt('VAULTED_VALID_ROOM', password).toString();
                await set(validatorRef, token);
                activateRoom(roomId, password);
            }
        }
    } catch (err) {
        showToast('Error verifying room.');
        console.error(err);
    }
}

/**
 * Activates a room, sets the UI state, saves history, and binds listeners.
 */
function activateRoom(roomId, password) {
    // 1. Detach old listener
    leaveCurrentRoom();

    // 2. Set new state
    currentRoomId = roomId;
    currentPassword = password;
    sessionPasswords[roomId] = password; // Cache it in memory for this session

    // 3. Update UI
    chatRoomTitle.textContent = roomId;
    messagesContainer.innerHTML = ''; // Clear old messages
    
    emptyState.classList.add('hidden');
    chatArea.classList.remove('hidden');
    appLayout.classList.add('chat-open'); // Slide mobile view

    // 4. Save to sidebar and re-render
    saveRecentRoom(roomId);
    loadSidebarRooms();

    // 5. System message & Focus
    addSystemMessage(`You joined room "${roomId}". Messages are end-to-end encrypted.`);
    startListening();
    startPresenceAndTyping(roomId);
    messageInput.focus();
}

let typingTimeout = null;
function startPresenceAndTyping(roomId) {
    if (!currentUser) return;
    
    // Presence
    const presenceRef = ref(database, `rooms/${roomId}/presence/${currentUser.uid}`);
    const connectedRef = ref(database, '.info/connected');
    
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            set(presenceRef, true);
            onDisconnect(presenceRef).remove();
        }
    });

    const roomPresenceRef = ref(database, `rooms/${roomId}/presence`);
    let isFirstPresenceLoad = true;
    let prevUids = new Set();
    unsubPresence = onValue(roomPresenceRef, (snap) => {
        const data = snap.val() || {};
        const count = Object.keys(data).length;
        if (count > 0) {
            roomPresence.textContent = `${count} online`;
        } else {
            roomPresence.textContent = '';
        }

        const currentUids = new Set(Object.keys(data));
        
        if (!isFirstPresenceLoad) {
            // Joined
            for (const uid of currentUids) {
                if (!prevUids.has(uid) && uid !== currentUser.uid) {
                    addSystemMessage("A user connected");
                }
            }
            // Left
            for (const uid of prevUids) {
                if (!currentUids.has(uid) && uid !== currentUser.uid) {
                    addSystemMessage("A user disconnected");
                }
            }
        }
        
        prevUids = currentUids;
        isFirstPresenceLoad = false;
    });

    // Typing listener
    const roomTypingRef = ref(database, `rooms/${roomId}/typing`);
    unsubTyping = onValue(roomTypingRef, (snap) => {
        const data = snap.val() || {};
        const typingUsers = [];
        const now = Date.now();
        
        for (const [uid, info] of Object.entries(data)) {
            if (uid !== currentUser.uid && (now - info.timestamp < 3000)) {
                typingUsers.push(info.displayName);
            }
        }
        
        if (typingUsers.length === 0) {
            typingIndicator.textContent = '';
        } else if (typingUsers.length === 1) {
            typingIndicator.textContent = `${typingUsers[0]} is typing...`;
        } else {
            typingIndicator.textContent = 'Multiple users are typing...';
        }
    });
    
    // Local Typing emitter
    const myTypingRef = ref(database, `rooms/${roomId}/typing/${currentUser.uid}`);
    
    const emitTyping = () => {
        if (!currentRoomId) return;
        set(myTypingRef, {
            displayName: currentUser.displayName || 'Anonymous',
            timestamp: serverTimestamp()
        });
        onDisconnect(myTypingRef).remove();
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            remove(myTypingRef);
        }, 2500);
    };

    messageInput.addEventListener('input', emitTyping);
    messageInput.addEventListener('blur', () => remove(myTypingRef));
    
    // Save to clean up later
    messageInput._emitTyping = emitTyping;
}

/**
 * Detaches listeners and clears memory for the active room.
 */
function leaveCurrentRoom() {
    if (unsubMessages) {
        unsubMessages();
        unsubMessages = null;
    }
    if (unsubPresence) {
        unsubPresence();
        unsubPresence = null;
    }
    if (unsubTyping) {
        unsubTyping();
        unsubTyping = null;
    }
    if (currentUser && currentRoomId) {
        // Remove presence and typing indicators explicitly on leave
        remove(ref(database, `rooms/${currentRoomId}/presence/${currentUser.uid}`)).catch(()=>{});
        remove(ref(database, `rooms/${currentRoomId}/typing/${currentUser.uid}`)).catch(()=>{});
    }
    if (messageInput._emitTyping) {
        messageInput.removeEventListener('input', messageInput._emitTyping);
        messageInput.removeEventListener('blur', () => {}); // Can't remove anon function easily but we clear typing indicator
        delete messageInput._emitTyping;
    }
    
    currentRoomId = null;
    currentPassword = null;
    messagesContainer.innerHTML = '';
    roomPresence.textContent = '';
    typingIndicator.textContent = '';
}


// Mobile Back Button
backBtn.addEventListener('click', () => {
    appLayout.classList.remove('chat-open');
    // Optionally leave room or just keep it active in background
});

// Sign Out
logoutBtn.addEventListener('click', async () => {
    clearUserSession();
    await signOut(auth);
});


// ─── Avatar Color Generator ─────────────────────────────────────────
const AVATAR_COLORS = [
    '#5865F2', '#23A559', '#FEE75C', '#EB459E', 
    '#ED4245', '#00A8FC', '#E67E22', '#9B59B6'
];

function getAvatarColor(str) {
    if (!str) return AVATAR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
}


// ─── Local Storage for Sidebar (Scoped Strictly Per User) ──────────
function getRecentRoomsKey() {
    return currentUser ? `vaulted_recent_rooms_${currentUser.uid}` : null;
}

function saveRecentRoom(roomId) {
    const key = getRecentRoomsKey();
    if (!key) return;
    let rooms = JSON.parse(localStorage.getItem(key) || '[]');
    rooms = rooms.filter(id => id !== roomId); // Remove duplicate
    rooms.unshift(roomId); // Add to top
    rooms = rooms.slice(0, 15); // Keep max 15 in sidebar
    localStorage.setItem(key, JSON.stringify(rooms));
}

function removeRecentRoom(roomId) {
    const key = getRecentRoomsKey();
    if (!key) return;
    let rooms = JSON.parse(localStorage.getItem(key) || '[]');
    rooms = rooms.filter(id => id !== roomId);
    localStorage.setItem(key, JSON.stringify(rooms));

    // If active room is removed, reset to empty state
    if (currentRoomId === roomId) {
        leaveCurrentRoom();
        chatArea.classList.add('hidden');
        emptyState.classList.remove('hidden');
        appLayout.classList.remove('chat-open');
    }

    delete sessionPasswords[roomId];
    loadSidebarRooms();
    showToast(`Removed #${roomId} from history`);
}

function loadSidebarRooms() {
    sidebarRoomsList.innerHTML = '';
    const key = getRecentRoomsKey();
    if (!key) return;

    const rooms = JSON.parse(localStorage.getItem(key) || '[]');
    
    if (rooms.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'sidebar-empty-hint';
        hint.innerHTML = 'No rooms yet. Click <strong>+</strong> to join one.';
        sidebarRoomsList.appendChild(hint);
        return;
    }

    rooms.forEach(roomId => {
        const item = document.createElement('div');
        item.className = `room-item ${roomId === currentRoomId ? 'active' : ''}`;
        
        const content = document.createElement('div');
        content.className = 'room-item-content';

        const icon = document.createElement('div');
        icon.className = 'room-icon';
        icon.textContent = '#';

        const name = document.createElement('span');
        name.className = 'room-name';
        name.textContent = roomId;

        content.appendChild(icon);
        content.appendChild(name);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'room-remove-btn';
        removeBtn.title = 'Remove from history';
        removeBtn.setAttribute('aria-label', `Remove room ${roomId}`);
        removeBtn.textContent = '×';

        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeRecentRoom(roomId);
        });

        item.appendChild(content);
        item.appendChild(removeBtn);

        item.addEventListener('click', () => {
            if (roomId === currentRoomId) {
                // Already in this room, just slide over on mobile
                appLayout.classList.add('chat-open');
                return;
            }
            
            // Check if we have the password in memory
            if (sessionPasswords[roomId]) {
                activateRoom(roomId, sessionPasswords[roomId]);
            } else {
                // We need the password. Open prompt.
                pendingRoomIdForDecryption = roomId;
                pwdRoomNameEl.textContent = `Room: ${roomId}`;
                pwdModalOverlay.classList.remove('hidden');
                pwdInput.focus();
            }
        });
        
        sidebarRoomsList.appendChild(item);
    });
}


// =====================================================================
//  END-TO-END ENCRYPTION (CryptoJS AES)
// =====================================================================
function encryptMessage(plaintext) {
    return CryptoJS.AES.encrypt(plaintext, currentPassword).toString();
}

function decryptMessage(ciphertext) {
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, currentPassword);
        const plaintext = bytes.toString(CryptoJS.enc.Utf8);
        return plaintext || null;
    } catch {
        return null; // Wrong password
    }
}


// =====================================================================
//  SENDING MESSAGES
// =====================================================================
messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const plaintext = messageInput.value.trim();
    if (!plaintext || !currentUser || !currentRoomId) return;

    messageInput.value = '';
    if (currentUser) {
        remove(ref(database, `rooms/${currentRoomId}/typing/${currentUser.uid}`)).catch(()=>{});
    }

    const ciphertext = encryptMessage(plaintext);
    const messagesRef = ref(database, `rooms/${currentRoomId}/messages`);

    try {
        await push(messagesRef, {
            uid:         currentUser.uid,
            displayName: currentUser.displayName || 'Anonymous',
            ciphertext:  ciphertext,
            timestamp:   Date.now()
        });
    } catch (err) {
        showToast('Failed to send message. Please try again.');
        messageInput.value = plaintext; // restore
    }
});


// =====================================================================
//  RECEIVING MESSAGES
// =====================================================================
function startListening() {
    const messagesQuery = query(
        ref(database, `rooms/${currentRoomId}/messages`),
        limitToLast(200)
    );

    unsubMessages = onChildAdded(messagesQuery, (snapshot) => {
        const data = snapshot.val();
        if (data) renderMessage(data);
    });
}

function renderMessage(data) {
    const isOwn = currentUser && data.uid === currentUser.uid;
    const plaintext = decryptMessage(data.ciphertext);

    const wrapper = document.createElement('div');
    wrapper.className = `message ${isOwn ? 'message-sent' : 'message-received'}`;

    if (!isOwn) {
        // User avatar with initials and deterministic color
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = (data.displayName || 'U').charAt(0).toUpperCase();
        avatarEl.style.backgroundColor = getAvatarColor(data.displayName || data.uid);
        avatarEl.title = data.displayName || 'User';
        wrapper.appendChild(avatarEl);
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'message-body';

    if (!isOwn) {
        const headerEl = document.createElement('div');
        headerEl.className = 'message-header';

        const senderEl = document.createElement('span');
        senderEl.className = 'message-sender';
        senderEl.textContent = data.displayName || 'Anonymous';
        headerEl.appendChild(senderEl);

        const timeEl = document.createElement('span');
        timeEl.className = 'message-time';
        timeEl.textContent = formatTime(data.timestamp);
        headerEl.appendChild(timeEl);

        bodyEl.appendChild(headerEl);
    }

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';

    if (plaintext !== null) {
        bubbleEl.textContent = plaintext;
    } else {
        bubbleEl.textContent = '[Encrypted Message]';
        bubbleEl.classList.add('encrypted');
    }

    bodyEl.appendChild(bubbleEl);

    if (isOwn) {
        const timeEl = document.createElement('span');
        timeEl.className = 'message-time';
        timeEl.textContent = formatTime(data.timestamp);
        bodyEl.appendChild(timeEl);
    }

    wrapper.appendChild(bodyEl);

    const isScrolledToBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 80;
    messagesContainer.appendChild(wrapper);
    
    if (isScrolledToBottom || isOwn) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    if (!isOwn && document.hidden) {
        unreadCount++;
        document.title = `(${unreadCount}) Vaulted`;
    }
}

function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'message-system';
    el.textContent = text;
    messagesContainer.appendChild(el);
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}



// Copy Room ID
if (copyRoomIdBtn) {
    copyRoomIdBtn.addEventListener('click', () => {
        if (currentRoomId) {
            navigator.clipboard.writeText(currentRoomId).then(() => {
                showToast('Room ID copied!');
            });
        }
    });
}
if (chatRoomTitle) {
    chatRoomTitle.addEventListener('click', () => {
        if (currentRoomId) {
            navigator.clipboard.writeText(currentRoomId).then(() => {
                showToast('Room ID copied!');
            });
        }
    });
}

// =====================================================================
//  CLIPBOARD INVITE SYSTEM
// =====================================================================
shareRoomBtn.addEventListener('click', async () => {
    if (!currentRoomId || !currentPassword) return;

    const inviteText =
        `Vaulted Secure Chat Invite\n` +
        `Room ID: ${currentRoomId}\n` +
        `Password: ${currentPassword}\n\n` +
        `Open the app and click the "Join" button to enter.`;

    try {
        await navigator.clipboard.writeText(inviteText);
        showToast('Invite copied to clipboard!');
    } catch {
        showToast('Could not copy. Please share manually.');
    }
});


// =====================================================================
//  UI POLISH: Shortcuts, Password Toggles, Tab Notifications
// =====================================================================
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        messageForm.requestSubmit();
    }
});

// Show/Hide Password functionality for all toggle buttons
document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const wrapper = e.currentTarget.closest('.password-wrapper');
        const input = wrapper.querySelector('input');
        const isPassword = input.getAttribute('type') === 'password';
        input.setAttribute('type', isPassword ? 'text' : 'password');
    });
});

let unreadCount = 0;
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        unreadCount = 0;
        document.title = 'Vaulted — Encrypted Chat';
    }
});

// Theme Toggle
const themeToggleBtn = document.getElementById('theme-toggle');
const moonIcon = document.getElementById('moon-icon');
const sunIcon = document.getElementById('sun-icon');

if (themeToggleBtn) {
    const savedTheme = localStorage.getItem('vaulted_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.classList.add('dark-theme');
        moonIcon.classList.add('hidden');
        sunIcon.classList.remove('hidden');
    }

    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        
        if (isDark) {
            localStorage.setItem('vaulted_theme', 'dark');
            moonIcon.classList.add('hidden');
            sunIcon.classList.remove('hidden');
        } else {
            localStorage.setItem('vaulted_theme', 'light');
            moonIcon.classList.remove('hidden');
            sunIcon.classList.add('hidden');
        }
    });
}

// Leave Room
if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener('click', () => {
        leaveCurrentRoom();
        chatArea.classList.add('hidden');
        emptyState.classList.remove('hidden');
        appLayout.classList.remove('chat-open'); // slide back on mobile
        
        // Clear active state in sidebar
        document.querySelectorAll('.room-item').forEach(btn => btn.classList.remove('active'));
    });
}

// =====================================================================
//  PWA SERVICE WORKER REGISTRATION
// =====================================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}
