/*
  game.js

  This module contains the bulk of Volt Surge’s gameplay logic.  It is
  adapted from the original single‑file implementation and still
  operates largely standalone: it draws to a canvas, handles input,
  updates player positions, trails and abilities, and synchronises
  state across Firebase.

  Refactoring the original code into a separate module means that it
  can import helpers from other files.  For example, the AI bot
  heuristics live in `ai.js` and are attached to player objects
  conditionally when a room needs filling with bots.  The network
  functions are imported from `network.js` but the existing
  Firebase logic has been retained to avoid breaking behaviour.  In
  future iterations you can replace these direct Firebase calls with
  the abstractions defined in `network.js`.

  Note: To enable the game, ensure that you provide a valid
  `FB_CONFIG` object at runtime.  See README for instructions.
*/

// Import auxiliary modules.  These are currently unused by the
// original game code but are available for future integration.
/* public/game.js — header fixed to remove duplicate `G` declaration
   Keep the rest of the original file unchanged below the `// 3. STATE` marker.
*/

import * as Network from './network.js';
import { Bot } from './ai.js';

/* --- auto-inserted safe DOM accessor: el(id) ---
   Returns the real element when present; otherwise a forgiving stub
   that safely swallows common DOM operations so missing elements won't crash the app.
*/
function el(id){
  try{
    const e = document.getElementById(id);
    if(e) return e;
  }catch(e){}
  const noop = ()=>{};
  const stub = {
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    removeChild: noop,
    replaceChild: noop,
    querySelector: ()=>null,
    querySelectorAll: ()=>[],
    getContext: ()=>null,
    focus: noop,
    blur: noop,
    style: {},
    classList: { add: noop, remove: noop, toggle: noop },
    value: '',
    textContent: '',
    innerText: ''
  };
  return stub;
}
/* --- end helper --- */


// BEGIN ORIGINAL GAME CODE
// ═══════════════════════════════════════════════════════════════
// 1. CONFIG
// ═══════════════════════════════════════════════════════════════
const G = {
  WORLD: 3000,
  PLAYER_SPEED: 190,
  SURGE_SPEED: 330,
  PLAYER_R: 14,
  BULLET_SPEED: 460,
  BULLET_DAMAGE: 15,
  BULLET_RANGE: 720,
  FIRE_RATE: 480,
  TRAIL_MS: 5200,
  TRAIL_DMG: 30,
  TRAIL_FRESH: 650,
  TRAIL_HEAL: 6,
  PULSE_CD: 8000,
  PULSE_R: 220,
  PULSE_STUN: 1500,
  SHIELD_CD: 10000,
  SHIELD_DUR: 2000,
  SURGE_CD: 12000,
  SURGE_DUR: 3000,
  SYNC_MS: 70,
  TRAIL_SYNC_MS: 160,
  MAX_PLAYERS: 8,
  MIN_TO_START: 2,
  HUES: [180, 300, 60, 120, 30, 240, 0, 270],
  SPAWNS: [
    { x: 400, y: 400 }, { x: 2600, y: 400 }, { x: 400, y: 2600 }, { x: 2600, y: 2600 },
    { x: 1500, y: 300 }, { x: 1500, y: 2700 }, { x: 300, y: 1500 }, { x: 2700, y: 1500 }
  ],
  PU_TYPES: ['health', 'pulse', 'shield', 'surge', 'chain'],
  PU_SPAWNS: [
    { x: 750, y: 750 }, { x: 2250, y: 750 }, { x: 750, y: 2250 }, { x: 2250, y: 2250 },
    { x: 1500, y: 750 }, { x: 1500, y: 2250 }, { x: 750, y: 1500 }, { x: 2250, y: 1500 },
    { x: 1500, y: 1500 }, { x: 1200, y: 1200 }, { x: 1800, y: 1800 }
  ],
  ZONE_PHASES: [
    { r: 1400, dmg: 0, dur: 30000 },
    { r: 1050, dmg: 5, dur: 60000 },
    { r: 720, dmg: 10, dur: 60000 },
    { r: 440, dmg: 15, dur: 60000 },
    { r: 220, dmg: 20, dur: 60000 },
    { r: 90, dmg: 30, dur: 60000 }
  ],
  RESPAWN_DELAY: 5000
};

// ═══════════════════════════════════════════════════════════════
// 2. FIREBASE CONFIG — Replace with YOUR Firebase config if needed
// ═══════════════════════════════════════════════════════════════
const FB_CONFIG = {
  apiKey: "AIzaSyCpfn31zD0CVddegKkzfhl1a8Kx8ioRFW4",
  authDomain: "voltagee-accf1.firebaseapp.com",
  databaseURL: "https://voltagee-accf1-default-rtdb.firebaseio.com",
  projectId: "voltagee-accf1",
  storageBucket: "voltagee-accf1.firebasestorage.app",
  messagingSenderId: "933548432641",
  appId: "1:933548432641:web:24aa604fccaa3d32218f00",
  measurementId: "G-V37VQYY6NQ"
};

// ═══════════════════════════════════════════════════════════════
// 3. STATE
// ═══════════════════════════════════════════════════════════════
let db, auth, uid, fbApp;
let myRoom = null, myPlayer = null, roomRef = null;
let isHost = false, roomCode = '';
let remotePlayers = {}; // uid → {name,hue,x,y,angle,hp,alive,kills,score,trail:[]}
let bullets = [], particles = [], lightnings = [], powerUps = [];
let zone = {cx:1500,cy:1500,r:1400,targetR:1400,phase:0,phaseTimer:0,displayR:1400};
let gameStartTime = 0, gameRunning = false;
let lastSyncTime = 0, lastTrailSyncTime = 0;
let syncInterval = null;
let canvas, ctx, mmCanvas, mmCtx;
let animId = null;
let lastTime = 0;
let shakeX = 0, shakeY = 0, shakeDecay = 0;
let camera = {x:0, y:0};
let chatListeners = [];
let voiceChat = null;
let preChargedAbilities = {pulse:false, shield:false}; // rewarded ad bonus
let roundStats = [];
let backgroundStars = [];
// Bot control
let botTimers = {}; // botId -> interval id
let botAIEnabled = true;

// Input state
const keys = {};
let mouseX = 0, mouseY = 0;
let joy = {dx:0, dy:0, active:false};
let joystickTouchId = null;

// ═══════════════════════════════════════════════════════════════
// 4. WEB AUDIO
// ═══════════════════════════════════════════════════════════════
let audioCtx;
function initAudio() {
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
}
function playSound(type) {
  if (!audioCtx) return;
  const ac = audioCtx;
  const now = ac.currentTime;
  const gain = ac.createGain();
  gain.connect(ac.destination);
  const osc = ac.createOscillator();
  osc.connect(gain);
  switch(type) {
    case 'fire':
      osc.frequency.setValueAtTime(800,now);
      osc.frequency.exponentialRampToValueAtTime(200,now+0.08);
      gain.gain.setValueAtTime(0.15,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.08);
      break;
    case 'hit':
      osc.type='sawtooth';
      osc.frequency.setValueAtTime(120,now);
      gain.gain.setValueAtTime(0.3,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.12);
      break;
    case 'kill':
      osc.type='sine';
      osc.frequency.setValueAtTime(440,now);
      osc.frequency.setValueAtTime(660,now+0.1);
      gain.gain.setValueAtTime(0.4,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.3);
      break;
    case 'pulse':
      osc.type='sawtooth';
      osc.frequency.setValueAtTime(60,now);
      osc.frequency.exponentialRampToValueAtTime(20,now+0.5);
      gain.gain.setValueAtTime(0.5,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.5);
      break;
    case 'shield':
      osc.type='sine';
      osc.frequency.setValueAtTime(880,now);
      gain.gain.setValueAtTime(0.2,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.2);
      break;
    case 'surge':
      osc.frequency.setValueAtTime(200,now);
      osc.frequency.exponentialRampToValueAtTime(800,now+0.15);
      gain.gain.setValueAtTime(0.3,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.2);
      break;
    case 'chain':
      for(let i=0;i<3;i++){
        const o2=ac.createOscillator(); const g2=ac.createGain();
        o2.connect(g2); g2.connect(ac.destination);
        o2.frequency.setValueAtTime(1200+i*300,now+i*0.05);
        g2.gain.setValueAtTime(0.2,now+i*0.05);
        g2.gain.exponentialRampToValueAtTime(0.001,now+i*0.05+0.1);
        o2.start(now+i*0.05); o2.stop(now+i*0.05+0.1);
      }
      osc.connect(gain); // fallthrough to stop below
      break;
    case 'death':
      osc.type='sawtooth';
      osc.frequency.setValueAtTime(300,now);
      osc.frequency.exponentialRampToValueAtTime(30,now+0.8);
      gain.gain.setValueAtTime(0.6,now);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.8);
      break;
    case 'pickup':
      osc.frequency.setValueAtTime(660,now); osc.frequency.setValueAtTime(880,now+0.08);
      gain.gain.setValueAtTime(0.25,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.2);
      break;
    case 'lowHP':
      osc.frequency.setValueAtTime(200,now);
      gain.gain.setValueAtTime(0.35,now); gain.gain.exponentialRampToValueAtTime(0.001,now+0.06);
      break;
  }
  osc.start(now);
  osc.stop(now+1);
}

// ═══════════════════════════════════════════════════════════════
// 5. PLAYER CLASS
// ═══════════════════════════════════════════════════════════════
class Player {
  constructor(id, name, hue, x, y, isLocal=false) {
    this.id=id; this.name=name; this.hue=hue;
    this.x=x; this.y=y; this.vx=0; this.vy=0;
    this.angle=0; this.hp=100; this.maxHp=100;
    this.energy=100; this.maxEnergy=100;
    this.kills=0; this.deaths=0; this.score=0;
    this.alive=true; this.isLocal=isLocal;
    this.radius=G.PLAYER_R;
    this.trail=[]; // {x,y,t}
    this.pulseCd=preChargedAbilities.pulse?0:0;
    this.shieldCd=preChargedAbilities.shield?0:0;
    this.surgeCd=0;
    this.shieldActive=false; this.surgeActive=false;
    this.shieldTimer=0; this.surgeTimer=0;
    this.fireCd=0; this.trailDmgTimer=0;
    this.stunTimer=0; this.hitFlash=0;
    this.respawnTimer=0; this.isRespawning=false;
    this.tx=x; this.ty=y; this.tangle=0; // interpolation targets
    this.survivalStart=Date.now();
    this.chainAmp=false; // power-up bonus
    this.lowHpBeep=0;
  }
  get color() { return `hsl(${this.hue},100%,60%)`; }
  get colorGlow() { return `hsl(${this.hue},100%,70%)`; }
  get speed() { return this.surgeActive ? G.SURGE_SPEED : G.PLAYER_SPEED; }
}

// ═══════════════════════════════════════════════════════════════
// 6. FIREBASE HELPERS
// ═══════════════════════════════════════════════════════════════
function initFirebase() {
  try {
    fbApp = firebase.initializeApp(FB_CONFIG);
    db = firebase.database();
    auth = firebase.auth();
    return true;
  } catch(e) {
    console.warn('Firebase init failed:', e);
    return false;
  }
}

function genRoomCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  for(let i=0;i<6;i++) code+=chars[Math.floor(Math.random()*chars.length)];
  return code;
}

async function signIn() {
  const r = await auth.signInAnonymously();
  uid = r.user.uid;
}

