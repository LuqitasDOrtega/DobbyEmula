'use strict';

// ── Window controls ──────────────────────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click',   () => window.api.windowMinimize());
document.getElementById('btn-max').addEventListener('click',   () => window.api.windowMaximize());
document.getElementById('btn-close').addEventListener('click', () => window.api.windowClose());

// ── Menu system ───────────────────────────────────────────────────────────────
document.querySelectorAll('.menu-item > span').forEach(label => {
  label.addEventListener('click', e => {
    e.stopPropagation();
    const item = label.parentElement;
    const wasOpen = item.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) item.classList.add('open');
  });
});
document.addEventListener('click', closeAllMenus);
function closeAllMenus() {
  document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
}

// ── State ─────────────────────────────────────────────────────────────────────
let emujsPort        = 0;
let gameActive       = false;
let controlsPatcher  = null;
let activeCore       = null;
let activeRomName    = '';
let activeConsoleId  = '';
let currentSlot      = 1;
let filledSlots      = new Set();
let currentScreen    = 'home';   // 'home' | 'library' | 'game'
let currentConsoleId = null;     // console the user was browsing when they launched a game
let romLibrary          = [];    // array returned by scan-roms
let coverObserver       = null;  // IntersectionObserver for lazy cover loading
const coverLoadFns      = new WeakMap();
let librarySearchQuery  = '';
let libraryShowFavsOnly = false;
let librarySortOrder    = localStorage.getItem('dobbySortOrder') || 'az';

const screenHome    = document.getElementById('screen-home');
const screenLibrary = document.getElementById('screen-library');
const gameContainer = document.getElementById('game-container');
const statusLeft    = document.getElementById('status-left');
const statusRight   = document.getElementById('status-right');

// ── Screen navigation ─────────────────────────────────────────────────────────
function showScreen(name, consoleId) {
  screenHome.classList.toggle('hidden', name !== 'home');
  screenLibrary.classList.toggle('hidden', name !== 'library');
  gameContainer.classList.toggle('hidden', name !== 'game');
  currentScreen = name;
  if (name === 'library' && consoleId) {
    currentConsoleId = consoleId;
    renderLibrary(consoleId);
  } else if (name === 'home') {
    currentConsoleId = null;
  }
}

// ── Favorites ─────────────────────────────────────────────────────────────────
function isFav(consoleId, romName) {
  return localStorage.getItem(`dobbyfav_${consoleId}_${romName}`) === '1';
}
function toggleFav(consoleId, romName) {
  const key  = `dobbyfav_${consoleId}_${romName}`;
  const wasF = localStorage.getItem(key) === '1';
  if (wasF) localStorage.removeItem(key); else localStorage.setItem(key, '1');
  return !wasF;
}

// ── Library filter (search + favorites) ───────────────────────────────────────
function applyLibraryFilter() {
  const q      = librarySearchQuery.toLowerCase().trim();
  const cards  = document.querySelectorAll('#rom-grid .rom-card');
  let visible  = 0;
  let favTotal = 0;

  for (const card of cards) {
    const name = (card.dataset.romName || '').toLowerCase();
    const fav  = card.dataset.romFav === '1';
    if (fav) favTotal++;
    const show = (!q || name.includes(q)) && (!libraryShowFavsOnly || fav);
    card.classList.toggle('hidden', !show);
    if (show) visible++;
  }

  const total  = cards.length;
  const countEl = document.getElementById('library-count');
  if (libraryShowFavsOnly) {
    countEl.textContent = q
      ? `${visible} de ${favTotal} favorito${favTotal !== 1 ? 's' : ''}`
      : favTotal === 0 ? 'sin favoritos'
      : `${favTotal} favorito${favTotal !== 1 ? 's' : ''}`;
  } else {
    countEl.textContent = q
      ? `${visible} de ${total} juego${total !== 1 ? 's' : ''}`
      : `${total} juego${total !== 1 ? 's' : ''}`;
  }
}

// ── Console metadata ──────────────────────────────────────────────────────────
const CONSOLE_META = {
  genesis:      { topLine: 'SEGA',      bottomLine: 'GENESIS'  },
  snes:         { topLine: 'SUPER',     bottomLine: 'NINTENDO' },
  mastersystem: { topLine: 'MASTER',    bottomLine: 'SYSTEM'   },
  gba:          { topLine: 'GAME BOY',  bottomLine: 'ADVANCE'  },
  gbc:          { topLine: 'GAME BOY',  bottomLine: 'COLOR'    },
  gb:           { topLine: 'GAME BOY',  bottomLine: ''         },
  atari2600:    { topLine: 'ATARI',     bottomLine: '2600'     },
  nds:          { topLine: 'NINTENDO',  bottomLine: 'DS'       },
  psx:          { topLine: 'PLAY',      bottomLine: 'STATION'  },
};

// ── Cover art via libretro-thumbnails ─────────────────────────────────────────
const LIBRETRO_SYSTEMS = {
  genesis:      'Sega_-_Mega_Drive_-_Genesis',
  snes:         'Nintendo_-_Super_Nintendo_Entertainment_System',
  mastersystem: 'Sega_-_Master_System_-_Mark_III',
  gba:          'Nintendo_-_Game_Boy_Advance',
  gbc:          'Nintendo_-_Game_Boy_Color',
  gb:           'Nintendo_-_Game_Boy',
  atari2600:    'Atari_-_2600',
  nds:          'Nintendo_-_Nintendo_DS',
  psx:          'Sony_-_PlayStation',
};

// Limit concurrent cover fetches
let _activeCovers = 0;
const _coverQueue = [];
const MAX_COVER_CONCURRENT = 8;

function queueCoverFetch(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _activeCovers++;
      fn().then(
        v => { _activeCovers--; _drainCoverQueue(); resolve(v); },
        e => { _activeCovers--; _drainCoverQueue(); reject(e); }
      );
    };
    if (_activeCovers < MAX_COVER_CONCURRENT) run();
    else _coverQueue.push(run);
  });
}
function _drainCoverQueue() {
  while (_activeCovers < MAX_COVER_CONCURRENT && _coverQueue.length > 0) _coverQueue.shift()();
}

function blobToDataUrl(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

// Index of available thumbnails per system — fetched once from GitHub API and cached 7 days
const TREE_CACHE_TTL   = 7 * 24 * 60 * 60 * 1000;
const _treeCache       = new Map(); // system → Set<name> | null | Promise
const _treeFetchPromises = new Map();

async function getThumbnailTree(system) {
  if (_treeCache.has(system)) return _treeCache.get(system);
  if (_treeFetchPromises.has(system)) return _treeFetchPromises.get(system);

  const promise = (async () => {
    // Try localStorage first
    try {
      const stored = localStorage.getItem(`dobbytree_${system}`);
      if (stored) {
        const { ts, names } = JSON.parse(stored);
        if (Date.now() - ts < TREE_CACHE_TTL) {
          const s = new Set(names);
          _treeCache.set(system, s);
          _treeFetchPromises.delete(system);
          return s;
        }
      }
    } catch { /* ignore */ }

    // Fetch index from GitHub API (1 request per system, rate-limit friendly)
    try {
      const resp = await fetch(
        `https://api.github.com/repos/libretro-thumbnails/${system}/git/trees/HEAD?recursive=1`,
        { headers: { Accept: 'application/vnd.github.v3+json' } }
      );
      if (!resp.ok) throw new Error('api error');
      const data  = await resp.json();
      const names = (data.tree || [])
        .filter(f => f.path.startsWith('Named_Boxarts/') && f.path.endsWith('.png'))
        .map(f => f.path.slice('Named_Boxarts/'.length, -4));
      try { localStorage.setItem(`dobbytree_${system}`, JSON.stringify({ ts: Date.now(), names })); } catch { }
      const s = new Set(names);
      _treeCache.set(system, s);
      _treeFetchPromises.delete(system);
      return s;
    } catch {
      _treeCache.set(system, null); // API unavailable — fall back to HTTP guessing
      _treeFetchPromises.delete(system);
      return null;
    }
  })();

  _treeFetchPromises.set(system, promise);
  return promise;
}

function buildCoverCandidates(romName) {
  const list = [romName];

  // "The Foo (USA)" → "Foo, The (USA)"  — No-Intro stores articles at the end
  if (/^the\s/i.test(romName)) {
    const withoutThe = romName.slice(4);
    const parenIdx   = withoutThe.indexOf(' (');
    if (parenIdx >= 0) {
      const base = withoutThe.slice(0, parenIdx);
      const tags = withoutThe.slice(parenIdx);
      list.push(`${base}, The${tags}`);
    } else {
      list.push(`${withoutThe}, The`);
    }
  }
  // "Foo, The (USA)" → "The Foo (USA)"
  const commaThe = romName.match(/^(.*?),\s*The(\s+\(.*)?$/i);
  if (commaThe) {
    const tags = commaThe[2] ? commaThe[2].trim() : '';
    list.push(`The ${commaThe[1].trim()}${tags ? ' ' + tags : ''}`);
  }

  const m = romName.match(/^(.*?)\s*\(([^)]+)\)(.*)/);
  if (m) {
    const base        = m[1].trim();
    const suffix      = m[3];
    const cleanSuffix = suffix.replace(/\s*\([^)]+\)/g, '');
    for (const r of ['(Europe)', '(USA)', '(World)', '(Japan)', '(Spain)', '(Brazil)']) {
      if (`${base} ${r}${suffix}` !== romName) list.push(`${base} ${r}${suffix}`);
      if (cleanSuffix !== suffix)              list.push(`${base} ${r}${cleanSuffix}`);
    }
    list.push(base + suffix);
    if (cleanSuffix !== suffix) list.push(base + cleanSuffix);
    list.push(base);
    const bareBase = romName.replace(/\s*\([^)]+\)/g, '').trim();
    if (bareBase !== base) list.push(bareBase);
  }

  return [...new Set(list)];
}

