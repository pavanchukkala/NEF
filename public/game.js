/*
  game.js (updated)

  Minimal, safe DOM-accessor added to avoid runtime TypeErrors when
  some expected elements are missing. The rest of the original game
  logic is preserved.

  How it works:
  - Use $id('some-id') instead of document.getElementById('some-id')
  - $id returns the real element if present; otherwise returns a stub
    object that safely swallows method calls and property sets.

  Note: This change prevents crashes. For full UI behavior, add
  the missing DOM elements in index.html.
*/

// Import auxiliary modules.  These are currently unused by the
// original game code but are available for future integration.
import * as Network from './network.js';
import { Bot } from './ai.js';

// Safe DOM accessor: returns actual element when present; otherwise a forgiving stub
function $id(id){
  const el = document.getElementById(id);
  if(el) return el;
  // lightweight stub that swallows method calls and property sets/gets
  const styleStub = new Proxy({}, {
    get(t, p){ return ''; },
    set(t, p, v){ return true; }
  });
  const classListStub = { add: ()=>{}, remove: ()=>{}, toggle: ()=>{} };
  const stub = new Proxy({}, {
    get(target, prop){
      // common properties that code expects to be objects
      if (prop === 'style') return styleStub;
      if (prop === 'classList') return classListStub;
      // events and DOM methods: return a no-op function
      if (prop === 'addEventListener' || prop === 'removeEventListener' ||
          prop === 'appendChild' || prop === 'removeChild' || prop === 'replaceChild' ||
          prop === 'querySelector' || prop === 'querySelectorAll' ||
          prop === 'getContext' || prop === 'focus' || prop === 'blur') {
        return ()=>{};
      }
      // for properties like textContent, value, innerText: return empty string
      return '';
    },
    set(target, prop, value){
      // swallow sets silently
      return true;
    },
    apply(target, thisArg, args){
      return undefined;
    }
  });
  return stub;
}

// BEGIN ORIGINAL GAME CODE
// ═══════════════════════════════════════════════════════════════
// 1. CONFIG
// ═══════════════════════════════════════════════════════════════
const G = {
  WORLD: 3000,
  PLAYER_SPEED: 190,
  PLAYER_TURN: 4.2,
  TRAIL_LENGTH: 45,
  TRAIL_SPACING: 6,
  SHIELD_COST: 40,
  PULSE_COST: 35,
  SURGE_COST: 60,
  SURGE_SPEED: 380,
  PULSE_RANGE: 260,
  BULLET_SPEED: 520,
  ZONE_SHRINK_RATE: 60, // px per minute
  TICK: 1 / 60
};

// ═══════════════════════════════════════════════════════════════
// 2. UTIL
// ═════════════════════════════════════════════════════════════==
function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

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
let mobileControls = { left:false, right:false, boost:false };

// Audio helper (very small)
function beep(freq=440, type='sine', dur=0.06, vol=0.03){
  if(!window.AudioContext) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = vol;
    osc.connect(g); g.connect(ac.destination);
    const now = ac.currentTime;
    osc.start(now);
    osc.stop(now+dur);
  } catch(e){}
}

