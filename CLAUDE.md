# DobbyEmula — Documentación del Proyecto

## ¿Qué es?
Frontend de emulación de escritorio para Windows (y próximamente Mac y Android). Pantalla de inicio con selector de consolas, biblioteca de juegos con cover art, y el juego corriendo adentro del canvas. Estilo MelonDS: ventana propia, menú de archivo, sin ejecutables externos.

## Stack tecnológico
- **Electron 31** (Node.js 24) — app de escritorio
- **EmulatorJS** (cores WASM) — emulación dentro del canvas, sin ejecutables externos
- **electron-builder** — genera el `.exe` portable

## Estructura de archivos
```
Emulador/
├── dist/
│   ├── DobbyEmula 1.1.3.exe     ← EXE portable final
│   ├── Icono DobbyEmula.png     ← Imagen fuente del ícono (la del usuario)
│   ├── ROMs/                    ← ROMs del usuario (deben estar AL LADO del .exe)
│   │   ├── Sega Genesis/
│   │   ├── Super Nintendo/
│   │   ├── Master System/
│   │   ├── Game Boy Advance/
│   │   ├── Game Boy Color/
│   │   ├── Game Boy/
│   │   ├── Atari 2600/
│   │   ├── Nintendo DS/
│   │   └── PlayStation/
│   └── Saves/                   ← Save states portables (creada automáticamente)
│       ├── genesis/
│       ├── gba/
│       └── ...
├── assets/
│   ├── icon.png                 ← Copia del ícono fuente (lo usa electron-builder)
│   ├── icon.ico                 ← Generado por gen-icon.mjs (ya no se usa en build)
│   └── icon-preview.png         ← PNG 256x256 transparente — usado en la UI de la app
├── emulatorjs/                   ← EmulatorJS v4.2.3 — cores WASM y assets
│   ├── loader.js
│   ├── emulator.min.js
│   ├── emulator.min.css
│   ├── compression/
│   │   └── extract7z.js              ← descompresor de cores (REQUERIDO)
│   └── cores/
│       ├── genesis_plus_gx-wasm.data / genesis_plus_gx-legacy-wasm.data
│       ├── mgba-wasm.data / mgba-legacy-wasm.data
│       ├── gambatte-wasm.data / gambatte-legacy-wasm.data
│       ├── smsplus-wasm.data / smsplus-legacy-wasm.data
│       ├── snes9x-wasm.data / snes9x-legacy-wasm.data
│       ├── stella2014-wasm.data / stella2014-legacy-wasm.data
│       ├── desmume-wasm.data / desmume-legacy-wasm.data
│       └── pcsx_rearmed-wasm.data / pcsx_rearmed-legacy-wasm.data
├── ROMs/                         ← ROMs en desarrollo
│   ├── Sega Genesis/             (.md .gen .smd .bin .68k)
│   ├── Super Nintendo/           (.sfc .smc .snes)
│   ├── Master System/            (.sms .gg)
│   ├── Game Boy Advance/         (.gba)
│   ├── Game Boy Color/           (.gbc)
│   ├── Game Boy/                 (.gb)
│   ├── Atari 2600/               (.a26 .bin .rom)
│   ├── Nintendo DS/              (.nds)
│   └── PlayStation/              (.cue .iso .chd .pbp .img .bin)
├── Saves/                        ← Save states en desarrollo
│   ├── genesis/
│   ├── gba/
│   └── ...
├── scripts/
│   └── gen-icon.mjs             ← Convierte PNG a ICO con fondo transparente (sharp + png-to-ico)
├── renderer/
│   ├── index.html                ← UI (titlebar, menús, pantallas home/library/game, modal cfg)
│   ├── styles.css                ← Tema oscuro
│   └── app.js                    ← Lógica del renderer
├── main.js                       ← Proceso principal Electron + HTTP server + IPC
├── preload.js                    ← Bridge IPC seguro
└── package.json
```

## Cómo correr en desarrollo
```
npm start
```
Si Electron falla ("failed to install correctly"):
```powershell
$zip = "$env:LOCALAPPDATA\electron\Cache\c94f2fc32e1fb05767f75322ea533eeb9828155f017ec184140930a3ec825e81\electron-v31.7.7-win32-x64.zip"
Expand-Archive -Path $zip -DestinationPath "node_modules\electron\dist" -Force
"electron.exe" | Out-File "node_modules\electron\path.txt" -Encoding ascii -NoNewline
```

## Cómo generar el .exe
```
npm run build
```
Genera `dist\DobbyEmula 1.1.3.exe` (~88MB portable).