async function fetchCover(consoleId, romName) {
  const cacheKey = `dobbycover_${consoleId}_${romName}`;
  const cached   = localStorage.getItem(cacheKey);
  if (cached) return cached;

  const system = LIBRETRO_SYSTEMS[consoleId];
  if (!system) return null;

  return queueCoverFetch(async () => {
    const [tree, candidates] = await Promise.all([
      getThumbnailTree(system),
      Promise.resolve(buildCoverCandidates(romName)),
    ]);

    const ghBase = `https://raw.githubusercontent.com/libretro-thumbnails/${system}/master/Named_Boxarts/`;

    if (tree) {
      // Best path: local index lookup → single HTTP request for the exact match
      const matched = candidates.find(name => tree.has(name));
      if (!matched) return null; // confirmed not in database, skip network
      try {
        const resp = await fetch(ghBase + encodeURIComponent(matched) + '.png');
        if (!resp.ok) return null;
        const dataUrl = await blobToDataUrl(await resp.blob());
        try { localStorage.setItem(cacheKey, dataUrl); } catch { }
        return dataUrl;
      } catch { return null; }
    }

    // Fallback (tree API unavailable): race all candidates via HTTP
    const ac = new AbortController();
    let winner = null;
    try {
      winner = await Promise.any(
        candidates.map(name =>
          fetch(ghBase + encodeURIComponent(name) + '.png', { signal: ac.signal })
            .then(r => { if (!r.ok) throw new Error(); return r; })
        )
      );
    } catch { /* no cover */ }
    let dataUrl = null;
    if (winner) { try { dataUrl = await blobToDataUrl(await winner.blob()); } catch { } }
    ac.abort();
    if (!dataUrl) return null;
    try { localStorage.setItem(cacheKey, dataUrl); } catch { }
    return dataUrl;
  });
}

// ── Fast Forward ──────────────────────────────────────────────────────────
let fastForwardKey = localStorage.getItem('dobbyFFKey') || 'Tab';
let ffPadBtn       = null;  // gamepad button index for FF (null = usar teclado)
let ffSpeed        = parseInt(localStorage.getItem('dobbyFFSpeed') || '3', 10);
let isFastForward  = false;
let ffListening    = false;

// Si hay un pad button guardado, usarlo en vez del teclado
const _savedFFPad = localStorage.getItem('dobbyFFPadBtn');
if (_savedFFPad !== null) { ffPadBtn = parseInt(_savedFFPad, 10); fastForwardKey = null; }

const GP_BTN_NAMES = ['A','B','X','Y','L1','R1','L2','R2','Select','Start','L3','R3','↑','↓','←','→'];
function gpBtnName(idx) { return '🎮 ' + (GP_BTN_NAMES[idx] ?? `Btn${idx}`); }
function formatFFBinding() { return ffPadBtn !== null ? gpBtnName(ffPadBtn) : formatKey(fastForwardKey || 'Tab'); }
function saveFFBinding() {
  if (ffPadBtn !== null) {
    localStorage.setItem('dobbyFFPadBtn', String(ffPadBtn));
    localStorage.removeItem('dobbyFFKey');
  } else {
    if (fastForwardKey) localStorage.setItem('dobbyFFKey', fastForwardKey);
    localStorage.removeItem('dobbyFFPadBtn');
  }
}

function setFastForward(active) {
  if (!gameActive || !window.EJS_emulator?.started) return;
  if (isFastForward === active) return;
  isFastForward = active;
  try {
    const fns = window.EJS_emulator?.gameManager?.functions;
    if (!fns) return;
    if (active) {
      fns.setFastForwardRatio(ffSpeed);
      fns.toggleFastForward(1);
    } else {
      fns.toggleFastForward(0);
    }
  } catch {}
}

function initShortcutsTab() {
  document.getElementById('ff-key-btn').textContent = formatFFBinding();
  updateFFSpeedButtons();
}

function updateFFSpeedButtons() {
  document.querySelectorAll('#ff-speed-opts .gfx-opt').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.speed, 10) === ffSpeed);
  });
}

document.querySelectorAll('#ff-speed-opts .gfx-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    ffSpeed = parseInt(btn.dataset.speed, 10);
    localStorage.setItem('dobbyFFSpeed', String(ffSpeed));
    updateFFSpeedButtons();
  });
});

document.getElementById('ff-key-btn').addEventListener('click', () => {
  if (ffListening) return;
  ffListening = true;
  const ffBtn = document.getElementById('ff-key-btn');
  ffBtn.classList.add('listening');
  ffBtn.textContent = 'Presioná una tecla o botón…';

  let gpPollId = null;
  function stopListening() {
    ffListening = false;
    ffBtn.classList.remove('listening');
    ffBtn.textContent = formatFFBinding();
    document.removeEventListener('keydown', onFFKey, true);
    clearInterval(gpPollId);
  }

  function onFFKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== 'Escape') {
      fastForwardKey = e.key;
      ffPadBtn = null;
      saveFFBinding();
    }
    stopListening();
  }
  document.addEventListener('keydown', onFFKey, true);

  // Capturar el estado inicial del pad para no triggear botones ya apretados
  const pad0 = [...(navigator.getGamepads?.() || [])].filter(Boolean)[0];
  const padPrevState = {};
  if (pad0) {
    for (let i = 0; i < pad0.buttons.length; i++) {
      padPrevState[i] = pad0.buttons[i]?.pressed || false;
    }
  }
  gpPollId = setInterval(() => {
    const pad = [...(navigator.getGamepads?.() || [])].filter(Boolean)[0];
    if (!pad) return;
    for (let i = 0; i < pad.buttons.length; i++) {
      const btn     = pad.buttons[i];
      const pressed = btn?.pressed || (btn?.value ?? 0) > 0.1;
      if (pressed && !padPrevState[i]) {
        ffPadBtn = i;
        fastForwardKey = null;
        saveFFBinding();
        stopListening();
        return;
      }
      padPrevState[i] = pressed;
    }
  }, 50);

  setTimeout(() => { if (ffListening) stopListening(); }, 10000);
});

// ── Graphics settings ─────────────────────────────────────────────────────
const GFX_DEFAULTS = { aspect: 'original', filter: 'pixelated', scanlines: 0 };

function loadGraphics() {
  try { return { ...GFX_DEFAULTS, ...JSON.parse(localStorage.getItem('dobbyGraphics') || '{}') }; }
  catch { return { ...GFX_DEFAULTS }; }
}

function saveGraphics(gfx) {
  localStorage.setItem('dobbyGraphics', JSON.stringify(gfx));
}

let currentGraphics = loadGraphics();

function applyGraphics(gfx) {
  // Aspect ratio — size #game-container directly so EmulatorJS fills it correctly
  const area = document.getElementById('game-area');
  const gc   = gameContainer;
  if (gfx.aspect === 'stretch') {
    gc.style.cssText = gc.style.cssText; // keep other inline styles
    gc.style.removeProperty('width');
    gc.style.removeProperty('height');
    gc.style.removeProperty('left');
    gc.style.removeProperty('top');
    gc.style.inset = '0';
  } else {
    const ratio = gfx.aspect === '16:9' ? 16/9 : 4/3;
    const areaW = area.clientWidth;
    const areaH = area.clientHeight;
    let w = areaH * ratio;
    let h = areaH;
    if (w > areaW) { w = areaW; h = areaW / ratio; }
    gc.style.inset  = 'auto';
    gc.style.width  = w + 'px';
    gc.style.height = h + 'px';
    gc.style.left   = Math.round((areaW - w) / 2) + 'px';
    gc.style.top    = Math.round((areaH - h) / 2) + 'px';
  }
  // Image filter
  gc.classList.remove('filter-pixelated', 'filter-smooth');
  gc.classList.add('filter-' + gfx.filter);
  // Scanlines
  const overlay = document.getElementById('scanlines-overlay');
  overlay.style.setProperty('--scanlines-opacity', (gfx.scanlines / 100).toFixed(2));
  overlay.classList.toggle('hidden', !gameActive || gfx.scanlines === 0);
}

// ── Recent ROMs ───────────────────────────────────────────────────────────
const EXT_TO_CONSOLE_ID = {
  '.sfc': 'snes', '.smc': 'snes', '.snes': 'snes',
  '.md': 'genesis', '.gen': 'genesis', '.smd': 'genesis', '.bin': 'genesis', '.68k': 'genesis',
  '.sms': 'mastersystem', '.gg': 'mastersystem',
  '.a26': 'atari2600', '.rom': 'atari2600',
  '.nds': 'nds',
  '.cue': 'psx', '.iso': 'psx', '.chd': 'psx', '.pbp': 'psx', '.img': 'psx',
  '.gba': 'gba',
  '.gbc': 'gbc',
  '.gb':  'gb',
};
const MAX_RECENTS = 8;

