import { _electron as electron } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR   = __dirname;
const EXE       = path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');
const GENESIS_ROM = path.join(APP_DIR, 'ROMs', 'Sega Genesis', 'Teenage Mutant Ninja Turtles - Return of the Shredder (Japan).md');

let passed = 0, failed = 0;
function ok(msg)   { console.log('  ✓', msg); passed++; }
function fail(msg) { console.log('  ✗', msg); failed++; }
function section(t){ console.log('\n─── ' + t); }

const app  = await electron.launch({ executablePath: EXE, args: [APP_DIR], timeout: 20000 });
await new Promise(r => setTimeout(r, 4000));
const page = app.windows()[0] ?? await app.firstWindow();
const port = await page.evaluate(() => window.api.getEmujsPort());

// Load Genesis ROM
const b64 = fs.readFileSync(GENESIS_ROM).toString('base64');
await page.evaluate(({ b64, p }) => {
  const bin = atob(b64); const buf = new ArrayBuffer(bin.length);
  new Uint8Array(buf).forEach((_, i, a) => { a[i] = bin.charCodeAt(i); });
  startGame({ name: 'TMNT', ext: '.md', core: 'genesis_plus_gx', data: buf, port: p });
}, { b64, p: port });

for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000));
  if (await page.evaluate(() => window.EJS_emulator?.started)) { ok('game started'); break; }
  if (i === 14) fail('game never started');
}
await new Promise(r => setTimeout(r, 1500));

// ── EJS overlay "Control Settings" hidden ─────────────────────────────────────
section('Control Settings button hidden');
const ctrlSettingsHidden = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
    .find(b => b.textContent.trim() === 'Control Settings');
  return btn ? getComputedStyle(btn).display === 'none' : 'not found';
});
ctrlSettingsHidden === true ? ok('"Control Settings" hidden from EJS overlay') :
  fail('"Control Settings" display=' + ctrlSettingsHidden);

// ── Save State / Load State buttons visible ───────────────────────────────────
section('Save/Load State buttons');
const saveVisible = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
    .find(b => b.textContent.trim() === 'Save State');
  return btn ? getComputedStyle(btn).display !== 'none' : false;
});
saveVisible ? ok('"Save State" button visible in EJS overlay') : fail('"Save State" not visible');

const loadVisible = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
    .find(b => b.textContent.trim() === 'Load State');
  return btn ? getComputedStyle(btn).display !== 'none' : false;
});
loadVisible ? ok('"Load State" button visible in EJS overlay') : fail('"Load State" not visible');

// ── Menu items enabled/disabled ───────────────────────────────────────────────
section('Emulación menu items');
const saveMenuEnabled = await page.evaluate(() =>
  !document.getElementById('action-save-state').classList.contains('disabled')
);
saveMenuEnabled ? ok('Guardar estado menu item enabled') : fail('Guardar estado still disabled');

const loadMenuEnabled = await page.evaluate(() =>
  !document.getElementById('action-load-state').classList.contains('disabled')
);
loadMenuEnabled ? ok('Cargar estado menu item enabled') : fail('Cargar estado still disabled');

// ── F5 triggers Save State ────────────────────────────────────────────────────
section('F5 / F9 keyboard shortcuts');
// Track if Save State button gets clicked via F5
const f5works = await page.evaluate(() => {
  let clicked = false;
  const btn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
    .find(b => b.textContent.trim() === 'Save State');
  if (btn) {
    const orig = btn.onclick;
    btn.addEventListener('click', () => { clicked = true; }, { once: true });
    window._f5Tracker = () => clicked;
  }
  return !!btn;
});
if (f5works) {
  await page.keyboard.press('F5');
  await new Promise(r => setTimeout(r, 200));
  const clicked = await page.evaluate(() => window._f5Tracker?.());
  clicked ? ok('F5 triggers Save State click') : fail('F5 did NOT click Save State');
} else {
  fail('Save State button not found for F5 test');
}

// ── Restart button (was broken before) ───────────────────────────────────────
section('Restart / Pause via clickEjsBtn');
const restartBtnExists = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
    .find(b => b.textContent.trim() === 'Restart');
  return !!btn;
});
restartBtnExists ? ok('"Restart" button accessible via clickEjsBtn') : fail('"Restart" not found');

const pauseBtnExists = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#game-container .ejs_menu_button')]
    .find(b => b.textContent.trim() === 'Pause' && getComputedStyle(b).display !== 'none');
  return !!btn;
});
pauseBtnExists ? ok('"Pause" button accessible and visible') : fail('"Pause" not found or hidden');

// ── Genesis controls still correct ───────────────────────────────────────────
section('Genesis controls still correct after all changes');
const controlsOk = await page.evaluate(() => {
  const c = window.EJS_emulator?.controls?.[0];
  return c?.[0]?.value === 90 && c?.[1]?.value === 65 && c?.[8]?.value === 88;
});
controlsOk ? ok('Z=B(90), A=A(65), X=C(88) still correct') : fail('controls mismatch');

await app.close();

console.log(`\n══════════════════════════════`);
console.log(`  ${passed} passed   ${failed} failed`);
console.log(`══════════════════════════════`);
if (failed > 0) process.exit(1);