## Git y GitHub

- Repo: **https://github.com/LuqitasDOrtega/DobbyEmula** (público)
- Remote guardado con token en la URL — para pushear: `git push`
- `.gitignore` excluye: `ROMs/`, `Saves/`, `node_modules/`, `dist/`
- Para publicar una actualización: hacer cambios → `git add . && git commit -m "..." && git push` → crear Release en GitHub con el nuevo `.exe`

## Ícono de la aplicación

### Ícono del .exe (explorador de Windows)
- Fuente: `dist/Icono DobbyEmula.png` (imagen del usuario — triángulo ▶ 3D morado con calcetín y texto "DobbyEmu")
- Copiada a `assets/icon.png` (sin espacios para evitar problemas)
- `package.json` apunta a `"icon": "assets/icon.png"` → electron-builder convierte a ICO internamente
- **IMPORTANTE**: NO usar el `assets/icon.ico` generado por `gen-icon.mjs` — electron-builder convierte el PNG él solo de forma más confiable

### Ícono dentro de la app (titlebar + home screen)
- Archivo: `assets/icon-preview.png` (256x256, fondo transparente)
- Generado por `scripts/gen-icon.mjs` que elimina el fondo negro pixel a pixel
- `renderer/index.html` línea 13: `<img id="logo">` en la barra de título
- `renderer/index.html` línea 70: `<img id="home-logo">` en la pantalla home

### Si el ícono del .exe no aparece en el explorador
Windows cachea los íconos. Soluciones:
1. Reiniciar la PC (más seguro)
2. O ejecutar en PowerShell:
```powershell
taskkill /f /im explorer.exe; Remove-Item "$env:LOCALAPPDATA\IconCache.db" -Force -ErrorAction SilentlyContinue; Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*" -Force -ErrorAction SilentlyContinue; Start-Process explorer.exe
```

### Si hay que regenerar el icon-preview.png (para la UI)
```
node scripts/gen-icon.mjs
```
Toma `dist/Icono DobbyEmula.png`, elimina el fondo negro, guarda `assets/icon-preview.png`.

## Arquitectura clave

### Flujo de navegación (3 pantallas)
```
Home (selector de consolas)
  ↓ click consola
Library (grid de juegos con cover art)
  ↓ click juego
Game (EmulatorJS corriendo)
  ↓ Archivo → Cerrar ROM
Library (vuelve a la consola que estaba)
```
- `showScreen('home' | 'library' | 'game', consoleId?)` maneja las transiciones
- `currentConsoleId` se resetea a `null` al volver al Home

### Servidor HTTP local (main.js)
- Arranca en un puerto aleatorio al iniciar la app
- Sirve los archivos de `emulatorjs/` para que el canvas los cargue
- En `.exe` los archivos están en `app.asar.unpacked/emulatorjs/`
- Usa `getEmujsDir()` para resolver la ruta correcta según el modo
- La ventana se muestra con `show: true` (sin esperar `ready-to-show`) para arrancar más rápido

### ROMs path en el .exe portable
```javascript
function getRomsDir() {
  if (app.isPackaged) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) return path.join(portableDir, 'ROMs');
    return path.join(path.dirname(process.execPath), 'ROMs');
  }
  return path.join(__dirname, 'ROMs');
}
```
**CRÍTICO**: el portable .exe se extrae a una carpeta temporal al ejecutarse. `process.execPath` apunta ahí, no al `.exe` original. Siempre usar `PORTABLE_EXECUTABLE_DIR`.

### Saves path en el .exe portable
Mismo patrón que ROMs pero con `Saves/`:
```javascript
function getSavesDir() {
  if (app.isPackaged) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) return path.join(portableDir, 'Saves');
    return path.join(path.dirname(process.execPath), 'Saves');
  }
  return path.join(__dirname, 'Saves');
}
```

### Escaneo de ROMs (main.js → renderer)
- `scan-roms` IPC: escanea las carpetas, devuelve `{ id, core, name, folder, exts, roms[] }[]`
- También **crea las subcarpetas** de ROMs si no existen y **regenera `_Léeme.txt` en cada una siempre** (para reflejar extensiones actuales)
- `open-rom-by-path` IPC: carga una ROM por path sin diálogo
- `CONSOLES` array en main.js define las 9 consolas con sus carpetas y extensiones