function getRecents() {
  try { return JSON.parse(localStorage.getItem('dobbyrecent') || '[]'); } catch { return []; }
}

function normalizePath(p) { return p.toLowerCase().replace(/\\/g, '/'); }

function saveToRecent(entry) {
  const norm = normalizePath(entry.fullPath);
  let list = getRecents().filter(r => normalizePath(r.fullPath) !== norm);
  list.unshift(entry);
  if (list.length > MAX_RECENTS) list = list.slice(0, MAX_RECENTS);
  try { localStorage.setItem('dobbyrecent', JSON.stringify(list)); } catch {}
}

function removeFromRecent(fullPath) {
  const list = getRecents().filter(r => r.fullPath !== fullPath);
  try { localStorage.setItem('dobbyrecent', JSON.stringify(list)); } catch {}
}

function renderRecentSection() {
  const section = document.getElementById('recent-section');
  const row     = document.getElementById('recent-row');
  const recents = getRecents();
  if (recents.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  row.innerHTML = '';

  for (const item of recents) {
    const card = document.createElement('div');
    card.className = 'recent-card';

    const coverDiv = document.createElement('div');
    coverDiv.className = 'recent-cover';
    const ph = document.createElement('div');
    ph.className = 'recent-cover-placeholder';
    ph.textContent = item.name.slice(0, 2).toUpperCase();
    coverDiv.appendChild(ph);

    const cached = localStorage.getItem(`dobbycover_${item.consoleId}_${item.name}`);
    if (cached) {
      ph.remove();
      const img = document.createElement('img');
      img.src = cached;
      img.alt = item.name;
      coverDiv.appendChild(img);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'recent-remove-btn';
    removeBtn.title = 'Quitar de recientes';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeFromRecent(item.fullPath);
      card.remove();
      if (row.children.length === 0) section.classList.add('hidden');
    });

    const infoDiv = document.createElement('div');
    infoDiv.className = 'recent-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'recent-name';
    nameEl.textContent = item.name;
    const conEl = document.createElement('div');
    conEl.className = 'recent-console';
    conEl.textContent = item.consoleName;
    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(conEl);

    card.appendChild(coverDiv);
    card.appendChild(removeBtn);
    card.appendChild(infoDiv);
    card.addEventListener('click', () => openRomByPath(item.fullPath, item.consoleId));
    row.appendChild(card);
  }
}

// ── Home screen ───────────────────────────────────────────────────────────────
function renderHomeScreen() {
  renderRecentSection();
  const grid = document.getElementById('console-grid');
  grid.innerHTML = '';
  for (const con of romLibrary) {
    const meta  = CONSOLE_META[con.id] || { topLine: '', bottomLine: con.name.toUpperCase() };
    const count = con.roms.length;
    const card  = document.createElement('div');
    card.className = 'console-card';
    card.dataset.consoleId = con.id;
    card.innerHTML = `
      <div class="console-art">
        <div class="console-badge">
          <span class="badge-top">${meta.topLine}</span>
          <span class="badge-bottom">${meta.bottomLine || meta.topLine}</span>
        </div>
      </div>
      <div class="console-info">
        <span class="console-name">${con.name}</span>
        <span class="console-rom-count">${count === 0 ? 'Sin juegos' : count === 1 ? '1 juego' : count + ' juegos'}</span>
      </div>`;
    card.addEventListener('click', () => showScreen('library', con.id));
    grid.appendChild(card);
  }
}

// ── Library screen ────────────────────────────────────────────────────────────
function setCoverImage(coverDiv, dataUrl, romName, btnGroup) {
  // Remove only the img/placeholder, preserving favBtn and btnGroup
  coverDiv.querySelector('img')?.remove();
  coverDiv.querySelector('.rom-cover-placeholder')?.remove();
  coverDiv.querySelector('.cover-btns')?.remove();
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = romName;
  coverDiv.appendChild(img);
  coverDiv.appendChild(btnGroup);
}

function setPlaceholder(coverDiv, romName, btnGroup) {
  coverDiv.querySelector('img')?.remove();
  coverDiv.querySelector('.rom-cover-placeholder')?.remove();
  coverDiv.querySelector('.cover-btns')?.remove();
  const ph = document.createElement('div');
  ph.className   = 'rom-cover-placeholder';
  ph.textContent = romName.slice(0, 2).toUpperCase();
  coverDiv.appendChild(ph);
  coverDiv.appendChild(btnGroup);
}

function renderLibrary(consoleId) {
  const con = romLibrary.find(c => c.id === consoleId);
  if (!con) return;

  // Reset search & filter state
  librarySearchQuery  = '';
  libraryShowFavsOnly = false;
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  document.getElementById('search-clear')?.classList.add('hidden');
  document.querySelectorAll('.filter-btn').forEach((b, i) => b.classList.toggle('active', i === 0));

  document.getElementById('library-title').textContent = con.name;
  const count = con.roms.length;
  document.getElementById('library-count').textContent =
    count === 0 ? '' : count === 1 ? '1 juego' : count + ' juegos';

  const grid  = document.getElementById('rom-grid');
  const empty = document.getElementById('rom-empty');
  grid.innerHTML = '';

  // Disconnect previous lazy-load observer
  if (coverObserver) { coverObserver.disconnect(); coverObserver = null; }

  if (count === 0) {
    empty.innerHTML =
      `<p>No hay juegos en esta carpeta</p>` +
      `<p class="empty-hint">Copiá tus ROMs en <code>ROMs/${con.folder}/</code> y reiniciá la app.</p>` +
      `<p class="empty-hint">Extensiones aceptadas: <code>${con.exts.join('  ')}</code></p>`;
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Only fetch covers when a card enters the viewport (+ 300px margin)
  coverObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      coverObserver.unobserve(entry.target);
      const fn = coverLoadFns.get(entry.target);
      if (fn) fn();
    }
  }, { rootMargin: '300px' });

  const sortedRoms = [...con.roms].sort((a, b) => {
    if (librarySortOrder === 'za') return b.name.localeCompare(a.name);
    if (librarySortOrder === 'fav') {
      const fa = isFav(consoleId, a.name) ? 0 : 1;
      const fb = isFav(consoleId, b.name) ? 0 : 1;
      return fa !== fb ? fa - fb : a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name); // az (default)
  });

  for (const rom of sortedRoms) {
    const card = document.createElement('div');
    card.className = 'rom-card';
    card.dataset.romName = rom.name;
    card.dataset.romFav  = isFav(consoleId, rom.name) ? '1' : '0';

    const cacheKey = `dobbycover_${consoleId}_${rom.name}`;

    const coverDiv = document.createElement('div');
    coverDiv.className = 'rom-cover';

    // Favorite star — top-right corner, always visible when favorited
    const favBtn = document.createElement('button');
    favBtn.className = 'fav-btn' + (card.dataset.romFav === '1' ? ' is-fav' : '');
    favBtn.textContent = '★';
    favBtn.title = 'Favorito';
    favBtn.addEventListener('click', e => {
      e.stopPropagation();
      const nowFav = toggleFav(consoleId, rom.name);
      favBtn.classList.toggle('is-fav', nowFav);
      card.dataset.romFav = nowFav ? '1' : '0';
      applyLibraryFilter();
    });
    coverDiv.appendChild(favBtn);

    const placeholder = document.createElement('div');
    placeholder.className = 'rom-cover-placeholder';
    placeholder.textContent = rom.name.slice(0, 2).toUpperCase();
    coverDiv.appendChild(placeholder);

    // Button group (edit + reset), visible on hover
    const btnGroup = document.createElement('div');
    btnGroup.className = 'cover-btns';

    const editBtn = document.createElement('button');
    editBtn.className = 'cover-edit-btn';
    editBtn.title = 'Cambiar imagen';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type   = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          try { localStorage.setItem(cacheKey, dataUrl); } catch (_) {}
          setCoverImage(coverDiv, dataUrl, rom.name, btnGroup);
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'cover-reset-btn';
    resetBtn.title = 'Restablecer imagen';
    resetBtn.textContent = '↺';
    resetBtn.addEventListener('click', async e => {
      e.stopPropagation();
      localStorage.removeItem(cacheKey);
      const dataUrl = await fetchCover(consoleId, rom.name);
      if (dataUrl) setCoverImage(coverDiv, dataUrl, rom.name, btnGroup);
      else setPlaceholder(coverDiv, rom.name, btnGroup);
    });

    btnGroup.appendChild(editBtn);
    btnGroup.appendChild(resetBtn);
    coverDiv.appendChild(btnGroup);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'rom-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'rom-title';
    titleEl.textContent = rom.name;
    infoDiv.appendChild(titleEl);

    card.appendChild(coverDiv);
    card.appendChild(infoDiv);
    card.addEventListener('click', () => openRomByPath(rom.fullPath, consoleId));
    grid.appendChild(card);

    // Register lazy loader — fires when card scrolls into view
    coverLoadFns.set(card, () => {
      fetchCover(consoleId, rom.name).then(dataUrl => {
        if (dataUrl) setCoverImage(coverDiv, dataUrl, rom.name, btnGroup);
      });
    });
    coverObserver.observe(card);
  }
}

