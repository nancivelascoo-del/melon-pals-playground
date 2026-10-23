// "Play together": two devices = two separate browser contexts (separate storage), running the game's real multiplayer code.
// Only the network pipe is simulated (tests/fake-peer.js) because real WebRTC needs the PeerJS cloud service and
// home Wi-Fi/NAT conditions that a CI machine can't reproduce. See TESTING.md for what still needs a real-device check.
const { test, expect } = require('@playwright/test');
const { watchErrors, offscreen } = require('./helpers');
const fakePeer = require('./fake-peer');

async function twoDevices(browser, info) {
  const opts = { ...info.project.use, baseURL: info.project.use.baseURL };
  delete opts.browserName; delete opts.channel; delete opts.trace; delete opts.screenshot;
  const hostCtx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const guestCtx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await fakePeer.install([hostCtx, guestCtx]);
  const host = await hostCtx.newPage(), guest = await guestCtx.newPage();
  const outside = [];
  for (const p of [host, guest]) p.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
  return { host, guest, hostCtx, guestCtx, outside };
}
const net = p => p.evaluate(() => window.__sb.net());
const ready = p => p.waitForFunction(() => window.__sb && window.__sb.state().W > 0);
// open the play-together panel unless it is already showing (it pops up by itself at times)
async function openNet(p) { if (await p.locator('#net').isHidden()) await p.locator('#bNet').tap(); await expect(p.locator('#net')).toBeVisible(); }
// tap a button inside that panel; the panel closes itself shortly after connecting, so reopen and retry if needed
async function tapInNet(p, sel) {
  for (let i = 0; i < 6; i++) {
    if (await p.locator('#net').isHidden()) await p.locator('#bNet').tap();
    try { await p.locator('#netCard ' + sel).tap({ timeout: 2500 }); return; } catch (e) { if (i === 5) throw e; }
  }
}
const has = (p, t) => p.evaluate(t => window.__sb.bodies().some(b => b.type === t), t);

async function hostAndJoin(host, guest) {
  await openNet(host); await host.locator('[data-a="host"]').tap();
  await expect.poll(async () => (await net(host)).state, { timeout: 15000 }).toBe('waiting');
  const code = (await net(host)).code;
  await expect(host.locator('#netCard .tile')).toHaveCount(5);
  await openNet(guest); await guest.locator('[data-a="join"]').tap();
  for (const i of code) await guest.locator(`[data-a="p"][data-p="${i}"]`).tap();
  await expect.poll(async () => (await net(host)).asking, { timeout: 20000, message: 'host is asked "Someone wants to join?"' }).toBe(true);
  return code;
}

