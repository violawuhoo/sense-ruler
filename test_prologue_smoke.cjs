/* Headless smoke test for Sense Ruler Phase 1 Prologue.
   Environment: Node 22, no jsdom/Playwright. We drive the inline <script> of
   index.html inside a vm context with minimal DOM/Canvas2D stubs.
   Verifies: first-boot Prologue, Prologue draw/cancel, Prologue success -> L1,
   Prologue fail -> replay (no text), 8-level success paths, and second-play skip. */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('/workspace/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no <script> found'); process.exit(2); }
const code = m[1];

function makeGame(preset) {
  let clock = 0, raf = null;
  const winListeners = {}, canListeners = {};
  const store = new Map();
  if (preset) for (const k in preset) store.set(k, preset[k]);

  const ctxStore = {};
  const ctx = new Proxy(ctxStore, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (p in t) return t[p];
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  function makeEl() {
    return { style: {}, textContent: '', innerHTML: '', onclick: null, disabled: false, className: '',
      appendChild() {}, addEventListener() {} };
  }
  const canvas = {
    getContext: () => ctx,
    addEventListener: (type, fn) => { (canListeners[type] = canListeners[type] || []).push(fn); },
    style: {}, width: 0, height: 0,
  };
  const els = {};
  const getEl = (id) => (id === 'c' ? canvas : (els[id] || (els[id] = makeEl())));
  const sandbox = {
    console, Math, JSON, Date, URL, URLSearchParams,
    setTimeout: () => 0, clearTimeout: () => {},
    performance: { now: () => clock },
    requestAnimationFrame: (cb) => { raf = cb; return 1; },
    location: { search: '' },
    navigator: { vibrate: () => {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: { getElementById: getEl, createElement: () => makeEl() },
    window: {
      addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
      devicePixelRatio: 2, innerWidth: 960, innerHeight: 540,
      AudioContext: undefined, webkitAudioContext: undefined,
    },
  };
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'sense_ruler_inline.js' });
  const dbg = sandbox.window.__dbg;
  const pump = (frames, ms = 50) => {
    for (let i = 0; i < frames; i++) { clock += ms; const cb = raf; raf = null; if (cb) cb(clock); }
  };
  const dispatch = (type) => {
    const ev = { preventDefault() {}, pointerType: 'touch', pointerId: 1 };
    (canListeners[type] || []).forEach((fn) => fn(ev));
  };
  return { dbg, pump, dispatch };
}

const results = [];
function test(name, fn) {
  try { fn(); results.push(['PASS', name]); console.log('  PASS ', name); }
  catch (e) { results.push(['FAIL', name + ' :: ' + e.message]); console.log('  FAIL ', name, '::', e.message); }
}
function assert(c, msg) { if (!c) throw new Error('ASSERT FAILED: ' + msg); }

const PASS = [194, 300, 180, 216, 45 * 2 * Math.PI, 210, 260, 220];

// ---------- Test A: first boot -> Prologue ----------
let g = makeGame();
test('A. first-boot enters Prologue (phase=prologue, levels.length=8)', () => {
  g.pump(6);
  assert(g.dbg.prologue === true, 'phase should be prologue on first play');
  assert(g.dbg.proSub === 'ready', 'proSub should be ready (ghost-hand demo)');
  assert(g.dbg.levels.length === 8, 'LEVELS length must stay 8');
});

// ---------- Test E: Prologue draw path ----------
test('E. Prologue ready (demo+affordance) & growing (hold progress) draw without error', () => {
  g.pump(10);
  assert(g.dbg.prologue === true, 'still in prologue');
  g.dispatch('pointerdown');
  assert(g.dbg.proSub === 'growing', 'pointerdown -> growing');
  g.pump(8);
  assert(g.dbg.proSub === 'growing', 'still growing while held');
});

// ---------- Test B: Prologue success ----------
test('B. Prologue success -> PROLOGUE_KEY + startLevel(0); no metric pollution', () => {
  const before = Object.keys(g.dbg.metrics).length;
  assert(g.dbg.prologueSim('success') === true, 'prologueSim(success)');
  g.pump(30);
  assert(g.dbg.isPrologueDone() === true, 'PROLOGUE_KEY written');
  assert(g.dbg.phase !== 'prologue', 'left prologue');
  assert(g.dbg.levels.length === 8, 'LEVELS length still 8');
  assert(Object.keys(g.dbg.metrics).length === before, 'Prologue adds no metrics');
  assert(g.dbg.report().rows.length === 0, 'report has no rows from Prologue');
});

// ---------- Test C: Prologue fail -> replay ----------
test('C. Prologue fail -> soft reset + replay demo, zero fail text', () => {
  g.dbg.forcePrologue();
  g.pump(2);
  assert(g.dbg.prologue === true && g.dbg.proSub === 'ready', 'forcePrologue -> ready');
  assert(g.dbg.prologueSim('fail') === true, 'prologueSim(fail)');
  assert(g.dbg.proSub === 'fail', 'in fail sub-state');
  assert(g.dbg.failMsg === '', 'Prologue fail suppresses all fail text (P1-5)');
  g.pump(30);
  assert(g.dbg.proSub === 'ready', 'fail replays demo back to ready');
  assert(g.dbg.failMsg === '', 'failMsg empty after replay');
});

// ---------- Test D: 8-level success ----------
test('D. all 8 levels reach success via simulated input', () => {
  g.dbg.setPrologueDone();
  for (let i = 0; i < 8; i++) {
    g.dbg.jump(i);
    let guard = 0;
    while (g.dbg.phase !== 'ready' && guard < 400) { g.pump(1); guard++; }
    assert(g.dbg.phase === 'ready', `level ${i} reaches ready (got ${g.dbg.phase})`);
    g.dispatch('pointerdown');
    assert(g.dbg.phase === 'growing', `level ${i} growing`);
    g.dbg.setRope(PASS[i]);
    g.dispatch('pointerup');
    assert(g.dbg.phase === 'fixed', `level ${i} fixed`);
    g.dispatch('pointerdown');
    assert(g.dbg.phase === 'transforming', `level ${i} transforming`);
    g.pump(16);
    const id = g.dbg.levels[i].id;
    assert(g.dbg.metrics[id] && g.dbg.metrics[id].passes >= 1, `level ${i} (${id}) registers a pass`);
    g.pump(20);
  }
  assert(g.dbg.levels.length === 8, 'LEVELS length still 8');
});

// ---------- Test F: hideText toggle ----------
test('F. __dbg.hideText() toggles without error', () => {
  g.dbg.hideText(true); g.pump(2); g.dbg.hideText(false); g.pump(2);
});

// ---------- Test G: second play (PROLOGUE_KEY preset) skips Prologue ----------
test('G. returning player (PROLOGUE_KEY set) skips Prologue on boot', () => {
  const g2 = makeGame({ 'sr_prologue_v1': '1' });
  g2.pump(40); // > 1.6s intro -> should startLevel(0), never prologue
  assert(g2.dbg.prologue === false, 'Prologue must be skipped on return play');
  assert(g2.dbg.phase === 'walking' || g2.dbg.phase === 'level_intro' || g2.dbg.phase === 'ready',
    'normal level flow engaged (got ' + g2.dbg.phase + ')');
  assert(g2.dbg.levels.length === 8, 'levels intact');
});

// ---------- summary ----------
const failed = results.filter((r) => r[0] === 'FAIL');
console.log('\n==== SMOKE SUMMARY ====');
console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
if (failed.length) { console.log('FAILURES:'); failed.forEach((f) => console.log('  - ' + f[1])); process.exit(1); }
console.log('ALL GREEN');