// ── Per-core button profiles ──────────────────────────────────────────────────
const CORE_PROFILES = {
  snes9x: {
    name: 'Super Nintendo',
    buttons: [
      { label: 'Arriba',    idx: 4,  defaultKey: 'ArrowUp'    },
      { label: 'Abajo',     idx: 5,  defaultKey: 'ArrowDown'  },
      { label: 'Izquierda', idx: 6,  defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',   idx: 7,  defaultKey: 'ArrowRight' },
      { label: 'Botón A',   idx: 8,  defaultKey: 'x'          },
      { label: 'Botón B',   idx: 0,  defaultKey: 'z'          },
      { label: 'Botón X',   idx: 9,  defaultKey: 's'          },
      { label: 'Botón Y',   idx: 1,  defaultKey: 'a'          },
      { label: 'L',         idx: 10, defaultKey: 'q'          },
      { label: 'R',         idx: 11, defaultKey: 'w'          },
      { label: 'Start',     idx: 3,  defaultKey: 'Enter'      },
      { label: 'Select',    idx: 2,  defaultKey: 'Backspace'  },
    ],
  },
  genesis_plus_gx: {
    name: 'Sega Genesis',
    buttons: [
      { label: 'Arriba',    idx: 4,  defaultKey: 'ArrowUp'    },
      { label: 'Abajo',     idx: 5,  defaultKey: 'ArrowDown'  },
      { label: 'Izquierda', idx: 6,  defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',   idx: 7,  defaultKey: 'ArrowRight' },
      { label: 'Botón A',   idx: 1,  defaultKey: 'a'          },
      { label: 'Botón B',   idx: 0,  defaultKey: 'z'          },
      { label: 'Botón C',   idx: 8,  defaultKey: 'x'          },
      { label: 'Botón X',   idx: 9,  defaultKey: 'd'          },
      { label: 'Botón Y',   idx: 10, defaultKey: 'q'          },
      { label: 'Botón Z',   idx: 11, defaultKey: 'w'          },
      { label: 'Start',     idx: 3,  defaultKey: 'Enter'      },
      { label: 'Mode',      idx: 2,  defaultKey: 'Backspace'  },
    ],
  },
  mgba: {
    name: 'Game Boy Advance',
    buttons: [
      { label: 'Arriba',       idx: 4,  defaultKey: 'ArrowUp'    },
      { label: 'Abajo',        idx: 5,  defaultKey: 'ArrowDown'  },
      { label: 'Izquierda',    idx: 6,  defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',      idx: 7,  defaultKey: 'ArrowRight' },
      { label: 'Botón A',      idx: 8,  defaultKey: 'x'          },
      { label: 'Botón B',      idx: 0,  defaultKey: 'z'          },
      { label: 'L',            idx: 10, defaultKey: 'a'          },
      { label: 'R',            idx: 11, defaultKey: 's'          },
      { label: 'Start',        idx: 3,  defaultKey: 'Enter'      },
      { label: 'Select',       idx: 2,  defaultKey: 'Backspace'  },
    ],
  },
  gambatte: {
    name: 'Game Boy / Color',
    buttons: [
      { label: 'Arriba',       idx: 4, defaultKey: 'ArrowUp'    },
      { label: 'Abajo',        idx: 5, defaultKey: 'ArrowDown'  },
      { label: 'Izquierda',    idx: 6, defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',      idx: 7, defaultKey: 'ArrowRight' },
      { label: 'Botón A',      idx: 8, defaultKey: 'x'          },
      { label: 'Botón B',      idx: 0, defaultKey: 'z'          },
      { label: 'Start',        idx: 3, defaultKey: 'Enter'      },
      { label: 'Select',       idx: 2, defaultKey: 'Backspace'  },
    ],
  },
  smsplus: {
    name: 'Master System',
    buttons: [
      { label: 'Arriba',        idx: 4, defaultKey: 'ArrowUp'    },
      { label: 'Abajo',         idx: 5, defaultKey: 'ArrowDown'  },
      { label: 'Izquierda',     idx: 6, defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',       idx: 7, defaultKey: 'ArrowRight' },
      { label: 'Botón 1',       idx: 0, defaultKey: 'z'          },
      { label: 'Botón 2',       idx: 8, defaultKey: 'x'          },
      { label: 'Start / Pausa', idx: 3, defaultKey: 'Enter'      },
    ],
  },
  atari2600: {
    name: 'Atari 2600',
    buttons: [
      { label: 'Arriba',    idx: 4, defaultKey: 'ArrowUp'    },
      { label: 'Abajo',     idx: 5, defaultKey: 'ArrowDown'  },
      { label: 'Izquierda', idx: 6, defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',   idx: 7, defaultKey: 'ArrowRight' },
      { label: 'Fuego',     idx: 0, defaultKey: 'z'          },
      { label: 'Select',    idx: 2, defaultKey: 'Backspace'  },
      { label: 'Reset',     idx: 3, defaultKey: 'Enter'      },
    ],
  },
  nds: {
    name: 'Nintendo DS',
    buttons: [
      { label: 'Arriba',    idx: 4,  defaultKey: 'ArrowUp'    },
      { label: 'Abajo',     idx: 5,  defaultKey: 'ArrowDown'  },
      { label: 'Izquierda', idx: 6,  defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',   idx: 7,  defaultKey: 'ArrowRight' },
      { label: 'Botón A',   idx: 8,  defaultKey: 'x'          },
      { label: 'Botón B',   idx: 0,  defaultKey: 'z'          },
      { label: 'Botón X',   idx: 9,  defaultKey: 's'          },
      { label: 'Botón Y',   idx: 1,  defaultKey: 'a'          },
      { label: 'L',         idx: 10, defaultKey: 'q'          },
      { label: 'R',         idx: 11, defaultKey: 'w'          },
      { label: 'Start',     idx: 3,  defaultKey: 'Enter'      },
      { label: 'Select',    idx: 2,  defaultKey: 'Backspace'  },
    ],
  },
  psx: {
    name: 'PlayStation',
    buttons: [
      { label: 'Arriba',    idx: 4,  defaultKey: 'ArrowUp'    },
      { label: 'Abajo',     idx: 5,  defaultKey: 'ArrowDown'  },
      { label: 'Izquierda', idx: 6,  defaultKey: 'ArrowLeft'  },
      { label: 'Derecha',   idx: 7,  defaultKey: 'ArrowRight' },
      { label: '× Cruz',    idx: 0,  defaultKey: 'z'          },
      { label: '○ Círculo', idx: 8,  defaultKey: 'x'          },
      { label: '□ Cuadro',  idx: 1,  defaultKey: 'a'          },
      { label: '△ Triáng.', idx: 9,  defaultKey: 's'          },
      { label: 'L1',        idx: 10, defaultKey: 'q'          },
      { label: 'R1',        idx: 11, defaultKey: 'w'          },
      { label: 'L2',        idx: 12, defaultKey: 'e'          },
      { label: 'R2',        idx: 13, defaultKey: 'r'          },
      { label: 'Start',     idx: 3,  defaultKey: 'Enter'      },
      { label: 'Select',    idx: 2,  defaultKey: 'Backspace'  },
    ],
  },
};

// ── Key storage ───────────────────────────────────────────────────────────────
function loadCoreKeys(core) {
  const profile = CORE_PROFILES[core];
  if (!profile) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(`dobbyControls_${core}`) || '{}');
    const result = {};
    for (const btn of profile.buttons) result[btn.idx] = saved[btn.idx] ?? btn.defaultKey;
    return result;
  } catch {
    const result = {};
    for (const btn of profile.buttons) result[btn.idx] = btn.defaultKey;
    return result;
  }
}

function saveCoreKeys(core, keys) {
  localStorage.setItem(`dobbyControls_${core}`, JSON.stringify(keys));
}

let allCoreKeys = {};
for (const core of Object.keys(CORE_PROFILES)) allCoreKeys[core] = loadCoreKeys(core);
let workingCoreKeys = {};

// ── Player 2 controls ─────────────────────────────────────────────────────────
const P2_CORES = new Set(['genesis_plus_gx', 'snes9x', 'smsplus', 'psx']);

const P2_DEFAULT_KEYS = {
  0: 'u', 1: 'h', 2: '-', 3: '=',
  4: 'i', 5: 'k', 6: 'j', 7: 'l',
  8: 'o', 9: 'n', 10: 'y', 11: 'p',
  12: 'g', 13: '[',
};

function loadCoreKeys2(core) {
  const profile = CORE_PROFILES[core];
  if (!profile || !P2_CORES.has(core)) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(`dobbyControls2_${core}`) || '{}');
    const result = {};
    for (const btn of profile.buttons) result[btn.idx] = saved[btn.idx] ?? P2_DEFAULT_KEYS[btn.idx] ?? btn.defaultKey;
    return result;
  } catch {
    const result = {};
    for (const btn of profile.buttons) result[btn.idx] = P2_DEFAULT_KEYS[btn.idx] ?? btn.defaultKey;
    return result;
  }
}
function saveCoreKeys2(core, keys) { localStorage.setItem(`dobbyControls2_${core}`, JSON.stringify(keys)); }

let allCoreKeys2 = {};
for (const core of Object.keys(CORE_PROFILES)) allCoreKeys2[core] = loadCoreKeys2(core);
let workingCoreKeys2 = {};
let currentPlayer = 1;

// ── Key utilities ─────────────────────────────────────────────────────────────
function keyNameToKeyCode(key) {
  const named = {
    'Enter': 13, 'Backspace': 8, 'Tab': 9, 'Escape': 27, ' ': 32,
    'PageUp': 33, 'PageDown': 34, 'End': 35, 'Home': 36,
    'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40,
    'Insert': 45, 'Delete': 46,
    'F1': 112, 'F2': 113, 'F3': 114, 'F4': 115, 'F5': 116,
    'F6': 117, 'F7': 118, 'F8': 119, 'F9': 120, 'F10': 121, 'F11': 122, 'F12': 123,
  };
  if (named[key] !== undefined) return named[key];
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

function formatKey(key) {
  const map = {
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'Enter': 'Enter', 'Backspace': 'Backspace', ' ': 'Espacio',
  };
  return map[key] || (key.length === 1 ? key.toUpperCase() : key);
}

// ── Game logic ────────────────────────────────────────────────────────────────
async function openRom() {
  closeAllMenus();
  statusLeft.textContent = 'Abriendo ROM…';
  const rom = await window.api.openRom();
  if (!rom)      { statusLeft.textContent = 'Cancelado'; return; }
  if (rom.error) { statusLeft.textContent = '⚠ ' + rom.error; return; }
  currentConsoleId = null;
  const consoleId = EXT_TO_CONSOLE_ID[rom.ext] || '';
  const con = romLibrary.find(c => c.id === consoleId);
  if (rom.fullPath) {
    saveToRecent({
      name:        rom.name,
      fullPath:    rom.fullPath,
      consoleId,
      consoleName: con?.name || CORE_PROFILES[rom.core]?.name || '',
      core:        rom.core,
    });
  }
  startGame({ ...rom, consoleId });
}

async function openRomByPath(fullPath, consoleId) {
  statusLeft.textContent = 'Cargando…';
  const rom = await window.api.openRomByPath(fullPath);
  if (!rom || rom.error) { statusLeft.textContent = '⚠ ' + (rom?.error || 'Error al cargar'); return; }
  const resolvedConsoleId = consoleId || EXT_TO_CONSOLE_ID[rom.ext] || '';
  const con = romLibrary.find(c => c.id === resolvedConsoleId);
  const finalCore = con?.core || rom.core;
  saveToRecent({
    name:        rom.name,
    fullPath,
    consoleId:   resolvedConsoleId,
    consoleName: con?.name || CORE_PROFILES[finalCore]?.name || '',
    core:        finalCore,
  });
  startGame({ ...rom, core: finalCore, consoleId: resolvedConsoleId });
}

function closeRom() {
  closeAllMenus();
  if (!gameActive) return;
  if (controlsPatcher) { clearInterval(controlsPatcher); controlsPatcher = null; }
  stopGamepadBridge();
  setFastForward(false);
  try { window.EJS_emulator?.setVolume?.(0); } catch (_) {}
  gameActive = false;
  activeCore = null;
  activeRomName   = '';
  activeConsoleId = '';
  currentSlot     = 1;
  filledSlots     = new Set();
  window.EJS_emulator = undefined;
  document.querySelectorAll('script[data-emujs]').forEach(s => s.remove());
  gameContainer.innerHTML = '';
  gameContainer.style.inset  = '';
  gameContainer.style.width  = '';
  gameContainer.style.height = '';
  gameContainer.style.left   = '';
  gameContainer.style.top    = '';
  document.getElementById('scanlines-overlay').classList.add('hidden');
  document.getElementById('slot-bar').classList.add('hidden');
  setEmuActions(false);
  statusLeft.textContent  = 'Listo';
  statusRight.textContent = '';
  // Return to where the user came from
  if (currentConsoleId) {
    showScreen('library', currentConsoleId);
  } else {
    showScreen('home');
  }
}

function patchControlsWhenReady(core) {
  if (controlsPatcher) { clearInterval(controlsPatcher); controlsPatcher = null; }
  controlsPatcher = setInterval(() => {
    const emu = window.EJS_emulator;
    if (!emu?.started || !emu?.gameManager) return;
    clearInterval(controlsPatcher);
    controlsPatcher = null;

    const c = emu.controls?.[0];
    if (c) {
      const keys = allCoreKeys[core] || {};
      for (const [idxStr, keyName] of Object.entries(keys)) {
        const code = keyNameToKeyCode(keyName);
        if (!code) continue;
        c[Number(idxStr)] = { ...(c[Number(idxStr)] || {}), value: code };
      }
    }
    if (P2_CORES.has(core)) {
      const c2 = emu.controls?.[1];
      if (c2) {
        const keys2 = allCoreKeys2[core] || {};
        for (const [idxStr, keyName] of Object.entries(keys2)) {
          const code = keyNameToKeyCode(keyName);
          if (!code) continue;
          c2[Number(idxStr)] = { ...(c2[Number(idxStr)] || {}), value: code };
        }
      }
    }

    const parent = emu.elements?.parent;
    if (parent) {
      if (parent.tabIndex < 0) parent.tabIndex = 0;
      parent.focus();
      for (const b of parent.querySelectorAll('.ejs_menu_button')) {
        const t = b.textContent.trim();
        if (t === 'Control Settings' || t === 'Set Speed') b.style.display = 'none';
      }
    }
    applyGraphics(currentGraphics);
    startGamepadBridge();
  }, 300);
}

function startGame(rom) {
  try { window.EJS_emulator?.setVolume?.(0); } catch (_) {}
  if (controlsPatcher) { clearInterval(controlsPatcher); controlsPatcher = null; }
  activeCore = rom.core;
  gameActive = true;
  showScreen('game');
  gameContainer.innerHTML = '';

  const base   = `http://127.0.0.1:${rom.port || emujsPort}/`;
  const blob   = new Blob([rom.data]);
  const romUrl = URL.createObjectURL(blob);

  window.EJS_player        = '#game-container';
  window.EJS_gameUrl       = romUrl;
  window.EJS_core          = rom.core;
  window.EJS_pathtodata    = base;
  window.EJS_gameName      = rom.name;
  window.EJS_startOnLoaded = true;
  window.EJS_Buttons       = { playPause: true, restart: true, fullscreen: true, saveState: true, loadState: true, screenshot: true };
  window.EJS_defaultOptions = { 'save-state-location': 'browser' };

  const script = document.createElement('script');
  script.src   = base + 'loader.js';
  script.dataset.emujs = '1';
  script.onerror = () => { statusLeft.textContent = '⚠ Error al cargar el emulador'; closeRom(); };
  document.body.appendChild(script);
  patchControlsWhenReady(rom.core);

  applyGraphics(currentGraphics);
  setEmuActions(true);
  activeRomName   = rom.name;
  activeConsoleId = rom.consoleId || currentConsoleId || '';
  currentSlot     = 1;
  filledSlots     = new Set();
  statusLeft.textContent  = rom.name;
  statusRight.textContent = '';
  document.getElementById('slot-bar').classList.remove('hidden');
  updateSlotBar();
  checkSaveSlots();
}

function coreLabel(core) {
  return {
    snes9x:           'Super Nintendo · Snes9x',
    mgba:             'Game Boy Advance · mGBA',
    gambatte:         'Game Boy · Gambatte',
    genesis_plus_gx:  'Sega Genesis · Genesis Plus GX',
    smsplus:          'Master System · SMS Plus',
    atari2600:        'Atari 2600 · Stella',
    nds:              'Nintendo DS · DeSmuME',
  }[core] || core;
}

function setEmuActions(active) {
  ['action-close','action-pause','action-reset','action-save-state','action-load-state'].forEach(id => {
    document.getElementById(id).classList.toggle('disabled', !active);
  });
}

function clickEjsBtn(text) {
  const btn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
    .find(b => b.textContent.trim() === text && getComputedStyle(b).display !== 'none');
  btn?.click();
}

// ── Save slots ────────────────────────────────────────────────────────────────
function updateSlotBar() {
  document.querySelectorAll('.slot-btn').forEach(btn => {
    const n = parseInt(btn.dataset.slot, 10);
    btn.classList.toggle('active', n === currentSlot);
    btn.classList.toggle('filled', filledSlots.has(n));
  });
}

function showSlotFeedback(msg, durationMs = 1500) {
  statusRight.textContent = msg;
  clearTimeout(showSlotFeedback._t);
  showSlotFeedback._t = setTimeout(() => { if (gameActive) statusRight.textContent = ''; }, durationMs);
}

async function checkSaveSlots() {
  try {
    const filled = await window.api.listSaveSlots({ consoleId: activeConsoleId, romName: activeRomName });
    filledSlots = new Set(filled);
    updateSlotBar();
  } catch (_) {}
}

async function ejsSaveState() {
  if (!gameActive || !window.EJS_emulator?.started) return;
  try {
    const gm  = window.EJS_emulator.gameManager;
    const raw = typeof gm.getState === 'function' ? gm.getState() : gm.functions.saveStateInfo();
    if (!raw) throw new Error('no data');
    const buf = raw instanceof Uint8Array
      ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
      : raw;
    await window.api.saveState({ consoleId: activeConsoleId, romName: activeRomName, slot: currentSlot, data: buf });
    filledSlots.add(currentSlot);
    updateSlotBar();
    showSlotFeedback(`Slot ${currentSlot} guardado`);
  } catch (_) {
    showSlotFeedback('⚠ Error al guardar');
  }
}

async function ejsLoadState() {
  if (!gameActive || !window.EJS_emulator?.started) return;
  try {
    const data = await window.api.loadState({ consoleId: activeConsoleId, romName: activeRomName, slot: currentSlot });
    if (!data) { showSlotFeedback(`Slot ${currentSlot} vacío`); return; }
    const gm    = window.EJS_emulator.gameManager;
    const uint8 = new Uint8Array(data);
    if (typeof gm.loadState === 'function') gm.loadState(uint8);
    else gm.functions.loadState(uint8);
    showSlotFeedback(`Slot ${currentSlot} cargado`);
  } catch (_) {
    showSlotFeedback('⚠ Error al cargar');
  }
}

// ── Slot bar ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.slot-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentSlot = parseInt(btn.dataset.slot, 10);
    updateSlotBar();
  });
});

