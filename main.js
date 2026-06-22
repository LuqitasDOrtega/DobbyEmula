const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const https = require('https');

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

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(null);

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
  emujsServer?.close();
  if (process.platform !== 'darwin') app.quit();
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
];

function getRomsDir() {
  if (app.isPackaged) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) return path.join(portableDir, 'ROMs');
    return path.join(path.dirname(process.execPath), 'ROMs');
  }
  return path.join(__dirname, 'ROMs');
}

function getSavesDir() {
  if (app.isPackaged) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) return path.join(portableDir, 'Saves');
    return path.join(path.dirname(process.execPath), 'Saves');
  }
  return path.join(__dirname, 'Saves');
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
}

function stateFilePath(consoleId, romName, slot) {
  return path.join(getSavesDir(), consoleId, `${sanitizeName(romName)}_slot${slot}.state`);
}

ipcMain.handle('scan-roms', () => {
  const base = getRomsDir();
  return CONSOLES.map(con => {
    const dir  = path.join(base, con.folder);
    const roms = [];
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
      for (const file of fs.readdirSync(dir)) {
        const ext = path.extname(file).toLowerCase();
        if (con.exts.includes(ext)) {
          roms.push({ name: path.basename(file, ext), file, ext, fullPath: path.join(dir, file) });
        }
      }
    } catch (_) {}
    return { ...con, roms };
  });
});

ipcMain.handle('open-rom-by-path', (_, romPath) => {
  const ext  = path.extname(romPath).toLowerCase();
  const core = CORE_MAP[ext];
  if (!core) return { error: `Extensión ${ext} no soportada` };
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
      { name: 'ROMs',         extensions: ['gba','gb','gbc','md','gen','smd','bin','sms','gg','68k','sfc','smc','snes'] },
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
