'use strict';
const STANDARD_ICONS = [
  { id: 'icon1',  img: 'icons/icon-01.png',  glyph: '🍒' },
  { id: 'icon2',  img: 'icons/icon-02.png',  glyph: '🍋' },
  { id: 'icon3',  img: 'icons/icon-03.png',  glyph: '🍊' },
  { id: 'icon4',  img: 'icons/icon-04.png',  glyph: '🍇' },
  { id: 'icon5',  img: 'icons/icon-05.png',  glyph: '🍉' },
  { id: 'icon6',  img: 'icons/icon-06.png',  glyph: '🔔' },
  { id: 'icon7',  img: 'icons/icon-07.png',  glyph: '🍀' },
  { id: 'icon8',  img: 'icons/icon-08.png',  glyph: '💎' },
  { id: 'icon9',  img: 'icons/icon-09.png',  glyph: '7️⃣' },
  { id: 'icon10', img: 'icons/icon-10.png', glyph: '👑' },
];
const WILD    = { id: 'wild',    img: 'icons/wild.png',    glyph: '🃏' };
const SCATTER = { id: 'scatter', img: 'icons/scatter.png', glyph: '⭐' };

/* win sound asstes */
const SOUNDS = {
  shit: 'sounds/shitwin.mp3',
  mid:  'sounds/midwin.mp3',
  epic: 'sounds/epicwin.mp3',
};

/* gifs assest */
const GIF_LEFT  = 'gifs/left.gif';
const GIF_RIGHT = 'gifs/right.gif';

/* mehcanic settings */
const REELS = 5, ROWS = 3;
const PAYOUT = { 3: 3, 4: 6, 5: 9 };   // points by chain length
const SCATTER_BONUS = 2;               // 3+ scatters anywhere
const WEIGHT = { standard: 10, wild: 3, scatter: 3 };

const WIN_TIERS = [                    
  { name: 'epic', min: 7, label: 'Epic win!', ms: 4500 },
  { name: 'mid',  min: 4, label: 'Mid win!',  ms: 2000 },
  { name: 'shit', min: 1, label: 'Shit win!', ms: 1800 },
];

/* localstorage lockgin system */
const LOCK_STREAK = 5;            // same-tier wins in a row that trigger a lock
const LOCK_SCORE_STEP = 100;      // lock each time total score passes another multiple of this
const LOSS_BREAKS_STREAK = false; // true = a spin with no win also resets the streak
const STORAGE_KEY = 'epicSlot.v1';
const MIN = 60 * 1000;
const LOCKS = {
  shit: { lines: ['hokimu elek bro', 'matio'],     ms: 3 * MIN, img: 'images/lock-shit.png' },
  mid:  { lines: ['hokimu biasa aja', 'matio'],             ms: 3 * MIN, img: 'images/lock-mid.png' },
  epic: { lines: ['hokimu kok bagus?', 'kamu buzzer?'],   ms: 1 * MIN, img: 'images/lock-epic.png' },
  rest: { lines: ['kamu mainnya udah lama', 'mending istirahat'],              ms: 5 * MIN, img: 'images/lock-rest.png' },
};

/* state dom */
const $ = (id) => document.getElementById(id);
const state = {
  score: 0, counts: { shit: 0, mid: 0, epic: 0 },
  streak: { tier: null, count: 0 }, milestone: 0, lock: null,   // lock = { type, until }
  busy: false, paused: false,
};
const reelEls = [];   // reelEls[reel][row] -> cell element
let grid = [];        // grid[reel][row]    -> icon

/* pausable timer */
function wait(ms) {
  return new Promise((resolve) => {
    let left = ms, last = performance.now();
    (function frame(now) {
      if (!state.paused) left -= now - last;
      last = now;
      left <= 0 ? resolve() : requestAnimationFrame(frame);
    })(last);
  });
}

/* icon rdender */
function iconHTML(icon) {
  if (!icon.img) return `<span>${icon.glyph}</span>`;
  return `<img src="${icon.img}" alt="${icon.id}" draggable="false" ` +
    `onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${icon.glyph}'}))">`;
}
function setCell(el, icon) { el.innerHTML = iconHTML(icon); }

