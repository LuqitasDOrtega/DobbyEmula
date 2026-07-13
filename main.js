const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const https = require('https');
const zlib  = require('zlib');

const GITHUB_REPO = 'LuqitasDOrtega/DobbyEmula';

function checkForUpdates() {
  const options = {
    hostname: 'api.github.com',
    path:     `/repos/${GITHUB_REPO}/releases/latest`,
    headers:  { 'User-Agent': 'DobbyEmula' },
  };
  https.get(options, res => {
    let raw = '';
    res.on('data', d => raw += d);
    res.on('end', () => {
      try {
        const { tag_name, html_url } = JSON.parse(raw);
        if (!tag_name) return;
        const latest  = tag_name.replace(/^v/, '');
        const current = app.getVersion();
        if (isNewerVersion(latest, current)) {
          mainWindow?.webContents.send('update-available', { version: latest, url: html_url });
        }
      } catch (_) {}
    });
  }).on('error', () => {});
}

function isNewerVersion(latest, current) {
  const parse = v => v.split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

// SharedArrayBuffer is required by the Emscripten pthreads model used by the
// emulator cores. Without it the WASM module fails to instantiate. Enabling it
// here via a Chromium flag is simpler than COOP/COEP and works with file://.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

let mainWindow;
let emujsServer;
let emujsPort = 0;

// ── EmulatorJS local HTTP server ─────────────────────────────────────────────
const MIME = {
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.data': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.html': 'text/html',
};

function getEmujsDir() {
  // In packaged .exe, asarUnpack extracts emulatorjs to app.asar.unpacked/
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'emulatorjs');
  }
  return path.join(__dirname, 'emulatorjs');
}

// Returns a Promise that resolves with the assigned port once the server is
// listening, eliminating any race condition between server startup and window load.
function startEmujsServer() {
  return new Promise((resolve) => {
    const dir = getEmujsDir();
    emujsServer = http.createServer((req, res) => {
      const rel  = req.url.split('?')[0];
      const file = path.join(dir, rel);
      if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          'Content-Type':                    MIME[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin':     '*',
          'Cross-Origin-Resource-Policy':    'cross-origin',
        });
        res.end(data);
      });
    });
    emujsServer.listen(0, '127.0.0.1', () => {
      emujsPort = emujsServer.address().port;
      resolve(emujsPort);
    });
  });
}

