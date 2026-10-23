# Testing

Melon Pals Playground has automatic checks (Playwright) that run on every push and pull request.
The live site only updates from `main`, and **only if every check passes** (see `.github/workflows/qa-and-deploy.yml`).

## What is checked

Every check runs in Chromium and WebKit (Safari's engine) at three sizes: iPad landscape (1180×820), iPad portrait (820×1180) and phone (390×844), all with touch.

- **Screens & buttons** (`tests/screens.spec.js`): the game loads cleanly and draws; every visible button is tapped and must visibly change something (tools, dance/slow/mute, gravity, all 16 toys, bar arrows, Play together, Clear → No / Yes); settings survive a reload; delete/pin/grab work on the canvas; the Play together panel (menu, all 16 picture buttons, undo, close).
- **Layout**: no sideways scrolling, toolbar/toy bar/stage fully on screen, buttons at least 34px and not overlapping, popups fit on the phone.
- **Files & sound** (`tests/assets-audio.spec.js`): every file the page, offline list and manifest point at returns 200; icons are real PNGs of the right size; sound only starts after the first tap, then toys, dance music, mute and unmute all behave. (Sounds are made live with Web Audio, so there are no sound files.)
- **Offline** (`tests/offline.spec.js`): the service worker installs, caches the game, and the game reloads and plays with no internet; Play together says "Needs internet".
- **Play together** (`tests/multiplayer.spec.js`): two separate browsers join through a stand-in for the PeerJS server: host/approve, toys and gravity sync both ways, guest can't Clear, drop + auto-reconnect, host leaving, wrong pictures, "They said no", cancel.
- Every test fails on any console error or uncaught exception.

## What is not checked automatically

- Whether sounds *sound* right, and whether the game feels fun / looks right.
- Real internet multiplayer through the PeerJS cloud server and STUN/TURN across real Wi-Fi/NAT and two real devices.
- Real iPad/iPhone Safari quirks (Add to Home Screen, real touch gestures, audio unlocking on device).

## Running locally

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm test                               # everything
BROWSERS=chromium npx playwright test  # quicker, Chromium only
npx playwright test tests/offline.spec.js --project=webkit-phone
```
