// Automated QA for Melon Pals Playground. See TESTING.md.
const { defineConfig } = require('@playwright/test');
const PORT = 4173;
const SIZES = {
  'ipad-landscape': { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 2 },
  'ipad-portrait': { viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 2 },
  'phone': { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
};
// BROWSERS: chromium, webkit (Safari's engine, closest to iPad) and/or chrome (the installed Google Chrome, used in CI).
// ONLY_SIZE: run just one screen size (CI runs each size as its own parallel job).
const BROWSERS = (process.env.BROWSERS || 'chromium,webkit').split(',');
const ENGINE = { chromium: { browserName: 'chromium' }, webkit: { browserName: 'webkit' }, chrome: { browserName: 'chromium', channel: 'chrome' } };
const projects = [];
for (const b of BROWSERS) for (const [size, use] of Object.entries(SIZES)) {
  if (process.env.ONLY_SIZE && process.env.ONLY_SIZE !== size) continue;
  projects.push({ name: b + '-' + size, use: { ...ENGINE[b], ...use } });
}
module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { actionTimeout: 10000, navigationTimeout: 20000, baseURL: 'http://127.0.0.1:' + PORT + '/melon-pals-playground/', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects,
  webServer: { command: 'node tests/serve.js ' + PORT, url: 'http://127.0.0.1:' + PORT + '/melon-pals-playground/', reuseExistingServer: !process.env.CI },
});
