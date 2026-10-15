// boot-watchdog-test.mjs — DOM-stubbed smoke test for the boot
// watchdog inline script in docs/explore.html. The watchdog is a
// classic script (not a module), so this harness extracts it from
// the page and runs it in a vm context against fake window/document/
// performance/timer stubs, then drives its listeners and its 20 s
// progress-stall timer through the scenarios that must hold:
//
//   stall >= 20 s without interactivity        -> panel
//   boot-critical (marked) rejection            -> panel
//   genuine script error during boot            -> panel
//   fire-and-forget (unmarked) rejection        -> NO panel, console-recorded
//   resource / message-less error noise         -> NO panel
//   any rejection or error AFTER __bootOk()    -> NO panel
//
// Run: node tools/boot-watchdog-test.mjs   (exit 1 on any failure)

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../docs/explore.html', import.meta.url), 'utf8');
const marker = html.indexOf('window.__booted = false;');
if (marker < 0) { console.error('FAIL  watchdog script not found in docs/explore.html'); process.exit(1); }
const start = html.lastIndexOf('<script>', marker);
const end = html.indexOf('</script>', marker);
const watchdogSrc = html.slice(start + '<script>'.length, end);

function makeEl() {
  return {
    dataset: {}, style: {}, children: [], className: '', textContent: '',
    _html: '',
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
  };
}

function boot() {
  const loadingEl = makeEl();
  const handlers = {};
  const warns = [];
  let now = 1_000_000;
  let intervalCb = null;
  const fakeConsole = { warn: (...a) => warns.push(a), log: () => {} };
  const fakeWindow = {
    addEventListener(name, fn) { handlers[name] = fn; },
    console: fakeConsole,   // in a real browser window.console === console; the watchdog's guard reads it off window
  };
  const sandbox = {
    window: fakeWindow,
    document: {
      getElementById: (id) => (id === 'loading' ? loadingEl : null),
      createElement: () => makeEl(),
    },
    performance: { now: () => now },
    setInterval: (cb) => { intervalCb = cb; return 1; },
    clearInterval: () => {},
    console: fakeConsole,
    location: { href: 'https://example.test/explore.html', replace() {} },
    URL,
  };
  vm.runInNewContext(watchdogSrc, sandbox, { filename: 'watchdog-inline.js' });
  return {
    win: fakeWindow, handlers, loadingEl, warns,
    advance(ms) { now += ms; },
    tick() { intervalCb(); },
    panelShown: () => loadingEl.dataset.failed === '1',
  };
}

const marked = (msg) => { const e = new Error(msg); e.__bootCritical = true; return e; };

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

// 1. progress stall >= 20 s without interactivity -> panel
{
  const b = boot();
  b.advance(21_000);
  b.tick();
  check('stall >= 20 s shows the panel', b.panelShown());
}
// 1b. progress inside the window -> no panel (a stamp resets the clock)
{
  const b = boot();
  b.advance(19_000);
  b.win.__bootProgress = 1_000_000 + 19_000;   // a tile landed: progress stamped
  b.advance(19_000);
  b.tick();
  check('progress within the window shows no panel', !b.panelShown());
}
// 2. boot-critical (marked) rejection -> panel
{
  const b = boot();
  b.handlers.unhandledrejection({ reason: marked('chart index failed'), preventDefault() {} });
  check('boot-critical rejection shows the panel', b.panelShown());
}
// 3. fire-and-forget (unmarked) rejection during boot -> NO panel, recorded
{
  const b = boot();
  b.handlers.unhandledrejection({ reason: new Error('harbor-kit.json 404'), preventDefault() {} });
  check('fire-and-forget rejection shows no panel', !b.panelShown());
  check('fire-and-forget rejection is console-recorded', b.warns.length >= 1);
}
// 4. post-boot: nothing panels, marked or not
{
  const b = boot();
  b.win.__bootOk();
  b.handlers.unhandledrejection({ reason: marked('late critical'), preventDefault() {} });
  b.handlers.error({ target: b.win, message: 'late script error', error: new Error('late') });
  b.advance(60_000); b.tick();
  check('post-boot rejection/error/stall show no panel', !b.panelShown());
}
// 5. error noise during boot -> NO panel
{
  const b = boot();
  b.handlers.error({ target: makeEl() });                                   // resource element error
  b.handlers.error({ target: b.win });                                      // message-less window event
  check('resource / message-less error noise shows no panel', !b.panelShown());
}
// 6. genuine script error during boot -> panel
{
  const b = boot();
  b.handlers.error({ target: b.win, message: 'ReferenceError: gridFromTile is not defined', error: new ReferenceError('x') });
  check('genuine script error shows the panel', b.panelShown());
}

console.log(failures ? `\nWATCHDOG TEST: ${failures} FAILURE(S)` : '\nWATCHDOG TEST: ALL PASS');
process.exit(failures ? 1 : 0);
