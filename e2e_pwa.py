#!/usr/bin/env python3
"""End-to-end PWA test in a real Chromium/Chrome browser.

* Serves the project from a sub-directory (/snake-game/) like GitHub Pages does for
  project sites. Anything requested outside that prefix returns 404, so any
  root-absolute path in the app would be caught.
* Checks service-worker registration/scope, pre-cache contents, installability,
  the install button flow, standalone mode, iOS help dialog and OFFLINE play
  (the web server is shut down before the offline checks).

Usage:
    pip install playwright            # plus a Chromium/Chrome binary
    python3 tests/e2e_pwa.py
    CHROME_PATH=/usr/bin/google-chrome python3 tests/e2e_pwa.py
    python3 tests/e2e_pwa.py --screenshots     # also (re)creates screenshots/*.png
"""
import http.server
import json
import os
import re
import socketserver
import sys
import tempfile
import threading
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = "/snake-game/"
CHROME = os.environ.get("CHROME_PATH")
for guess in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"):
    if not CHROME and os.path.exists(guess):
        CHROME = guess

hits = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        hits.append(path)
        if not path.startswith(PREFIX):
            return os.path.join(ROOT, "__does_not_exist__")
        return super().translate_path("/" + path[len(PREFIX):])

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


srv = Server(("127.0.0.1", 0), Handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d%s" % (PORT, PREFIX)

fails = 0


def ok(cond, msg):
    global fails
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails += 1


sw_src = open(os.path.join(ROOT, "service-worker.js"), encoding="utf8").read()
shell = re.findall(r"'([^']+)'", re.search(r"APP_SHELL = \[(.*?)\];", sw_src, re.S).group(1))
shell += re.findall(r"'([^']+)'", re.search(r"OPTIONAL_FILES = \[(.*?)\];", sw_src, re.S).group(1))
expected_paths = sorted({PREFIX if f == "./" else PREFIX + f for f in shell})

with sync_playwright() as p:
    # A persistent profile is NOT incognito, so Chrome reports real installability.
    ctx = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix="snake-pwa-profile-"),
        executable_path=CHROME,
        headless=True,
        args=["--no-sandbox"],
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        has_touch=True,
        is_mobile=True,
    )
    page = ctx.new_page()
    errors, bad = [], []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: bad.append((r.status, r.url)) if r.status >= 400 else None)

    # ---------- 1. load + service worker ----------
    page.goto(BASE)
    scope = page.evaluate("navigator.serviceWorker.ready.then(r => r.scope)")
    ok(scope == BASE, "service worker registered with sub-directory scope (%s)" % scope)
    page.wait_for_function("navigator.serviceWorker.controller !== null || true")
    page.reload()
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=10000)
    ok(True, "page is controlled by the service worker after reload")
    ok(page.title() == "Snake 50 – Classic Snake Game", "page title: " + page.title())

    cached = page.evaluate(
        """async () => {
            const keys = await caches.keys();
            const out = {};
            for (const k of keys) {
              const c = await caches.open(k);
              out[k] = (await c.keys()).map(r => new URL(r.url).pathname);
            }
            return out;
        }"""
    )
    ok(len(cached) == 1 and list(cached)[0].startswith("snake50-"), "single versioned cache: %s" % list(cached))
    paths = sorted(set(list(cached.values())[0]))
    missing = [x for x in expected_paths if x not in paths]
    ok(not missing, "all %d app-shell files pre-cached %s" % (len(expected_paths), missing or ""))

    # ---------- 2. installability ----------
    cdp = ctx.new_cdp_session(page)
    errs = cdp.send("Page.getInstallabilityErrors").get("installabilityErrors", [])
    ok(errs == [], "Chrome installability errors: %s" % (errs or "none"))
    mf = cdp.send("Page.getAppManifest")
    ok(not mf.get("errors"), "manifest parses without errors %s" % (mf.get("errors") or ""))
    parsed = json.loads(mf["data"])
    mf_url = mf["url"]
    ok(urljoin(mf_url, parsed["start_url"]) == BASE and urljoin(mf_url, parsed["scope"]) == BASE,
       "start_url/scope resolve inside sub-directory")
    ok(all(urljoin(mf_url, i["src"]).startswith(BASE) for i in parsed["icons"]),
       "all manifest icons resolve inside sub-directory")

    icon_results = page.evaluate(
        """async (urls) => Promise.all(urls.map(async (u) => {
            const r = await fetch(u, { cache: 'no-store' });
            return [u, r.status, r.headers.get('content-type')];
        }))""",
        [urljoin(mf_url, i["src"]) for i in parsed["icons"]],
    )
    ok(all(st == 200 and (ct or "").startswith("image/png") for _, st, ct in icon_results),
       "every manifest icon downloads with HTTP 200 as image/png: %s" % [(u.rsplit("/", 1)[1], st) for u, st, _ in icon_results])
    ok("screenshots" not in parsed or all(page.evaluate("u => fetch(u).then(r => r.status)", urljoin(mf_url, x["src"])) == 200 for x in parsed["screenshots"]),
       "manifest has no screenshot references to missing files")
    ok(not bad, "no failed (>=400) requests while loading %s" % (bad or ""))
    ok(not errors, "no console errors / uncaught exceptions %s" % (errors or ""))
    outside = [h for h in hits if not h.startswith(PREFIX)]
    ok(not outside, "no requests outside the repo sub-directory %s" % (outside or ""))

    # ---------- 3. install button flow (simulated beforeinstallprompt) ----------
    # Real Chrome fires beforeinstallprompt itself for an installable app, so the button may already be shown.
    try:
        page.wait_for_selector("#installBtn", state="visible", timeout=5000)
        ok(True, "REAL beforeinstallprompt fired in Chrome and the Install App button appeared")
    except Exception:
        ok(page.is_hidden("#installBtn"), "install button hidden (Chrome did not fire beforeinstallprompt headless)")
    page.evaluate(
        """() => {
            const ev = new Event('beforeinstallprompt', { cancelable: true });
            window.__prompted = false;
            ev.prompt = () => { window.__prompted = true; return Promise.resolve(); };
            ev.userChoice = Promise.resolve({ outcome: 'accepted' });
            window.dispatchEvent(ev);
        }"""
    )
    ok(page.is_visible("#installBtn"), "install button appears on beforeinstallprompt")
    page.click("#installBtn")
    page.wait_for_function("window.__prompted === true")
    ok(True, "clicking install button calls the native install prompt")
    page.wait_for_function("document.getElementById('installBtn').hidden === true")
    ok(True, "install button hides after the prompt")
    page.evaluate("window.dispatchEvent(new Event('appinstalled'))")
    page.wait_for_selector("#pwaToast.show")
    ok("installed" in page.inner_text("#pwaToast"), "appinstalled shows confirmation toast")

    # ---------- 4. standalone (installed window) ----------
    s_page = ctx.new_page()
    # Headless Chrome cannot emulate display-mode, so patch matchMedia the way an installed window answers.
    s_page.add_init_script("""
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (q) => /display-mode:\\s*standalone/.test(q)
          ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
          : orig(q);
    """)
    s_page.goto(BASE)
    ok(s_page.evaluate("document.documentElement.classList.contains('standalone')"), "standalone class applied when launched as installed app")
    s_page.evaluate("window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', {cancelable:true}), {prompt(){}, userChoice: Promise.resolve({})}))")
    ok(s_page.is_hidden("#installBtn"), "install button stays hidden inside the installed app")
    s_page.keyboard.press("ArrowUp")
    s_page.wait_for_timeout(600)
    ok(s_page.evaluate("SnakeGame.state") == "running", "game runs in standalone window")
    s_page.close()

    # ---------- 5. iOS Safari manual install hint ----------
    ip = ctx.new_page()
    # Real iOS Safari never fires beforeinstallprompt; swallow Chrome's so the manual-instructions path is tested.
    ip.add_init_script("window.addEventListener('beforeinstallprompt', e => e.stopImmediatePropagation(), true);")
    ip_cdp = ctx.new_cdp_session(ip)
    ip_cdp.send("Emulation.setUserAgentOverride", {
        "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    })
    ip.goto(BASE)
    ok(ip.is_visible("#installBtn"), "iOS: manual install button shown")
    ip.click("#installBtn")
    ok(ip.is_visible("#installHelp") and "Add to Home Screen" in ip.inner_text("#installHelpText"), "iOS: 'Add to Home Screen' instructions dialog")
    ip.click("#installHelpClose")
    ok(ip.is_hidden("#installHelp"), "iOS: dialog closes")
    ip.close()

    if "--screenshots" in sys.argv:
        os.makedirs(os.path.join(ROOT, "screenshots"), exist_ok=True)

        def prep(pg):
            pg.goto(BASE)
            pg.add_style_tag(content=".chip-install{display:none !important}")
            pg.evaluate(
                """() => {
                    const G = window.SnakeGame;
                    G.setDirection('right');
                    for (let i = 0; i < 4; i++) { G._eatNow(); G.tick(); }
                    G.setDirection('down');
                    for (let i = 0; i < 2; i++) { G._eatNow(); G.tick(); }
                }"""
            )
            pg.wait_for_timeout(60)

        prep(page)
        page.screenshot(path=os.path.join(ROOT, "screenshots", "mobile.png"))
        desk = p.chromium.launch_persistent_context(
            tempfile.mkdtemp(prefix="snake-pwa-desktop-"),
            executable_path=CHROME,
            headless=True,
            args=["--no-sandbox"],
            viewport={"width": 1280, "height": 720},
            device_scale_factor=1,
        )
        dp = desk.new_page()
        prep(dp)
        dp.screenshot(path=os.path.join(ROOT, "screenshots", "desktop.png"))
        desk.close()
        print("Screenshots written to screenshots/")

    # ---------- 6. OFFLINE: kill the web server, then reload ----------
    page.close()
    page = ctx.new_page()
    srv.shutdown()
    srv.server_close()
    ctx.set_offline(True)
    off_errors = []
    page.on("pageerror", lambda e: off_errors.append(str(e)))

    for url, label in ((BASE, "root"), (BASE + "index.html", "index.html"), (BASE + "?source=pwa", "start_url with query")):
        page.goto(url)
        ok(page.title() == "Snake 50 – Classic Snake Game", "OFFLINE: page loads from cache (%s)" % label)

    ok(page.evaluate("getComputedStyle(document.body).backgroundColor !== ''") and page.evaluate("document.styleSheets.length") >= 1,
       "OFFLINE: stylesheet loaded")
    ok(page.evaluate("typeof window.SnakeGame === 'object'"), "OFFLINE: game script loaded")
    ok(page.evaluate("document.getElementById('board').getContext('2d') !== null"), "OFFLINE: canvas ready")
    manifest_ok = page.evaluate("fetch('manifest.json').then(r => r.ok)")
    ok(manifest_ok, "OFFLINE: manifest.json served from cache")
    icon_ok = page.evaluate("fetch('icon-512.png').then(r => r.ok)")
    ok(icon_ok, "OFFLINE: icons served from cache")

    page.click(".pad-btn.right")  # tap controller => starts the game
    page.wait_for_timeout(900)
    ok(page.evaluate("SnakeGame.state") == "running", "OFFLINE: game starts from on-screen controller")
    ok(page.evaluate("SnakeGame.snake[0].x") > 15, "OFFLINE: snake moves continuously")
    page.click("#centerBtn")
    ok(page.evaluate("SnakeGame.state") == "paused" and page.is_visible("#overlay"), "OFFLINE: centre button pauses")
    page.click("#centerBtn")
    ok(page.evaluate("SnakeGame.state") == "running", "OFFLINE: centre button resumes")
    ok(not off_errors, "OFFLINE: no JavaScript errors %s" % (off_errors or ""))

    ctx.close()

print("\nALL E2E PWA CHECKS PASSED" if fails == 0 else "\n%d FAILED" % fails)
sys.exit(1 if fails else 0)