// ── Menu actions ──────────────────────────────────────────────────────────────
document.getElementById('action-open').addEventListener('click', openRom);
document.getElementById('action-close').addEventListener('click', () => {
  if (!document.getElementById('action-close').classList.contains('disabled')) closeRom();
});
document.getElementById('action-quit').addEventListener('click', () => window.api.windowClose());
document.getElementById('action-fullscreen').addEventListener('click', () => {
  closeAllMenus(); window.api.toggleFullscreen();
});
document.getElementById('action-pause').addEventListener('click', () => {
  closeAllMenus();
  clickEjsBtn('Pause') || clickEjsBtn('Play');
});
document.getElementById('action-reset').addEventListener('click', () => {
  closeAllMenus();
  clickEjsBtn('Restart');
});
document.getElementById('action-save-state').addEventListener('click', () => {
  closeAllMenus(); ejsSaveState();
});
document.getElementById('action-load-state').addEventListener('click', () => {
  closeAllMenus(); ejsLoadState();
});
document.getElementById('action-controls-cfg').addEventListener('click', () => {
  closeAllMenus(); openSettingsModal('controls');
});
document.getElementById('action-gamepad-info').addEventListener('click', () => {
  closeAllMenus(); openSettingsModal('joystick');
});
document.getElementById('action-shortcuts-info').addEventListener('click', () => {
  closeAllMenus(); openSettingsModal('shortcuts');
});
document.getElementById('action-graphics-cfg').addEventListener('click', () => {
  closeAllMenus(); openSettingsModal('graphics');
});
document.getElementById('btn-back-home').addEventListener('click', () => showScreen('home'));