test('host and guest connect, share toys and controls, survive a drop, and leave cleanly', async ({ browser }, info) => {
  test.slow();
  const { host, guest, hostCtx, guestCtx, outside } = await twoDevices(browser, info);
  const wh = watchErrors(host), wg = watchErrors(guest);
  // the guest has its own saved world that must come back after playing together
  await guest.goto('./'); await ready(guest);
  await guest.evaluate(() => { const sb = window.__sb; sb.clear(); const f = sb.state().floor; sb.make('box', 200, f - 30, { size: 54, v: 1 }); sb.make('melon', 400, f - 40, {}); sb.save(); });
  await guest.reload(); await ready(guest);
  await host.goto('./'); await ready(host);
  await host.evaluate(() => { const sb = window.__sb; sb.clear(); const s = sb.state(); sb.make('box', s.W * 0.3, s.floor - 30, { size: 60, v: 0 }); sb.save(); });

  await hostAndJoin(host, guest);
  expect(await offscreen(host, '#ask .card, #ask button'), 'join request fits on screen').toEqual([]);
  await host.locator('#askYes').tap();
  await expect.poll(async () => (await net(guest)).state, { timeout: 20000 }).toBe('connected');
  await expect.poll(async () => (await net(host)).state).toBe('connected');
  await expect(guest.locator('#bNet')).toHaveClass(/net-on/);
  await expect.poll(() => guest.evaluate(() => window.__sb.state().mirror)).toBe(true);

  // toys added on either device show up on both
  await host.locator('[data-spawn="puppy"]').tap();
  await expect.poll(() => has(guest, 'puppy'), { message: 'host puppy appears on guest' }).toBe(true);
  await guest.locator('[data-spawn="dino"]').tap();
  await expect.poll(() => has(host, 'dino'), { message: 'guest dinosaur runs on host' }).toBe(true);
  await expect.poll(() => has(guest, 'dino')).toBe(true);
  // the guest's gravity button changes the shared world; only the host may clear everything
  await guest.locator('#bGrav').tap();
  await expect.poll(() => host.evaluate(() => window.__sb.state().gravMode)).toBe(1);
  await expect.poll(() => guest.evaluate(() => window.__sb.state().gravMode)).toBe(1);
  await expect(guest.locator('#bClear')).toHaveClass(/\boff\b/);
  await guest.locator('#bClear').tap();
  await expect(guest.locator('#modal')).toBeHidden();

  // the guest's playing panel has working buttons and fits on screen
  await openNet(guest);
  expect(await offscreen(guest, '#netCard, #netCard button')).toEqual([]);
  if (await guest.locator('#net').isVisible()) await guest.locator('#netCard [data-a="close"]').tap({ timeout: 2500 }).catch(() => {});

  // a dropped connection: guest keeps playing, then reconnects by itself without asking the host again
  await guest.evaluate(() => window.__sb.netDrop());
  await expect.poll(async () => (await net(guest)).state).toMatch(/reconnecting|connected/);
  await expect.poll(async () => (await net(guest)).state, { timeout: 25000 }).toBe('connected');
  expect((await net(host)).asking).toBe(false);

  // host leaves: guest gets its own saved world back, host keeps the shared creation
  await tapInNet(host, '[data-a="leave"]');
  await expect.poll(async () => (await net(guest)).role, { timeout: 8000 }).toBe('solo');
  await expect.poll(() => guest.evaluate(() => window.__sb.bodies().map(b => b.type).sort().join(','))).toBe('box,melon');
  expect(await has(host, 'dino')).toBe(true);
  expect(outside, 'nothing outside the site is contacted').toEqual([]);
  wh.expectClean(); wg.expectClean();
  await hostCtx.close(); await guestCtx.close();
});

test('host can say no, and wrong pictures give a friendly message', async ({ browser }, info) => {
  test.slow();
  const { host, guest, hostCtx, guestCtx } = await twoDevices(browser, info);
  const wh = watchErrors(host), wg = watchErrors(guest);
  await host.goto('./'); await guest.goto('./'); await ready(host); await ready(guest);

  // wrong pictures
  await openNet(guest); await guest.locator('[data-a="join"]').tap();
  for (const i of [15, 15, 15, 15, 14]) await guest.locator(`[data-a="p"][data-p="${i}"]`).tap();
  await expect.poll(async () => (await net(guest)).err, { timeout: 20000 }).toBe('notfound');
  await expect(guest.locator('#netCard')).toContainText('No game with those pictures');
  await guest.locator('[data-a="again"]').tap();
  await expect(guest.locator('[data-a="p"]')).toHaveCount(16);
  await guest.locator('[data-a="close"]').tap();

  // the host says no
  await hostAndJoin(host, guest);
  await host.locator('#askNo').tap();
  await expect.poll(async () => (await net(guest)).err, { timeout: 8000 }).toBe('no');
  await expect(guest.locator('#netCard')).toContainText('They said no');
  expect((await net(guest)).role).toBe('solo');

  // the guest backs out while waiting
  await guest.locator('[data-a="again"]').tap();
  const code = (await net(host)).code;
  for (const i of code) await guest.locator(`[data-a="p"][data-p="${i}"]`).tap();
  await expect.poll(async () => (await net(guest)).state, { timeout: 8000 }).toMatch(/asking|connecting/);
  await guest.locator('[data-a="cancel"]').tap();
  await expect(guest.locator('[data-a="p"]')).toHaveCount(16);

  // host stops hosting
  await expect(host.locator('#ask'), 'join request goes away when the guest backs out').toBeHidden({ timeout: 8000 });
  await tapInNet(host, '[data-a="leave"]');
  await expect.poll(async () => (await net(host)).role).toBe('solo');
  wh.expectClean(); wg.expectClean();
  await hostCtx.close(); await guestCtx.close();
});