// ── macOS application menu ────────────────────────────────────────────────────
// La ventana no tiene menú propio (frame: false, menú "Archivo" dibujado en el
// HTML) — pero en Mac hace falta igual el menú de aplicación en la barra
// superior del sistema para que funcionen Cmd+Q, Cmd+C/V, Cmd+M, etc. En
// Windows/Linux se mantiene sin menú, como antes.
function buildAppMenu() {
  if (process.platform !== 'darwin') return null;
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
  ]);
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(buildAppMenu());

  mainWindow = new BrowserWindow({
    width: 1024,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    backgroundColor: '#0d0d10',
    show: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await startEmujsServer();
  createWindow();
  // Chequear actualizaciones 5 segundos después de arrancar
  setTimeout(checkForUpdates, 5000);
});
app.on('window-all-closed', () => {
  // En Mac la app se queda viva en el Dock sin ventanas — no cerrar el
  // servidor acá, sino recién al salir de verdad (before-quit).
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { emujsServer?.close(); });
app.on('activate', () => {
  // Mac: reabrir la ventana al clickear el ícono del Dock si no hay ninguna.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC ───────────────────────────────────────────────────────────────────────
const CORE_MAP = {
  '.gba': 'mgba',
  '.gb':  'gambatte',
  '.gbc': 'gambatte',
  '.md':  'genesis_plus_gx',
  '.gen': 'genesis_plus_gx',
  '.smd': 'genesis_plus_gx',
  '.bin': 'genesis_plus_gx',
  '.68k': 'genesis_plus_gx',
  '.sms': 'smsplus',
  '.gg':  'smsplus',
  '.sfc': 'snes9x',
  '.smc': 'snes9x',
  '.snes':'snes9x',
  '.a26': 'atari2600',
  '.rom': 'atari2600',
  '.nds': 'nds',
  '.cue': 'psx',
  '.iso': 'psx',
  '.chd': 'psx',
  '.pbp': 'psx',
  '.img': 'psx',
  '.nes': 'nes',
  '.pce': 'pce',
};

const CONSOLES = [
  { id: 'genesis',      core: 'genesis_plus_gx', name: 'Sega Genesis',     folder: 'Sega Genesis',     exts: ['.md','.gen','.smd','.bin','.68k'] },
  { id: 'snes',         core: 'snes9x',           name: 'Super Nintendo',   folder: 'Super Nintendo',   exts: ['.sfc','.smc','.snes'] },
  { id: 'mastersystem', core: 'smsplus',          name: 'Master System',    folder: 'Master System',    exts: ['.sms','.gg'] },
  { id: 'gba',          core: 'mgba',             name: 'Game Boy Advance', folder: 'Game Boy Advance', exts: ['.gba'] },
  { id: 'gbc',          core: 'gambatte',         name: 'Game Boy Color',   folder: 'Game Boy Color',   exts: ['.gbc'] },
  { id: 'gb',           core: 'gambatte',         name: 'Game Boy',         folder: 'Game Boy',         exts: ['.gb'] },
  { id: 'atari2600',    core: 'atari2600',        name: 'Atari 2600',       folder: 'Atari 2600',       exts: ['.a26','.bin','.rom'] },
  { id: 'nds',          core: 'nds',              name: 'Nintendo DS',      folder: 'Nintendo DS',      exts: ['.nds'] },
  { id: 'psx',          core: 'psx',              name: 'PlayStation',      folder: 'PlayStation',      exts: ['.cue','.iso','.chd','.pbp','.img','.bin'] },
  { id: 'nes',          core: 'nes',              name: 'NES',              folder: 'NES',              exts: ['.nes'] },
  { id: 'pce',          core: 'pce',              name: 'PC Engine',        folder: 'PC Engine',        exts: ['.pce'] },
];

// Carpeta "portable" al lado del ejecutable — donde viven ROMs/ y Saves/.
// Windows: PORTABLE_EXECUTABLE_DIR (seteada por el target portable de electron-builder).
// macOS: process.execPath apunta a AppName.app/Contents/MacOS/AppName — subimos
// 4 niveles para llegar a la carpeta que contiene el .app (mismo lugar en el
// que el usuario lo tenga: Descargas, Aplicaciones, etc.), imitando el mismo
// comportamiento portable que en Windows.
function getPortableBaseDir() {
  if (!app.isPackaged) return __dirname;
  if (process.platform === 'darwin') {
    return path.dirname(path.dirname(path.dirname(path.dirname(process.execPath))));
  }
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) return portableDir;
  return path.dirname(process.execPath);
}

function getRomsDir()  { return path.join(getPortableBaseDir(), 'ROMs'); }
function getSavesDir() { return path.join(getPortableBaseDir(), 'Saves'); }

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
}

function stateFilePath(consoleId, romName, slot) {
  return path.join(getSavesDir(), consoleId, `${sanitizeName(romName)}_slot${slot}.state`);
}

// Los juegos de PSX multi-pista traen 1 .cue + varios .bin (pistas de audio CD).
// El .cue referencia cada .bin por nombre exacto en líneas `FILE "x.bin" BINARY`.
function parseCueFileRefs(content) {
  const refs = [];
  const re = /FILE\s+(?:"([^"]+)"|(\S+))\s+BINARY/gi;
  let m;
  while ((m = re.exec(content))) refs.push(m[1] || m[2]);
  return refs;
}

// Sin este filtro, cada .bin referenciado aparecería como una entrada aparte
// en la biblioteca además del .cue.
function getCueReferencedBins(dir, cueFiles) {
  const referenced = new Set();
  for (const cueFile of cueFiles) {
    try {
      const content = fs.readFileSync(path.join(dir, cueFile), 'utf8');
      for (const ref of parseCueFileRefs(content)) referenced.add(ref.toLowerCase());
    } catch (_) {}
  }
  return referenced;
}