// ── Settings modal ────────────────────────────────────────────────────────────
const modal    = document.getElementById('modal-controls');
const gpStatus = document.getElementById('gamepad-status');

let listeningBtn  = null;
let listeningCore = null;
let listeningIdx  = null;
let modalConsole  = null;

function switchOuterTab(name) {
  document.querySelectorAll('.outer-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.outer === name)
  );
  document.querySelectorAll('.outer-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`outer-${name}`).classList.remove('hidden');

  const isControls = name === 'controls';
  document.getElementById('btn-controls-reset').classList.toggle('hidden', !isControls);
  document.getElementById('btn-controls-save').classList.toggle('hidden', !isControls);

  if (name === 'joystick') { updateGamepadStatus(); startGamepadPoll(); renderGpadRemapper(); }
  else stopGamepadPoll();
  if (name === 'graphics')  initGraphicsTab();
  if (name === 'shortcuts') initShortcutsTab();
}

let gamePausedByModal = false;

function openSettingsModal(outerTab = 'controls', consoleTab = null) {
  if (listeningBtn) cancelListen();
  currentPlayer = 1;
  workingCoreKeys  = {};
  workingCoreKeys2 = {};
  for (const core of Object.keys(CORE_PROFILES)) {
    workingCoreKeys[core]  = { ...allCoreKeys[core] };
    workingCoreKeys2[core] = { ...allCoreKeys2[core] };
  }
  switchOuterTab(outerTab);
  if (outerTab === 'controls') {
    document.querySelectorAll('.player-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    updateConsoleTabsVisibility();
    const startTab = consoleTab || activeCore || 'genesis_plus_gx';
    switchConsoleTab(startTab);
    updateConsoleTabs();
  }
  // Pausar el juego si estaba corriendo
  if (gameActive && window.EJS_emulator?.started) {
    const pauseBtn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
      .find(b => b.textContent.trim() === 'Pause' && getComputedStyle(b).display !== 'none');
    if (pauseBtn) {
      setFastForward(false);
      clickEjsBtn('Pause');
      gamePausedByModal = true;
    }
  }
  modal.classList.remove('hidden');
}

function openControlsModal(consoleTab = null) { openSettingsModal('controls', consoleTab); }

function closeControlsModal() {
  if (listeningBtn) cancelListen();
  cancelGpadRemap();
  modal.classList.add('hidden');
  stopGamepadPoll();
  // Reanudar solo si lo pausamos nosotros al abrir
  if (gamePausedByModal) {
    clickEjsBtn('Play');
    gamePausedByModal = false;
  }
}

function saveControls() {
  if (listeningBtn) cancelListen();
  for (const core of Object.keys(CORE_PROFILES)) {
    allCoreKeys[core] = { ...workingCoreKeys[core] };
    saveCoreKeys(core, allCoreKeys[core]);
    if (P2_CORES.has(core)) {
      allCoreKeys2[core] = { ...workingCoreKeys2[core] };
      saveCoreKeys2(core, allCoreKeys2[core]);
    }
  }
  if (gameActive && activeCore && window.EJS_emulator?.started) {
    const c = window.EJS_emulator.controls?.[0];
    if (c) {
      for (const [idxStr, keyName] of Object.entries(allCoreKeys[activeCore])) {
        const code = keyNameToKeyCode(keyName);
        if (!code) continue;
        c[Number(idxStr)] = { ...(c[Number(idxStr)] || {}), value: code };
      }
    }
    if (P2_CORES.has(activeCore)) {
      const c2 = window.EJS_emulator.controls?.[1];
      if (c2) {
        for (const [idxStr, keyName] of Object.entries(allCoreKeys2[activeCore])) {
          const code = keyNameToKeyCode(keyName);
          if (!code) continue;
          c2[Number(idxStr)] = { ...(c2[Number(idxStr)] || {}), value: code };
        }
      }
    }
  }
  closeControlsModal();
  statusLeft.textContent = 'Controles guardados';
}

function resetConsoleKeys() {
  if (!modalConsole || !CORE_PROFILES[modalConsole]) return;
  if (currentPlayer === 2) {
    workingCoreKeys2[modalConsole] = {};
    for (const btn of CORE_PROFILES[modalConsole].buttons)
      workingCoreKeys2[modalConsole][btn.idx] = P2_DEFAULT_KEYS[btn.idx] ?? btn.defaultKey;
  } else {
    workingCoreKeys[modalConsole] = {};
    for (const btn of CORE_PROFILES[modalConsole].buttons) workingCoreKeys[modalConsole][btn.idx] = btn.defaultKey;
  }
  renderKeysGrid(modalConsole);
}

function switchConsoleTab(tab) {
  document.querySelectorAll('#console-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.console === tab);
  });
  modalConsole = tab;
  renderKeysGrid(tab);
}

function updateConsoleTabs() {
  document.querySelectorAll('#console-tabs .tab').forEach(tab => {
    tab.classList.toggle('playing-now', gameActive && tab.dataset.console === activeCore);
  });
}

function renderKeysGrid(core) {
  const grid    = document.getElementById('keys-grid');
  const profile = CORE_PROFILES[core];
  grid.innerHTML = '';
  if (!profile) return;
  const keysMap = currentPlayer === 2 ? workingCoreKeys2 : workingCoreKeys;
  for (const btn of profile.buttons) {
    const keyName = keysMap[core]?.[btn.idx] ?? (currentPlayer === 2 ? P2_DEFAULT_KEYS[btn.idx] : undefined) ?? btn.defaultKey;
    const row     = document.createElement('div');
    row.className = 'key-row';
    const lbl     = document.createElement('span');
    lbl.className = 'key-label';
    lbl.textContent = btn.label;
    const keyBtn  = document.createElement('button');
    keyBtn.className = 'key-btn';
    keyBtn.textContent = formatKey(keyName);
    keyBtn.dataset.core = core;
    keyBtn.dataset.idx  = btn.idx;
    keyBtn.addEventListener('click', () => startListen(keyBtn, core, btn.idx));
    row.appendChild(lbl);
    row.appendChild(keyBtn);
    grid.appendChild(row);
  }
}

function startListen(btn, core, idx) {
  if (listeningBtn) cancelListen();
  listeningBtn  = btn;
  listeningCore = core;
  listeningIdx  = idx;
  btn.classList.add('listening');
  btn.textContent = 'Presioná una tecla…';
  document.addEventListener('keydown', onKeyCapture, { once: true });
}

function cancelListen() {
  if (!listeningBtn) return;
  document.removeEventListener('keydown', onKeyCapture);
  listeningBtn.classList.remove('listening');
  const km = currentPlayer === 2 ? workingCoreKeys2 : workingCoreKeys;
  const keyName = km[listeningCore]?.[listeningIdx] ?? '';
  listeningBtn.textContent = formatKey(keyName);
  listeningBtn  = null;
  listeningCore = null;
  listeningIdx  = null;
}

function onKeyCapture(e) {
  e.preventDefault();
  if (e.key === 'Escape') { cancelListen(); return; }
  if (listeningCore !== null && listeningIdx !== null) {
    const km = currentPlayer === 2 ? workingCoreKeys2 : workingCoreKeys;
    km[listeningCore][listeningIdx] = e.key;
    listeningBtn.textContent = formatKey(e.key);
  }
  listeningBtn.classList.remove('listening');
  listeningBtn  = null;
  listeningCore = null;
  listeningIdx  = null;
}

modal.querySelector('.modal-backdrop').addEventListener('click', closeControlsModal);
modal.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(b => b.addEventListener('click', closeControlsModal));
document.getElementById('btn-controls-save').addEventListener('click', saveControls);
document.getElementById('btn-controls-reset').addEventListener('click', resetConsoleKeys);
document.querySelectorAll('#console-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => switchConsoleTab(tab.dataset.console));
});

