# 🐍 Snake 50

A polished, installable Snake game with **50 levels**, built with plain HTML, CSS and JavaScript. It runs in any modern browser, can be installed like a native app on Android and desktop (and added to the home screen on iOS), and **works fully offline** after the first visit. There is no backend, no database and no build step.

<p align="center">
  <img src="screenshots/mobile.png" alt="Snake 50 on a phone" width="260">
  &nbsp;&nbsp;
  <img src="screenshots/desktop.png" alt="Snake 50 in a desktop window" width="520">
</p>

## Features

- **50 levels** – eat 10 food balls to complete a level. The snake keeps its length and your score carries over.
- **Rising difficulty** – the snake gets faster every level, from 190 ms per move (Level 1) to 80 ms (Level 50), and never becomes unplayable.
- **Victory screen** – finishing Level 50 shows *YOU COMPLETED THE GAME* with your final score, total food eaten and a confetti celebration. Level 51 never unlocks.
- **Scoreboard** – current score, level, food eaten this level, a progress bar to the next level, and a **high score saved in your browser** (`localStorage`).
- **Gaming controller** – circular on-screen D-pad with a centre pause/resume button, tuned for touch screens. Also supports keyboard and swipe gestures.
- **Smooth movement** – fixed-step game logic with interpolated drawing, input buffering and no instant reversals into the snake's own body.
- **Sound effects** – generated with the Web Audio API (no audio files): eating, level up, pause/resume, game over and victory. One-tap sound toggle.
- **Vibration** – optional haptics on supported phones (short buzz when eating, a pattern on level up, a stronger one on game over).
- **Progressive Web App** – installable, offline-capable, standalone window, themed splash screen and icons (including maskable and iOS icons).
- **Responsive** – layout adapts from small phones to large desktop windows.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Move | On-screen arrows, or swipe on the board | Arrow keys or **W A S D** |
| Pause / resume | Centre button | **Space**, **P** or **Esc** |
| Start / play again | Overlay button or any direction | **Space** or **Enter** |

## Play and install

Once the game is hosted (see [Deploy to GitHub Pages](#deploy-to-github-pages)), open its URL.

| Platform | How to install |
| --- | --- |
| **Android (Chrome, Edge, Samsung Internet)** | Tap the in-game **Install App** button, or the browser menu → *Install app* / *Add to Home screen*. |
| **Desktop (Chrome, Edge)** | Click **Install App** in the game, or the install icon at the right of the address bar. |
| **iPhone / iPad (Safari)** | Tap **Install App** for instructions: *Share* → *Add to Home Screen*. |

After the first successful online visit the game is cached and keeps working with no connection. When installed it opens in its own window without browser controls.

## Run locally

Service workers only run on `https://` or `http://localhost`, so don't open `index.html` through a `file://` URL if you want to test the PWA features (the game itself still plays that way). Start any static server from the project folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a repository on GitHub and push this project so that `index.html` is in the **root** of the branch.
   ```bash
   git init
   git add .
   git commit -m "Snake 50 PWA"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```
2. In the repository open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select **main** and **/ (root)**, then **Save**.
4. After a minute the game is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

All paths in the project (manifest, service worker, icons, scripts) are **relative**, so the game works inside the repository sub-directory without any configuration. A `.nojekyll` file is included so GitHub Pages serves the files exactly as they are.

### Releasing an update

Browsers keep the cached copy until the service worker changes. After editing any game file, bump `VERSION` at the top of `service-worker.js` (for example `v1.0.0` → `v1.0.1`) and push. Players get the new version the next time they open the game after it downloads; old caches are deleted automatically.

## Project structure

Everything lives in the repository root, so the same paths work locally and on GitHub Pages (`https://YOUR-USERNAME.github.io/YOUR-REPO/`).

```
.
├── index.html                 # Game page and PWA <head> tags
├── style.css                  # Styles (dark gaming theme, controller, install UI)
├── script.js                  # Game logic, rendering, audio, vibration, input
├── pwa.js                     # Service-worker registration and install experience
├── service-worker.js          # Offline caching
├── manifest.json              # Web app manifest (name, colours, icons)
├── .nojekyll                  # Tells GitHub Pages not to run Jekyll
├── icon-192.png, icon-512.png                    # App icons
├── icon-maskable-192.png, icon-maskable-512.png  # Maskable icons (Android adaptive shapes)
├── apple-touch-icon.png, favicon-32.png, icon.svg
├── splash/                    # iOS launch screens (optional)
├── screenshots/               # Images used by this README
├── tests/                     # Automated tests (see below)
└── tools/generate-icons.py    # Regenerates every icon and splash image
```

## Tests

```bash
node tests/test_game.js     # game rules: movement, growth, 10 food per level, Level 50 win, restart, pause
node tests/test_pwa.js      # manifest, icons, pre-cache list, relative paths
python3 tests/e2e_pwa.py    # real Chrome: service worker, installability, install flow, offline play
```

`e2e_pwa.py` needs [Playwright for Python](https://playwright.dev/python/) and a Chrome/Chromium binary (set `CHROME_PATH` if it isn't found automatically). It serves the project from a repository-style sub-path, so any root-absolute URL would fail the run, and it shuts the server down to prove offline play works.

## Technologies

- HTML5, CSS3 and vanilla JavaScript (ES2015+), no frameworks or dependencies
- Canvas 2D for rendering
- Web Audio API for sound, Vibration API for haptics, `localStorage` for saved settings and high score
- Web App Manifest and Service Worker (Cache Storage API) for installability and offline play
- GitHub Pages for hosting
- Python and [Pillow](https://python-pillow.org/) (optional, only to regenerate icons)

## Turning it into a store app later

Because it is a standards-compliant PWA, it can be wrapped for app stores without rewriting the game, for example with [PWABuilder](https://www.pwabuilder.com/) or Bubblewrap (Trusted Web Activity) for Google Play. Store packaging has its own requirements (developer accounts, signing keys, listing assets), so treat that as a separate step.

## License

No license file is included yet. Add one (for example MIT) before publishing if you want others to be able to reuse the code.