const POOL = [
  ...STANDARD_ICONS.flatMap((i) => Array(WEIGHT.standard).fill(i)),
  ...Array(WEIGHT.wild).fill(WILD),
  ...Array(WEIGHT.scatter).fill(SCATTER),
];
const randomIcon = () => POOL[Math.floor(Math.random() * POOL.length)];

/* buidl board */
function buildBoard() {
  const wrap = $('reels');
  for (let r = 0; r < REELS; r++) {
    const reel = document.createElement('div');
    reel.className = 'reel';
    reelEls[r] = [];
    for (let row = 0; row < ROWS; row++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      setCell(cell, randomIcon());
      reel.appendChild(cell);
      reelEls[r][row] = cell;
    }
    wrap.appendChild(reel);
  }
  grid = reelEls.map((reel) => reel.map(() => randomIcon()));
  grid.forEach((reel, r) => reel.forEach((icon, row) => setCell(reelEls[r][row], icon)));

  // icon list popup
  STANDARD_ICONS.forEach((icon) => {
    const c = document.createElement('div');
    c.className = 'cell';
    setCell(c, icon);
    $('standardIcons').appendChild(c);
  });
  setCell($('scatterIcon'), SCATTER);
  setCell($('wildIcon'), WILD);

  // side gifs
  if (GIF_LEFT)  $('gifLeftImg').src = GIF_LEFT;
  if (GIF_RIGHT) $('gifRightImg').src = GIF_RIGHT;
}

/* win eval */
function evaluate(g) {
  let points = 0;
  const winCells = [];                       // [reel,row]
  const icons = new Map();                   // icons in saud reel
  let wildUsed = false, scatterUsed = false;

  for (const sym of STANDARD_ICONS) {
    // walk reels left→right from reel 1; a reel continues the chain if it has the symbol or a wild
    let len = 0, realSeen = false, wildHere = false;
    const cells = [];
    for (let r = 0; r < REELS; r++) {
      const real = g[r].map((ic, row) => (ic.id === sym.id ? row : -1)).filter((x) => x >= 0);
      const wilds = g[r].map((ic, row) => (ic.id === 'wild' ? row : -1)).filter((x) => x >= 0);
      if (!real.length && !wilds.length) break;
      len++;
      if (real.length) { realSeen = true; real.forEach((row) => cells.push([r, row])); }
      else { wildHere = true; wilds.forEach((row) => cells.push([r, row])); }
    }
    if (len >= 3 && realSeen) {
      points += PAYOUT[len];
      winCells.push(...cells);
      icons.set(sym.id, sym);
      if (wildHere) wildUsed = true;
    }
  }

  // scatter: anywhere on the grid
  const scatters = [];
  g.forEach((reel, r) => reel.forEach((ic, row) => { if (ic.id === 'scatter') scatters.push([r, row]); }));
  if (scatters.length >= 3) {
    points += SCATTER_BONUS;
    winCells.push(...scatters);
    scatterUsed = true;
  }

  if (wildUsed) icons.set('wild', WILD);
  if (scatterUsed) icons.set('scatter', SCATTER);
  return { points, winCells, icons: [...icons.values()], scatterUsed };
}

const tierFor = (pts) => WIN_TIERS.find((t) => pts >= t.min);

/* save */
function save() {
  const { score, counts, streak, milestone, lock } = state;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ score, counts, streak, milestone, lock })); } catch (e) {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (d) Object.assign(state, {
      score: d.score || 0,
      counts: Object.assign({ shit: 0, mid: 0, epic: 0 }, d.counts),
      streak: d.streak || { tier: null, count: 0 },
      milestone: d.milestone || 0,
      lock: d.lock || null,
    });
  } catch (e) {}
}
function updateHud() {
  $('score').textContent = state.score;
  $('shitCount').textContent = state.counts.shit;
  $('midCount').textContent = state.counts.mid;
  $('epicCount').textContent = state.counts.epic;
}

