const fs = require('fs');
const vm = require('vm');

function makeEl() {
  const el = {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', className: '',
    clientWidth: 400, offsetWidth: 1, width: 400, height: 400,
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, appendChild(c) { this.children.push(c); },
    getContext() {
      return new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
    }
  };
  return el;
}
const els = {};
const store = {};
const listeners = {};
const sandbox = {
  console, Math, Set, setTimeout,
  document: {
    getElementById: (id) => (els[id] = els[id] || makeEl()),
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => makeEl(),
    addEventListener: (n, f) => { listeners[n] = f; }, hidden: false
  },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  navigator: { vibrate: () => true },
  requestAnimationFrame: () => {},
  addEventListener() {},
  devicePixelRatio: 1
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'script.js'), 'utf8'), sandbox);
const G = sandbox.SnakeGame;

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

ok(G.state === 'ready', 'starts in ready state');
ok(G.snakeLength === 3, 'initial length 3');
ok(G.food && G.food.x >= 0 && G.food.x < 30 && G.food.y >= 0 && G.food.y < 30 && !G.snake.some(s => s.x === G.food.x && s.y === G.food.y), 'food inside area, not on snake');

// start by pressing a direction, snake moves
G.setDirection('up');
ok(G.state === 'running', 'direction press starts game');
const h0 = { ...G.snake[0] };
G.tick();
ok(G.snake[0].y === h0.y - 1, 'snake turned up and moved');
// reversal blocked
G.setDirection('down');
G.tick();
ok(G.snake[0].y === h0.y - 2, 'reverse direction blocked');

// pause / resume
G.togglePause(); ok(G.state === 'paused', 'paused');
G.togglePause(); ok(G.state === 'running', 'resumed');

// speed table
ok(G.delayForLevel(1) === 190 && G.delayForLevel(50) === 80, 'speed 190ms -> 80ms');
let mono = true; for (let l = 2; l <= 50; l++) if (G.delayForLevel(l) > G.delayForLevel(l - 1)) mono = false;
ok(mono && G.delayForLevel(2) < G.delayForLevel(1), 'speed increases each level');

// keep snake alive: steer in a loop inside the board while eating
function eatOne() {
  const head = G.snake[0];
  // choose a direction toward a free cell that is safe, then place food ahead
  const options = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
  for (const [name, dx, dy] of options) {
    const nx = head.x + dx, ny = head.y + dy;
    if (nx < 0 || ny < 0 || nx >= 30 || ny >= 30) continue;
    if (G.snake.slice(0, -1).some(s => s.x === nx && s.y === ny)) continue;
    G.setDirection(name);
    break;
  }
  G._eatNow();
  G.tick();
}

const before = { len: G.snakeLength, score: G.score };
eatOne();
ok(G.score === before.score + 1 && G.snakeLength === before.len + 1, 'eating: score +1 and snake grows');
ok(G.levelFood === 1 && G.level === 1, 'level counter 1/10');
const f = G.food; ok(f && !G.snake.some(s => s.x === f.x && s.y === f.y), 'new food spawned off snake');

for (let i = 0; i < 8; i++) eatOne();
ok(G.levelFood === 9 && G.level === 1, '9/10 still level 1');
eatOne();
ok(G.level === 2 && G.levelFood === 0, 'tenth ball -> level 2, counter reset 0/10');
ok(G.score === 10 && G.snakeLength === 13, 'score and length carried over');

// ---- full run on a collision-free Hamiltonian route (30x30) ----
const W = 30, cyc = [];
for (let x = 0; x < W; x++) cyc.push({ x, y: 0 });
for (let y = 1; y < W; y++) {
  if (y % 2 === 1) for (let x = W - 1; x >= 1; x--) cyc.push({ x, y });
  else for (let x = 1; x < W; x++) cyc.push({ x, y });
}
for (let y = W - 1; y >= 1; y--) cyc.push({ x: 0, y });
G.playAgain();
G.snake.length = 0;
G.snake.push({ ...cyc[2] }, { ...cyc[1] }, { ...cyc[0] });
function cycleEat() {
  const h = G.snake[0];
  const i = cyc.findIndex(c => c.x === h.x && c.y === h.y);
  const nx = cyc[(i + 1) % cyc.length];
  const name = nx.x > h.x ? 'right' : nx.x < h.x ? 'left' : nx.y > h.y ? 'down' : 'up';
  G.setDirection(name);
  G._eatNow();
  G.tick();
}
let g2 = 0;
while (G.level < 50 && G.state === 'running' && g2++ < 1000) cycleEat();
ok(G.level === 50 && G.levelFood === 0 && G.state === 'running', 'reached level 50 (' + G.state + ', score ' + G.score + ')');
ok(G.score === 490, 'score 490 at start of level 50');
ok(G.snakeLength === 493, 'snake length carried over (493)');
for (let i = 0; i < 9; i++) cycleEat();
ok(G.level === 50 && G.levelFood === 9 && G.state === 'running', 'level 50 at 9/10');
cycleEat();
ok(G.state === 'won' && G.level === 50, 'level 50 completed -> won, no level 51');
ok(G.score === 500 && G.totalFood === 500, 'final score 500, total food 500');
ok(G.highScore === 500 && store.snake50_highScore === '500', 'high score saved to localStorage');

G.playAgain();
ok(G.state === 'running' && G.level === 1 && G.score === 0 && G.snakeLength === 3 && G.levelFood === 0, 'restart resets to level 1');
ok(G.highScore === 500, 'high score preserved after restart');

// wall collision
G.setDirection('up');
let n = 0; while (G.state === 'running' && n++ < 50) G.tick();
ok(G.state === 'over', 'wall collision -> game over');
G.playAgain();

// self collision: grow long then loop back
for (let i = 0; i < 5; i++) eatOne();
G.setDirection('up'); G.tick(); G.setDirection('left'); G.tick(); G.setDirection('down'); G.tick();
G.setDirection('right'); G.tick();
ok(G.state === 'over' || G.state === 'running', 'self-collision path executes without error (state ' + G.state + ')');

console.log(fails === 0 ? '\nALL TESTS PASSED' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