function updateConsoleTabsVisibility() {
  document.querySelectorAll('#console-tabs .tab').forEach(tab => {
    tab.classList.toggle('hidden', currentPlayer === 2 && !P2_CORES.has(tab.dataset.console));
  });
  const active = document.querySelector('#console-tabs .tab.active');
  if (active?.classList.contains('hidden')) {
    const first = document.querySelector('#console-tabs .tab:not(.hidden)');
    if (first) switchConsoleTab(first.dataset.console);
  }
}

document.querySelectorAll('.player-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (listeningBtn) cancelListen();
    document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPlayer = Number(btn.dataset.player);
    updateConsoleTabsVisibility();
    if (modalConsole) renderKeysGrid(modalConsole);
  });
});
document.querySelectorAll('.outer-tab').forEach(tab => {
  tab.addEventListener('click', () => switchOuterTab(tab.dataset.outer));
});

// ── Gamepad → keyboard bridge (makes joystick work in EmulatorJS) ────────────
// Default: Standard Web Gamepad API button index → libretro joypad index
const DEFAULT_GPAD_MAP = {
  0:  8,   // A / Cross      → libretro A
  1:  0,   // B / Circle     → libretro B
  2:  1,   // X / Square     → libretro Y
  3:  9,   // Y / Triangle   → libretro X
  4:  10,  // LB / L1        → libretro L
  5:  11,  // RB / R1        → libretro R
  6:  12,  // LT / L2        → libretro L2
  7:  13,  // RT / R2        → libretro R2
  8:  2,   // Select / Back  → libretro Select
  9:  3,   // Start          → libretro Start
  12: 4,   // D-pad Up       → libretro Up
  13: 5,   // D-pad Down     → libretro Down
  14: 6,   // D-pad Left     → libretro Left
  15: 7,   // D-pad Right    → libretro Right
};

function loadGpadMap() {
  try { const s = localStorage.getItem('dobbyGpadMap'); if (s) return JSON.parse(s); } catch {}
  return { ...DEFAULT_GPAD_MAP };
}
function saveGpadMap() { localStorage.setItem('dobbyGpadMap', JSON.stringify(gpadMap)); }

let gpadMap = loadGpadMap();

// Actions shown in the remapper UI (D-pad excluded — always fixed)
const GPAD_REMAP_ACTIONS = [
  { label: 'B  /  × Cruz',        libIdx: 0  },
  { label: 'A  /  ○ Círculo',     libIdx: 8  },
  { label: 'Y  /  □ Cuadro',      libIdx: 1  },
  { label: 'X  /  △ Triángulo',   libIdx: 9  },
  { label: 'L1',                  libIdx: 10 },
  { label: 'R1',                  libIdx: 11 },
  { label: 'L2',                  libIdx: 12 },
  { label: 'R2',                  libIdx: 13 },
  { label: 'Select',              libIdx: 2  },
  { label: 'Start',               libIdx: 3  },
];

let gpadRemapListening = null;
let gpadRemapPollId    = null;

function getPhysicalBtn(libIdx) {
  for (const [p, l] of Object.entries(gpadMap)) {
    if (l === libIdx) return Number(p);
  }
  return null;
}

function renderGpadRemapper() {
  const grid = document.getElementById('gpad-remap-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const action of GPAD_REMAP_ACTIONS) {
    const physBtn = getPhysicalBtn(action.libIdx);
    const row = document.createElement('div');
    row.className = 'gpad-remap-row';
    const lbl = document.createElement('span');
    lbl.className = 'gpad-action-label';
    lbl.textContent = action.label;
    const btnLabel = document.createElement('span');
    btnLabel.className = 'gpad-btn-label';
    btnLabel.id = `gpad-btn-label-${action.libIdx}`;
    btnLabel.textContent = physBtn !== null ? `BTN ${physBtn}` : 'No asignado';
    const remapBtn = document.createElement('button');
    remapBtn.className = 'gpad-remap-btn key-btn';
    remapBtn.id = `gpad-remap-btn-${action.libIdx}`;
    remapBtn.textContent = 'Reasignar';
    remapBtn.addEventListener('click', () => startGpadRemap(action.libIdx, remapBtn));
    row.appendChild(lbl);
    row.appendChild(btnLabel);
    row.appendChild(remapBtn);
    grid.appendChild(row);
  }
}

function startGpadRemap(libIdx, btn) {
  cancelGpadRemap();
  gpadRemapListening = libIdx;
  btn.classList.add('listening');
  btn.textContent = 'Presioná un botón…';
  const prevState = {};
  const pad0 = (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [])[0];
  if (pad0) pad0.buttons.forEach((b, i) => { prevState[i] = b.pressed || b.value > 0.1; });
  gpadRemapPollId = setInterval(() => {
    const pad = (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [])[0];
    if (!pad) return;
    pad.buttons.forEach((b, physIdx) => {
      const pressed = b.pressed || b.value > 0.1;
      if (pressed && !prevState[physIdx]) { applyGpadRemap(physIdx, libIdx); cancelGpadRemap(); }
      prevState[physIdx] = pressed;
    });
  }, 50);
}

function cancelGpadRemap() {
  if (gpadRemapPollId) { clearInterval(gpadRemapPollId); gpadRemapPollId = null; }
  if (gpadRemapListening !== null) {
    const btn = document.getElementById(`gpad-remap-btn-${gpadRemapListening}`);
    if (btn) { btn.classList.remove('listening'); btn.textContent = 'Reasignar'; }
    gpadRemapListening = null;
  }
}

function applyGpadRemap(physicalBtn, libIdx) {
  const m = { ...gpadMap };
  delete m[physicalBtn];
  for (const [p, l] of Object.entries(m)) { if (l === libIdx) delete m[p]; }
  m[physicalBtn] = libIdx;
  gpadMap = m;
  saveGpadMap();
  renderGpadRemapper();
  renderGamepadButtons();
}

const AXIS_DEAD = 0.5;

let gpBridgeRaf = null;
const gpBridgeState = {};

function fireKey(target, keyName, pressed) {
  const code = keyNameToKeyCode(keyName);
  const init = { key: keyName, keyCode: code, which: code, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', init));
}

function startGamepadBridge() {
  if (gpBridgeRaf) return;
  function poll() {
    gpBridgeRaf = requestAnimationFrame(poll);
    if (!gameActive || !activeCore || !window.EJS_emulator?.started) return;
    const pad    = [...(navigator.getGamepads?.() || [])].filter(Boolean)[0];
    if (!pad) return;
    const parent = window.EJS_emulator.elements?.parent;
    if (!parent) return;
    const keys   = allCoreKeys[activeCore] || {};

    // Digital buttons (analog triggers also detected via .value)
    for (const [btnStr, libIdx] of Object.entries(gpadMap)) {
      const btn     = pad.buttons[Number(btnStr)];
      const pressed = btn ? (btn.pressed || btn.value > 0.1) : false;
      const sk      = 'b' + btnStr;
      if (pressed !== gpBridgeState[sk]) {
        gpBridgeState[sk] = pressed;
        const k = keys[libIdx];
        if (k) fireKey(parent, k, pressed);
      }
    }

    // Left analog stick → D-pad (also works as directional input)
    const axisEntries = [
      ['ax0n', pad.axes[0] < -AXIS_DEAD, 6],
      ['ax0p', pad.axes[0] >  AXIS_DEAD, 7],
      ['ax1n', pad.axes[1] < -AXIS_DEAD, 4],
      ['ax1p', pad.axes[1] >  AXIS_DEAD, 5],
    ];
    for (const [sk, active, libIdx] of axisEntries) {
      if (active !== gpBridgeState[sk]) {
        gpBridgeState[sk] = active;
        const k = keys[libIdx];
        if (k) fireKey(parent, k, active);
      }
    }

    // P2 gamepad (second connected controller)
    if (P2_CORES.has(activeCore)) {
      const allPads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
      const pad2 = allPads[1];
      if (pad2) {
        const keys2 = allCoreKeys2[activeCore] || {};
        for (const [btnStr, libIdx] of Object.entries(gpadMap)) {
          const btn2    = pad2.buttons[Number(btnStr)];
          const pressed = btn2 ? (btn2.pressed || btn2.value > 0.1) : false;
          const sk      = 'p2b' + btnStr;
          if (pressed !== gpBridgeState[sk]) {
            gpBridgeState[sk] = pressed;
            const k = keys2[libIdx];
            if (k) fireKey(parent, k, pressed);
          }
        }
        const axes2 = [
          ['p2ax0n', pad2.axes[0] < -AXIS_DEAD, 6],
          ['p2ax0p', pad2.axes[0] >  AXIS_DEAD, 7],
          ['p2ax1n', pad2.axes[1] < -AXIS_DEAD, 4],
          ['p2ax1p', pad2.axes[1] >  AXIS_DEAD, 5],
        ];
        for (const [sk, active, libIdx] of axes2) {
          if (active !== gpBridgeState[sk]) {
            gpBridgeState[sk] = active;
            const k = keys2[libIdx];
            if (k) fireKey(parent, k, active);
          }
        }
      }
    }

    // Fast Forward via pad button
    if (ffPadBtn !== null) {
      const ffBtn     = pad.buttons[ffPadBtn];
      const ffPressed = ffBtn?.pressed || (ffBtn?.value ?? 0) > 0.1;
      if (ffPressed !== gpBridgeState['ffpad']) {
        gpBridgeState['ffpad'] = ffPressed;
        setFastForward(ffPressed);
      }
    }
  }
  poll();
}

function stopGamepadBridge() {
  if (gpBridgeRaf) { cancelAnimationFrame(gpBridgeRaf); gpBridgeRaf = null; }
  // Release any keys that were held down
  const parent = window.EJS_emulator?.elements?.parent;
  if (parent && activeCore) {
    const keys = allCoreKeys[activeCore] || {};
    for (const [sk, wasPressed] of Object.entries(gpBridgeState)) {
      if (wasPressed) {
        // figure out which libretro idx this state key maps to and release
        gpBridgeState[sk] = false;
      }
    }
  }
}

// ── Graphics tab ─────────────────────────────────────────────────────────────
function initGraphicsTab() {
  // Sync aspect buttons
  document.querySelectorAll('#gfx-aspect .gfx-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === currentGraphics.aspect);
  });
  // Sync filter buttons
  document.querySelectorAll('#gfx-filter .gfx-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === currentGraphics.filter);
  });
  // Sync slider
  const slider = document.getElementById('gfx-scanlines');
  slider.value = currentGraphics.scanlines;
  document.getElementById('gfx-scanlines-val').textContent = currentGraphics.scanlines + '%';
}