/* locking */
let lockInterval = null;
const isLocked = () => !!state.lock && state.lock.until > Date.now();

/* returns 'shit' | 'mid' | 'epic' | 'rest' if this win triggers a lock, else null */
function checkLock(tierName) {
  const s = state.streak;
  state.streak = s.tier === tierName ? { tier: tierName, count: s.count + 1 } : { tier: tierName, count: 1 };
  let lock = null;
  const step = Math.floor(state.score / LOCK_SCORE_STEP);
  if (step > state.milestone) { state.milestone = step; lock = 'rest'; }
  else if (state.streak.count >= LOCK_STREAK) lock = tierName;
  if (lock) state.streak = { tier: null, count: 0 };
  return lock;
}

function startLock(type, until = Date.now() + LOCKS[type].ms) {
  const cfg = LOCKS[type];
  state.lock = { type, until };
  save();
  hidePopup();
  $('fx').innerHTML = '';
  $('lockMsg').innerHTML = cfg.lines.map((l) => `<span>${l}</span>`).join('');
  const img = $('lockImg');
  img.style.visibility = 'hidden';
  img.onload = () => (img.style.visibility = 'visible');
  img.onerror = () => (img.style.visibility = 'hidden');   // no picture yet -> plain white box
  img.src = cfg.img;
  $('lockOverlay').hidden = false;
  $('spinBtn').disabled = true;
  tickLock();
  clearInterval(lockInterval);
  lockInterval = setInterval(tickLock, 250);
}

function tickLock() {
  if (!state.lock) return;
  const left = state.lock.until - Date.now();
  if (left <= 0) return endLock();
  const sec = Math.ceil(left / 1000);
  $('lockTimer').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

function endLock() {
  clearInterval(lockInterval);
  state.lock = null;
  save();
  $('lockOverlay').hidden = true;
  if (!state.busy) $('spinBtn').disabled = false;
}

/* spinngin */
async function spin() {
  if (state.busy || state.paused || isLocked()) return;
  state.busy = true;
  $('spinBtn').disabled = true;
  hidePopup();
  document.querySelectorAll('.cell.win').forEach((c) => c.classList.remove('win'));
  audio.unlock();

  const final = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, randomIcon));
  const reelNodes = document.querySelectorAll('.reel');
  const stopped = Array(REELS).fill(false);

  reelNodes.forEach((el) => el.classList.add('spinning'));
  const shuffler = setInterval(() => {
    if (state.paused) return;
    reelEls.forEach((reel, r) => { if (!stopped[r]) reel.forEach((c) => setCell(c, randomIcon())); });
  }, 90);

  await Promise.all(reelEls.map(async (reel, r) => {
    await wait(800 + r * 380);
    stopped[r] = true;
    reel.forEach((c, row) => setCell(c, final[r][row]));
    reelNodes[r].classList.remove('spinning');
  }));
  clearInterval(shuffler);
  grid = final;

  const result = evaluate(grid);
  if (result.points > 0) await celebrate(result);
  else if (LOSS_BREAKS_STREAK) { state.streak = { tier: null, count: 0 }; save(); }

  state.busy = false;
  $('spinBtn').disabled = isLocked();
}

/* win popup n effects */
async function celebrate({ points, winCells, icons, scatterUsed }) {
  const tier = tierFor(points);
  state.score += points;
  state.counts[tier.name]++;
  updateHud();

  winCells.forEach(([r, row]) => reelEls[r][row].classList.add('win'));

  // shenanigans
  const lock = checkLock(tier.name);
  save();
  if (lock) {
    await wait(900);            
    startLock(lock);
    return;
  }

  const pop = $('winPopup');
  pop.className = 'win-popup' + (tier.name === 'epic' ? ' epic' : '');
  pop.innerHTML = `${points} points won! ${tier.label}` +
    (scatterUsed ? `<small>includes +${SCATTER_BONUS} scatter bonus</small>` : '');
  pop.hidden = false;

  audio.play(tier.name);
  if (tier.name === 'epic') epicEffects(icons, tier.ms);
  await wait(tier.ms);
  hidePopup();
}

