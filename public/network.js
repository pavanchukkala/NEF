/*
  network.js

  Firebase and networking abstraction layer for Volt Surge.

  This module wraps Firebase initialisation, lobby creation/joining,
  realtime state updates and chat/voice signalling.  To keep costs
  zero, it uses Firebase's free Spark plan with anonymous
  authentication.  Replace the placeholder config below with your
  project's values from the Firebase console.

  All public functions return promises and are designed to be
  awaitable.  Event listeners accept callbacks that will be invoked
  whenever data changes on the server.
*/

// Import the Firebase compat SDKs from CDN.  Using the compat layer
// keeps the API close to v8 and does not require a build step.
let app;
let db;
let auth;
let uid;

export async function initFirebase(config) {
  if (app) return; // prevent multiple initialisations
  app = initializeApp(config);
  db = getDatabase(app);
  auth = getAuth(app);
  const cred = await signInAnonymously(auth);
  uid = cred.user.uid;
}

export function getUid() {
  return uid;
}

// Lobby operations
export async function createLobby(name) {
  // Generate a random 6‑letter room code
  const code = Math.random().toString(36).substr(2, 6).toUpperCase();
  await set(ref(db, `lobbies/${code}`), {
    host: uid,
    name,
    created: Date.now(),
    players: {}
  });
  return code;
}

export async function joinLobby(code, playerName) {
  const lobbyRef = ref(db, `lobbies/${code}`);
  const snap = await get(lobbyRef);
  if (!snap.exists()) throw new Error('Lobby does not exist');
  // Register player under players list
  const playerRef = ref(db, `lobbies/${code}/players/${uid}`);
  await set(playerRef, {
    name: playerName,
    joined: Date.now()
  });
  return code;
}

export function onLobbyPlayers(code, callback) {
  const playersRef = ref(db, `lobbies/${code}/players`);
  return onValue(playersRef, snap => {
    const val = snap.val() || {};
    callback(val);
  });
}

// Remove player on disconnect
export function leaveLobby(code) {
  const playerRef = ref(db, `lobbies/${code}/players/${uid}`);
  remove(playerRef);
}

// Game state operations
export function sendState(code, state) {
  const stateRef = ref(db, `lobbies/${code}/state/${uid}`);
  return set(stateRef, state);
}

export function onStateUpdates(code, callback) {
  const stateRef = ref(db, `lobbies/${code}/state`);
  return onValue(stateRef, snap => {
    const states = snap.val() || {};
    callback(states);
  });
}

// Chat operations
export function sendChatMessage(code, text) {
  const msgRef = ref(db, `lobbies/${code}/chat`);
  const id = push(child(msgRef, '/')).key;
  return set(ref(db, `lobbies/${code}/chat/${id}`), {
    uid,
    text,
    timestamp: Date.now()
  });
}

export function onChat(code, callback) {
  const msgRef = ref(db, `lobbies/${code}/chat`);
  return onValue(msgRef, snap => {
    const msgs = snap.val() || {};
    callback(Object.values(msgs));
  });
}
