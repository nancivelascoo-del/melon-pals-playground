// Every screen and every button: each tap must do something, with no errors, and nothing may be cut off.
const { test, expect } = require('@playwright/test');
const { watchErrors, openGame, signature, tapAndExpectChange, visibleButtons, offscreen, pageOverflow } = require('./helpers');

test.describe('main screen', () => {
  test('loads cleanly with the toolbar and toy bar showing', async ({ page }) => {
    const w = watchErrors(page);
    await openGame(page);
    await expect(page).toHaveTitle('Melon Pals Playground');
    for (const id of ['bNet', 'bDance', 'bGrav', 'bSlow', 'bMute', 'bClear']) await expect(page.locator('#' + id)).toBeVisible();
    await expect(page.locator('[data-spawn]')).toHaveCount(16);
    expect(await page.evaluate(() => window.__sb.state().n), 'starts with a little scene to play with').toBeGreaterThan(0);
    // the canvas really draws something (not a blank screen)
    const painted = await page.evaluate(() => {
      const c = document.getElementById('c'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return seen.size;
    });
    expect(painted, 'canvas shows more than one color').toBeGreaterThan(3);
    await page.waitForTimeout(1500);   // let the physics run a bit
    w.expectClean();
  });

  test('every visible button does something when tapped', async ({ page }) => {
    const w = watchErrors(page);
    await openGame(page);
    const buttons = await visibleButtons(page, '#app');
    expect(buttons.length).toBeGreaterThan(15);
    const tapped = [];

    // drawing tools: pick each one in turn (grab is already picked, so do it last)
    for (const t of ['pin', 'del', 'grab']) {
      await tapAndExpectChange(page, page.locator(`[data-tool="${t}"]`), 'tool ' + t);
      await expect(page.locator(`[data-tool="${t}"]`)).toHaveClass(/\bon\b/);
      tapped.push('tool:' + t);
    }
    // toggles: tap twice, each tap changes something and the second puts it back
    for (const [id, key] of [['bDance', 'dance'], ['bSlow', 'slow'], ['bMute', 'muted']]) {
      const v0 = await page.evaluate(k => window.__sb.state()[k], key);
      await tapAndExpectChange(page, page.locator('#' + id), id);
      expect(await page.evaluate(k => window.__sb.state()[k], key)).toBe(!v0);
      await tapAndExpectChange(page, page.locator('#' + id), id + ' (again)');
      expect(await page.evaluate(k => window.__sb.state()[k], key)).toBe(v0);
      tapped.push(id);
    }
    // gravity cycles down -> space -> up -> down
    for (const want of [1, 2, 0]) {
      await tapAndExpectChange(page, page.locator('#bGrav'), 'bGrav');
      expect(await page.evaluate(() => window.__sb.state().gravMode)).toBe(want);
    }
    tapped.push('bGrav');

    // every toy in the bar adds that toy
    for (const b of buttons.filter(b => b.spawn)) {
      const before = await page.evaluate(t => window.__sb.bodies().filter(x => x.type === t).length, b.spawn);
      await page.locator(`[data-spawn="${b.spawn}"]`).tap();
      await expect.poll(() => page.evaluate(t => window.__sb.bodies().filter(x => x.type === t).length, b.spawn),
        { message: 'toy button ' + b.label + ' adds a ' + b.spawn }).toBeGreaterThan(before);
      tapped.push('toy:' + b.spawn);
    }

    // toy-bar arrows only show when the toys don't all fit
    await page.evaluate(() => { const e = document.getElementById('bottom'); e.scrollLeft = 0; e.scrollTop = 0; });
    await page.waitForTimeout(200);
    const arrows = (await visibleButtons(page, '#bar')).filter(b => b.id === 'sbNext' || b.id === 'sbPrev');
    if (await page.locator('#bar.fits').count()) {
      expect(arrows, 'arrows hidden when every toy fits').toEqual([]);
    } else {
      await tapAndExpectChange(page, page.locator('#sbNext'), 'More toys arrow'); tapped.push('sbNext');
      await page.waitForTimeout(500);
      await tapAndExpectChange(page, page.locator('#sbPrev'), 'Back arrow'); tapped.push('sbPrev');
    }

    // play together opens its panel (its insides are tested below)
    await tapAndExpectChange(page, page.locator('#bNet'), 'Play together');
    await expect(page.locator('#net')).toBeVisible();
    await page.locator('[data-a="close"]').tap();
    await expect(page.locator('#net')).toBeHidden();
    tapped.push('bNet');

    // clear all asks first; "no" keeps everything, "yes" clears
    const n = await page.evaluate(() => window.__sb.state().n);
    await tapAndExpectChange(page, page.locator('#bClear'), 'Clear all');
    await expect(page.locator('#modal')).toBeVisible();
    await tapAndExpectChange(page, page.locator('#no'), 'No, keep it');
    await expect(page.locator('#modal')).toBeHidden();
    expect(await page.evaluate(() => window.__sb.state().n)).toBe(n);
    await page.locator('#bClear').tap();
    await tapAndExpectChange(page, page.locator('#yes'), 'Yes, clear everything');
    await expect.poll(() => page.evaluate(() => window.__sb.state().n)).toBe(0);
    tapped.push('bClear', 'no', 'yes');

    // nothing on the main screen was skipped
    const all = buttons.map(b => b.tool ? 'tool:' + b.tool : b.spawn ? 'toy:' + b.spawn : b.id);
    expect(all.filter(x => !tapped.includes(x)), 'buttons that were not exercised').toEqual([]);
    w.expectClean();
  });

  test('settings stick after reopening the game', async ({ page }) => {
    const w = watchErrors(page);
    await openGame(page);
    await page.locator('#bGrav').tap(); await page.locator('#bSlow').tap(); await page.locator('#bMute').tap();
    await page.locator('[data-spawn="dino"]').tap();
    const n = await page.evaluate(() => window.__sb.state().n);
    await page.waitForTimeout(400);
    await page.reload(); await page.waitForFunction(() => window.__sb && window.__sb.state().W > 0);
    const s = await page.evaluate(() => window.__sb.state());
    expect([s.gravMode, s.slow, s.muted]).toEqual([1, true, true]);
    expect(s.n).toBe(n);
    w.expectClean();
  });
});

test.describe('play area tools', () => {
  async function addBox(page) {
    return page.evaluate(() => {
      const sb = window.__sb; sb.clear(); const s = sb.state(), b = sb.make('box', s.W / 2, s.floor - 30, { size: 60, v: 0 });
      return sb.bodies().indexOf(b);
    });
  }
  async function boxPoint(page) {
    return page.evaluate(() => { const b = window.__sb.bodies()[0], cx = b.pts.reduce((a, p) => a + p.x, 0) / b.pts.length, cy = b.pts.reduce((a, p) => a + p.y, 0) / b.pts.length; return window.__sb.toClient(cx, cy); });
  }
  test('delete tool removes a toy you tap', async ({ page }) => {
    const w = watchErrors(page); await openGame(page); await addBox(page); await page.waitForTimeout(500);
    await page.locator('[data-tool="del"]').tap();
    const p = await boxPoint(page); await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => page.evaluate(() => window.__sb.state().n)).toBe(0);
    w.expectClean();
  });
  test('pin tool pins and unpins a toy', async ({ page }) => {
    const w = watchErrors(page); await openGame(page); await addBox(page); await page.waitForTimeout(500);
    await page.locator('[data-tool="pin"]').tap();
    const pinned = () => page.evaluate(() => window.__sb.bodies()[0].pts.every(p => p.pin));
    let p = await boxPoint(page); await page.touchscreen.tap(p.x, p.y);
    await expect.poll(pinned).toBe(true);
    p = await boxPoint(page); await page.touchscreen.tap(p.x, p.y);
    await expect.poll(pinned).toBe(false);
    w.expectClean();
  });
  test('grab tool drags a toy', async ({ page }) => {
    const w = watchErrors(page); await openGame(page); await addBox(page); await page.waitForTimeout(600);
    const p = await boxPoint(page), x0 = p.x;
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(p.x - 12 * i, p.y - 8 * i); await page.waitForTimeout(30); }
    const mid = await boxPoint(page); await page.mouse.up();
    expect(x0 - mid.x, 'box followed the finger').toBeGreaterThan(40);
    w.expectClean();
  });
});