### Cover art (renderer/app.js)
- Fuente: **libretro-thumbnails** en GitHub (sin API key, igual que RetroArch)
- Sistemas: `Sega_-_Mega_Drive_-_Genesis`, `Sega_-_Master_System_-_Mark_III`, `Nintendo_-_Game_Boy_Advance`, `Nintendo_-_Game_Boy_Color`, `Nintendo_-_Game_Boy`, `Atari_-_2600`, `Nintendo_-_Nintendo_DS`, `Sony_-_PlayStation`
- Cache: localStorage `dobbycover_{consoleId}_{romName}` (base64 dataURL)
- Si no hay cover → placeholder con las 2 primeras letras del nombre
- Botón `✎` en hover → imagen propia (mismo cache key)
- Botón `↺` en hover → borra y re-fetcha la automática

**Estrategia de carga (performance para 400+ ROMs):**
1. `getThumbnailTree(system)` — llama a la GitHub tree API una sola vez por sistema, cachea 7 días en localStorage (`dobbytree_{system}`). Construye un `Set` local con todos los nombres disponibles.
2. `fetchCover(consoleId, romName)` — busca candidatos en el Set local (0 requests para misses), luego hace 1 solo fetch HTTP al match.
3. **IntersectionObserver** lazy loading (rootMargin 300px) — solo carga las portadas visibles.
4. Throttle queue `MAX_COVER_CONCURRENT=8` — máximo 8 requests simultáneos.

**Estrategia de búsqueda `fetchCover`** (en orden):
1. Nombre exacto del archivo
2. Sustituciones de región: `(ESP)` → `(Europe)`, `(USA)`, `(World)`, `(Japan)`, `(Spain)`, `(Brazil)` — con y sin suffix como `(v1.1)`
3. Nombre sin región
4. Nombre sin todos los tags entre paréntesis (nombre base puro)

**Problema conocido**: ROMs con nombre distinto al No-Intro (ej. `Pokemon - Fire Red Version` vs `Pokemon - FireRed Version`) no van a encontrar portada → usar `✎`.

### Búsqueda, favoritos y ordenamiento (renderer/app.js + index.html)
- **Barra de búsqueda** (`#search-input`): filtra juegos por nombre en tiempo real dentro de la biblioteca activa.
- **Favoritos**: botón ⭐ en hover sobre cada card → guarda en localStorage `dobbyfav_{consoleId}_{romName}` = `'1'`.
- **Filtro**: botones "Todos" / "★ Favoritos" en `#filter-btns`.
- **Ordenamiento**: select `#sort-select` con opciones `az` (A→Z), `za` (Z→A), `fav` (★ Primero). Se aplica en `renderLibrary` antes de generar las cards. Persiste en localStorage `dobbySortOrder`.
- `applyLibraryFilter()` aplica búsqueda + filtro simultáneamente sin re-renderizar el grid. El orden ya está fijado en el DOM desde `renderLibrary`.

### Mapeo extensión → sistema EmulatorJS
| Extensión | Sistema EJS | Core real |
|-----------|-------------|-----------|
| `.gba` | `gba` | mgba |
| `.gb`, `.gbc` | `gb` | gambatte |
| `.md`, `.gen`, `.smd`, `.bin`, `.68k` | `genesis_plus_gx` | genesis_plus_gx |
| `.sms`, `.gg` | `smsplus` | smsplus |
| `.sfc`, `.smc`, `.snes` | `snes9x` | snes9x |
| `.a26`, `.bin`, `.rom` | `atari2600` | stella2014 |
| `.nds` | `nds` | desmume |
| `.cue`, `.iso`, `.chd`, `.pbp`, `.img`, `.bin` | `psx` | pcsx_rearmed |

**CRÍTICO — EJS espera el nombre del SISTEMA, no del core:**
- `window.EJS_core` debe ser el sistema (`atari2600`, `nds`, `gba`, `psx`) — EJS elige el core internamente
- Los sistemas genéricos como `genesis_plus_gx` también funcionan porque EJS los acepta como nombre directo
- El mapa completo de sistemas está en `emulator.min.js`: `{atari2600:["stella2014"], nds:["melonds","desmume","desmume2015"], gba:["mgba"], psx:["pcsx_rearmed","mednafen_psx_hw"], ...}`

**CRÍTICO — Extensiones ambiguas (`.bin`):**
- `.bin` existe en Genesis, Atari 2600 Y PlayStation — `CORE_MAP` solo puede mapear a uno (Genesis)
- Solución: `openRomByPath(fullPath, consoleId)` en renderer usa `con?.core` de `romLibrary` si tiene `consoleId`, ignorando el CORE_MAP para ese caso
- Esto funciona porque los clicks de librería siempre pasan el `consoleId` correcto
- Consecuencia: un `.bin` de PSX abierto desde Archivo → Abrir ROM (sin consoleId) cargará como Genesis. El usuario debe abrirlo desde la biblioteca o usar `.cue`/`.iso`/`.chd`

