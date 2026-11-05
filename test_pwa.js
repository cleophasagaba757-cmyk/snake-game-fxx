// Static PWA checks: manifest, icons, service-worker precache list, relative paths.
// Run with:  node tests/test_pwa.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function pngSize(file) {
  const b = fs.readFileSync(path.join(root, file));
  if (b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---- manifest ----
const m = JSON.parse(read('manifest.json'));
ok(!!m.name && !!m.short_name, 'manifest has name and short_name');
ok(m.short_name.length <= 12, 'short_name is short enough for a home screen (' + m.short_name + ')');
ok(!!m.description, 'manifest has description');
ok(/^#[0-9a-f]{6}$/i.test(m.theme_color), 'theme_color set (' + m.theme_color + ')');
ok(/^#[0-9a-f]{6}$/i.test(m.background_color), 'background_color set (' + m.background_color + ')');
ok(m.display === 'standalone', 'display is standalone');
ok(m.start_url === './' && m.scope === './', 'start_url and scope are relative ("./")');
ok(m.id === './', 'id is relative');
ok(!/^\//.test(m.start_url) && !/^https?:/.test(m.start_url), 'start_url is not root-absolute');

const icons = m.icons || [];
const has = (size, purpose) => icons.some((i) => i.sizes === size && (i.purpose || 'any') === purpose);
ok(has('192x192', 'any') && has('512x512', 'any'), 'manifest has 192 and 512 "any" icons');
ok(has('192x192', 'maskable') && has('512x512', 'maskable'), 'manifest has 192 and 512 maskable icons');
icons.forEach((i) => {
  ok(exists(i.src), 'icon file exists: ' + i.src);
  const s = pngSize(i.src);
  const [w, h] = i.sizes.split('x').map(Number);
  ok(s && s.w === w && s.h === h, 'icon dimensions match ' + i.sizes + ' (' + i.src + ')');
  ok(!/^\//.test(i.src), 'icon path is relative: ' + i.src);
});
(m.screenshots || []).forEach((s) => ok(exists(s.src), 'screenshot exists: ' + s.src));

// ---- index.html wiring ----
const html = read('index.html');
ok(/<link rel="manifest" href="manifest\.json">/.test(html), 'index.html links manifest.json');
ok(/<meta name="theme-color" content="#[0-9a-f]{6}">/i.test(html), 'index.html has theme-color');
ok(/rel="apple-touch-icon"/.test(html), 'index.html has apple-touch-icon');
ok(/name="viewport"/.test(html), 'index.html has viewport meta');
ok(/<script src="pwa\.js">/.test(html), 'index.html loads pwa.js');
ok(/apple-mobile-web-app-capable/.test(html), 'iOS standalone meta present');

const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((x) => x[1]);
refs.forEach((r) => {
  ok(!/^\//.test(r) && !/^https?:\/\//.test(r), 'html reference is relative: ' + r);
  ok(exists(r), 'html reference exists: ' + r);
});

// ---- service worker ----
const sw = read('service-worker.js');
const shell = [...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
ok(shell.length > 5, 'service worker pre-caches ' + shell.length + ' files');
const optional = [...sw.match(/const OPTIONAL_FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
optional.forEach((f) => ok(exists(f), 'optional cached file exists: ' + f));
ok(/Promise\.allSettled/.test(sw), 'optional files cannot block service-worker installation');
icons.forEach((i) => ok(!/\//.test(i.src), 'icon lives at repo root (no sub-folder): ' + i.src));
ok(!m.screenshots || m.screenshots.every((x) => exists(x.src)), 'no screenshot references to missing files');
shell.forEach((f) => {
  if (f === './') return;
  ok(exists(f), 'pre-cached file exists: ' + f);
  ok(!/^\//.test(f), 'pre-cache path is relative: ' + f);
});
['index.html', 'style.css', 'script.js', 'pwa.js', 'manifest.json'].forEach((f) =>
  ok(shell.includes(f), 'app shell includes ' + f));
ok(/addEventListener\('install'/.test(sw) && /addEventListener\('activate'/.test(sw) && /addEventListener\('fetch'/.test(sw),
  'service worker has install, activate and fetch handlers');
ok(!/['"]\/[a-z]/i.test(sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'service worker has no root-absolute paths');

// ---- registration uses relative URL + scope ----
const pwa = read('pwa.js');
ok(/register\('service-worker\.js', \{ scope: '\.\/' \}\)/.test(pwa), 'registration uses relative path and scope');
ok(/beforeinstallprompt/.test(pwa) && /appinstalled/.test(pwa), 'install prompt + appinstalled handled');

// ---- splash images referenced in html exist ----
[...html.matchAll(/apple-touch-startup-image" href="([^"]+)"/g)].forEach((x) => {
  const s = pngSize(x[1]);
  const dims = x[1].match(/(\d+)x(\d+)/);
  ok(s && s.w === +dims[1] && s.h === +dims[2], 'splash image valid: ' + x[1]);
});

ok(exists('.nojekyll'), '.nojekyll present for GitHub Pages');

console.log(fails === 0 ? '\nALL PWA STATIC CHECKS PASSED' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