async function createRoom(pub=false) {
  const code = genRoomCode();
  const playerName = getPlayerName();
  const hue = G.HUES[0];
  const spawn = G.SPAWNS[0];
  const roomData = {
    meta: {host:uid, state:'waiting', seed:Date.now(), isPublic:pub, createdAt:firebase.database.ServerValue.TIMESTAMP, maxPlayers:G.MAX_PLAYERS},
    players: {
      [uid]: {id:uid,name:playerName,hue,x:spawn.x,y:spawn.y,angle:0,hp:100,kills:0,score:0,alive:true,updatedAt:Date.now()}
    },
    powerUps: buildPowerUps()
  };
  await db.ref(`rooms/${code}`).set(roomData);
  await db.ref(`rooms/${code}/players/${uid}`).onDisconnect().remove();
  roomCode = code;
  isHost = true;
  return code;
}

async function joinRoom(code, pub=false) {
  code = code.toUpperCase().trim();
  const snap = await db.ref(`rooms/${code}/meta`).once('value');
  if (!snap.exists()) { showNotif('Room not found!'); return false; }
  const meta = snap.val();
  if (meta.state !== 'waiting') { showNotif('Game already started!'); return false; }
  const psSnap = await db.ref(`rooms/${code}/players`).once('value');
  const ps = psSnap.val() || {};
  const count = Object.keys(ps).length;
  if (count >= G.MAX_PLAYERS) { showNotif('Room is full!'); return false; }
  const playerName = getPlayerName();
  const hue = G.HUES[Math.min(count, G.HUES.length-1)];
  const spawn = G.SPAWNS[Math.min(count, G.SPAWNS.length-1)];
  await db.ref(`rooms/${code}/players/${uid}`).set({
    id:uid,name:playerName,hue,x:spawn.x,y:spawn.y,angle:0,hp:100,kills:0,score:0,alive:true,updatedAt:Date.now()
  });
  await db.ref(`rooms/${code}/players/${uid}`).onDisconnect().remove();
  roomCode = code;
  isHost = (meta.host === uid);
  return true;
}

async function quickMatch() {
  const snap = await db.ref('rooms').orderByChild('meta/isPublic').equalTo(true).limitToFirst(10).once('value');
  const rooms = snap.val() || {};
  for (const [code, room] of Object.entries(rooms)) {
    if (!room.meta || room.meta.state !== 'waiting') continue;
    const count = Object.keys(room.players || {}).length;
    if (count < G.MAX_PLAYERS) {
      const ok = await joinRoom(code);
      if (ok) return code;
    }
  }
  return await createRoom(true);
}

function buildPowerUps() {
  const pu = {};
  G.PU_SPAWNS.forEach((pos, i) => {
    const type = G.PU_TYPES[i % G.PU_TYPES.length];
    pu[`pu${i}`] = {id:`pu${i}`, type, x:pos.x, y:pos.y, active:true, respawnAt:0};
  });
  return pu;
}

function listenRoom(code) {
  roomRef = db.ref(`rooms/${code}`);
  // Players
  roomRef.child('players').on('value', snap => {
    const ps = snap.val() || {};
    updateRemotePlayers(ps);
    updateWaitingRoomUI(ps);
  });
  // Meta (game state)
  roomRef.child('meta').on('value', snap => {
    const meta = snap.val();
    if (!meta) return;
    if (meta.state === 'countdown' && !gameRunning) startCountdown(meta.countdown || 3);
    if (meta.state === 'playing' && !gameRunning) beginGame(meta.seed);
    if (meta.state === 'ended') endGame(meta.winnerId);
  });
  // Chat
  roomRef.child('chat').limitToLast(40).on('child_added', snap => {
    const msg = snap.val();
    if (msg) addChatMessage(msg);
  });
  // Trails from remote players
  roomRef.child('trails').on('value', snap => {
    const trails = snap.val() || {};
    for (const [pid, data] of Object.entries(trails)) {
      if (pid === uid) continue;
      if (remotePlayers[pid] && data.pts) {
        try {
          const pts = parseTrailPts(data.pts);
          remotePlayers[pid].trail = pts;
        } catch(e) {}
      }
    }
  });
  // Power-ups
  roomRef.child('powerUps').on('value', snap => {
    const raw = snap.val() || {};
    powerUps = Object.values(raw).map(pu => ({...pu, rot:Math.random()*Math.PI*2}));
  });
  // Zone (host broadcasts)
  roomRef.child('zone').on('value', snap => {
    const z = snap.val();
    if (z && !isHost) {
      zone.cx=z.cx; zone.cy=z.cy; zone.targetR=z.r; zone.phase=z.phase; zone.phaseTimer=z.phaseTimer;
    }
  });
  // Bullets (from remote players)
  roomRef.child('bullets').on('child_added', snap => {
    const b = snap.val();
    if (b && b.ownerId !== uid) {
      bullets.push({...b, local:false, dist:0});
      snap.ref.remove();
    }
  });
}

function parseTrailPts(str) {
  if (!str) return [];
  return str.split(';').map(pt => {
    const [x,y,t] = pt.split(',').map(Number);
    return {x,y,t};
  }).filter(pt => !isNaN(pt.x) && Date.now()-pt.t < G.TRAIL_MS+500);
}

function encodeTrailPts(pts) {
  const now = Date.now();
  const recent = pts.filter(p => now-p.t < G.TRAIL_MS);
  // subsample: every 2nd point for bandwidth
  const sub = recent.filter((_,i)=>i%2===0);
  return sub.map(p=>`${Math.round(p.x)},${Math.round(p.y)},${p.t}`).join(';');
}

// ═══════════════════════════════════════════════════════════════
// 7. WAITING ROOM UI
// ═══════════════════════════════════════════════════════════════
function updateWaitingRoomUI(ps) {
  const grid = el('player-slots-grid');
  const players = Object.values(ps);
  const meta = { host: isHost ? uid : null };
  let html = '';
  for (let i=0;i<G.MAX_PLAYERS;i++) {
    const p = players[i];
    if (p) {
      html += `<div class="player-slot">
        <div class="slot-dot" style="background:hsl(${p.hue},100%,60%)"></div>
        <div>
          <div class="slot-name">${escHtml(p.name)}</div>
          ${p.id===uid ? (isHost ? '<div class="slot-host">HOST • YOU</div>' : '<div class="slot-host">YOU</div>') : ''}${p.id&&p.id.startsWith('bot_')?'<div class="slot-host" style="color:#66ff99">BOT</div>':''}
        </div>
      </div>`;
    } else {
      html += `<div class="player-slot empty"><div class="slot-dot" style="background:#1a2a3a"></div><div style="color:#2a4060;font-size:0.85rem">Waiting...</div></div>`;
    }
  }
  grid.innerHTML = html;
  const startBtn = el('btn-start');
  if (isHost) {
    startBtn.style.display = '';
    // Allow host to start even if alone — we'll auto-insert a bot if needed
    startBtn.disabled = false;
  } else {
    startBtn.style.display = 'none';
  }
  el('room-code-display').textContent = roomCode;
}