document.querySelectorAll('#gfx-aspect .gfx-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    currentGraphics.aspect = btn.dataset.value;
    saveGraphics(currentGraphics);
    document.querySelectorAll('#gfx-aspect .gfx-opt').forEach(b => b.classList.toggle('active', b === btn));
    if (gameActive) applyGraphics(currentGraphics);
  });
});

document.querySelectorAll('#gfx-filter .gfx-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    currentGraphics.filter = btn.dataset.value;
    saveGraphics(currentGraphics);
    document.querySelectorAll('#gfx-filter .gfx-opt').forEach(b => b.classList.toggle('active', b === btn));
    if (gameActive) applyGraphics(currentGraphics);
  });
});

document.getElementById('gfx-scanlines').addEventListener('input', e => {
  currentGraphics.scanlines = Number(e.target.value);
  saveGraphics(currentGraphics);
  document.getElementById('gfx-scanlines-val').textContent = currentGraphics.scanlines + '%';
  if (gameActive) applyGraphics(currentGraphics);
});

// ── Gamepad detection (for Settings → Joystick panel) ────────────────────────
let gpPollId = null;

function updateGamepadStatus() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  if (pads.length === 0) {
    gpStatus.className = 'info-box warn';
    gpStatus.textContent = '⚠ No se detectó ningún joystick. Conectalo y presioná "Detectar joystick".';
  } else {
    gpStatus.className = 'info-box ok';
    gpStatus.textContent = `✓ ${pads.length} joystick${pads.length > 1 ? 's' : ''} detectado${pads.length > 1 ? 's' : ''}: ${pads.map(p => p.id).join(' / ')}`;
  }
}

function startGamepadPoll() {
  renderGamepadButtons();
  gpPollId = setInterval(() => { updateGamepadStatus(); refreshGamepadLights(); }, 100);
}

function stopGamepadPoll() {
  if (gpPollId) { clearInterval(gpPollId); gpPollId = null; }
}

function gpadMapLabel(physIdx) {
  const libIdx = gpadMap[physIdx];
  if (libIdx === undefined) return '';
  const action = GPAD_REMAP_ACTIONS.find(a => a.libIdx === libIdx);
  if (action) return action.label.split('/')[0].trim();
  const dpad = { 4:'↑', 5:'↓', 6:'←', 7:'→' };
  return dpad[libIdx] || '';
}

function renderGamepadButtons() {
  const allPads  = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pad1     = allPads[0];
  const pad2     = allPads[1];

  const container = document.getElementById('gamepad-buttons');
  container.innerHTML = '';
  const count = pad1 ? pad1.buttons.length : 16;
  for (let i = 0; i < count; i++) {
    const lbl = gpadMapLabel(i);
    const div = document.createElement('div');
    div.className = 'gp-btn';
    div.innerHTML = `<div class="gp-name">BTN ${i}${lbl ? `<br><span class="gp-action">${lbl}</span>` : ''}</div><div class="gp-light" id="gp-light-${i}"></div>`;
    container.appendChild(div);
  }

  const p2section  = document.getElementById('gpad-p2-section');
  const container2 = document.getElementById('gamepad-buttons-2');
  if (pad2) {
    p2section.classList.remove('hidden');
    container2.innerHTML = '';
    for (let i = 0; i < pad2.buttons.length; i++) {
      const lbl = gpadMapLabel(i);
      const div = document.createElement('div');
      div.className = 'gp-btn';
      div.innerHTML = `<div class="gp-name">BTN ${i}${lbl ? `<br><span class="gp-action">${lbl}</span>` : ''}</div><div class="gp-light" id="gp2-light-${i}"></div>`;
      container2.appendChild(div);
    }
  } else {
    p2section.classList.add('hidden');
    container2.innerHTML = '';
  }
}

function refreshGamepadLights() {
  const allPads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pad1 = allPads[0];
  const pad2 = allPads[1];
  if (pad1) pad1.buttons.forEach((btn, i) => {
    const el = document.getElementById(`gp-light-${i}`);
    if (el) el.classList.toggle('on', btn.pressed || btn.value > 0.1);
  });
  if (pad2) pad2.buttons.forEach((btn, i) => {
    const el = document.getElementById(`gp2-light-${i}`);
    if (el) el.classList.toggle('on', btn.pressed || btn.value > 0.1);
  });
}

window.addEventListener('gamepadconnected',    () => { updateGamepadStatus(); renderGpadRemapper(); renderGamepadButtons(); });
window.addEventListener('gamepaddisconnected', () => { updateGamepadStatus(); renderGamepadButtons(); });

document.getElementById('gpad-remap-reset').addEventListener('click', () => {
  cancelGpadRemap();
  gpadMap = { ...DEFAULT_GPAD_MAP };
  saveGpadMap();
  renderGpadRemapper();
  renderGamepadButtons();
});

// ── Keyboard shortcuts (window capture — runs before any EJS listener) ────────
window.addEventListener('keydown', e => {
  if (listeningBtn || ffListening) return;
  if (!e.ctrlKey && !e.metaKey && fastForwardKey && e.key === fastForwardKey && gameActive) {
    e.preventDefault(); setFastForward(true); return;
  }
  if (gameActive && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-5]$/.test(e.key)) {
    currentSlot = parseInt(e.key, 10); updateSlotBar(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); openRom(); }
  if (e.key === 'F5')     { e.preventDefault(); ejsSaveState(); }
  if (e.key === 'F9')     { e.preventDefault(); ejsLoadState(); }
  if (e.key === 'F11')    { e.preventDefault(); window.api.toggleFullscreen(); }
  if (e.key === 'Escape') { closeAllMenus(); closeControlsModal(); }
}, true);

window.addEventListener('keyup', e => {
  if (fastForwardKey && e.key === fastForwardKey) setFastForward(false);
}, true);

// ── Update banner ─────────────────────────────────────────────────────────────
let updateUrl = null;
window.api.onUpdateAvailable(({ version, url }) => {
  updateUrl = url;
  document.getElementById('update-text').textContent = `Nueva versión disponible: v${version}`;
  document.getElementById('update-banner').classList.remove('hidden');
});
document.getElementById('update-download-btn').addEventListener('click', () => {
  if (updateUrl) window.api.openExternal(updateUrl);
});
document.getElementById('update-dismiss-btn').addEventListener('click', () => {
  document.getElementById('update-banner').classList.add('hidden');
});

// ── Search & filter wiring ────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  librarySearchQuery = e.target.value;
  document.getElementById('search-clear').classList.toggle('hidden', !librarySearchQuery);
  applyLibraryFilter();
});

document.getElementById('search-clear').addEventListener('click', () => {
  librarySearchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').classList.add('hidden');
  applyLibraryFilter();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    libraryShowFavsOnly = btn.dataset.filter === 'favs';
    applyLibraryFilter();
  });
});

const sortSelect = document.getElementById('sort-select');
sortSelect.value = librarySortOrder;
sortSelect.addEventListener('change', () => {
  librarySortOrder = sortSelect.value;
  localStorage.setItem('dobbySortOrder', librarySortOrder);
  if (currentConsoleId) renderLibrary(currentConsoleId);
});

window.addEventListener('resize', () => { if (gameActive) applyGraphics(currentGraphics); });

document.getElementById('btn-clear-recents').addEventListener('click', () => {
  localStorage.removeItem('dobbyrecent');
  document.getElementById('recent-section').classList.add('hidden');
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  emujsPort  = await window.api.getEmujsPort();
  romLibrary = await window.api.scanRoms();
  renderHomeScreen();
  showScreen('home');
  statusLeft.textContent = 'Listo';
}

init();
