// Every file the game points at must exist, and the sound engine must actually make sounds.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { watchErrors, openGame } = require('./helpers');
const ROOT = path.resolve(__dirname, '..');

function referencedFiles() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)["']/g)) if (!/^(https?:|data:|mailto:|blob:)/.test(m[1]) && !m[1].includes("' +")) files.add(m[1]);
  for (const m of html.matchAll(/\.src\s*=\s*'([^']+\.(?:js|png|mp3|wav|ogg))'/g)) files.add(m[1]);          // scripts loaded on demand (peerjs)
  for (const m of html.matchAll(/register\('([^']+)'/g)) files.add(m[1]);                                    // service worker
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  for (const m of sw.match(/ASSETS\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)) files.add(m[1].replace(/^\.\//, '') || './');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const i of man.icons) files.add(i.src);
  return [...files];
}

test('every referenced file loads (HTML, offline list, app icons)', async ({ request }, info) => {
  test.skip(!info.project.name.endsWith('ipad-landscape'), 'file checks do not depend on screen size');
  const files = referencedFiles();
  expect(files).toEqual(expect.arrayContaining(['index.html', 'sw.js', 'peerjs.min.js', 'manifest.webmanifest', 'icons/icon-192.png']));
  for (const f of files) {
    const res = await request.get(f === './' ? './' : f);
    expect(res.status(), f + ' should load').toBe(200);
    expect((await res.body()).length, f + ' should not be empty').toBeGreaterThan(0);
  }
});

test('app icons are real PNGs with the sizes the manifest promises', async ({ request }, info) => {
  test.skip(!info.project.name.endsWith('ipad-landscape'), 'file checks do not depend on screen size');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const i of man.icons) {
    const buf = await (await request.get(i.src)).body();
    expect(buf.slice(1, 4).toString(), i.src + ' is a PNG').toBe('PNG');
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    expect(w + 'x' + h, i.src).toBe(i.sizes);
  }
});

// The game makes all its sounds live with the Web Audio API (there are no sound files), so count the sounds it starts.
const COUNT_SOUNDS = () => {
  window.__soundsStarted = 0;
  const P = window.AudioScheduledSourceNode && AudioScheduledSourceNode.prototype;
  if (P) { const s = P.start; P.start = function () { window.__soundsStarted++; return s.apply(this, arguments); }; }
};

test('sound starts after the first tap, toys make sounds, and the mute button silences them', async ({ page, browserName }) => {
  const w = watchErrors(page);
  await page.addInitScript(COUNT_SOUNDS);
  await openGame(page);
  expect(await page.evaluate(() => window.__sb.state().audio), 'no sound before the first touch (browser rule)').toBe('none');
  await page.locator('[data-spawn="ball"]').tap();
  await expect.poll(() => page.evaluate(() => window.__sb.state().audio), { message: 'audio engine is running after a tap' }).toBe('running');
  await page.waitForTimeout(150);
  const sounds = () => page.evaluate(() => window.__soundsStarted);
  for (const t of ['melon', 'dino', 'puppy']) {
    const before = await sounds();
    await page.locator(`[data-spawn="${t}"]`).tap();
    await expect.poll(sounds, { message: 'adding a ' + t + ' plays a sound' }).toBeGreaterThan(before);
  }
  // dance mode plays music on its own
  await page.locator('#bDance').tap(); let before = await sounds(); await page.waitForTimeout(700);
  expect(await sounds() - before, 'dance music keeps playing').toBeGreaterThan(3);
  await page.locator('#bDance').tap();
  // muted: no new sounds
  await page.locator('#bMute').tap(); await page.waitForTimeout(300);
  before = await sounds();
  for (const t of ['melon', 'box', 'car']) { await page.locator(`[data-spawn="${t}"]`).tap(); await page.waitForTimeout(120); }
  expect(await sounds(), 'muted means silent').toBe(before);
  await page.locator('#bMute').tap();
  before = await sounds(); await page.locator('[data-spawn="balloon"]').tap();
  await expect.poll(sounds, { message: 'unmuting brings sound back' }).toBeGreaterThan(before);
  w.expectClean();
});
