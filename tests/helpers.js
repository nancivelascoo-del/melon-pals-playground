// Shared helpers for the Melon Pals QA checks.
const { expect } = require('@playwright/test');

// Collect uncaught exceptions and console errors. Call expectClean() at the end of a test.
function watchErrors(page, { ignore = [] } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push('uncaught: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (ignore.some(r => r.test(t))) return;
    errors.push('console.error: ' + t);
  });
  page.on('crash', () => errors.push('page crashed'));
  return { errors, expectClean: () => expect(errors, 'no console errors or uncaught exceptions').toEqual([]) };
}

async function openGame(page) {
  await page.goto('./');
  await page.waitForFunction(() => window.__sb && window.__sb.state().W > 0);
  await page.waitForTimeout(250);
}

// Everything a button could change: game state, toys on screen, overlays, button looks, toy-bar scroll.
async function signature(page) {
  return page.evaluate(() => {
    const sb = window.__sb, s = sb.state(), types = {};
    sb.bodies().forEach(b => { types[b.type] = (types[b.type] || 0) + 1; });
    const pins = sb.bodies().reduce((n, b) => n + b.pts.filter(p => p.pin).length, 0);
    const bottom = document.getElementById('bottom');
    return JSON.stringify({
      s: { gravMode: s.gravMode, slow: s.slow, muted: s.muted, dance: s.dance, tool: s.tool, n: s.n, role: s.role }, types, pins,
      modal: document.getElementById('modal').hidden, net: document.getElementById('net').hidden, ask: document.getElementById('ask').hidden,
      card: document.getElementById('netCard').innerHTML.length,
      classes: [...document.querySelectorAll('button')].map(b => b.className).join('|'),
      scroll: Math.round(bottom.scrollLeft) + ',' + Math.round(bottom.scrollTop),
    });
  });
}

// Tap a button the way a finger would (touch on touch devices), then wait until something visibly changes.
async function tapAndExpectChange(page, locator, label) {
  const before = await signature(page);
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
  if (touch) await locator.tap(); else await locator.click();
  await expect.poll(() => signature(page), { message: label + ' should do something when tapped', timeout: 2500 }).not.toBe(before);
}

// Visible = rendered with a size and not hidden behind display:none/visibility/opacity 0 or pointer-events:none.
async function visibleButtons(page, scope = 'body') {
  return page.evaluate(sel => {
    const out = [];
    document.querySelectorAll(sel + ' button').forEach((b, i) => {
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      if (!r.width || !r.height || cs.visibility === 'hidden' || +cs.opacity === 0 || cs.pointerEvents === 'none' || b.disabled) return;
      if (b.closest('[hidden]')) return;
      out.push({ label: b.getAttribute('aria-label') || b.textContent.trim() || b.id || b.className, id: b.id, spawn: b.dataset.spawn, tool: b.dataset.tool, a: b.dataset.a });
    });
    return out;
  }, scope);
}

// Elements that must sit fully inside the screen (nothing cut off or off-screen).
async function offscreen(page, selector) {
  return page.evaluate(sel => {
    const W = innerWidth, H = innerHeight, bad = [];
    document.querySelectorAll(sel).forEach(el => {
      if (el.closest('[hidden]')) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(el).display === 'none') return;
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)
        bad.push((el.id || el.getAttribute('aria-label') || el.className || el.tagName) + ' at ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
    });
    return bad;
  }, selector);
}

async function pageOverflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return { x: Math.max(d.scrollWidth, document.body.scrollWidth) - innerWidth, y: Math.max(d.scrollHeight, document.body.scrollHeight) - innerHeight };
  });
}

module.exports = { watchErrors, openGame, signature, tapAndExpectChange, visibleButtons, offscreen, pageOverflow };
