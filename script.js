(() => {
  'use strict';

  /* =========================================================
     Configuration
     ========================================================= */
  const GRID = 30;                 // 30 x 30 cells (500 food + start length must fit on the board)
  const TOTAL_LEVELS = 50;         // exactly 50 levels
  const FOOD_PER_LEVEL = 10;       // 10 food balls per level
  const START_LENGTH = 3;
  const BASE_DELAY = 190;          // ms per move on level 1
  const MIN_DELAY = 80;            // ms per move on level 50 (stays playable)
  const DELAY_STEP = (BASE_DELAY - MIN_DELAY) / (TOTAL_LEVELS - 1);

  const STORAGE = {
    high: 'snake50_highScore',
    sound: 'snake50_sound',
    vibrate: 'snake50_vibrate'
  };

  const DIRS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1,  y: 0 }
  };

  /* =========================================================
     DOM
     ========================================================= */
  const $ = (id) => document.getElementById(id);
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const boardWrap = $('boardWrap');
  const scoreEl = $('score');
  const highEl = $('high');
  const levelEl = $('level');
  const levelFoodEl = $('levelFood');
  const remainingEl = $('remaining');
  const progressFill = $('progressFill');
  const toastEl = $('toast');
  const overlay = $('overlay');
  const overlayCard = $('overlayCard');
  const overlayTitle = $('overlayTitle');
  const overlaySub = $('overlaySub');
  const overlayStats = $('overlayStats');
  const overlayBtn = $('overlayBtn');
  const confettiEl = $('confetti');
  const centerBtn = $('centerBtn');
  const soundBtn = $('soundBtn');
  const vibrateBtn = $('vibrateBtn');

  /* =========================================================
     Storage helpers (safe if localStorage is blocked)
     ========================================================= */
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
  }

  /* =========================================================
     Game state
     ========================================================= */
  let snake = [];
  let prevSnake = [];
  let dir = DIRS.right;
  let dirQueue = [];
  let food = null;
  let score = 0;
  let highScore = parseInt(load(STORAGE.high, '0'), 10) || 0;
  let level = 1;
  let levelFood = 0;
  let totalFood = 0;
  let state = 'ready';             // ready | running | paused | over | won
  let acc = 0;                     // ms accumulated towards next move
  let lastFrame = 0;
  let soundOn = load(STORAGE.sound, '1') === '1';
  let vibrateOn = load(STORAGE.vibrate, '1') === '1';
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  /* =========================================================
     Audio (Web Audio – generated tones, no files needed)
     ========================================================= */
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, start, dur, type, vol) {
    const ac = getAudio();
    if (!ac) return;
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function sfx(name) {
    if (!soundOn) return;
    try {
      switch (name) {
        case 'eat':
          tone(660, 0, 0.07, 'square', 0.09);
          tone(990, 0.06, 0.09, 'square', 0.09);
          break;
        case 'level':
          [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.14, 'triangle', 0.16));
          break;
        case 'pause':
          tone(440, 0, 0.08, 'sine', 0.14);
          tone(330, 0.08, 0.1, 'sine', 0.14);
          break;
        case 'resume':
          tone(330, 0, 0.08, 'sine', 0.14);
          tone(440, 0.08, 0.1, 'sine', 0.14);
          break;
        case 'over':
          [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.22, 'sawtooth', 0.12));
          break;
        case 'win':
          [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.18));
          break;
        default: break;
      }
    } catch (e) { /* audio is optional */ }
  }

  /* =========================================================
     Vibration
     ========================================================= */
  function vibrate(pattern) {
    if (!vibrateOn || !canVibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* optional */ }
  }

  /* =========================================================
     Helpers
     ========================================================= */
  function delayForLevel(lv) {
    return Math.max(MIN_DELAY, Math.round(BASE_DELAY - (lv - 1) * DELAY_STEP));
  }

  function sameCell(a, b) { return a.x === b.x && a.y === b.y; }

  function spawnFood() {
    const taken = new Set(snake.map((s) => s.y * GRID + s.x));
    const free = [];
    for (let i = 0; i < GRID * GRID; i++) {
      if (!taken.has(i)) free.push(i);
    }
    if (free.length === 0) return false;
    const pick = free[Math.floor(Math.random() * free.length)];
    food = { x: pick % GRID, y: Math.floor(pick / GRID) };
    return true;
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
  }

  /* =========================================================
     UI updates
     ========================================================= */
  function updateHud() {
    scoreEl.textContent = score;
    highEl.textContent = highScore;
    levelEl.textContent = level;
    levelFoodEl.textContent = levelFood + '/' + FOOD_PER_LEVEL;
    const left = FOOD_PER_LEVEL - levelFood;
    remainingEl.textContent = level === TOTAL_LEVELS && left === 1
      ? '1 to the finish!'
      : left + ' to ' + (level === TOTAL_LEVELS ? 'finish' : 'go');
    progressFill.style.width = (levelFood / FOOD_PER_LEVEL) * 100 + '%';
  }

  function updateOptionButtons() {
    soundBtn.textContent = 'Sound: ' + (soundOn ? 'ON' : 'OFF');
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    if (!canVibrate) {
      vibrateBtn.textContent = 'Vibration: N/A';
      vibrateBtn.disabled = true;
      vibrateBtn.setAttribute('aria-pressed', 'false');
    } else {
      vibrateBtn.textContent = 'Vibration: ' + (vibrateOn ? 'ON' : 'OFF');
      vibrateBtn.setAttribute('aria-pressed', String(vibrateOn));
    }
  }

  function updateCenterIcon() {
    if (state === 'paused') centerBtn.classList.add('is-paused');
    else centerBtn.classList.remove('is-paused');
  }

  function showOverlay(opts) {
    overlayCard.className = 'overlay-card ' + (opts.cls || '');
    overlayTitle.textContent = opts.title;
    overlaySub.textContent = opts.sub || '';
    overlaySub.style.display = opts.sub ? '' : 'none';
    overlayStats.innerHTML = '';
    (opts.stats || []).forEach((s) => {
      const li = document.createElement('li');
      li.innerHTML = s.label + ': <strong>' + s.value + '</strong>';
      overlayStats.appendChild(li);
    });
    if (opts.button) {
      overlayBtn.textContent = opts.button;
      overlayBtn.classList.remove('hidden');
    } else {
      overlayBtn.classList.add('hidden');
    }
    overlay.classList.add('show');
  }

  function hideOverlay() {
    overlay.classList.remove('show');
  }

  function endStats() {
    return [
      { label: 'Final score', value: score },
      { label: 'Level reached', value: level },
      { label: 'Food eaten', value: totalFood }
    ];
  }

  /* =========================================================
     Confetti (victory animation)
     ========================================================= */
  function launchConfetti() {
    confettiEl.innerHTML = '';
    const colors = ['#39ff88', '#ffd166', '#ff4d6d', '#4dc3ff', '#c77dff', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2.2 + Math.random() * 2.4 + 's';
      p.style.animationDelay = Math.random() * 1.2 + 's';
      p.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      p.style.width = 6 + Math.random() * 6 + 'px';
      confettiEl.appendChild(p);
    }
  }

  function clearConfetti() { confettiEl.innerHTML = ''; }

  /* =========================================================
     Game flow
     ========================================================= */
  function resetGame() {
    const mid = Math.floor(GRID / 2);
    snake = [];
    for (let i = 0; i < START_LENGTH; i++) snake.push({ x: mid - i, y: mid });
    prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    dir = DIRS.right;
    dirQueue = [];
    score = 0;
    level = 1;
    levelFood = 0;
    totalFood = 0;
    acc = 0;
    food = null;
    spawnFood();
    clearConfetti();
    updateHud();
  }

  function newGame() {
    resetGame();
    state = 'ready';
    updateCenterIcon();
    showOverlay({
      title: 'SNAKE',
      sub: 'Eat 10 food balls per level. Clear all 50 levels to win!',
      button: 'START',
      cls: ''
    });
  }

  function startGame() {
    if (state !== 'ready') return;
    state = 'running';
    acc = 0;
    hideOverlay();
    updateCenterIcon();
    getAudio(); // unlock audio on first user gesture
  }

  function playAgain() {
    resetGame();
    state = 'running';
    hideOverlay();
    updateCenterIcon();
    getAudio();
  }

  function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    sfx('pause');
    updateCenterIcon();
    showOverlay({ title: 'PAUSED', sub: 'Press the centre button to resume', cls: 'paused' });
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'running';
    sfx('resume');
    hideOverlay();
    updateCenterIcon();
  }

  function togglePause() {
    if (state === 'ready') startGame();
    else if (state === 'running') pauseGame();
    else if (state === 'paused') resumeGame();
    else if (state === 'over' || state === 'won') playAgain();
  }

  function gameOver() {
    state = 'over';
    prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    sfx('over');
    vibrate([200, 80, 300]);
    boardWrap.classList.remove('shake');
    void boardWrap.offsetWidth;
    boardWrap.classList.add('shake');
    updateCenterIcon();
    showOverlay({ title: 'GAME OVER', stats: endStats(), button: 'PLAY AGAIN', cls: 'over' });
  }

  function winGame() {
    state = 'won';
    food = null;
    prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    sfx('win');
    vibrate([100, 60, 100, 60, 100, 60, 400]);
    updateCenterIcon();
    launchConfetti();
    showOverlay({
      title: 'YOU COMPLETED THE GAME!',
      sub: 'All 50 levels cleared. Legendary!',
      stats: [
        { label: 'Final score', value: score },
        { label: 'Total food balls eaten', value: totalFood }
      ],
      button: 'PLAY AGAIN',
      cls: 'won'
    });
  }

  function onEat() {
    score += 1;
    totalFood += 1;
    levelFood += 1;
    if (score > highScore) {
      highScore = score;
      save(STORAGE.high, highScore);
    }

    if (levelFood >= FOOD_PER_LEVEL) {
      if (level >= TOTAL_LEVELS) {
        // Level 50 is final: never unlock level 51
        levelFood = FOOD_PER_LEVEL;
        updateHud();
        bump(scoreEl);
        winGame();
        return;
      }
      level += 1;
      levelFood = 0;
      acc = 0;
      sfx('level');
      vibrate([60, 40, 60, 40, 120]);
      showToast('LEVEL ' + (level - 1) + ' COMPLETED!');
      bump(levelEl);
    } else {
      sfx('eat');
      vibrate(40);
    }

    updateHud();
    bump(scoreEl);
    if (!spawnFood()) winGame(); // board completely full (practically impossible)
  }

  /* One logical move of the snake */
  function tick() {
    prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    if (dirQueue.length) dir = dirQueue.shift();

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) {
      gameOver();
      return;
    }

    const ate = food !== null && sameCell(head, food);
    // When not eating the tail vacates its cell, so it's safe to move into it
    const body = ate ? snake : snake.slice(0, -1);
    if (body.some((s) => sameCell(s, head))) {
      gameOver();
      return;
    }

    snake.unshift(head);
    if (!ate) snake.pop();
    else onEat();
  }

  /* =========================================================
     Input
     ========================================================= */
  function setDirection(name) {
    const next = DIRS[name];
    if (!next) return;

    if (state === 'ready') startGame();
    else if (state === 'over' || state === 'won') return;
    else if (state === 'paused') return;

    const last = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
    // no direct reversal and ignore repeat of same direction
    if (next.x === -last.x && next.y === -last.y) return;
    if (next.x === last.x && next.y === last.y) return;
    if (dirQueue.length < 2) dirQueue.push(next);
  }

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right'
  };

  document.addEventListener('keydown', (e) => {
    if (KEYMAP[e.key]) {
      e.preventDefault();
      setDirection(KEYMAP[e.key]);
      const btn = document.querySelector('.pad-btn[data-dir="' + KEYMAP[e.key] + '"]');
      if (btn) {
        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 90);
      }
    } else if (e.key === ' ' || e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'running' || state === 'paused') togglePause();
      else if (e.key === ' ') togglePause(); // start / play again
    } else if (e.key === 'Enter' && (state === 'over' || state === 'won' || state === 'ready')) {
      e.preventDefault();
      togglePause();
    }
  });

  // Directional buttons: pointerdown gives instant response on touch screens
  document.querySelectorAll('.pad-btn[data-dir]').forEach((btn) => {
    const handler = (e) => {
      e.preventDefault();
      setDirection(btn.dataset.dir);
    };
    if (window.PointerEvent) btn.addEventListener('pointerdown', handler);
    else {
      btn.addEventListener('touchstart', handler, { passive: false });
      btn.addEventListener('mousedown', handler);
    }
    // keyboard activation of a focused button (Enter / Space)
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) setDirection(btn.dataset.dir);
    });
  });

  (function bindCenter() {
    const handler = (e) => { e.preventDefault(); togglePause(); };
    if (window.PointerEvent) centerBtn.addEventListener('pointerdown', handler);
    else {
      centerBtn.addEventListener('touchstart', handler, { passive: false });
      centerBtn.addEventListener('mousedown', handler);
    }
    centerBtn.addEventListener('click', (e) => { if (e.detail === 0) togglePause(); });
  })();

  overlayBtn.addEventListener('click', () => {
    if (state === 'ready') startGame();
    else if (state === 'over' || state === 'won') playAgain();
  });

  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    save(STORAGE.sound, soundOn ? '1' : '0');
    updateOptionButtons();
    if (soundOn) sfx('eat');
  });

  vibrateBtn.addEventListener('click', () => {
    if (!canVibrate) return;
    vibrateOn = !vibrateOn;
    save(STORAGE.vibrate, vibrateOn ? '1' : '0');
    updateOptionButtons();
    if (vibrateOn) vibrate(40);
  });

  // Swipe on the board as a bonus on phones
  (function bindSwipe() {
    let sx = 0, sy = 0, active = false;
    canvas.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches.length) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      active = true;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!active || !e.touches || !e.touches.length) return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? 'right' : 'left');
      else setDirection(dy > 0 ? 'down' : 'up');
      active = false;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { active = false; }, { passive: true });
  })();

  // Auto-pause when the tab/app is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'running') pauseGame();
  });

  /* =========================================================
     Rendering
     ========================================================= */
  let cell = 20;
  let dpr = 1;

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const size = Math.max(200, Math.floor(canvas.clientWidth || 400));
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    cell = canvas.width / GRID;
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 150));

  function lerp(a, b, t) { return a + (b - a) * t; }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground() {
    const w = canvas.width;
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, w, w);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#0a1020' : '#0d1427';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  function drawFood(time) {
    if (!food) return;
    const cx = (food.x + 0.5) * cell;
    const cy = (food.y + 0.5) * cell;
    const pulse = 1 + Math.sin(time / 180) * 0.08;
    const r = cell * 0.36 * pulse;

    ctx.save();
    ctx.shadowColor = 'rgba(255, 77, 109, 0.95)';
    ctx.shadowBlur = cell * 0.9;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ffd0d9');
    g.addColorStop(0.35, '#ff4d6d');
    g.addColorStop(1, '#c1123a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSnake(t) {
    const n = snake.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const cur = snake[i];
      const prev = prevSnake[i] || prevSnake[prevSnake.length - 1] || cur;
      pts.push({
        x: lerp(prev.x, cur.x, t) * cell,
        y: lerp(prev.y, cur.y, t) * cell
      });
    }

    const pad = cell * 0.07;
    const size = cell - pad * 2;

    // body, drawn tail -> head so the head ends on top
    for (let i = n - 1; i >= 0; i--) {
      const p = pts[i];
      const shade = i === 0 ? 0 : Math.min(0.45, (i / Math.max(n, 8)) * 0.5);
      const isHead = i === 0;
      ctx.save();
      if (isHead) {
        ctx.shadowColor = 'rgba(57, 255, 136, 0.8)';
        ctx.shadowBlur = cell * 0.6;
      }
      const g = ctx.createLinearGradient(p.x, p.y, p.x + cell, p.y + cell);
      if (isHead) {
        g.addColorStop(0, '#9dffc4');
        g.addColorStop(1, '#22e07a');
      } else {
        g.addColorStop(0, 'rgba(57,255,136,' + (1 - shade) + ')');
        g.addColorStop(1, 'rgba(18,170,86,' + (1 - shade) + ')');
      }
      ctx.fillStyle = g;
      roundRect(p.x + pad, p.y + pad, size, size, cell * (isHead ? 0.34 : 0.26));
      ctx.fill();
      ctx.restore();
    }

    // eyes on the head
    const h = pts[0];
    const cx = h.x + cell / 2;
    const cy = h.y + cell / 2;
    const d = dirQueue.length === 0 ? dir : dir;
    const fx = d.x;
    const fy = d.y;
    const sx = -fy;   // perpendicular
    const sy = fx;
    const eyeOff = cell * 0.2;
    const fwd = cell * 0.14;
    [-1, 1].forEach((side) => {
      const ex = cx + fx * fwd + sx * eyeOff * side;
      const ey = cy + fy * fwd + sy * eyeOff * side;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, cell * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#04200f';
      ctx.beginPath();
      ctx.arc(ex + fx * cell * 0.04, ey + fy * cell * 0.04, cell * 0.065, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function render(time) {
    drawBackground();
    drawFood(time);
    const delay = delayForLevel(level);
    const t = state === 'running' || state === 'paused' ? Math.min(1, acc / delay) : 1;
    drawSnake(state === 'ready' || state === 'over' || state === 'won' ? 1 : t);
  }

  /* =========================================================
     Main loop (fixed-step logic + smooth interpolated drawing)
     ========================================================= */
  function frame(time) {
    const dt = Math.min(100, time - (lastFrame || time));
    lastFrame = time;

    if (state === 'running') {
      acc += dt;
      let delay = delayForLevel(level);
      let guard = 0;
      while (acc >= delay && state === 'running' && guard < 5) {
        acc -= delay;
        tick();
        delay = delayForLevel(level);
        guard++;
      }
      if (state !== 'running') acc = 0;
    }

    render(time);
    requestAnimationFrame(frame);
  }

  /* =========================================================
     Init
     ========================================================= */
  function init() {
    updateOptionButtons();
    resizeCanvas();
    newGame();
    requestAnimationFrame(frame);
  }

  // Small read-only hook handy for debugging / automated testing
  window.SnakeGame = {
    get state() { return state; },
    get score() { return score; },
    get level() { return level; },
    get levelFood() { return levelFood; },
    get totalFood() { return totalFood; },
    get highScore() { return highScore; },
    get snakeLength() { return snake.length; },
    get food() { return food; },
    get snake() { return snake; },
    delayForLevel,
    tick,
    setDirection,
    togglePause,
    playAgain,
    _eatNow() {
      // test helper: place food directly ahead of the head and move
      const d = dirQueue.length ? dirQueue[0] : dir;
      const nx = snake[0].x + d.x, ny = snake[0].y + d.y;
      food = { x: nx, y: ny };
    }
  };

  init();
})();