function updateRemotePlayers(ps) {
  for (const [pid, pdata] of Object.entries(ps)) {
    if (pid === uid) {
      if (myPlayer) {
        myPlayer.kills = pdata.kills;
        myPlayer.score = pdata.score;
      }
      continue;
    }
    if (!remotePlayers[pid]) {
      remotePlayers[pid] = {
        id:pid, name:pdata.name||'Player', hue:pdata.hue||180,
        x:pdata.x||1500, y:pdata.y||1500, tx:pdata.x||1500, ty:pdata.y||1500,
        angle:pdata.angle||0, hp:pdata.hp||100, alive:pdata.alive!==false,
        kills:pdata.kills||0, score:pdata.score||0,
        trail:[], hitFlash:0, stunTimer:0, shieldActive:false, surgeActive:false,
        chainAmp:false
      };
    } else {
      const rp = remotePlayers[pid];
      rp.tx = pdata.x; rp.ty = pdata.y;
      rp.tangle = pdata.angle;
      rp.hp = pdata.hp;
      rp.alive = pdata.alive !== false;
      rp.kills = pdata.kills || 0;
      rp.score = pdata.score || 0;
      rp.name = pdata.name;
    }
  }
  // Remove disconnected
  for (const pid of Object.keys(remotePlayers)) {
    if (!ps[pid]) delete remotePlayers[pid];
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. GAME INIT
// ═══════════════════════════════════════════════════════════════
function generateStars() {
  backgroundStars = [];
  for (let i=0;i<300;i++) {
    backgroundStars.push({
      x: Math.random()*G.WORLD, y: Math.random()*G.WORLD,
      r: Math.random()*1.5+0.3, a: Math.random()*0.7+0.1
    });
  }
}

function beginGame(seed) {
  if (gameRunning) return;
  gameRunning = true;
  gameStartTime = Date.now();
  generateStars();

  // Init zone
  zone = {cx:1500,cy:1500,r:G.ZONE_PHASES[0].r,targetR:G.ZONE_PHASES[0].r,displayR:G.ZONE_PHASES[0].r,phase:0,phaseTimer:0};

  // Create local player
  const snap_p = Object.values(remotePlayers);
  const allIds = Object.keys({...remotePlayers, [uid]:true});
  allIds.sort();
  const myIdx = allIds.indexOf(uid);
  const spawn = G.SPAWNS[(myIdx >= 0 ? myIdx : 0) % G.SPAWNS.length];
  const hue = G.HUES[(myIdx >= 0 ? myIdx : 0) % G.HUES.length];
  myPlayer = new Player(uid, getPlayerName(), hue, spawn.x, spawn.y, true);
  if (preChargedAbilities.pulse) { myPlayer.pulseCd = 0; preChargedAbilities.pulse=false; }
  if (preChargedAbilities.shield) { myPlayer.shieldCd = 0; preChargedAbilities.shield=false; }

  // Setup canvas
  canvas = el('game-canvas');
  ctx = canvas.getContext('2d');
  mmCanvas = el('minimap-canvas');
  mmCtx = mmCanvas.getContext('2d');
  resizeCanvas();

  // Show game screen
  showScreen('s-game');
  el('hud').style.display = 'block';
  if (isMobile()) {
    el('mobile-controls').style.display = 'block';
  }

  // Start sync
  syncInterval = setInterval(syncGame, G.SYNC_MS);

  // If host, start AI for any bots that exist (or bots we created earlier)
  if (isHost && botAIEnabled && roomRef) {
    // fetch players and start bot AIs
    roomRef.child('players').once('value').then(snap => {
      const players = snap.val() || {};
      for (const pid of Object.keys(players)) {
        if (pid && pid.startsWith('bot_')) {
          startBotAI(pid);
        }
      }
    }).catch(()=>{});
  }

  // Start loop
  lastTime = performance.now();
  animId = requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ═══════════════════════════════════════════════════════════════
// 9. GAME LOOP
// ═══════════════════════════════════════════════════════════════
function gameLoop(timestamp) {
  animId = requestAnimationFrame(gameLoop);
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  if (!gameRunning || !myPlayer) return;
  update(dt);
  render();
  renderMinimap();
  updateHUD();
}

function update(dt) {
  const now = Date.now();
  updateLocalPlayer(dt, now);
  updateRemoteInterp(dt);
  updateBullets(dt, now);
  updateParticles(dt);
  updateLightnings(dt);
  updateZone(dt, now);
  updatePowerUps(now);
  shakeX *= 0.8; shakeY *= 0.8;
  if (Math.abs(shakeX)<0.1) shakeX=0;
  if (Math.abs(shakeY)<0.1) shakeY=0;
}

function updateLocalPlayer(dt, now) {
  const p = myPlayer;
  if (!p || !p.alive) return;

  // Timers
  if (p.stunTimer > 0) { p.stunTimer -= dt*1000; if(p.stunTimer<0)p.stunTimer=0; }
  if (p.shieldTimer > 0) { p.shieldTimer -= dt*1000; if(p.shieldTimer<=0){p.shieldActive=false;p.shieldTimer=0;} }
  if (p.surgeTimer > 0) { p.surgeTimer -= dt*1000; if(p.surgeTimer<=0){p.surgeActive=false;p.surgeTimer=0;} }
  if (p.pulseCd > 0) p.pulseCd = Math.max(0, p.pulseCd - dt*1000);
  if (p.shieldCd > 0) p.shieldCd = Math.max(0, p.shieldCd - dt*1000);
  if (p.surgeCd > 0) p.surgeCd = Math.max(0, p.surgeCd - dt*1000);
  if (p.fireCd > 0) p.fireCd = Math.max(0, p.fireCd - dt*1000);
  if (p.hitFlash > 0) p.hitFlash -= dt*3;

  // Low HP sound
  if (p.hp <= 25 && p.hp > 0) {
    p.lowHpBeep = (p.lowHpBeep||0) + dt;
    if (p.lowHpBeep > 1) { playSound('lowHP'); p.lowHpBeep=0; }
  } else p.lowHpBeep=0;

  // Movement
  if (p.stunTimer <= 0) {
    let dx=0, dy=0;
    if (joy.active) { dx=joy.dx; dy=joy.dy; }
    else {
      if (keys['w']||keys['arrowup']) dy=-1;
      if (keys['s']||keys['arrowdown']) dy=1;
      if (keys['a']||keys['arrowleft']) dx=-1;
      if (keys['d']||keys['arrowright']) dx=1;
    }
    if (dx!==0||dy!==0) {
      const len = Math.hypot(dx,dy);
      dx/=len; dy/=len;
      p.vx += (dx*p.speed - p.vx) * Math.min(1, dt*14);
      p.vy += (dy*p.speed - p.vy) * Math.min(1, dt*14);
      p.angle = Math.atan2(dy, dx);
    } else {
      p.vx *= Math.pow(0.08, dt);
      p.vy *= Math.pow(0.08, dt);
    }
    p.x = Math.max(p.radius, Math.min(G.WORLD-p.radius, p.x + p.vx*dt));
    p.y = Math.max(p.radius, Math.min(G.WORLD-p.radius, p.y + p.vy*dt));
  }

  // Mouse aim on desktop
  if (!isMobile()) {
    const wx = mouseX - canvas.width/2 + camera.x + p.x;
    const wy = mouseY - canvas.height/2 + camera.y + p.y;
    if (Math.hypot(mouseX-canvas.width/2, mouseY-canvas.height/2)>20) {
      p.angle = Math.atan2(wy-p.y, wx-p.x);
    }
  }

  // Trail
  if (p.alive && (Math.abs(p.vx)>2||Math.abs(p.vy)>2)) {
    p.trail.push({x:p.x, y:p.y, t:now});
  }
  p.trail = p.trail.filter(pt => now - pt.t < G.TRAIL_MS);

  // Auto-fire
  if (p.fireCd <= 0 && p.alive) {
    fireBullet(p);
    p.fireCd = G.FIRE_RATE;
  }

  // Trail damage & heal (against remote players)
  checkLocalTrailDamage(p, dt, now);

  // Zone damage
  const distToCenter = Math.hypot(p.x-zone.cx, p.y-zone.cy);
  if (distToCenter > zone.displayR && !p.shieldActive) {
    const phase = G.ZONE_PHASES[Math.min(zone.phase, G.ZONE_PHASES.length-1)];
    p.hp -= phase.dmg * dt;
    p.hp = Math.max(0, p.hp);
  }

  // Death check
  if (p.hp <= 0 && p.alive) killLocalPlayer();

  // Energy regen
  p.energy = Math.min(100, p.energy + dt*8);

  // Camera
  camera.x = p.x - canvas.width/2;
  camera.y = p.y - canvas.height/2;
  camera.x = Math.max(0, Math.min(G.WORLD-canvas.width, camera.x));
  camera.y = Math.max(0, Math.min(G.WORLD-canvas.height, camera.y));
}

function checkLocalTrailDamage(p, dt, now) {
  // Check remote player trails against local player
  for (const rp of Object.values(remotePlayers)) {
    if (!rp.alive || !rp.trail || rp.trail.length < 2) continue;
    for (let i=1;i<rp.trail.length;i++) {
      const a=rp.trail[i-1], b=rp.trail[i];
      const age = now - b.t;
      if (age > G.TRAIL_MS) continue;
      const d = distToSeg(p.x,p.y, a.x,a.y, b.x,b.y);
      if (d < p.radius+4 && !p.shieldActive) {
        p.hp -= G.TRAIL_DMG * dt;
        p.hp = Math.max(0, p.hp);
        p.hitFlash = 1;
        shakeX = (Math.random()-0.5)*10;
        shakeY = (Math.random()-0.5)*10;
        break;
      }
    }
  }
  // Heal from own fresh trail
  if (p.trail.length>=2) {
    const last = p.trail[p.trail.length-1];
    if (Date.now() - last.t < G.TRAIL_FRESH) {
      p.hp = Math.min(p.maxHp, p.hp + G.TRAIL_HEAL*dt);
    }
  }
}

function fireBullet(p) {
  const speed = G.BULLET_SPEED;
  const b = {
    x:p.x + Math.cos(p.angle)*p.radius,
    y:p.y + Math.sin(p.angle)*p.radius,
    vx:Math.cos(p.angle)*speed,
    vy:Math.sin(p.angle)*speed,
    ownerId:p.id, hue:p.hue,
    damage:G.BULLET_DAMAGE*(p.surgeActive?1.5:1)*(p.chainAmp?2:1),
    dist:0, local:true, id:genId()
  };
  bullets.push(b);
  playSound('fire');
  // Broadcast to Firebase (throttled)
  if (roomRef) roomRef.child(`bullets/${b.id}`).set({
    x:b.x,y:b.y,vx:b.vx,vy:b.vy,ownerId:p.id,hue:p.hue,damage:b.damage,id:b.id
  });
}

function updateBullets(dt, now) {
  const toRemove = [];
  for (let i=bullets.length-1;i>=0;i--) {
    const b = bullets[i];
    b.x += b.vx*dt;
    b.y += b.vy*dt;
    b.dist += Math.hypot(b.vx,b.vy)*dt;
    // Wall bounce
    if (b.x<5||b.x>G.WORLD-5){b.vx*=-1;b.dist+=20;}
    if (b.y<5||b.y>G.WORLD-5){b.vy*=-1;b.dist+=20;}
    if (b.dist > G.BULLET_RANGE) { toRemove.push(i); continue; }
    // Hit local player
    if (b.ownerId !== uid && myPlayer && myPlayer.alive) {
      if (Math.hypot(b.x-myPlayer.x, b.y-myPlayer.y) < myPlayer.radius+5) {
        if (!myPlayer.shieldActive) {
          myPlayer.hp = Math.max(0, myPlayer.hp - b.damage);
          myPlayer.hitFlash=1;
          shakeX=(Math.random()-0.5)*16; shakeY=(Math.random()-0.5)*16;
          spawnParticles(b.x, b.y, `hsl(${b.hue},100%,60%)`, 8);
          playSound('hit');
          // Check chain
          checkChainLightning(b.x, b.y, b.ownerId);
          if (myPlayer.hp<=0) killLocalPlayer();
        }
        toRemove.push(i); continue;
      }
    }
    // Hit remote players (if we're the bullet owner — prevents double counting)
    if (b.ownerId === uid) {
      for (const [pid, rp] of Object.entries(remotePlayers)) {
        if (!rp.alive) continue;
        if (Math.hypot(b.x-rp.x, b.y-rp.y) < rp.radius+5) {
          if (!rp.shieldActive) {
            const newHp = Math.max(0, rp.hp - b.damage);
            rp.hp = newHp;
            rp.hitFlash=1;
            spawnParticles(b.x,b.y,`hsl(${rp.hue},100%,60%)`,8);
            playSound('hit');
            checkChainLightning(b.x, b.y, uid, rp);
            // Broadcast HP change
            if (roomRef) roomRef.child(`players/${pid}/hp`).set(newHp);
            if (newHp <= 0) {
              rp.alive=false;
              if (roomRef) roomRef.child(`players/${pid}/alive`).set(false);
              myPlayer.kills++;
              myPlayer.score += 100 + myPlayer.kills*10;
              if (myPlayer.chainAmp) { myPlayer.chainAmp=false; }
              playSound('kill');
              addKillFeedEntry(myPlayer.name, rp.name, myPlayer.hue, rp.hue);
              if (roomRef) roomRef.child(`players/${uid}`).update({kills:myPlayer.kills,score:myPlayer.score});
              spawnDeathParticles(rp.x, rp.y, rp.hue);
              checkWinCondition();
            }
          }
          toRemove.push(i); break;
        }
      }
    }
  }
  for (let i=toRemove.length-1;i>=0;i--) bullets.splice(toRemove[i],1);
}

function checkChainLightning(bx, by, fromId, hitPlayer) {
  // Find nearest trail segment within range
  const chainRange = 180;
  let closest = null, closestDist = chainRange;
  const allTrails = [
    ...Object.values(remotePlayers).map(rp=>({player:rp,trail:rp.trail}))
  ];
  if (myPlayer && myPlayer.trail) allTrails.push({player:myPlayer, trail:myPlayer.trail});
  for (const {player, trail} of allTrails) {
    if (!trail || trail.length<2) continue;
    for (let i=1;i<trail.length;i++) {
      const d = distToSeg(bx,by, trail[i-1].x,trail[i-1].y, trail[i].x,trail[i].y);
      if (d<closestDist) { closestDist=d; closest={player,pt:{x:trail[i].x,y:trail[i].y}}; }
    }
  }
  if (!closest) return;
  // Chain hits nearest player to that trail segment
  lightnings.push({x1:bx,y1:by,x2:closest.pt.x,y2:closest.pt.y,t:Date.now(),life:0.3});
  playSound('chain');
  // Deal chain damage to player who owns that trail (if different from already hit player)
  const chainTarget = closest.player;
  if (!hitPlayer || chainTarget !== hitPlayer) {
    if (chainTarget.id === uid && myPlayer && myPlayer.alive && !myPlayer.shieldActive) {
      myPlayer.hp = Math.max(0, myPlayer.hp-10);
      myPlayer.hitFlash=1;
    } else if (chainTarget.id !== uid && chainTarget.alive && !chainTarget.shieldActive) {
      chainTarget.hp = Math.max(0, chainTarget.hp-10);
      chainTarget.hitFlash=1;
    }
  }
}

function checkWinCondition() {
  if (!isHost) return;
  const aliveRemote = Object.values(remotePlayers).filter(p=>p.alive).length;
  const localAlive = myPlayer && myPlayer.alive ? 1 : 0;
  const totalAlive = aliveRemote + localAlive;
  if (totalAlive <= 1) {
    const winner = localAlive ? uid : (Object.values(remotePlayers).find(p=>p.alive)?.id || uid);
    if (roomRef) {
      roomRef.child('meta').update({state:'ended', winnerId:winner});
    } else {
      endGame(winner);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 10. ZONE
// ═══════════════════════════════════════════════════════════════
function updateZone(dt, now) {
  const phase = G.ZONE_PHASES[Math.min(zone.phase, G.ZONE_PHASES.length-1)];
  if (zone.phase === 0) {
    zone.phaseTimer += dt*1000;
    if (zone.phaseTimer >= phase.dur) {
      zone.phase=1; zone.phaseTimer=0;
      zone.targetR = G.ZONE_PHASES[1].r;
      showNotif('⚡ Zone contracting!');
    }
  } else if (zone.phase < G.ZONE_PHASES.length) {
    zone.phaseTimer += dt*1000;
    const phaseDur = phase.dur;
    zone.displayR += (zone.targetR - zone.displayR) * Math.min(1, dt*0.5);
    if (zone.phaseTimer >= phaseDur) {
      const next = zone.phase+1;
      zone.phase = next;
      zone.phaseTimer = 0;
      if (next < G.ZONE_PHASES.length) {
        zone.targetR = G.ZONE_PHASES[next].r;
        showNotif(`⚡ Zone Phase ${next} — increasing damage!`);
      }
    }
  }
  // Host broadcasts zone occasionally
  if (isHost && roomRef && Math.random()<0.06) {
    roomRef.child('zone').set({cx:zone.cx,cy:zone.cy,r:zone.displayR,phase:zone.phase,phaseTimer:zone.phaseTimer});
  }
}

// ═══════════════════════════════════════════════════════════════
// 11. POWER-UPS
// ═══════════════════════════════════════════════════════════════
function updatePowerUps(now) {
  if (!myPlayer || !myPlayer.alive) return;
  for (const pu of powerUps) {
    if (!pu.active) continue;
    if (Math.hypot(myPlayer.x-pu.x, myPlayer.y-pu.y) < myPlayer.radius+16) {
      collectPowerUp(pu);
    }
    pu.rot = (pu.rot||0) + 0.02;
  }
}

function collectPowerUp(pu) {
  pu.active = false;
  playSound('pickup');
  spawnParticles(pu.x, pu.y, '#ffff00', 12);
  switch(pu.type) {
    case 'health': myPlayer.hp = Math.min(myPlayer.maxHp, myPlayer.hp+40); showNotif('+40 HP'); break;
    case 'pulse': myPlayer.pulseCd=0; showNotif('Pulse Recharged!'); break;
    case 'shield': myPlayer.shieldCd=0; showNotif('Shield Recharged!'); break;
    case 'surge': myPlayer.surgeCd=0; showNotif('Surge Recharged!'); break;
    case 'chain': myPlayer.chainAmp=true; showNotif('Chain Amp — next kill splashes!'); break;
  }
  if (roomRef) roomRef.child(`powerUps/${pu.id}`).update({active:false, respawnAt:Date.now()+20000});
  // Respawn
  setTimeout(()=>{ 
    pu.active=true;
    pu.type = G.PU_TYPES[Math.floor(Math.random()*G.PU_TYPES.length)];
    if (roomRef) roomRef.child(`powerUps/${pu.id}`).update({active:true,type:pu.type});
  }, 20000);
}

// ═══════════════════════════════════════════════════════════════
// 12. ABILITIES
// ═══════════════════════════════════════════════════════════════
function activatePulse() {
  const p = myPlayer;
  if (!p||!p.alive||p.pulseCd>0) return;
  p.pulseCd = G.PULSE_CD; p.energy -= 30;
  playSound('pulse');
  // Clear nearby remote trails
  const cr = G.PULSE_R;
  for (const rp of Object.values(remotePlayers)) {
    if (!rp.trail) continue;
    rp.trail = rp.trail.filter(pt=>Math.hypot(pt.x-p.x,pt.y-p.y)>cr);
    // Stun
    if (Math.hypot(rp.x-p.x, rp.y-p.y) < cr) {
      rp.stunTimer = G.PULSE_STUN;
      if (roomRef) roomRef.child(`players/${rp.id}`).update({stunUntil:Date.now()+G.PULSE_STUN});
    }
  }
  // Visual shockwave
  spawnShockwave(p.x, p.y, cr, p.hue);
  showNotif('💥 PULSE!');
}

function activateShield() {
  const p = myPlayer;
  if (!p||!p.alive||p.shieldCd>0||p.shieldActive) return;
  p.shieldCd=G.SHIELD_CD; p.shieldActive=true;
  p.shieldTimer=G.SHIELD_DUR; p.energy-=25;
  playSound('shield');
  showNotif('🛡️ Shield activated!');
}

function activateSurge() {
  const p = myPlayer;
  if (!p||!p.alive||p.surgeCd>0||p.surgeActive) return;
  p.surgeCd=G.SURGE_CD; p.surgeActive=true;
  p.surgeTimer=G.SURGE_DUR; p.energy-=35;
  playSound('surge');
  showNotif('⚡ SURGE!');
}

// ═══════════════════════════════════════════════════════════════
// 13. PARTICLES & EFFECTS
// ═══════════════════════════════════════════════════════════════
function spawnParticles(x,y,color,count) {
  for(let i=0;i<count;i++) {
    const angle = Math.random()*Math.PI*2;
    const speed = Math.random()*150+50;
    particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,color,life:1,size:Math.random()*3+1});
  }
}

function spawnDeathParticles(x,y,hue) {
  for(let i=0;i<25;i++) {
    const angle=Math.random()*Math.PI*2, spd=Math.random()*200+80;
    particles.push({x,y,vx:Math.cos(angle)*spd,vy:Math.sin(angle)*spd,
      color:`hsl(${hue},100%,60%)`,life:1,size:Math.random()*5+2});
  }
}

function spawnShockwave(x,y,maxR,hue) {
  lightnings.push({type:'wave',x,y,hue,maxR,r:0,life:1});
}

function updateParticles(dt) {
  for(let i=particles.length-1;i>=0;i--) {
    const p=particles[i];
    p.x+=p.vx*dt; p.y+=p.vy*dt;
    p.vx*=Math.pow(0.15,dt); p.vy*=Math.pow(0.15,dt);
    p.life-=dt*2;
    if(p.life<=0) particles.splice(i,1);
  }
}

function updateLightnings(dt) {
  for(let i=lightnings.length-1;i>=0;i--) {
    const l=lightnings[i];
    l.life-=dt*3;
    if(l.type==='wave') l.r+=(l.maxR-l.r)*Math.min(1,dt*8);
    if(l.life<=0) lightnings.splice(i,1);
  }
}

// ═══════════════════════════════════════════════════════════════
// 14. RENDERER
// ═══════════════════════════════════════════════════════════════
function render() {
  if(!ctx||!canvas) return;
  ctx.save();
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Background
  ctx.fillStyle = '#000510';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // Camera transform + shake
  const cx = Math.round(camera.x + shakeX);
  const cy = Math.round(camera.y + shakeY);
  ctx.translate(-cx,-cy);

  // Grid
  drawGrid(ctx,cx,cy);
  // Stars
  drawStars(ctx);
  // Zone shadow (area outside safe zone)
  drawZoneShadow(ctx);
  // Power-ups
  drawPowerUps(ctx);
  // Trails
  drawAllTrails(ctx);
  // Remote players
  for(const rp of Object.values(remotePlayers)) {
    if(rp.alive) drawPlayer(ctx,rp,false);
  }
  // Local player
  if(myPlayer&&myPlayer.alive) drawPlayer(ctx,myPlayer,true);
  // Bullets
  drawBullets(ctx);
  // Particles
  drawParticles(ctx);
  // Lightnings
  drawLightnings(ctx);
  // Zone wall
  drawZoneWall(ctx);
  // Zone warning overlay (when outside)
  if(myPlayer&&myPlayer.alive) {
    const d=Math.hypot(myPlayer.x-zone.cx, myPlayer.y-zone.cy);
    if(d>zone.displayR) {
      ctx.restore();
      const ratio=Math.min((d-zone.displayR)/200,1);
      ctx.fillStyle=`rgba(255,20,20,${ratio*0.28})`;
      ctx.fillRect(0,0,canvas.width,canvas.height);
      return;
    }
  }

  ctx.restore();
}

function drawGrid(ctx,cx,cy) {
  ctx.save();
  ctx.strokeStyle='rgba(0,60,180,0.07)';
  ctx.lineWidth=1;
  const step=100;
  const sx=Math.floor(cx/step)*step;
  const sy=Math.floor(cy/step)*step;
  for(let x=sx;x<cx+canvas.width+step;x+=step) {
    ctx.beginPath(); ctx.moveTo(x,cy); ctx.lineTo(x,cy+canvas.height); ctx.stroke();
  }
  for(let y=sy;y<cy+canvas.height+step;y+=step) {
    ctx.beginPath(); ctx.moveTo(cx,y); ctx.lineTo(cx+canvas.width,y); ctx.stroke();
  }
  ctx.restore();
}

function drawStars(ctx) {
  ctx.save();
  for(const s of backgroundStars) {
    ctx.beginPath();
    ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,255,255,${s.a})`;
    ctx.fill();
  }
  ctx.restore();
}

function drawZoneShadow(ctx) {
  const r = zone.displayR;
  ctx.save();
  // Draw dark overlay outside zone
  ctx.fillStyle='rgba(0,0,10,0.5)';
  ctx.fillRect(0,0,G.WORLD,G.WORLD);
  ctx.globalCompositeOperation='destination-out';
  ctx.beginPath();
  ctx.arc(zone.cx,zone.cy,r,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.5)';
  ctx.fill();
  ctx.globalCompositeOperation='source-over';
  ctx.restore();
}

function drawZoneWall(ctx) {
  const r=zone.displayR;
  ctx.save();
  const now=Date.now();
  ctx.beginPath();
  const segs=64;
  for(let i=0;i<=segs;i++) {
    const a=(i/segs)*Math.PI*2;
    const noise=Math.sin(a*7+now*0.003)*4+Math.sin(a*13+now*0.005)*2;
    const x=zone.cx+Math.cos(a)*(r+noise);
    const y=zone.cy+Math.sin(a)*(r+noise);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath();
  ctx.strokeStyle=`rgba(0,220,255,${0.7+Math.sin(now*0.005)*0.3})`;
  ctx.lineWidth=3;
  ctx.shadowColor='#00ddff';
  ctx.shadowBlur=12;
  ctx.stroke();
  ctx.shadowBlur=0;
  ctx.restore();
}

function drawAllTrails(ctx) {
  ctx.save();
  const now=Date.now();
  const allTrailSources = [
    ...Object.values(remotePlayers).map(p=>({trail:p.trail,hue:p.hue,surgeActive:p.surgeActive}))
  ];
  if(myPlayer) allTrailSources.push({trail:myPlayer.trail,hue:myPlayer.hue,surgeActive:myPlayer.surgeActive});
  for(const {trail,hue,surgeActive} of allTrailSources) {
    if(!trail||trail.length<2) continue;
    for(let i=1;i<trail.length;i++) {
      const a=trail[i-1], b=trail[i];
      const age=now-b.t;
      if(age>G.TRAIL_MS) continue;
      const alpha=(1-age/G.TRAIL_MS)*0.9;
      const width=surgeActive ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle=`hsla(${hue},100%,60%,${alpha})`;
      ctx.shadowColor=`hsl(${hue},100%,70%)`;
      ctx.shadowBlur=surgeActive?12:6;
      ctx.lineWidth=width;
      ctx.lineCap='round';
      ctx.stroke();
    }
  }
  ctx.shadowBlur=0;
  ctx.restore();
}

function drawPlayer(ctx,p,isLocal) {
  ctx.save();
  const flash=p.hitFlash||0;
  if(flash>0) { ctx.filter=`brightness(${1+flash*3})`; }

  // Shield ring
  if(p.shieldActive) {
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.radius+8,0,Math.PI*2);
    ctx.strokeStyle=`rgba(0,200,255,0.7)`;
    ctx.lineWidth=3;
    ctx.shadowColor='#00ffff';
    ctx.shadowBlur=15;
    ctx.stroke();
    ctx.shadowBlur=0;
  }
  // Surge glow
  if(p.surgeActive) {
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.radius+4,0,Math.PI*2);
    ctx.strokeStyle=`rgba(255,255,0,0.6)`;
    ctx.lineWidth=2;
    ctx.shadowColor='#ffff00';
    ctx.shadowBlur=20;
    ctx.stroke();
    ctx.shadowBlur=0;
  }
  // Body
  ctx.beginPath();
  ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);
  ctx.fillStyle=flash>0?`rgba(255,255,255,${Math.min(1,flash)})`:p.color||`hsl(${p.hue},100%,60%)`;
  ctx.shadowColor=p.colorGlow||`hsl(${p.hue},100%,70%)`;
  ctx.shadowBlur=flash>0?20:10;
  ctx.fill();
  ctx.shadowBlur=0;
  // Direction indicator
  ctx.beginPath();
  ctx.moveTo(p.x+Math.cos(p.angle)*(p.radius-2), p.y+Math.sin(p.angle)*(p.radius-2));
  ctx.lineTo(p.x+Math.cos(p.angle)*(p.radius+6), p.y+Math.sin(p.angle)*(p.radius+6));
  ctx.strokeStyle='rgba(255,255,255,0.8)';
  ctx.lineWidth=2.5;
  ctx.stroke();
  // Name
  ctx.fillStyle=isLocal?'rgba(255,255,255,0.95)':'rgba(200,220,255,0.8)';
  ctx.font=`bold 11px Rajdhani,sans-serif`;
  ctx.textAlign='center';
  ctx.fillText(p.name, p.x, p.y-p.radius-5);
  // HP bar
  const bw=30, bh=3, bx=p.x-bw/2, by=p.y-p.radius-12;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(bx,by,bw,bh);
  const hpRatio=Math.max(0,p.hp/100);
  ctx.fillStyle=`hsl(${hpRatio*120},100%,55%)`; ctx.fillRect(bx,by,bw*hpRatio,bh);
  ctx.restore();
}

function drawBullets(ctx) {
  ctx.save();
  for(const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x,b.y,4,0,Math.PI*2);
    ctx.fillStyle=`hsl(${b.hue},100%,70%)`;
    ctx.shadowColor=`hsl(${b.hue},100%,80%)`;
    ctx.shadowBlur=10;
    ctx.fill();
    // Tail
    ctx.beginPath();
    ctx.moveTo(b.x,b.y);
    ctx.lineTo(b.x-b.vx*0.04, b.y-b.vy*0.04);
    ctx.strokeStyle=`hsla(${b.hue},100%,70%,0.5)`;
    ctx.lineWidth=2;
    ctx.stroke();
  }
  ctx.shadowBlur=0;
  ctx.restore();
}

function drawPowerUps(ctx) {
  ctx.save();
  const now=Date.now();
  const puColors={health:'#00ff88',pulse:'#00ffff',shield:'#8888ff',surge:'#ffff00',chain:'#ff88ff'};
  for(const pu of powerUps) {
    if(!pu.active) continue;
    const c=puColors[pu.type]||'#ffffff';
    const rot=(pu.rot||0)+now*0.001;
    const pulse=1+Math.sin(now*0.003+pu.x)*0.15;
    ctx.save();
    ctx.translate(pu.x,pu.y);
    ctx.rotate(rot);
    ctx.scale(pulse,pulse);
    ctx.beginPath();
    // Diamond shape
    ctx.moveTo(0,-14); ctx.lineTo(10,0); ctx.lineTo(0,14); ctx.lineTo(-10,0);
    ctx.closePath();
    ctx.fillStyle=c+'44';
    ctx.strokeStyle=c;
    ctx.shadowColor=c;
    ctx.shadowBlur=15;
    ctx.lineWidth=2;
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.shadowBlur=0;
  ctx.restore();
}

function drawParticles(ctx) {
  ctx.save();
  for(const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2);
    // Use globalAlpha for particle fade (color may be hsl or hex)
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur=0;
  ctx.restore();
}

function drawLightnings(ctx) {
  ctx.save();
  for(const l of lightnings) {
    if(l.type==='wave') {
      ctx.beginPath();
      ctx.arc(l.x,l.y,l.r,0,Math.PI*2);
      ctx.strokeStyle=`hsla(${l.hue},100%,70%,${l.life*0.6})`;
      ctx.shadowColor=`hsl(${l.hue},100%,70%)`;
      ctx.shadowBlur=15;
      ctx.lineWidth=3*l.life;
      ctx.stroke();
    } else {
      // Zigzag bolt
      const segs=8;
      const dx=(l.x2-l.x1)/segs, dy=(l.y2-l.y1)/segs;
      ctx.beginPath(); ctx.moveTo(l.x1,l.y1);
      for(let i=1;i<segs;i++) {
        ctx.lineTo(l.x1+dx*i+(Math.random()-0.5)*18, l.y1+dy*i+(Math.random()-0.5)*18);
      }
      ctx.lineTo(l.x2,l.y2);
      ctx.strokeStyle=`rgba(255,255,255,${l.life})`;
      ctx.shadowColor='#00ffff';
      ctx.shadowBlur=12;
      ctx.lineWidth=2;
      ctx.stroke();
    }
  }
  ctx.shadowBlur=0;
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// 15. MINIMAP
// ═══════════════════════════════════════════════════════════════
function renderMinimap() {
  if(!mmCtx) return;
  const s=100, scale=s/G.WORLD;
  mmCtx.clearRect(0,0,s,s);
  mmCtx.fillStyle='rgba(0,5,20,0.85)';
  mmCtx.fillRect(0,0,s,s);
  // Zone
  mmCtx.beginPath();
  mmCtx.arc(zone.cx*scale,zone.cy*scale,zone.displayR*scale,0,Math.PI*2);
  mmCtx.strokeStyle='rgba(0,200,255,0.6)'; mmCtx.lineWidth=1; mmCtx.stroke();
  // Remote players
  for(const rp of Object.values(remotePlayers)) {
    if(!rp.alive) continue;
    mmCtx.beginPath();
    mmCtx.arc(rp.x*scale,rp.y*scale,3,0,Math.PI*2);
    mmCtx.fillStyle=`hsl(${rp.hue},100%,60%)`; mmCtx.fill();
  }
  // Local player
  if(myPlayer&&myPlayer.alive) {
    mmCtx.beginPath();
    mmCtx.arc(myPlayer.x*scale,myPlayer.y*scale,4,0,Math.PI*2);
    mmCtx.fillStyle='#ffffff'; mmCtx.fill();
  }
  // Power-ups
  for(const pu of powerUps) {
    if(!pu.active) continue;
    mmCtx.beginPath();
    mmCtx.arc(pu.x*scale,pu.y*scale,2,0,Math.PI*2);
    mmCtx.fillStyle='#ffff44'; mmCtx.fill();
  }
}

// ═══════════════════════════════════════════════════════════════
// 16. HUD UPDATE
// ═══════════════════════════════════════════════════════════════
function updateHUD() {
  if(!myPlayer) return;
  const p=myPlayer;
  // HP
  el('hp-fill').style.width=`${Math.max(0,p.hp)}%`;
  el('hp-fill').style.background=p.hp<25?'var(--danger)':p.hp<50?'var(--warn)':'';
  el('hp-val').textContent=Math.round(Math.max(0,p.hp));
  el('en-fill').style.width=`${p.energy}%`;
  el('en-val').textContent=Math.round(p.energy);
  el('hud-kills').textContent=`${p.kills} kill${p.kills!==1?'s':''}`;
  el('hud-score').textContent=`${p.score} pts`;
  // Abilities
  updateAbilityUI('pulse',p.pulseCd,G.PULSE_CD);
  updateAbilityUI('shield',p.shieldCd,G.SHIELD_CD);
  updateAbilityUI('surge',p.surgeCd,G.SURGE_CD);
  // Zone timer
  const elapsed=Date.now()-gameStartTime;
  const total=G.ZONE_PHASES.reduce((a,z)=>a+z.dur,0);
  const rem=Math.max(0,total-elapsed)/1000;
  const mins=Math.floor(rem/60),secs=Math.floor(rem%60);
  el('zone-timer').textContent=`${mins}:${secs.toString().padStart(2,'0')}`;
  el('zone-phase').textContent=zone.phase===0?'Zone stable':`Zone Phase ${zone.phase}`;
  // Players alive
  const alive=Object.values(remotePlayers).filter(r=>r.alive).length+(p.alive?1:0);
  el('players-alive').textContent=`${alive} alive`;
}

function updateAbilityUI(name,cd,maxCd) {
  const cdEl=document.getElementById(`ab-${name}-cd`);
  const fillEl=document.getElementById(`ab-${name}-fill`);
  const mbFill=document.getElementById(`mb-${name}-fill`);
  const ratio=cd>0?cd/maxCd:0;
  const pct=ratio*100;
  if(cdEl) { cdEl.style.display=cd>0?'flex':'none'; cdEl.textContent=Math.ceil(cd/1000); }
  if(fillEl) fillEl.style.height=pct+'%';
  if(mbFill) mbFill.style.height=pct+'%';
}

function addKillFeedEntry(killerName, victimName, killerHue, victimHue) {
  const kf=el('kill-feed');
  const div=document.createElement('div');
  div.className='kf-entry';
  div.innerHTML=`<span style="color:hsl(${killerHue},100%,65%)">${escHtml(killerName)}</span> <span style="color:#666">⚡</span> <span style="color:hsl(${victimHue},100%,65%)">${escHtml(victimName)}</span>`;
  kf.appendChild(div);
  setTimeout(()=>div.remove(),4000);
  if(kf.children.length>5) kf.removeChild(kf.firstChild);
}

// ═══════════════════════════════════════════════════════════════
// 17. REMOTE INTERPOLATION
// ═══════════════════════════════════════════════════════════════
function updateRemoteInterp(dt) {
  for(const rp of Object.values(remotePlayers)) {
    if(!rp.tx) continue;
    rp.x += (rp.tx - rp.x) * Math.min(1, dt*12);
    rp.y += (rp.ty - rp.y) * Math.min(1, dt*12);
    if(rp.tangle!==undefined) {
      let da = rp.tangle - rp.angle;
      while(da>Math.PI) da-=Math.PI*2;
      while(da<-Math.PI) da+=Math.PI*2;
      rp.angle += da * Math.min(1, dt*10);
    }
    if(rp.hitFlash>0) rp.hitFlash-=dt*3;
    if(rp.stunTimer>0) rp.stunTimer-=dt*1000;
  }
}

// ═══════════════════════════════════════════════════════════════
// 18. SYNC
// ═══════════════════════════════════════════════════════════════
function syncGame() {
  if(!myPlayer||!roomRef) return;
  const now=Date.now();
  const p=myPlayer;
  // Position sync
  roomRef.child(`players/${uid}`).update({
    x:Math.round(p.x), y:Math.round(p.y),
    angle:+p.angle.toFixed(3), hp:Math.round(p.hp),
    alive:p.alive, kills:p.kills, score:p.score,
    updatedAt:now
  });
  // Trail sync
  if(now-lastTrailSyncTime > G.TRAIL_SYNC_MS) {
    const encoded=encodeTrailPts(p.trail);
    if(encoded) roomRef.child(`trails/${uid}`).set({pts:encoded,t:now});
    lastTrailSyncTime=now;
  }
}

// ═══════════════════════════════════════════════════════════════
// 19. CHAT
// ═══════════════════════════════════════════════════════════════
// Fix: allow sending chat from waiting room (when myPlayer may be null)
function sendChat(text, panelId) {
  if(!text || !text.trim() || !roomRef) return;
  // Build message with best available name/hue
  const name = getPlayerName();
  const hue = (myPlayer && myPlayer.hue) || (remotePlayers[uid] && remotePlayers[uid].hue) || 180;
  const msg={uid, name:name, text:text.trim(), t:Date.now(), hue:hue};
  roomRef.child('chat').push(msg);
}

function addChatMessage(msg) {
  // In-game overlay
  const co=el('chat-overlay-msgs');
  if(co) {
    const d=document.createElement('div');
    d.className='co-msg';
    d.innerHTML=`<span style="color:hsl(${msg.hue||180},100%,65%);font-weight:700">${escHtml(msg.name)}</span> <span style="color:#ccc">${escHtml(msg.text)}</span>`;
    co.appendChild(d);
    setTimeout(()=>{try{d.remove()}catch(e){}},6000);
    while(co.children.length>10) co.removeChild(co.firstChild);
  }
  // Waiting room chat
  const wc=el('wait-chat-msgs');
  if(wc) {
    const d=document.createElement('div');
    d.className='chat-msg';
    d.innerHTML=`<span class="cn" style="color:hsl(${msg.hue||180},100%,65%)">${escHtml(msg.name)}</span><span class="ct">${escHtml(msg.text)}</span>`;
    wc.appendChild(d);
    wc.scrollTop=wc.scrollHeight;
    while(wc.children.length>80) wc.removeChild(wc.firstChild);
  }
}

function addSystemMsg(text) {
  const wc=el('wait-chat-msgs');
  if(wc) {
    const d=document.createElement('div');
    d.className='chat-msg system'; d.textContent=text;
    wc.appendChild(d); wc.scrollTop=wc.scrollHeight;
  }
}

// ═══════════════════════════════════════════════════════════════
// 20. VOICE CHAT (WebRTC)
// ═══════════════════════════════════════════════════════════════
class VoiceChat {
  constructor() {
    this.stream=null; this.muted=false;
    this.peers={}; // uid→{pc, stream}
    this.iceServers=[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun1.l.google.com:19302'}
    ];
  }
  async start() {
    try {
      this.stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      this.muted=false;
      this._listenSignals();
      // Create offers to all existing players
      for(const pid of Object.keys(remotePlayers)) {
        if(pid>uid) await this._createOffer(pid); // lexicographic tie-break
      }
      el('mute-btn').textContent='🎤 On';
      return true;
    } catch(e) {
      showNotif('Microphone not available'); return false;
    }
  }
  toggleMute() {
    this.muted=!this.muted;
    if(this.stream) this.stream.getAudioTracks().forEach(t=>t.enabled=!this.muted);
    const btn=el('mute-btn');
    btn.textContent=this.muted?'🔇 Muted':'🎤 On';
    btn.classList.toggle('muted',this.muted);
  }
  async _createOffer(targetId) {
    if(!roomRef||!this.stream) return;
    const pc=this._newPC(targetId);
    this.stream.getTracks().forEach(t=>pc.addTrack(t,this.stream));
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    roomRef.child(`vc/${uid}/${targetId}/offer`).set(JSON.stringify(offer));
  }
  _newPC(peerId) {
    const pc=new RTCPeerConnection({iceServers:this.iceServers});
    this.peers[peerId]={pc};
    pc.onicecandidate=e=>{
      if(e.candidate&&roomRef) roomRef.child(`vc/${uid}/${peerId}/ice`).push(JSON.stringify(e.candidate));
    };
    pc.ontrack=e=>{
      const audio=new Audio();
      audio.srcObject=e.streams[0];
      audio.play().catch(()=>{});
      this.peers[peerId].stream=e.streams[0];
      this._updateVCUI();
    };
    return pc;
  }
  _listenSignals() {
    if(!roomRef) return;
    // Listen for offers TO me
    roomRef.child(`vc`).on('child_added', async snap=>{
      const fromId=snap.key;
      if(fromId===uid) return;
      const data=snap.val()||{};
      if(data[uid]?.offer && !this.peers[fromId]) {
        const pc=this._newPC(fromId);
        if(this.stream) this.stream.getTracks().forEach(t=>pc.addTrack(t,this.stream));
        await pc.setRemoteDescription(JSON.parse(data[uid].offer));
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        roomRef.child(`vc/${uid}/${fromId}/answer`).set(JSON.stringify(answer));
        // ICE candidates
        roomRef.child(`vc/${fromId}/${uid}/ice`).on('child_added',async s=>{
          try { await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(s.val()))); } catch(e){}
        });
      }
    });
    // Listen for answers to my offers
    roomRef.child(`vc/${uid}`).on('child_changed', async snap=>{
      const toId=snap.key;
      const data=snap.val()||{};
      if(data.answer && this.peers[toId]?.pc) {
        const pc=this.peers[toId].pc;
        if(pc.signalingState==='have-local-offer') {
          await pc.setRemoteDescription(JSON.parse(data.answer));
          roomRef.child(`vc/${toId}/${uid}/ice`).on('child_added',async s=>{
            try { await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(s.val()))); } catch(e){}
          });
        }
      }
    });
  }
  _updateVCUI() {
    const panel=el('vc-players');
    if(!panel) return;
    let html='';
    for(const [pid,peer] of Object.entries(this.peers)) {
      const rp=remotePlayers[pid]||{};
      html+=`<div class="vc-player" id="vc-${pid}">
        <div class="vc-dot" style="background:hsl(${rp.hue||180},100%,60%)"></div>
        <span style="font-size:0.7rem">${escHtml(rp.name||'...')}</span>
      </div>`;
    }
    panel.innerHTML=html;
  }
  cleanup() {
    for(const {pc} of Object.values(this.peers)) try{pc.close()}catch(e){}
    if(this.stream) this.stream.getTracks().forEach(t=>t.stop());
    this.peers={}; this.stream=null;
    if(roomRef) roomRef.child(`vc/${uid}`).remove();
  }
}

// ═══════════════════════════════════════════════════════════════
// 21. DEATH & RESPAWN
// ═══════════════════════════════════════════════════════════════
function killLocalPlayer() {
  if(!myPlayer||!myPlayer.alive) return;
  myPlayer.alive=false; myPlayer.hp=0;
  spawnDeathParticles(myPlayer.x,myPlayer.y,myPlayer.hue);
  playSound('death');
  if(roomRef) roomRef.child(`players/${uid}`).update({alive:false,hp:0});
  checkWinCondition();
  // Show respawn overlay
  const overlay=el('respawn-overlay');
  overlay.classList.add('active');
  let t=G.RESPAWN_DELAY/1000;
  const timerEl=el('resp-timer');
  const timerEl2=el('resp-timer2');
  const iv=setInterval(()=>{
    t=Math.max(0,t-1);
    if(timerEl) timerEl.textContent=t;
    if(timerEl2) timerEl2.textContent=t;
    if(t<=0) { clearInterval(iv); respawnPlayer(); }
  },1000);
  // Watch for "watch ad" button
  el('resp-ad-btn').onclick=()=>{
    clearInterval(iv);
    // Simulate rewarded ad (replace with actual ad SDK call)
    showRewardedAdDialog(()=>{clearInterval(iv);respawnPlayer(true);});
  };
}

function respawnPlayer(instant=false) {
  el('respawn-overlay').classList.remove('active');
  if(!myPlayer) return;
  const idx=Math.floor(Math.random()*G.SPAWNS.length);
  const spawn=G.SPAWNS[idx];
  myPlayer.x=spawn.x; myPlayer.y=spawn.y;
  myPlayer.vx=0; myPlayer.vy=0;
  myPlayer.hp=100; myPlayer.alive=true;
  myPlayer.trail=[];
  if(roomRef) roomRef.child(`players/${uid}`).update({alive:true,hp:100,x:spawn.x,y:spawn.y});
}

// ═══════════════════════════════════════════════════════════════
// 22. GAME END
// ═══════════════════════════════════════════════════════════════
function endGame(winnerId) {
  if(!gameRunning) return;
  gameRunning=false;
  cancelAnimationFrame(animId);
  clearInterval(syncInterval);
  stopLocalPlay();
  // Stop bots AI timers (host side)
  if (isHost) stopAllBotAI();
  // Build round stats
  const allPlayers=[
    {id:uid,name:getPlayerName(),hue:myPlayer?.hue||180,kills:myPlayer?.kills||0,score:myPlayer?.score||0,alive:myPlayer?.alive||false},
    ...Object.values(remotePlayers).map(rp=>({id:rp.id,name:rp.name,hue:rp.hue,kills:rp.kills||0,score:rp.score||0,alive:rp.alive||false}))
  ];
  allPlayers.sort((a,b)=>b.score-a.score||b.kills-a.kills);
  roundStats=allPlayers;
  const winner=allPlayers.find(p=>p.id===winnerId)||allPlayers[0];
  showResults(winner,allPlayers);
}

function showResults(winner, players) {
  el('winner-name').textContent=winner?.name||'—';
  const rows=el('results-rows');
  rows.innerHTML=players.map((p,i)=>{
    const rankClass=i===0?'r1':i===1?'r2':i===2?'r3':'';
    const survMs=p.alive?(Date.now()-gameStartTime):(Date.now()-gameStartTime);
    const survS=Math.floor(survMs/1000);
    const survStr=`${Math.floor(survS/60)}m${(survS%60).toString().padStart(2,'0')}s`;
    return `<div class="rt-row">
      <span class="rt-rank ${rankClass}">${i+1}</span>
      <span class="rt-name-cell"><span class="rt-dot" style="background:hsl(${p.hue},100%,60%)"></span>${escHtml(p.name)}${p.id===uid?' (you)':''}</span>
      <span>${p.kills}</span>
      <span>${p.score}</span>
      <span>${survStr}</span>
    </div>`;
  }).join('');
  el('hud').style.display='none';
  el('mobile-controls').style.display='none';
  showScreen('s-results');
  // Ad
  try{(adsbygoogle=window.adsbygoogle||[]).push({});}catch(e){}
}

// ═══════════════════════════════════════════════════════════════
// 23. COUNTDOWN
// ═══════════════════════════════════════════════════════════════
function startCountdown(n) {
  const countdownEl = el('countdown');
  const numEl = el('countdown-num');
  if (countdownEl && countdownEl.classList) countdownEl.classList.add('active');
  let count = n || 3;
  if (numEl) numEl.textContent = count;
  const iv = setInterval(() => {
    count--;
    if (count > 0) {
      if (numEl) {
        numEl.style.animation = 'none';
        void numEl.offsetWidth;
        numEl.style.animation = 'cdPop 0.6s ease forwards';
        numEl.textContent = count;
      }
    } else {
      clearInterval(iv);
      if (numEl) numEl.textContent = 'GO!';
      setTimeout(() => {
        if (countdownEl && countdownEl.classList) countdownEl.classList.remove('active');
      }, 800);
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
// 24. MONETIZATION
// ═══════════════════════════════════════════════════════════════
function showRewardedAdDialog(onComplete) {
  // Implement with your ad SDK (e.g., Google IMA, AdSense rewarded units)
  // Placeholder: simulate ad for testing
  const msg = document.createElement('div');
  msg.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem;color:#fff;font-family:Orbitron,sans-serif';
  msg.innerHTML = '<div style="font-size:1.2rem;color:#ffaa00">⚡ Rewarded Ad</div><div style="color:#888;font-size:0.85rem">Ad would play here (integrate your ad SDK)</div><div id="ad-countdown" style="font-size:2rem;color:#fff">30</div><button onclick="this.parentElement.remove()" style="margin-top:1rem;padding:10px 24px;background:#ffaa00;color:#000;border:none;border-radius:8px;font-family:Orbitron;cursor:pointer;display:none" id="ad-close">Claim Reward ▶</button>';
  document.body.appendChild(msg);
  let t = 5; // in production: 30 seconds
  const iv = setInterval(() => {
    t--;
    const adCountdown = el('ad-countdown');
    if (adCountdown) adCountdown.textContent = t;
    if (t <= 0) {
      clearInterval(iv);
      const adClose = el('ad-close');
      if (adClose) {
        adClose.style.display = 'block';
        adClose.onclick = () => { msg.remove(); onComplete?.(); };
      }
    }
  }, 1000);
}

el('rewarded-ad-btn').addEventListener('click',()=>{
  showRewardedAdDialog(()=>{
    preChargedAbilities.pulse=true;
    preChargedAbilities.shield=true;
    showNotif('🎁 Power Pack earned — Pulse & Shield pre-charged!');
  });
});

// ═══════════════════════════════════════════════════════════════
// 25. INPUT HANDLING
// ═══════════════════════════════════════════════════════════════
window.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  keys[k]=true;
  if(k==='q') activatePulse();
  if(k==='e') activateShield();
  if(k==='r') activateSurge();
  if(k==='enter'||k==='t') toggleGameChat();
  if(e.code==='Space') e.preventDefault();
});
window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });
window.addEventListener('mousemove',e=>{ mouseX=e.clientX; mouseY=e.clientY; });
window.addEventListener('resize',resizeCanvas);

// Ability buttons (desktop HUD)
el('ab-pulse-btn').addEventListener('click',activatePulse);
el('ab-shield-btn').addEventListener('click',activateShield);
el('ab-surge-btn').addEventListener('click',activateSurge);

// Mobile ability buttons
el('mb-pulse').addEventListener('touchstart',e=>{e.preventDefault();activatePulse();});
el('mb-shield').addEventListener('touchstart',e=>{e.preventDefault();activateShield();});
el('mb-surge').addEventListener('touchstart',e=>{e.preventDefault();activateSurge();});

// Joystick
const jOuter=el('joystick-outer');
const jInner=el('joystick-inner');
jOuter.addEventListener('touchstart',e=>{
  e.preventDefault();
  const t=e.changedTouches[0];
  joystickTouchId=t.identifier;
  updateJoy(t.clientX, t.clientY, jOuter);
},{passive:false});
document.addEventListener('touchmove',e=>{
  if(joystickTouchId===null) return;
  for(const t of e.changedTouches) {
    if(t.identifier===joystickTouchId) { e.preventDefault(); updateJoy(t.clientX,t.clientY,jOuter); break; }
  }
},{passive:false});
document.addEventListener('touchend',e=>{
  for(const t of e.changedTouches) {
    if(t.identifier===joystickTouchId) {
      joystickTouchId=null;
      joy={dx:0,dy:0,active:false};
      jInner.style.transform='translate(-50%,-50%)';
      break;
    }
  }
});
function updateJoy(cx,cy,outer) {
  const rect=outer.getBoundingClientRect();
  const ox=rect.left+rect.width/2, oy=rect.top+rect.height/2;
  let dx=cx-ox, dy=cy-oy;
  const dist=Math.hypot(dx,dy), maxR=35;
  if(dist>maxR){dx=dx/dist*maxR;dy=dy/dist*maxR;}
  jInner.style.transform=`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  joy={dx:dx/maxR, dy:dy/maxR, active:Math.hypot(dx,dy)>5};
}

function toggleGameChat() {
  const wrap=el('chat-input-wrap');
  const isOpen=wrap.classList.contains('open');
  wrap.classList.toggle('open');
  if(!isOpen) { el('chat-game-input').focus(); }
}

el('chat-game-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){
    const inp=e.target;
    sendChat(inp.value,'game');
    inp.value='';
    el('chat-input-wrap').classList.remove('open');
    e.preventDefault();
  }
  if(e.key==='Escape') el('chat-input-wrap').classList.remove('open');
  e.stopPropagation();
});
el('chat-send-btn').addEventListener('click',()=>{
  const inp=el('chat-game-input');
  sendChat(inp.value,'game');
  inp.value='';
  el('chat-input-wrap').classList.remove('open');
});
el('chat-toggle-btn').addEventListener('click',toggleGameChat);

// Waiting room chat
el('wait-chat-send').addEventListener('click',()=>{
  const inp=el('wait-chat-input');
  sendChat(inp.value,'wait');
  inp.value='';
});
el('wait-chat-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'){sendChat(e.target.value,'wait');e.target.value='';e.preventDefault();}
});

