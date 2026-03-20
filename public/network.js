// public/network.js — compat / global-firebase wrapper
// Assumes firebase-app-compat.js, firebase-database-compat.js, firebase-auth-compat.js
// are loaded in index.html before this module executes.

let app;
let db;
let auth;
let uid;

/**
 * Initialize Firebase using the global `firebase` compat object.
 * Call once from game bootstrap.
 * @param {Object} config - Firebase config object (FB_CONFIG)
 */
export async function initFirebase(config) {
  if (app) return { app, db, auth, uid };

  if (typeof firebase === 'undefined') {
    throw new Error('Global `firebase` is not available. Ensure compat SDK script tags are loaded in index.html before game.js');
  }

  app = firebase.initializeApp(config);
  db = firebase.database();
  auth = firebase.auth();

  // sign in anonymously (idempotent if already signed in)
  if (!auth.currentUser) {
    const cred = await auth.signInAnonymously();
    uid = cred.user.uid;
  } else {
    uid = auth.currentUser.uid;
  }

  return { app, db, auth, uid };
}

export function getUid() {
  return uid || (auth && auth.currentUser && auth.currentUser.uid) || null;
}

/* ---------- Lobby / player functions ---------- */

export async function createLobby(name) {
  if (!db) throw new Error('Firebase not initialized');
  const code = Math.random().toString(36).substr(2, 6).toUpperCase();
  await db.ref(`lobbies/${code}`).set({
    host: getUid(),
    name,
    created: firebase.database.ServerValue.TIMESTAMP,
    players: {}
  });
  return code;
}

export async function joinLobby(code, playerName) {
  if (!db) throw new Error('Firebase not initialized');
  const snap = await db.ref(`lobbies/${code}`).once('value');
  if (!snap.exists()) throw new Error('Lobby does not exist');
  await db.ref(`lobbies/${code}/players/${getUid()}`).set({
    name: playerName,
    joined: firebase.database.ServerValue.TIMESTAMP
  });
  return code;
}

export function onLobbyPlayers(code, callback) {
  if (!db) throw new Error('Firebase not initialized');
  const ref = db.ref(`lobbies/${code}/players`);
  const handler = ref.on('value', s => callback(s.val() || {}));
  return () => ref.off('value', handler);
}

export function leaveLobby(code) {
  if (!db) throw new Error('Firebase not initialized');
  return db.ref(`lobbies/${code}/players/${getUid()}`).remove();
}

/* ---------- Game state / sync ---------- */

export function sendState(code, state) {
  if (!db) throw new Error('Firebase not initialized');
  return db.ref(`lobbies/${code}/state/${getUid()}`).set({
    state,
    ts: firebase.database.ServerValue.TIMESTAMP
  });
}

export function onStateUpdates(code, callback) {
  if (!db) throw new Error('Firebase not initialized');
  const ref = db.ref(`lobbies/${code}/state`);
  const handler = ref.on('value', s => callback(s.val() || {}));
  return () => ref.off('value', handler);
}

/* ---------- Chat ---------- */

export function sendChatMessage(code, text) {
  if (!db) throw new Error('Firebase not initialized');
  const ref = db.ref(`lobbies/${code}/chat`);
  const newRef = ref.push();
  return newRef.set({
    uid: getUid(),
    text,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
}

export function onChat(code, callback) {
  if (!db) throw new Error('Firebase not initialized');
  const ref = db.ref(`lobbies/${code}/chat`);
  const handler = ref.on('value', s => {
    const val = s.val() || {};
    // convert keyed object to array sorted by key (push id order)
    callback(Object.values(val));
  });
  return () => ref.off('value', handler);
}