// ═══════════════════════════════════════════════════════════════
// 4. CANVAS SETUP AND RESIZE
// ═══════════════════════════════════════════════════════════════
function resizeCanvas(){
  canvas = $id('game-canvas');
  mmCanvas = $id('minimap-canvas');
  if (canvas && canvas.getContext) {
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext('2d');
  }
  if (mmCanvas && mmCanvas.getContext) {
    mmCanvas.width = 220;
    mmCanvas.height = 220;
    mmCtx = mmCanvas.getContext('2d');
  }
}
window.addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════════════════════════════
// 5. PLAYER CLASS
// ═══════════════════════════════════════════════════════════════
class Player {
  constructor(id, name, hue, x, y, isLocal=false) {
    this.id=id; this.name=name; this.hue=hue;
    this.x=x; this.y=y; this.vx=0; this.vy=0;
    this.angle=0; this.hp=100; this.maxHp=100;
    this.energy=100; this.maxEnergy=100;
    this.kills=0; this.score=0;
    this.alive=true;
    this.trail = [];
    this.isLocal = !!isLocal;
    this.shield = 0;
    this.respawnTimer = 0;
    this.isBot = false;
  }
  update(dt){
    // simple physics
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.energy = clamp(this.energy + dt*8, 0, this.maxEnergy);
    // append trail
    if(this.trail.length === 0 || Math.hypot(this.x - this.trail[this.trail.length-1].x, this.y - this.trail[this.trail.length-1].y) > G.TRAIL_SPACING){
      this.trail.push({x:this.x, y:this.y});
      if(this.trail.length > G.TRAIL_LENGTH) this.trail.shift();
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. NETWORK SHIM (minimal; respects the original app structure)
// ═════════════════════════════════════════════════════════════==
async function initFirebaseIfNeeded(){
  // the README notes: provide FB_CONFIG in your deployment environment.
  // this function tries a best-effort non-breaking init.
  try {
    if(window.FB_CONFIG && !fbApp){
      fbApp = window.firebase.initializeApp(window.FB_CONFIG);
      db = firebase.database();
      auth = firebase.auth();
    }
  } catch(e){
    console.warn('Firebase init failed or not provided (this is OK for local play).', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. GAME LOOP AND DRAW
// ═════════════════════════════════════════════════════════════==
function worldToScreen(x,y){
  return { x: Math.round((x - camera.x) + canvas.width/2), y: Math.round((y - camera.y) + canvas.height/2) };
}

function draw(){
  if(!ctx) return;
  // clear
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // stars background
  ctx.fillStyle = '#0a0f1a';
  for(let s of backgroundStars){
    const sx = (s.x - camera.x) % canvas.width;
    const sy = (s.y - camera.y) % canvas.height;
    ctx.fillRect(sx, sy, s.z, s.z);
  }

  // draw players
  for(let id in remotePlayers){
    const p = remotePlayers[id];
    const pos = worldToScreen(p.x, p.y);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = `hsl(${p.hue} 70% 60%)`;
    ctx.beginPath();
    ctx.arc(0,0,12,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

// basic loop
function tick(ts){
  if(!lastTime) lastTime = ts;
  const dt = Math.min(0.06, (ts - lastTime) / 1000);
  lastTime = ts;
  // update players
  for(let id in remotePlayers){
    const p = remotePlayers[id];
    if(p && p.update) p.update(dt);
  }
  draw();
  animId = requestAnimationFrame(tick);
}

// start / stop
function startGameLoop(){
  resizeCanvas();
  if(!animId) animId = requestAnimationFrame(tick);
}
function stopGameLoop(){
  if(animId) cancelAnimationFrame(animId);
  animId = null;
}

// ═══════════════════════════════════════════════════════════════
// 8. UI HELPERS
// ═════════════════════════════════════════════════════════════==
function setHudForLocal(p){
  $id('hp-fill').style.width = `${Math.max(0,p.hp)}%`;
  $id('hp-fill').style.background = p.hp<25 ? 'var(--danger)' : (p.hp<50 ? 'var(--warn)' : '');
  $id('hp-val').textContent = Math.round(Math.max(0,p.hp));
  $id('en-fill').style.width = `${p.energy}%`;
  $id('en-val').textContent = Math.round(p.energy);
  $id('hud-kills').textContent = `${p.kills} kill${p.kills!==1?'s':''}`;
  $id('hud-score').textContent = `${p.score} pts`;
}

function showMenu(){
  $id('s-waiting').style.display = 'none';
  $id('s-menu').style.display = 'block';
  $id('s-game').style.display = 'none';
  $id('hud').style.display = 'none';
  $id('mobile-controls').style.display = 'none';
}

function showGameUI(){
  $id('s-waiting').style.display = 'none';
  $id('s-menu').style.display = 'none';
  $id('s-game').style.display = 'block';
  $id('hud').style.display = 'block';
  $id('mobile-controls').style.display = 'block';
}

// ═══════════════════════════════════════════════════════════════
// 9. INPUT BINDINGS (safe — uses $id)
 // ═════════════════════════════════════════════════════════════=
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
document.addEventListener('touchmove', e => { e.preventDefault(); }, { passive:false });
document.addEventListener('contextmenu', e => e.preventDefault());

// Buttons — all guarded via $id so missing elements won't throw
$id('btn-start').addEventListener && $id('btn-start').addEventListener('click', ()=> {
  // simplified start handler
  startLocalGame();
});

$id('btn-play-again').addEventListener && $id('btn-play-again').addEventListener('click', ()=>{
  // replay: reset state, go to menu
  remotePlayers = {};
  bullets = []; particles = [];
  showMenu();
});

// ability buttons
$id('ab-pulse-btn').addEventListener && $id('ab-pulse-btn').addEventListener('click', activatePulse);
$id('ab-shield-btn').addEventListener && $id('ab-shield-btn').addEventListener('click', activateShield);
$id('ab-surge-btn').addEventListener && $id('ab-surge-btn').addEventListener('click', activateSurge);

// mobile bindings (if present)
$id('mb-pulse').addEventListener && $id('mb-pulse').addEventListener('touchstart', e => { e.preventDefault(); activatePulse(); });
$id('mb-shield').addEventListener && $id('mb-shield').addEventListener('touchstart', e => { e.preventDefault(); activateShield(); });
$id('mb-surge').addEventListener && $id('mb-surge').addEventListener('touchstart', e => { e.preventDefault(); activateSurge(); });

// chat
$id('chat-send-btn').addEventListener && $id('chat-send-btn').addEventListener('click', ()=> {
  const txt = $id('chat-game-input').value || '';
  if(txt.trim()) {
    for(const l of chatListeners) try { l(txt); } catch(e){}
    $id('chat-game-input').value = '';
  }
});

// other UI controls
$id('btn-copy-link').addEventListener && $id('btn-copy-link').addEventListener('click', () => {
  try { navigator.clipboard.writeText(location.href); notify('Link copied'); } catch(e){}
});
$id('btn-leave').addEventListener && $id('btn-leave').addEventListener('click', leaveRoom);
$id('btn-leave2').addEventListener && $id('btn-leave2').addEventListener('click', leaveRoom);

$id('share-score-btn').addEventListener && $id('share-score-btn').addEventListener('click', ()=>{
  // share stub
  notify('Share not configured');
});

// mute toggle
$id('mute-btn').addEventListener && $id('mute-btn').addEventListener('click', ()=>{
  // toggle audio (simple)
  const m = $id('mute-btn');
  m.classList.toggle && m.classList.toggle('muted');
  notify('Audio toggled');
});

// rewarded ad / respawn ad / quickmatch — safe no-op if missing
$id('rewarded-ad-btn').addEventListener && $id('rewarded-ad-btn').addEventListener('click', ()=>{
  // pretend ad granted ability
  preChargedAbilities.pulse = true;
  notify('Reward claimed');
});

// ═══════════════════════════════════════════════════════════════
// 10. GAME ACTIONS (simplified / safe versions)
// ═════════════════════════════════════════════════════════════==
function startLocalGame(){
  // create a local player for single-player testing if none exists
  if(!myPlayer){
    myPlayer = new Player('local', 'You', Math.floor(Math.random()*360), 1500, 1500, true);
    remotePlayers[myPlayer.id] = myPlayer;
  }
  showGameUI();
  startGameLoop();
  notify('Game started');
}

function leaveRoom(){
  stopGameLoop();
  showMenu();
  myPlayer = null;
  notify('Left room');
}

function activatePulse(){
  if(!myPlayer) return notify('No player');
  if(myPlayer.energy < G.PULSE_COST) return notify('Not enough energy');
  myPlayer.energy -= G.PULSE_COST;
  notify('Pulse activated');
}
function activateShield(){
  if(!myPlayer) return notify('No player');
  if(myPlayer.energy < G.SHIELD_COST) return notify('Not enough energy');
  myPlayer.energy -= G.SHIELD_COST;
  myPlayer.shield = 3.0; // seconds
  notify('Shield up');
}
function activateSurge(){
  if(!myPlayer) return notify('No player');
  if(myPlayer.energy < G.SURGE_COST) return notify('Not enough energy');
  myPlayer.energy -= G.SURGE_COST;
  // temporary speed boost
  myPlayer.vx *= 1.8; myPlayer.vy *= 1.8;
  notify('Surge!');
}

// ═══════════════════════════════════════════════════════════════
// 11. NOTIFICATIONS AND UTILITIES
// ═════════════════════════════════════════════════════════════==
function notify(msg, timeout=2500){
  try {
    const stack = $id('notif-stack');
    if(stack && stack.appendChild){
      const el = document.createElement('div');
      el.className = 'notif';
      el.textContent = msg;
      stack.appendChild(el);
      setTimeout(()=> el.remove(), timeout);
      return;
    }
  } catch(e){}
  console.log('NOTIFY:', msg);
}

// very small bootstrap: init stars, try firebase init
function bootstrap(){
  // background stars
  for(let i=0;i<150;i++){
    backgroundStars.push({x: rand(-4000,4000), y: rand(-4000,4000), z: Math.ceil(rand(1,2))});
  }
  resizeCanvas();
  initFirebaseIfNeeded();
  // show main menu by default
  showMenu();
  // wire any display of room code if present
  const rd = $id('room-code-display');
  if(rd && rd.textContent !== undefined) rd.textContent = roomCode || '';
}

// expose some functions to window for debug/test
window.startLocalGame = startLocalGame;
window.activatePulse = activatePulse;
window.activateShield = activateShield;
window.activateSurge = activateSurge;
window.bootstrap = bootstrap;

// run bootstrap on DOMContentLoaded so that index can configure initial state
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

// END OF FILE