// Voice
el('mute-btn').addEventListener('click',()=>{
  if(!voiceChat) {
    voiceChat=new VoiceChat();
    voiceChat.start();
  } else {
    voiceChat.toggleMute();
  }
});


let localMode = false;
let localBotTimer = null;

function stopLocalPlay() {
  localMode = false;
  if (localBotTimer) {
    clearInterval(localBotTimer);
    localBotTimer = null;
  }
}

function startLocalPlay() {
  try { cleanupGame(); } catch (e) {}
  stopLocalPlay();
  localMode = true;
  isHost = true;
  roomRef = null;
  roomCode = `LOCAL-${genRoomCode()}`;
  uid = `local_${genRoomCode()}`;
  remotePlayers = {};
  bullets = [];
  particles = [];
  lightnings = [];
  powerUps = buildPowerUps();
  zone = {cx:1500,cy:1500,r:G.ZONE_PHASES[0].r,targetR:G.ZONE_PHASES[0].r,displayR:G.ZONE_PHASES[0].r,phase:0,phaseTimer:0};

  const spawn = G.SPAWNS[1] || G.SPAWNS[0];
  const botId = 'bot_local';
  remotePlayers[botId] = {
    id: botId,
    name: 'CPU',
    hue: G.HUES[1] || 180,
    x: spawn.x,
    y: spawn.y,
    tx: spawn.x,
    ty: spawn.y,
    tangle: Math.PI,
    angle: Math.PI,
    hp: 100,
    maxHp: 100,
    kills: 0,
    score: 0,
    alive: true,
    radius: G.PLAYER_R,
    shieldActive: false,
    surgeActive: false,
    shieldTimer: 0,
    surgeTimer: 0,
    shieldCd: 0,
    surgeCd: 0,
    fireCd: 0,
    trail: [],
    hitFlash: 0,
    stunTimer: 0,
    chainAmp: false
  };

  beginGame(Date.now());
  showNotif('Local battle started');
  startLocalBotAI(botId);
}

