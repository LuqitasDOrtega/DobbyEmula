import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)));
const app = await electron.launch({ args: [dir] });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await new Promise(r => setTimeout(r, 2500));

await win.click('.console-card[data-console-id="genesis"]');
await new Promise(r => setTimeout(r, 500));
if (!await win.evaluate(() => !!document.querySelector('.rom-card'))) {
  console.log('NO ROM'); await app.close(); process.exit(1);
}
await win.click('.rom-card:first-child');
let started = false;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 500));
  started = await win.evaluate(() => !!window.EJS_emulator?.started);
  if (started) break;
}
if (!started) { await app.close(); process.exit(1); }
await new Promise(r => setTimeout(r, 2000));

// Enable FF to trigger the notification
await win.evaluate(() => {
  const fns = window.EJS_emulator.gameManager.functions;
  fns.setFastForwardRatio(3);
  fns.toggleFastForward(1);
});
await new Promise(r => setTimeout(r, 500));

// Dump ALL elements inside #game-container while notification is visible
const domDump = await win.evaluate(() => {
  function dumpElement(el, depth = 0) {
    if (depth > 5) return '';
    const cs = getComputedStyle(el);
    const tag = el.tagName;
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className ? `.${[...el.classList].join('.')}` : '';
    const text = el.innerText ? `"${el.innerText.slice(0,30)}"` : '';
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `bg:${cs.backgroundColor}` : '';
    const display = cs.display === 'none' ? '(hidden)' : '';
    const line = `${'  '.repeat(depth)}${tag}${id}${cls} ${text} ${bg} ${display}`.trim();
    let result = line + '\n';
    for (const child of el.children) {
      result += dumpElement(child, depth + 1);
    }
    return result;
  }
  return dumpElement(document.getElementById('game-container'));
});
console.log('DOM while FF notification visible:');
console.log(domDump);

await win.evaluate(() => window.EJS_emulator.gameManager.functions.toggleFastForward(0));
await app.close();