function hidePopup() { $('winPopup').hidden = true; }

function fxNode(icon, cls, size) {
  const el = document.createElement('div');
  el.className = cls;
  el.style.fontSize = size + 'px';
  el.innerHTML = iconHTML(icon);
  $('fx').appendChild(el);
  return el;
}

async function epicEffects(icons, ms) {
  const pick = () => icons[Math.floor(Math.random() * icons.length)];
  const fx = $('fx');
  const stepMs = 90;
  for (let t = 0; t < ms; t += stepMs) {
    // rain
    const d = fxNode(pick(), 'drop', 28 + Math.random() * 36);
    const dur = 2200 + Math.random() * 1800;
    d.style.left = Math.random() * 100 + 'vw';
    d.style.animationDuration = dur + 'ms';
    setTimeout(() => d.remove(), dur + 200);

    // fireworks — a burst every ~450ms
    if (Math.floor(t / stepMs) % 5 === 0) burst(pick, 10 + Math.random() * 80, 12 + Math.random() * 45);
    await wait(stepMs);
  }
  setTimeout(() => (fx.innerHTML = ''), 4500);
}

function burst(pick, xPct, yPct) {
  const n = 14, radius = 90 + Math.random() * 90;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = fxNode(pick(), 'spark', 22 + Math.random() * 14);
    s.style.left = xPct + 'vw';
    s.style.top = yPct + 'vh';
    s.style.setProperty('--dx', Math.cos(a) * radius + 'px');
    s.style.setProperty('--dy', Math.sin(a) * radius + 'px');
    setTimeout(() => s.remove(), 1000);
  }
}

/* sound placeholder */
const audio = {
  ctx: null,
  unlock() {
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  note(freq, start, dur, type = 'triangle', vol = 0.18) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
  },
  files: {},
  play(tier) {
    const src = SOUNDS[tier];
    if (src) {
      const f = this.files[tier] || (this.files[tier] = new Audio(src));
      f.currentTime = 0;
      f.play().catch(() => this.synth(tier));   // file missing/blocked -> built-in sound
      return;
    }
    this.synth(tier);
  },
  synth(tier) {
    if (tier === 'epic') return this.synthEpic();
    if (!this.ctx) return;
    const notes = tier === 'mid' ? [523, 659, 784] : [440, 523];
    notes.forEach((f, i) => this.note(f, i * 0.12, 0.25));
  },
  pauseAll(p) {
    Object.values(this.files).forEach((f) => {
      if (p) f.pause();
      else if (f.currentTime > 0 && !f.ended) f.play().catch(() => {});
    });
  },
  synthEpic() {
    if (!this.ctx) return;
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.note(f, i * 0.12, 0.35));
    [1319, 1568, 2093].forEach((f, i) => this.note(f, 1 + i * 0.1, 0.5, 'square', 0.06));
    // crackle
    for (let i = 0; i < 14; i++) this.note(800 + Math.random() * 2500, 0.9 + i * 0.22, 0.08, 'sawtooth', 0.04);
  },
};

/* popup pauses */
function setPaused(p) {
  state.paused = p;
  document.body.classList.toggle('paused', p);
  $('iconModal').hidden = !p;
  audio.pauseAll(p);
  if (p) $('closeBtn').focus(); else $('iconListBtn').focus();
}

/* init */
buildBoard();
load();
updateHud();
if (isLocked()) startLock(state.lock.type, state.lock.until);   // still locked after refresh
else if (state.lock) { state.lock = null; save(); }
$('spinBtn').addEventListener('click', spin);
$('iconListBtn').addEventListener('click', () => setPaused(true));
$('closeBtn').addEventListener('click', () => setPaused(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.paused) setPaused(false);
  if (e.code === 'Space' && !state.paused && e.target === document.body) { e.preventDefault(); spin(); }
});