function startLocalBotAI(botId) {
  if (localBotTimer) clearInterval(localBotTimer);
  localBotTimer = setInterval(() => {
    if (!gameRunning || !myPlayer) return;
    const bot = remotePlayers[botId];
    if (!bot || !bot.alive) return;

    const target = myPlayer;
    let dx = target.x - bot.x + (Math.random() - 0.5) * 70;
    let dy = target.y - bot.y + (Math.random() - 0.5) * 70;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    bot.angle = Math.atan2(ny, nx);
    const moveSpeed = G.PLAYER_SPEED * 0.78;
    bot.x = clamp(bot.x + nx * moveSpeed * 0.12, bot.radius, G.WORLD - bot.radius);
    bot.y = clamp(bot.y + ny * moveSpeed * 0.12, bot.radius, G.WORLD - bot.radius);
    bot.tx = bot.x;
    bot.ty = bot.y;
    bot.tangle = bot.angle;

    const now = Date.now();
    bot.trail.push({ x: bot.x, y: bot.y, t: now });
    bot.trail = bot.trail.filter(pt => now - pt.t < G.TRAIL_MS);

    bot.fireCd = Math.max(0, (bot.fireCd || 0) - 120);
    if (bot.fireCd <= 0) {
      fireBullet(bot);
      bot.fireCd = G.FIRE_RATE * (0.7 + Math.random() * 0.7);
    }

    if (!bot.shieldActive && Math.random() < 0.006) {
      bot.shieldActive = true;
      bot.shieldTimer = G.SHIELD_DUR;
      bot.shieldCd = G.SHIELD_CD;
    }
    if (bot.shieldActive) {
      bot.shieldTimer -= 120;
      if (bot.shieldTimer <= 0) bot.shieldActive = false;
    }

    checkWinCondition();
  }, 120);
}

