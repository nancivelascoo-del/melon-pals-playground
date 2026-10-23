// Offline support: the service worker installs on the first visit, then the game works with no internet.
const { test, expect } = require('@playwright/test');
const { watchErrors, openGame } = require('./helpers');

test('service worker registers and the game works offline after the first visit', async ({ page, context }) => {
  const w = watchErrors(page, { ignore: [/Failed to load resource/i, /ERR_INTERNET_DISCONNECTED/i] });
  await openGame(page);
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, state: reg.active && reg.active.state };
  });
  expect(sw.scope).toMatch(/\/melon-pals-playground\/$/);
  expect(sw.state).toBe('activated');
  // the offline cache holds every file the game needs
  const cached = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k.find(x => x.startsWith('melon-pals-'))); return (await c.keys()).map(r => new URL(r.url).pathname); });
  for (const f of ['/melon-pals-playground/', '/melon-pals-playground/index.html', '/melon-pals-playground/peerjs.min.js', '/melon-pals-playground/icons/icon-192.png'])
    expect(cached, 'offline cache has ' + f).toContain(f);

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__sb && window.__sb.state().W > 0);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page came from the offline copy').toBe(true);
  // play a bit with no internet
  const n = await page.evaluate(() => window.__sb.state().n);
  await page.locator('[data-spawn="melon"]').tap();
  await expect.poll(() => page.evaluate(() => window.__sb.state().n)).toBeGreaterThan(n);
  await page.locator('#bGrav').tap();
  expect(await page.evaluate(() => window.__sb.state().gravMode)).toBe(1);
  // play together explains it needs internet instead of hanging
  await page.locator('#bNet').tap();
  await expect(page.locator('#netCard')).toContainText('Needs internet');
  await expect(page.locator('#netCard')).toContainText('Playing alone still works');
  // opening the app fresh while offline (new tab) also works
  const p2 = await context.newPage();
  const w2 = watchErrors(p2, { ignore: [/Failed to load resource/i] });
  await p2.goto('./');
  await p2.waitForFunction(() => window.__sb && window.__sb.state().W > 0);
  await context.setOffline(false);
  w.expectClean(); w2.expectClean();
});