test.describe('play together panel (no internet needed)', () => {
  test('menu, picture picker, undo and close all respond', async ({ page }) => {
    const w = watchErrors(page);
    await openGame(page);
    await page.locator('#bNet').tap();
    const card = page.locator('#netCard');
    await expect(card.locator('[data-a="host"]')).toBeVisible();
    await expect(card.locator('[data-a="join"]')).toBeVisible();
    expect((await visibleButtons(page, '#netCard')).map(b => b.a).sort()).toEqual(['close', 'host', 'join']);

    await tapAndExpectChange(page, card.locator('[data-a="join"]'), 'Join');
    await expect(card.locator('[data-a="p"]')).toHaveCount(16);
    for (let i = 0; i < 16; i++) {           // every picture button adds a picture (undo after each so we never hit 5)
      await tapAndExpectChange(page, card.locator(`[data-a="p"][data-p="${i}"]`), 'picture ' + (i + 1));
      await expect(card.locator('.tile:not(.empty)')).toHaveCount(1);
      await tapAndExpectChange(page, card.locator('[data-a="del"]'), 'Undo');
      await expect(card.locator('.tile:not(.empty)')).toHaveCount(0);
    }
    await tapAndExpectChange(page, card.locator('[data-a="close"]'), 'Close');
    await expect(page.locator('#net')).toBeHidden();

    // reopening goes back to the menu; tapping the dark backdrop closes it
    await page.locator('#bNet').tap();
    await expect(card.locator('[data-a="host"]')).toBeVisible();
    await page.mouse.click(3, 3);
    await expect(page.locator('#net')).toBeHidden();
    w.expectClean();
  });
});