async function tryOnlineQuickMatch() {
  try {
    if (!initFirebase()) return false;
    if (!uid) {
      try { await signIn(); } catch (e) { return false; }
    }
    const code = await quickMatch();
    enterWaitingRoom(code);
    if (isHost) {
      setTimeout(() => {
        const btn = document.getElementById('btn-start');
        if (btn) btn.click();
      }, 300);
    }
    return true;
  } catch (e) {
    console.warn('Quick match failed, falling back to local play.', e);
    return false;
  }
}

async function tryOnlineCreateRoom() {
  try {
    if (!initFirebase()) return false;
    if (!uid) {
      try { await signIn(); } catch (e) { return false; }
    }
    const code = await createRoom(false);
    enterWaitingRoom(code);
    return true;
  } catch (e) {
    console.warn('Create room failed, falling back to local play.', e);
    return false;
  }
}

async function tryOnlineJoinRoom(code) {
  try {
    if (!initFirebase()) return false;
    if (!uid) {
      try { await signIn(); } catch (e) { return false; }
    }
    const ok = await joinRoom(code);
    if (ok) enterWaitingRoom(code);
    return !!ok;
  } catch (e) {
    console.warn('Join room failed, falling back to local play.', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 26. ROOM MANAGEMENT UI
// ═══════════════════════════════════════════════════════════════
el('btn-quickmatch').addEventListener('click',async()=>{
  const name=getPlayerName();
  if(!name){showNotif('Enter your name first!');return;}
  setLoadingMsg('Finding match...');
  try{
    const code=await quickMatch();
    enterWaitingRoom(code);
  }catch(e){showNotif('Could not connect. Check Firebase config.');}
});

el('btn-create').addEventListener('click',async()=>{
  const name=getPlayerName();
  if(!name){showNotif('Enter your name first!');return;}
  try{
    const ok = await tryOnlineCreateRoom();
    if (!ok) startLocalPlay();
  }catch(e){
    showNotif('Starting local battle.');
    startLocalPlay();
  }
});

// Current landing page buttons from public/index.html
el('btn-quick').addEventListener('click', async () => {
  const ok = await tryOnlineQuickMatch();
  if (!ok) startLocalPlay();
});

el('btn-join').addEventListener('click', async () => {
  const code = el('join-code').value.trim().toUpperCase();
  if (!code) {
    showNotif('Enter a room code');
    return;
  }
  const ok = await tryOnlineJoinRoom(code);
  if (!ok) {
    showNotif('Starting local battle.');
    startLocalPlay();
  }
});


el('btn-join-open').addEventListener('click',()=>{
  const row=el('join-row');
  row.style.display=row.style.display==='none'?'flex':'none';
});

el('btn-join-go').addEventListener('click',async()=>{
  const code=el('join-code').value.trim().toUpperCase();
  if(code.length<4){showNotif('Enter room code');return;}
  const ok=await joinRoom(code);
  if(ok) enterWaitingRoom(code);
});

function enterWaitingRoom(code) {
  roomCode=code;
  el('room-code-display').textContent=code;
  history.replaceState(null,'',`?room=${code}`);
  listenRoom(code);
  showScreen('s-waiting');
  addSystemMsg(`Joined room ${code}. Invite link: ${window.location.href}`);
}

el('btn-copy-link').addEventListener('click',()=>{
  const url=`${location.origin}${location.pathname}?room=${roomCode}`;
  navigator.clipboard?.writeText(url).then(()=>showNotif('Invite link copied!')).catch(()=>{
    prompt('Copy this link:',url);
  });
});

async function ensureBotIfNeeded() {
  if (!roomRef) return null;
  try {
    const snap = await roomRef.child('players').once('value');
    const ps = snap.val() || {};
    const humanCount = Object.keys(ps).filter(id=>!id.startsWith('bot_')).length;
    if (humanCount < 2) {
      // create single bot
      const botId = 'bot_'+genId();
      const count = Object.keys(ps).length;
      const hue = G.HUES[Math.min(count, G.HUES.length-1)];
      const spawn = G.SPAWNS[Math.min(count, G.SPAWNS.length-1)];
      const botName = 'CPU-'+botId.slice(4,8).toUpperCase();
      await roomRef.child(`players/${botId}`).set({
        id:botId, name:botName, hue:hue, x:spawn.x, y:spawn.y, angle:0, hp:100, kills:0, score:0, alive:true, updatedAt:Date.now(), isBot:true
      });
      // bots should not be removed by onDisconnect
      showNotif('No players found — bot has joined');
      return botId;
    }
  } catch(e){}
  return null;
}

el('btn-start').addEventListener('click',async()=>{
  if(!isHost||!roomRef) return;
  // If only host or <MIN_TO_START human players, add a bot first
  let botId = null;
  try {
    botId = await ensureBotIfNeeded();
  } catch(e){}
  await roomRef.child('meta').update({state:'countdown',countdown:3,startedAt:Date.now()});
  setTimeout(async()=>{
    await roomRef.child('meta').update({state:'playing', seed:Date.now()});
    // If bot was created, start bot AI (host controls bots)
    if (botId && isHost) startBotAI(botId);
  },3200);
});

el('btn-leave').addEventListener('click',leaveRoom);
el('btn-leave2').addEventListener('click',leaveRoom);
el('btn-menu-from-results').addEventListener('click',()=>{
  cleanupGame(); showScreen('s-menu');
});
el('btn-play-again').addEventListener('click',()=>{
  if(roomRef&&isHost) {
    roomRef.child('meta').update({state:'waiting'});
    showScreen('s-waiting');
  } else {
    cleanupGame(); showScreen('s-menu');
  }
});

function leaveRoom() {
  if(roomRef&&uid) roomRef.child(`players/${uid}`).remove();
  cleanupGame();
  showScreen('s-menu');
  history.replaceState(null,'',window.location.pathname);
}

function cleanupGame() {
  gameRunning=false;
  if(animId) cancelAnimationFrame(animId);
  if(syncInterval) clearInterval(syncInterval);
  stopLocalPlay();
  if(roomRef) { roomRef.off(); roomRef=null; }
  if(voiceChat) { voiceChat.cleanup(); voiceChat=null; }
  // stop and remove bots if host
  if (isHost) {
    stopAllBotAI();
    if (roomCode && db) {
      // remove bot players from DB to keep rooms clean
      db.ref(`rooms/${roomCode}/players`).once('value').then(snap=>{
        const players = snap.val() || {};
        for (const pid of Object.keys(players)) {
          if (pid && pid.startsWith('bot_')) {
            db.ref(`rooms/${roomCode}/players/${pid}`).remove().catch(()=>{});
          }
        }
      }).catch(()=>{});
    }
  }
  myPlayer=null; remotePlayers={}; bullets=[]; particles=[]; lightnings=[]; powerUps=[];
  el('hud').style.display='none';
  el('mobile-controls').style.display='none';
}

el('share-score-btn').addEventListener('click',()=>{
  const myStats=roundStats.find(p=>p.id===uid)||{kills:0,score:0};
  const rank=(roundStats.findIndex(p=>p.id===uid))+1;
  const text=`I ranked #${rank} in Volt Surge with ${myStats.kills} kills! ⚡ Free multiplayer game → ${location.origin}`;
  if(navigator.share) { navigator.share({title:'Volt Surge',text,url:location.origin}).catch(()=>{}); }
  else { navigator.clipboard?.writeText(text).then(()=>showNotif('Score copied! Share it!')).catch(()=>prompt('Share this:',text)); }
});

// ═══════════════════════════════════════════════════════════════
// 27. UTILS
// ═══════════════════════════════════════════════════════════════
function showScreen(id) {
  const screenIds = ['s-menu', 's-waiting', 's-game', 's-results'];
  for (const sid of screenIds) {
    const node = document.getElementById(sid);
    if (!node) continue;
    if (sid === id) {
      node.style.display = sid === 's-game' ? 'block' : 'block';
      node.classList.add('active');
    } else {
      node.style.display = 'none';
      node.classList.remove('active');
    }
  }
  const target = document.getElementById(id);
  if (target && target.classList) target.classList.add('active');
}

function showNotif(text, duration=3000) {
  const stack=el('notif-stack');
  const el=document.createElement('div');
  el.className='notif'; el.textContent=text;
  stack.appendChild(el);
  setTimeout(()=>{try{el.remove()}catch(e){}},duration+500);
}

function setLoadingMsg(msg) {
  const node = el('loading-msg');
  if (node) node.textContent = msg;
}

function getPlayerName() {
  const inp=el('player-name');
  return (inp?.value||'').trim()||('Player'+(Math.floor(Math.random()*9000)+1000));
}

function isMobile() { return /Mobi|Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent)||window.innerWidth<768; }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function genId() { return Math.random().toString(36).slice(2,10); }

function distToSeg(px,py,x1,y1,x2,y2) {
  const dx=x2-x1, dy=y2-y1;
  const len2=dx*dx+dy*dy;
  if(len2===0) return Math.hypot(px-x1,py-y1);
  const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/len2));
  return Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
}