// EmulatorJS solo puede arrancar un juego desde UN archivo (o un .zip/.7z que
// contenga varios). Un .cue de PSX multi-pista necesita el .cue + todos sus
// .bin en el mismo "disco" virtual — así que se empaquetan en un .zip en
// memoria (sin comprimir, más rápido) y eso es lo que se le manda al emulador.
// EJS detecta el formato por firma de bytes (PK\x03\x04) y lo descomprime solo.
function buildStoredZip(entries) {
  const localParts   = [];
  const centralParts = [];
  let offset = 0;
  const now     = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc     = zlib.crc32(data) >>> 0;
    const size    = data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralDirStart = offset;
  const centralDir      = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

// Arma el .zip en memoria para un .cue: el archivo mismo + cada .bin que referencia.
function buildCueZip(cuePath) {
  const dir       = path.dirname(cuePath);
  const cueName   = path.basename(cuePath);
  const cueBuffer = fs.readFileSync(cuePath);
  const refs      = parseCueFileRefs(cueBuffer.toString('utf8'));
  const dirFiles  = fs.readdirSync(dir);

  const entries = [{ name: cueName, data: cueBuffer }];
  for (const ref of refs) {
    const match = dirFiles.find(f => f.toLowerCase() === ref.toLowerCase());
    if (!match) throw new Error(`No se encontró "${ref}" (referenciado por ${cueName})`);
    entries.push({ name: match, data: fs.readFileSync(path.join(dir, match)) });
  }
  return buildStoredZip(entries);
}

ipcMain.handle('scan-roms', () => {
  const base = getRomsDir();
  return CONSOLES.map(con => {
    const dir  = path.join(base, con.folder);
    let roms = [];
    try {
      fs.mkdirSync(dir, { recursive: true });
      const readme = path.join(dir, '_Léeme.txt');
      {
        fs.writeFileSync(readme,
          `${con.name}\r\n` +
          `${'─'.repeat(con.name.length)}\r\n` +
          `Extensiones aceptadas: ${con.exts.join(', ')}\r\n` +
          `Copiá tus ROMs en esta carpeta y reiniciá DobbyEmula.\r\n`,
          'utf8'
        );
      }
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (con.exts.includes(ext)) {
          roms.push({ name: path.basename(file, ext), file, ext, fullPath: path.join(dir, file) });
        }
      }
      if (con.exts.includes('.cue')) {
        const cueFiles    = files.filter(f => path.extname(f).toLowerCase() === '.cue');
        const referenced  = getCueReferencedBins(dir, cueFiles);
        roms = roms.filter(r => !(r.ext === '.bin' && referenced.has(r.file.toLowerCase())));
      }
    } catch (_) {}
    return { ...con, roms };
  });
});

ipcMain.handle('open-rom-by-path', (_, romPath) => {
  const ext  = path.extname(romPath).toLowerCase();
  const core = CORE_MAP[ext];
  if (!core) return { error: `Extensión ${ext} no soportada` };

  if (ext === '.cue') {
    try {
      const zip    = buildCueZip(romPath);
      const buffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
      return { name: path.basename(romPath, ext), ext, core, data: buffer, port: emujsPort };
    } catch (e) {
      return { error: e.message };
    }
  }

  const data   = fs.readFileSync(romPath);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return { name: path.basename(romPath, ext), ext, core, data: buffer, port: emujsPort };
});

ipcMain.handle('get-emujs-port', () => emujsPort);

ipcMain.handle('open-rom', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir ROM',
    properties: ['openFile'],
    filters: [
      { name: 'ROMs',         extensions: ['gba','gb','gbc','md','gen','smd','bin','sms','gg','68k','sfc','smc','snes','cue','iso','chd','pbp','img','a26','rom','nds','nes','pce'] },
      { name: 'Todos',        extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const romPath = result.filePaths[0];
  const ext     = path.extname(romPath).toLowerCase();
  const core    = CORE_MAP[ext];
  if (!core) return { error: `Extension ${ext} no soportada` };

  const data = fs.readFileSync(romPath);
  // Slice to get a clean ArrayBuffer without shared-memory offset issues
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return {
    name: path.basename(romPath, ext),
    ext,
    core,
    data: buffer,
    port: emujsPort,
    fullPath: romPath,
  };
});

ipcMain.handle('save-state', (_, { consoleId, romName, slot, data }) => {
  const dir  = path.join(getSavesDir(), consoleId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFilePath(consoleId, romName, slot), Buffer.from(data));
  return true;
});

ipcMain.handle('load-state', (_, { consoleId, romName, slot }) => {
  const file = stateFilePath(consoleId, romName, slot);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('list-save-slots', (_, { consoleId, romName }) => {
  const dir    = path.join(getSavesDir(), consoleId);
  const prefix = sanitizeName(romName) + '_slot';
  const filled = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix) && f.endsWith('.state')) {
        const n = parseInt(f.slice(prefix.length, -6), 10);
        if (n >= 1 && n <= 5) filled.push(n);
      }
    }
  } catch (_) {}
  return filled;
});

ipcMain.on('open-external', (_, url) => shell.openExternal(url));
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());
ipcMain.on('toggle-fullscreen', () => mainWindow.setFullScreen(!mainWindow.isFullScreen()));