### Sistema de controles por consola — Jugador 1 y 2 (renderer/app.js)
`CORE_PROFILES` define botones, índices libretro y teclas por defecto para P1. Se guarda en `dobbyControls_${core}` en localStorage.

**Jugador 2:**
- Consolas con soporte P2: `genesis_plus_gx`, `snes9x`, `smsplus`, `psx` (definidas en `P2_CORES`)
- GBA, Game Boy, NDS, Atari 2600 NO tienen P2
- Teclas P2 guardadas en `dobbyControls2_{core}` en localStorage
- Defaults P2: D-pad en IJKL, botones en U/O/H/N, hombros en Y/P/G/[
- `patchControlsWhenReady` parchea `controls[0]` (P1) Y `controls[1]` (P2) para consolas en P2_CORES
- Toggle **Jugador 1 / Jugador 2** en la tab Controles — al cambiar a P2 se ocultan las consolas no-P2
- `currentPlayer` (1 o 2) controla qué mapa de teclas edita el grid

**CRÍTICO — genesis_plus_gx libretro mapping:**
- libretro B (idx 0) → Genesis **B** (ataque principal) → Z
- libretro Y (idx 1) → Genesis **A** (botón izquierdo) → A
- libretro A (idx 8) → Genesis **C** (salto/secundario) → X

**Flujo del patcher (`patchControlsWhenReady`):**
1. Espera `EJS_emulator.started === true` AND `gameManager !== null`
2. Escribe keyCodes en `controls[0][idx].value`
3. Oculta "Control Settings" del HUD de EJS
4. Llama `parent.focus()`
5. Arranca `startGamepadBridge()`

### Gamepad bridge (renderer/app.js)
EmulatorJS no lee el joystick directamente en Electron. Solución: bridge que pollea el Gamepad API cada frame y dispara `KeyboardEvent` sintéticos a `EJS_emulator.elements.parent`.

El mapeo físico→libretro es configurable via **remapper** (tab Joystick → Mapeo de botones). Se guarda en localStorage `dobbyGpadMap`. El default es:
```javascript
const DEFAULT_GPAD_MAP = {
  0:8, 1:0, 2:1, 3:9,       // A/B/X/Y face buttons → libretro A/B/Y/X
  4:10, 5:11, 6:12, 7:13,   // L1/R1/L2/R2
  8:2, 9:3,                  // Select/Start
  12:4, 13:5, 14:6, 15:7,   // D-pad
};
```
El stick analógico izquierdo también funciona como D-pad (threshold 0.5).
- `startGamepadBridge()` → se llama al final de `patchControlsWhenReady`
- `stopGamepadBridge()` → se llama en `closeRom()`
- El bridge también pollea `getGamepads()[1]` para el **Jugador 2** (si la consola activa está en `P2_CORES`)

### Modal de configuración (Configuración → ...)
Modal con 4 tabs externas:
- **Controles** — toggle Jugador 1 / Jugador 2 arriba + tabs internas por consola (SNES/Genesis/GBA/Game Boy/Master System/Atari 2600/Nintendo DS/PlayStation), con Guardar/Restablecer
- **Joystick** — detección, visualizador de botones del gamepad P1 (y P2 si hay segundo pad conectado), remapper de botones físicos
- **Atajos** — tabla de shortcuts + configuración de tecla/botón y velocidad de Fast Forward
- **Gráficos** — relación de aspecto, filtro de imagen, scanlines CRT

**IMPORTANTE**: al abrir el modal con un juego corriendo, el juego se **pausa automáticamente** (`gamePausedByModal = true`) y se reanuda al cerrarlo. Solo pausa si estaba corriendo (no toca el estado si ya estaba pausado).

**Botón Cancelar**: usa clase `modal-cancel-btn` (no `modal-close-btn` que tiene 26×26px fijo). El ✕ del header sigue usando `modal-close-btn`. El JS escucha ambas: `.modal-close-btn, .modal-cancel-btn`.

### Fast Forward (renderer/app.js)
- **Tecla o botón de joystick** configurable (default: Tab) — mantener apretado para acelerar
- Velocidad configurable: 2×, 3×, 4×, 8× (default 3×, guardado en localStorage `dobbyFFSpeed`)
- Storage: `dobbyFFKey` (teclado) o `dobbyFFPadBtn` (índice del botón de gamepad) — mutuamente excluyentes
- Display: tecla → nombre de tecla, pad → "🎮 L2" etc. usando `GP_BTN_NAMES`
- Detección analógica: usa `btn.pressed || btn.value > 0.1` para capturar gatillos que no setean `.pressed`
- API correcta de EJS v4.2.3:
  ```javascript
  gm.functions.setFastForwardRatio(n);  // n = multiplicador
  gm.functions.toggleFastForward(1);    // 1 = activar, 0 = desactivar — SIEMPRE pasar argumento
  ```
- **CRÍTICO**: `toggleFastForward()` sin argumento recibe `undefined`→0→desactiva. Siempre pasar 1 o 0.
- Keydown/keyup usan `window.addEventListener(..., true)` (capture phase) para interceptar antes de EJS.
- El pad FF se chequea dentro del loop de `startGamepadBridge()` cada frame.
- La notificación "Fast-Forward." es dibujada por WASM en el canvas — no es DOM, no se puede estilizar con CSS.

### Save States por slots (renderer/app.js + main.js)
Sistema propio que reemplaza el `clickEjsBtn('Save State')` anterior.

**5 slots por juego**, guardados como archivos portables:
- Ruta: `Saves/{consoleId}/{romName}_slot{n}.state` al lado del `.exe`
- Extensión `.state` — binario puro, no importa la extensión
- `sanitizeName(name)` elimina caracteres ilegales en Windows, limita a 100 chars

**IPC handlers en main.js:**
- `save-state` → `{ consoleId, romName, slot, data }` → escribe archivo
- `load-state` → `{ consoleId, romName, slot }` → devuelve ArrayBuffer o null
- `list-save-slots` → `{ consoleId, romName }` → devuelve array de slots con archivo existente

**API de EJS para leer/escribir estado:**
```javascript
// Guardar:
const raw = typeof gm.getState === 'function' ? gm.getState() : gm.functions.saveStateInfo();
// Cargar:
if (typeof gm.loadState === 'function') gm.loadState(uint8);
else gm.functions.loadState(uint8);
```

**Slot bar en la barra de estado** (`#slot-bar` en index.html):
- Visible solo durante el juego
- Botones 1-5 clickeables para cambiar de slot
- Teclas 1-5 durante el juego también cambian de slot (capture phase, sin modificadores)
- Punto `•` arriba del número si el slot tiene archivo guardado (clase `.filled`)
- Borde iluminado en el slot activo (clase `.active`)
- F5 guarda / F9 carga en el slot activo

**Variables en app.js:**
```javascript
let activeRomName   = '';  // nombre de la ROM activa
let activeConsoleId = '';  // consoleId de la ROM activa
let currentSlot     = 1;  // slot seleccionado (1-5)
let filledSlots     = new Set(); // slots que tienen archivo guardado
```

### HUD de EmulatorJS — IMPORTANTE
- `EJS_emulator.elements` solo tiene: `main`, `parent`, `contextmenu`, `menu`, `bottomBar`, `cheatRows`, `statePopupPanel`
- **NO tiene** `playPause`, `restart`, `saveState`, `loadState` — siempre usar `clickEjsBtn(texto)`
- "Control Settings" del HUD queda **oculto** (usamos el modal propio)

### Atajos de teclado globales
| Tecla | Acción |
|-------|--------|
| Ctrl+O | Abrir ROM |
| F5 | Guardar estado (slot activo) |
| F9 | Cargar estado (slot activo) |
| F11 | Pantalla completa |
| 1-5 | Cambiar slot (solo durante juego) |
| Escape | Cerrar menús / modal |
| Tab (configurable) | Fast Forward (mantener) |

### Carpetas de ROMs — auto-creación e info
Al iniciar la app, `scan-roms` crea las carpetas de ROMs si no existen y genera `_Léeme.txt` en cada subcarpeta con las extensiones aceptadas. Útil para nuevos usuarios.

La pantalla vacía de biblioteca también muestra la ruta y extensiones aceptadas dinámicamente.

### Sistema de actualizaciones (main.js + renderer)
- Al arrancar, espera 5 segundos y consulta `https://api.github.com/repos/LuqitasDOrtega/DobbyEmula/releases/latest`
- Compara `tag_name` (ej. `v1.2.0`) con `app.getVersion()` usando `isNewerVersion()`
- Si hay versión nueva: `mainWindow.webContents.send('update-available', { version, url })`
- El renderer muestra un banner verde en la parte inferior con botón "Descargar" que abre el navegador
- El usuario descarga el nuevo `.exe` desde GitHub Releases y reemplaza el viejo
- IPC: `open-external` → `shell.openExternal(url)` | `onUpdateAvailable` en preload
- Banner: `#update-banner` en index.html, clase `.hidden` para ocultarlo, botón `#update-dismiss-btn` para cerrar

**Flujo para publicar actualización:**
1. Hacer cambios en el código
2. Actualizar versión en `package.json`
3. `git add . && git commit -m "..." && git push`
4. En GitHub → Releases → New release → tag `v{version}` → subir el `.exe` → Publish
5. Los usuarios lo ven automáticamente la próxima vez que abran la app

### Fondo del home screen (renderer/styles.css)
`#screen-home` tiene un patrón de líneas diagonales tenues sobre el fondo oscuro:
```css
background-color: var(--bg);
background-image: repeating-linear-gradient(
  -45deg,
  rgba(255,255,255,0.04) 0px,
  rgba(255,255,255,0.04) 2px,
  transparent 2px,
  transparent 10px
);
```
**CRÍTICO**: NO agregar `background: var(--bg)` después de `background-image` en la misma regla — el shorthand resetea `background-image` a `none`.

### Remapper de botones del joystick (renderer/app.js + index.html)
Tab Joystick → sección "Mapeo de botones": permite reasignar qué botón físico del gamepad dispara cada acción libretro.
- `GPAD_REMAP_ACTIONS` array con labels y libIdx de cada acción
- `renderGpadRemapper()` dibuja la grilla; `startGpadRemap(libIdx)` inicia polling; `applyGpadRemap(physBtn, libIdx)` guarda
- Mapa guardado en `dobbyGpadMap` localStorage; reseteable con botón "Restaurar predeterminado"

### Visualizador P2 en tab Joystick (renderer/app.js + index.html)
- `#gpad-p2-section` — div oculto por defecto, aparece solo cuando hay un segundo gamepad conectado
- `renderGamepadButtons()` lo muestra/oculta según `getGamepads()[1]` y dibuja luces `gp2-light-{i}`
- `refreshGamepadLights()` actualiza luces de P1 (`gp-light-{i}`) Y P2 (`gp2-light-{i}`)
- `gamepaddisconnected` también llama `renderGamepadButtons()` para ocultar P2 al desconectar

### Recientes sin duplicados (renderer/app.js)
`saveToRecent` normaliza el `fullPath` antes de comparar (`toLowerCase + replace \\ → /`) para evitar duplicados por diferencias de barras o mayúsculas en Windows.

### Build limpia .exe viejos automáticamente (package.json)
Script `prebuild` en package.json borra todos los `.exe` de `dist/` antes de cada build. Solo queda el nuevo.

## Pendiente / Ideas futuras
- Verificar que el ícono del .exe aparezca en el explorador después de reiniciar la PC
- Historial de ROMs recientes (lógica `saveToRecent` ya existe, falta UI en el home)
- Más opciones de gráficos
- NES (fceumm/nestopia), N64 (mupen64plus_next) — cores disponibles en EJS CDN

## Expansión multiplataforma (planificado)

### Colaboración con Git + GitHub
- Repo ya inicializado en **https://github.com/LuqitasDOrtega/DobbyEmula**
- Cada colaborador trabaja en su propia rama y hace merge

### Mac (colaborador externo)
- Electron soporta Mac de fábrica — solo ajustar build target a `dmg` en package.json
- Rutas de archivos usan `/` igual que Node.js `path` — compatibles
- El menú nativo de Mac va en la barra superior del sistema, no en la ventana — hay que adaptar el menú de Archivo

### Mobile / Android (futuro)
- Tecnología: **Capacitor** — toma el renderer HTML/CSS/JS existente y lo empaqueta como app nativa
- EmulatorJS WASM funciona en WebView móvil (GBA/GB bien, Genesis más o menos)
- **Diferencias clave respecto al desktop:**
  - ROMs: el usuario las importa desde dentro de la app (sin acceso al filesystem libre)
  - Controles: EmulatorJS tiene botones táctiles integrados
  - Sin IPC de Electron — los handlers de main.js (ROMs, saves) habría que reimplementarlos con plugins de Capacitor
- iOS requiere distribución por App Store / TestFlight — Android más flexible
- Prioridad: Android primero

## Problemas conocidos resueltos

### 1. Network error al cargar ROM
**Causa**: archivos `*-legacy-wasm.data` y `compression/extract7z.js` faltaban.
```powershell
$base = "https://cdn.emulatorjs.org/4.2.3/data"; $dir = ".\emulatorjs"
"compression/extract7z.js","cores/genesis_plus_gx-legacy-wasm.data","cores/mgba-legacy-wasm.data","cores/gambatte-legacy-wasm.data","cores/smsplus-legacy-wasm.data" | ForEach-Object {
  Invoke-WebRequest "$base/$_" -OutFile "$dir\$($_ -replace '/','\')" -UseBasicParsing
}
```

### 2. Controles Genesis no funcionaban
**Solución**: `window.EJS_startOnLoaded = true` + patcher que espera `started && gameManager`.

### 3. Tecla Z (Genesis) no respondía
**Solución**: Z → idx 0 (B = ataque), X → idx 8 (C = salto).

### 4. ROMs no detectadas en el .exe portable
**Causa**: `process.execPath` apunta a la carpeta temporal de extracción, no al `.exe` original.
**Solución**: usar `process.env.PORTABLE_EXECUTABLE_DIR` en `getRomsDir()`.

### 5. Joystick no funcionaba en juegos
**Causa**: EmulatorJS no lee el Gamepad API en Electron.
**Solución**: gamepad bridge — pollea el gamepad cada frame y dispara KeyboardEvent sintéticos.

### 6. ASAR y servidor HTTP
`emulatorjs/` usa `asarUnpack` en package.json → `app.asar.unpacked/`. `getEmujsDir()` usa `process.resourcesPath` cuando `app.isPackaged`.

### 7. Cover art no encontrada para ROMs con tags no-No-Intro
**Causa**: libretro-thumbnails usa naming No-Intro. Tags como `(ESP)`, `(U)`, `(v1.1)` no coinciden.
**Solución**: `fetchCover` prueba múltiples sustituciones de región y versiones sin suffix. Si el nombre base difiere (ej. "Fire Red" vs "FireRed"), usar el botón `✎` para imagen manual.

### 8. Cover art lenta con 400+ ROMs
**Causa**: intentar cargar todas las portadas al mismo tiempo con múltiples candidatos por ROM.
**Solución**: GitHub tree API (1 request/sistema, cachea 7 días) + IntersectionObserver lazy load + throttle queue de 8 simultáneos.

### 9. Ícono del .exe generado con png-to-ico no aparecía en Windows
**Causa**: el .ico generado manualmente no era reconocido correctamente por Windows.
**Solución**: apuntar `"icon"` en package.json a un `.png` directo — electron-builder descarga su propio `icons-bundle` y hace la conversión internamente de forma más confiable.

### 10. Fast Forward no funcionaba
**Causa**: se llamaba `emu.setSpeed()` / `gm.setSpeed()` que no existen en EJS v4.2.3. También `toggleFastForward()` sin argumento → WASM recibe undefined→0→desactiva.
**Solución**: `gm.functions.setFastForwardRatio(n)` + `gm.functions.toggleFastForward(1)` con argumento explícito.

### 11. Teclas (FF, slots) bloqueadas por EJS
**Causa**: EJS llama `stopPropagation` en sus listeners de keydown.
**Solución**: `window.addEventListener('keydown', ..., true)` — capture phase, corre antes que cualquier listener de EJS.

### 12. Save states en AppData no portables
**Causa**: `EJS_defaultOptions: { 'save-state-location': 'browser' }` guardaba en localStorage de Chromium.
**Solución**: sistema propio con IPC + archivos en `Saves/` al lado del `.exe`. API: `gm.getState()` / `gm.loadState(uint8)`.

## Problemas conocidos resueltos (sesión 2026-06-22)

### 13. Botón "Cancelar" del modal aplastado
**Causa**: clase `modal-close-btn` tiene `width: 26px; height: 26px` fijo (pensado para el ✕ del header).
**Solución**: cambiar a `modal-cancel-btn` en el HTML del footer. El JS escucha `.modal-close-btn, .modal-cancel-btn`.

### 14. Fast Forward solo funcionaba con teclado
**Solución**: detector de tecla/botón ampliado para escuchar gamepad durante la asignación (polling cada 50ms). `ffPadBtn` guardado en `dobbyFFPadBtn` en localStorage. Bridge chequea el botón cada frame.

### 15. Gatillos analógicos (L2/R2) no detectados
**Causa**: algunos joysticks setean `btn.value` pero no `btn.pressed` para los gatillos.
**Solución**: usar `btn.pressed || btn.value > 0.1` en el visualizador de Joystick y en el detector del FF.

### 16. Joystick movía el personaje con la config abierta
**Causa**: el gamepad bridge seguía corriendo mientras el modal estaba visible.
**Solución**: `openSettingsModal()` pausa EJS si el juego está corriendo (`gamePausedByModal = true`). `closeControlsModal()` lo reanuda si fue pausado por el modal.

## Problemas conocidos resueltos (sesión 2026-06-22)

### 17. Banner de actualización falso positivo
**Causa**: tag de GitHub era `v1.1.1` pero `app.getVersion()` devolvía `1.1.0` — siempre detectaba "versión nueva".
**Solución**: alinear la versión en `package.json` con el tag de GitHub. Regla: siempre buildear DESPUÉS de cambiar la versión.

### 18. Atari 2600 / Nintendo DS cargaban el core de Genesis
**Causa A**: `window.EJS_core` estaba seteado al nombre del core (`stella2014`, `desmume`) en lugar del nombre del sistema (`atari2600`, `nds`). EJS no reconocía esos valores y caía al fallback (genesis_plus_gx).
**Solución A**: el campo `core` en CONSOLES y CORE_MAP debe ser el nombre de sistema EJS (`atari2600`, `nds`), no el core interno.

**Causa B**: para `.bin` el CORE_MAP devolvía `genesis_plus_gx`, incluso cuando la ROM venía de la carpeta Atari 2600.
**Solución B**: `openRomByPath(fullPath, consoleId)` en el renderer sobreescribe el core con `con?.core` de `romLibrary` cuando tiene `consoleId`. Los clicks de librería siempre pasan el consoleId correcto.

### 19. _Léeme.txt no se actualizaba con nuevas extensiones
**Causa**: la creación usaba `if (!fs.existsSync(readme))` — no regeneraba si ya existía.
**Solución**: eliminado el check, ahora se sobreescribe siempre al abrir la app.

## Problemas conocidos resueltos (sesión 2026-06-24)

### 20. Ordenamiento de biblioteca
**Agregado**: select `#sort-select` en `#library-toolbar` con opciones A→Z / Z→A / ★ Primero.
- Variable `librarySortOrder` (localStorage `dobbySortOrder`, default `'az'`)
- Sort se aplica en `renderLibrary` con `[...con.roms].sort(...)` (no muta el array original)
- `★ Primero`: favoritos A→Z primero, luego resto A→Z
- El select no se resetea al navegar entre consolas — el orden persiste

### 21. PlayStation (PSX) agregada como consola
- id: `psx`, core EJS: `psx`, core real: `pcsx_rearmed`
- Extensiones: `.cue`, `.iso`, `.chd`, `.pbp`, `.img`, `.bin`
- `.bin` en `ROMs/PlayStation/` funciona porque los clicks de librería pasan `consoleId` → `finalCore = con?.core = 'psx'`
- Cores descargados del CDN: `pcsx_rearmed-wasm.data` + `pcsx_rearmed-legacy-wasm.data`
- Cover art: `Sony_-_PlayStation` en libretro-thumbnails
- Controles PSX: × (idx 0), ○ (idx 8), □ (idx 1), △ (idx 9), L1 (idx 10), R1 (idx 11), L2 (idx 12), R2 (idx 13)
- Tab "PlayStation" agregado en el modal Configuración → Controles

## Problemas conocidos resueltos (sesión 2026-06-24 — v1.1.3)

### 22. background: var(--bg) pisaba el background-image del home
**Causa**: `#screen-home` tenía `background: var(--bg)` al final del bloque CSS. El shorthand resetea `background-image` a `none`.
**Solución**: reemplazar por `background-color: var(--bg)` y poner el `background-image` después.

### 23. Joystick no detectaba Y/Triangle, L2/R2 en el bridge
**Causa**: `DEFAULT_GPAD_MAP` no tenía los botones físicos 3 (Y), 6 (L2), 7 (R2).
**Solución**: agregados al DEFAULT_GPAD_MAP con sus libIdx correspondientes (9, 12, 13).

### 24. background-image en #screen-home no visible
**Causa**: opacidad `0.03` en líneas de 1px sobre fondo oscuro era imperceptible.
**Solución**: subir a `0.04` con líneas de 2px. Calibrado iterativamente en modo dev con `npm start`.

## Testing automatizado
Playwright con `_electron` API. Inyectar ROM via `startGame()`, inspeccionar estado con `page.evaluate()`. No hay test-driver permanente — los tests se escriben inline y se borran después.