// ═══════════════════════════════════════════════════════════════
// 28. STARTUP
// ═══════════════════════════════════════════════════════════════
async function init() {
  setLoadingMsg('Starting engine...');
  initAudio();

  setLoadingMsg('Connecting to server...');
  let fbOk = false;
  try {
    fbOk = initFirebase();
  } catch (e) {
    fbOk = false;
  }

  if (fbOk) {
    try {
      await signIn();
      setLoadingMsg('Authenticated!');
    } catch (e) {
      setLoadingMsg('Offline local play mode');
    }
  } else {
    setLoadingMsg('Offline local play mode');
  }

  // Check URL for room code (invite links)
  const urlRoom = new URLSearchParams(window.location.search).get('room');

  setTimeout(async () => {
    showScreen('s-menu');
    if (urlRoom && fbOk) {
      showNotif(`Joining room ${urlRoom.toUpperCase()}...`);
      const ok = await joinRoom(urlRoom);
      if (ok) enterWaitingRoom(urlRoom.toUpperCase());
    } else if (urlRoom && !fbOk) {
      showNotif('Invite link detected, but Firebase is unavailable. Use Quick Match for local play.');
    }
  }, 100);
}

// Prevent mobile scroll/zoom during game
document.addEventListener('touchmove',e=>{
  if(gameRunning) e.preventDefault();
},{passive:false});