test.describe('layout: nothing cut off or off-screen', () => {
  test('main screen, clear-all box and play-together panel fit on screen', async ({ page }) => {
    const w = watchErrors(page);
    await openGame(page);
    expect(await pageOverflow(page), 'page does not scroll sideways or down').toEqual({ x: 0, y: 0 });
    expect(await offscreen(page, '#top, #top button, #bar, #stage')).toEqual([]);
    // every toy is reachable: on screen already, or inside the scrollable toy bar
    const bar = await page.locator('#bottom').boundingBox();
    expect(bar.width).toBeGreaterThan(40); expect(bar.height).toBeGreaterThan(40);
    // toolbar buttons are big enough for small fingers (Apple suggests 44pt; 34px is the floor we allow on phones)
    const small = await page.evaluate(() => [...document.querySelectorAll('#top button, .spawn')].filter(b => { const r = b.getBoundingClientRect(); return r.width < 34 || r.height < 34; }).map(b => b.getAttribute('aria-label')));
    expect(small, 'buttons too small to tap').toEqual([]);
    // no two toolbar buttons overlap
    const overlaps = await page.evaluate(() => {
      const r = [...document.querySelectorAll('#top button')].map(b => [b.getAttribute('aria-label'), b.getBoundingClientRect()]), out = [];
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i][1], b = r[j][1]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(r[i][0] + ' / ' + r[j][0]); }
      return out;
    });
    expect(overlaps).toEqual([]);

    await page.locator('#bClear').tap();
    expect(await offscreen(page, '#modal .card, #modal button')).toEqual([]);
    await page.locator('#no').tap();

    await page.locator('#bNet').tap();
    expect(await offscreen(page, '#netCard, #netCard button')).toEqual([]);
    await page.locator('[data-a="join"]').tap();
    // the picture picker may scroll inside its card on short screens, but the card itself must fit
    expect(await offscreen(page, '#netCard')).toEqual([]);
    const fitsOrScrolls = await page.evaluate(() => { const c = document.getElementById('netCard'); return c.scrollHeight <= c.clientHeight + 1 || getComputedStyle(c).overflowY === 'auto'; });
    expect(fitsOrScrolls).toBe(true);
    w.expectClean();
  });
});