document.addEventListener('contextmenu',e=>e.preventDefault());

// Initialize
init();


// ═══════════════════════════════════════════════════════════════
// ---------- BOT AI (host-side) ---------------------------------
// Small, non-intrusive AI controlled by host. Creates natural movement + firing.
// ═════════════════════════════════════════════════════════════==
function startBotAI(botId) {
  if (!botAIEnabled || !isHost || !roomRef || botTimers[botId]) return;
  // tick AI at ~120ms
  const tickMs = 120;
  botTimers[botId] = setInterval(async ()=>{
    try {
      const snap = await roomRef.child(`players/${botId}`).once('value');
      const bot = snap.val();
      if (!bot) { clearInterval(botTimers[botId]); delete botTimers[botId]; return; }
      // Pick target: nearest human player based on players list (exclude bots)
      const playersSnap = await roomRef.child('players').once('value');
      const players = playersSnap.val() || {};
      const humans = Object.values(players).filter(p=>p && !p.id.startsWith('bot_') && p.id!==botId);
      const target = humans.length ? humans.reduce((a,b)=>{
        const da = Math.hypot(a.x - bot.x, a.y - bot.y);
        const db = Math.hypot(b.x - bot.x, b.y - bot.y);
        return db < da ? b : a;
      }, humans[0]) : null;
      let newX = bot.x, newY = bot.y;
      const speed = G.PLAYER_SPEED * 0.85;
      if (target) {
        // Add slight randomness to movement to make bots feel more human.
        let dx = target.x - bot.x;
        let dy = target.y - bot.y;
        // Jitter so bots don't follow perfectly straight lines
        dx += (Math.random() - 0.5) * 80;
        dy += (Math.random() - 0.5) * 80;
        const d = Math.hypot(dx,dy) || 1;
        const nx = dx / d;
        const ny = dy / d;
        // Vary speed slightly to simulate hesitation
        const varSpeed = speed * (0.85 + Math.random() * 0.3);
        newX = Math.max(G.PLAYER_R, Math.min(G.WORLD-G.PLAYER_R, bot.x + nx * varSpeed * (tickMs/1000)));
        newY = Math.max(G.PLAYER_R, Math.min(G.WORLD-G.PLAYER_R, bot.y + ny * varSpeed * (tickMs/1000)));
        const angle = Math.atan2(ny, nx);
        // Update bot position/angle in DB
        await roomRef.child(`players/${botId}`).update({
          x: Math.round(newX),
          y: Math.round(newY),
          angle: +angle.toFixed(3),
          updatedAt: Date.now()
        });
        // Make bots fire unpredictably: sometimes delay firing, sometimes burst
        const fireChance = 0.1 + Math.random() * 0.15;
        if (Math.random() < fireChance) {
          const bId = genId();
          const vx = Math.cos(angle) * G.BULLET_SPEED;
          const vy = Math.sin(angle) * G.BULLET_SPEED;
          await roomRef.child(`bullets/${bId}`).set({
            x: bot.x + Math.cos(angle) * G.PLAYER_R,
            y: bot.y + Math.sin(angle) * G.PLAYER_R,
            vx,
            vy,
            ownerId: botId,
            hue: bot.hue,
            damage: G.BULLET_DAMAGE,
            id: bId
          });
        }
      } else {
        // wander randomly with gentle noise
        const wanderAngle = Math.random() * Math.PI * 2;
        // Slight speed variation for wandering
        const wanderSpeed = speed * (0.5 + Math.random() * 0.5);
        newX = Math.max(G.PLAYER_R, Math.min(G.WORLD - G.PLAYER_R, bot.x + Math.cos(wanderAngle) * wanderSpeed * (tickMs / 1000)));
        newY = Math.max(G.PLAYER_R, Math.min(G.WORLD - G.PLAYER_R, bot.y + Math.sin(wanderAngle) * wanderSpeed * (tickMs / 1000)));
        await roomRef.child(`players/${botId}`).update({
          x: Math.round(newX),
          y: Math.round(newY),
          angle: +wanderAngle.toFixed(3),
          updatedAt: Date.now()
        });
        // Occasionally fire while wandering
        if (Math.random() < 0.08) {
          const bId = genId();
          const vx = Math.cos(wanderAngle) * G.BULLET_SPEED;
          const vy = Math.sin(wanderAngle) * G.BULLET_SPEED;
          await roomRef.child(`bullets/${bId}`).set({
            x: bot.x + Math.cos(wanderAngle) * G.PLAYER_R,
            y: bot.y + Math.sin(wanderAngle) * G.PLAYER_R,
            vx,
            vy,
            ownerId: botId,
            hue: bot.hue,
            damage: G.BULLET_DAMAGE,
            id: bId
          });
        }
      }
    } catch(e) {
      // ignore transient DB errors
    }
  }, tickMs);
}

function stopAllBotAI() {
  for (const id of Object.keys(botTimers)) {
    try { clearInterval(botTimers[id]); } catch(e){}
    delete botTimers[id];
  }
}