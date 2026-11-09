/* End-to-end check of the course runtime in a real browser.
   node tests/e2e/learn.e2e.mjs            (uses a synthetic full course file)
   FULL_PACK=path/to/full.json node tests/e2e/learn.e2e.mjs   (uses a real one)
   SHOTS=dir  also writes screenshots there.
   Serves the repo root on a local port; touches no network. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { buildPack } from '../../scripts/build-course-pack.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('../../test-results/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const URL_LEARN = `${BASE}/courses/ai-starts-here/learn/`;

/* The course file a buyer would import. */
let fullPath = process.env.FULL_PACK;
let fullLabel = 'real full course file';
if (!fullPath) {
  const md = readFileSync(join(ROOT, 'tests/fixtures/sample-course.md'), 'utf8');
  const overlay = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sample-overlay.json'), 'utf8'));
  fullPath = join(OUT, 'synthetic-full.json');
  writeFileSync(fullPath, JSON.stringify(buildPack(md, overlay, 'full', 'ai-starts-here')));
  fullLabel = 'synthetic full course file';
}
const fullPack = JSON.parse(readFileSync(fullPath, 'utf8'));
const badPath = join(OUT, 'not-a-course.json');
writeFileSync(badPath, '{"hello": "world"}');
const previewPath = join(ROOT, 'courses/ai-starts-here/learn/preview.pack.json');

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('ok   ' + name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL ' + name + '\n     ' + String(e && e.message || e).split('\n').join('\n     ')); }
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true }); }
async function noSideScroll(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1], `page scrolls sideways: ${w[0]} > ${w[1]}`);
}

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// The hub's newsletter endpoint must never be called by the runtime.
const outbound = [];
page.on('request', (r) => { if (!r.url().startsWith(BASE)) outbound.push(r.url()); });

await step('fresh visit shows the free preview with nothing done', async () => {
  await page.goto(URL_LEARN);
  await page.getByRole('heading', { level: 1, name: 'AI Starts Here' }).waitFor();
  assert.match(await page.locator('.tag').first().innerText(), /free preview/i);
  assert.match(await page.locator('.rt-progress span').first().innerText(), /0 of 2 exercises done in the free preview/);
  assert.equal(await page.locator('.rt-mods li.is-locked').count(), 4);
  assert.equal(await page.locator('#rt-notice').isHidden(), true);
  await shot(page, '01-overview-desktop');
});

await step('Module 1 lesson: copy the prompt, write a note, mark it done', async () => {
  await page.getByRole('link', { name: 'Start Module 1' }).click();
  await page.getByRole('heading', { level: 1, name: 'It is a conversation, not a program' }).waitFor();
  await page.locator('#ex-1\\.1').getByRole('button', { name: 'Copy the prompt' }).click();
  await page.locator('#ex-1\\.1').getByText(/Copied|Selected/).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert.match(clip, /^Explain what you are good at/);
  await page.locator('#note-1_1').fill('It said it is good at drafts and bad at recent facts.');
  await page.locator('#ex-1\\.1').getByText('Saved on this device').waitFor();
  await page.locator('#done-1_1').check();
  assert.match(await page.locator('.rt-modstate').innerText(), /1 of 2 exercises done in this module/);
  await shot(page, '02-module1-desktop');
});

await step('notes survive a reload and the overview offers to resume', async () => {
  await page.locator('#note-1_2').fill('Typed and left the page without blurring');
  await page.reload();
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(await page.locator('#note-1_1').inputValue(), 'It said it is good at drafts and bad at recent facts.');
  assert.equal(await page.locator('#done-1_1').isChecked(), true);
  assert.equal(await page.locator('#note-1_2').inputValue(), 'Typed and left the page without blurring', 'pagehide must flush an unsaved note');
  await page.goto(URL_LEARN + '#');
  await page.getByRole('link', { name: 'Pick up where you left off: Module 1' }).waitFor();
});

await step('a locked module explains that checkout is not open, with no dead buy button', async () => {
  await page.goto(URL_LEARN + '#m2');
  await page.getByRole('heading', { level: 1, name: 'Say what you want, not how to get it' }).waitFor();
  await page.getByText('Checkout for the full course is not open yet.').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Get the full course' }).count(), 0);
  const href = await page.getByRole('link', { name: 'Tell me when it opens' }).getAttribute('href');
  assert.equal(href, '../#email');
  assert.equal(await page.locator('body').innerText().then((t) => t.includes('Goal-first requests beat')), false, 'locked lesson text must not appear');
  await shot(page, '03-locked-module-desktop');
});

await step('when a checkout link exists, the locked module links to it', async () => {
  const p2 = await ctx.newPage();
  await p2.route('**/courses/store.js', async (route) => {
    const body = readFileSync(join(ROOT, 'courses/store.js'), 'utf8').replace('"ai-starts-here": ""', '"ai-starts-here": "https://shop.example/ai-starts-here"');
    await route.fulfill({ body, contentType: 'text/javascript' });
  });
  await p2.goto(URL_LEARN + '#m3');
  const link = p2.getByRole('link', { name: 'Get the full course' });
  await link.waitFor();
  assert.equal(await link.getAttribute('href'), 'https://shop.example/ai-starts-here');
  await p2.close();
});

await step('importing the wrong files fails with a plain reason', async () => {
  await page.goto(URL_LEARN + '#m2');
  await page.locator('#rt-pack-file').setInputFiles(badPath);
  await page.getByText(/That file did not work: This is not a Mick course file/).waitFor();
  await page.locator('#rt-pack-file').setInputFiles(previewPath);
  await page.getByText(/That is the free preview, not the full course file/).waitFor();
});

await step(`importing the ${fullLabel} unlocks every module and keeps preview notes`, async () => {
  await page.locator('#rt-pack-file').setInputFiles(fullPath);
  await page.waitForFunction(() => window.__courseRuntime.pack().edition === 'full');
  assert.equal(await page.locator('.rt-unlock').count(), 0);
  await page.goto(URL_LEARN + '#m1');
  await page.locator('#note-1_1').waitFor();
  assert.match(await page.locator('#note-1_1').inputValue(), /drafts/);
  await page.reload();
  await page.waitForFunction(() => window.__courseRuntime.pack() && window.__courseRuntime.pack().edition === 'full');
});

await step('working every exercise finishes the course and opens the finish page', async () => {
  for (const m of fullPack.modules) {
    await page.goto(URL_LEARN + '#' + m.id);
    for (const e of m.exercises) {
      const id = e.id.replace(/\W/g, '_');
      const ta = page.locator('#note-' + id);
      if (!(await ta.inputValue())) await ta.fill('Synthetic note for ' + e.id);
      await page.locator('#done-' + id).check();
    }
  }
  await page.getByRole('link', { name: 'Finish the course' }).click();
  await page.getByRole('heading', { level: 1, name: 'You did all of it.' }).waitFor();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('mick.courses')).courses['ai-starts-here']);
  assert.ok(st.completedAt, 'completion is saved');
  await shot(page, '04-finished-desktop');
});

let notebookText = '', backupPath = '';
await step('the notebook downloads as Markdown and a backup downloads as JSON', async () => {
  await page.goto(URL_LEARN + '#notebook');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my notebook' }).click()]);
  assert.equal(dl.suggestedFilename(), 'ai-starts-here-notebook.md');
  notebookText = readFileSync(await dl.path(), 'utf8');
  assert.match(notebookText, /^# My notebook: /);
  assert.match(notebookText, /It said it is good at drafts/);
  [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a backup file' }).click()]);
  backupPath = join(OUT, 'backup.json');
  await dl.saveAs(backupPath);
  assert.equal(JSON.parse(readFileSync(backupPath, 'utf8')).schema, 'mick.course-backup');
  await shot(page, '05-notebook-desktop');
});

await step('delete my progress, then restore it from the backup', async () => {
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete my progress' }).click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('mick.courses')).courses['ai-starts-here']);
  await page.goto(URL_LEARN + '#notebook');
  await page.locator('#rt-restore').setInputFiles(backupPath);
  await page.getByText('Backup restored.').waitFor();
  await page.getByText('It said it is good at drafts and bad at recent facts.').waitFor();
});

await step('removing the course file returns to the preview and keeps notes', async () => {
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remove the course file' }).click();
  await page.waitForFunction(() => window.__courseRuntime.pack().edition === 'preview');
  await page.goto(URL_LEARN + '#m1');
  assert.match(await page.locator('#note-1_1').inputValue(), /drafts/);
});

await step('a damaged save is set aside and the learner is told', async () => {
  await page.evaluate(() => localStorage.setItem('mick.courses', '{"version":1,"courses":{"ai-starts-here":'));
  await page.reload();
  await page.locator('#rt-notice').waitFor({ state: 'visible' });
  assert.match(await page.locator('#rt-notice').innerText(), /damaged, so the page started fresh/);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('mick.courses.corrupt')).raw);
  assert.match(kept, /^\{"version":1/);
  await shot(page, '06-recovered-desktop');
});

await step('a damaged installed course file falls back to the preview with a notice', async () => {
  await page.evaluate(() => localStorage.setItem('mick.coursepack.ai-starts-here', '{broken'));
  await page.reload();
  await page.waitForFunction(() => window.__courseRuntime.pack() && window.__courseRuntime.pack().edition === 'preview');
  assert.match(await page.locator('#rt-notice').innerText(), /course file saved in this browser is damaged/);
  await page.evaluate(() => localStorage.removeItem('mick.coursepack.ai-starts-here'));
});

await step('if the course cannot load, the page says so and Try again works', async () => {
  const p3 = await ctx.newPage();
  await p3.route('**/preview.pack.json', (r) => r.abort());
  await p3.goto(URL_LEARN);
  await p3.getByRole('heading', { level: 1, name: 'The course did not load' }).waitFor();
  await p3.unroute('**/preview.pack.json');
  await p3.getByRole('button', { name: 'Try again' }).click();
  await p3.getByRole('heading', { level: 1, name: 'AI Starts Here' }).waitFor();
  await p3.close();
});

await step('blocked storage still lets you work and warns you to export', async () => {
  const c2 = await browser.newContext();
  await c2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  });
  const p4 = await c2.newPage();
  await p4.goto(URL_LEARN + '#m1');
  await p4.locator('#rt-notice').waitFor({ state: 'visible' });
  assert.match(await p4.locator('#rt-notice').innerText(), /not letting the page save/);
  await p4.locator('#note-1_1').fill('memory only');
  await p4.locator('#note-1_1').blur();
  await p4.locator('#ex-1\\.1').getByText(/Not saved/).waitFor();
  await c2.close();
});

await step('phone layout: no sideways scroll on every view, tap targets at least 44px', async () => {
  const c3 = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p5 = await c3.newPage();
  for (const [hash, name] of [['', '07-overview-phone'], ['#m1', '08-module1-phone'], ['#m2', '09-locked-phone'], ['#notebook', '10-notebook-phone']]) {
    await p5.goto(URL_LEARN + hash);
    await p5.getByRole('heading', { level: 1 }).waitFor();
    await noSideScroll(p5);
    if (SHOTS) await p5.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true });
  }
  await p5.goto(URL_LEARN + '#m1');
  const h = await p5.locator('.rt-check').first().boundingBox();
  assert.ok(h.height >= 44, 'done checkbox row is ' + h.height + 'px tall');
  await c3.close();
});

await step('keyboard: module change moves focus to the new heading', async () => {
  await page.goto(URL_LEARN + '#');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => { location.hash = '#m1'; });
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'H1' && /conversation/.test(document.activeElement.textContent));
});

await step('two tabs: work saved in one is not wiped by typing in the other', async () => {
  await page.evaluate(() => { localStorage.removeItem('mick.courses'); localStorage.removeItem('mick.courses.corrupt'); });
  await page.goto(URL_LEARN + '#m1');
  await page.reload();
  await page.locator('#note-1_1').waitFor();
  const b = await ctx.newPage();
  await b.goto(URL_LEARN + '#m1');
  await b.locator('#note-1_2').waitFor();
  // Tab A starts a note and keeps the cursor in it.
  await page.locator('#note-1_1').click();
  await page.locator('#note-1_1').pressSequentially('from tab A');
  await page.locator('#ex-1\\.1').getByText('Saved on this device').waitFor();
  // Tab B saves different work while A is still typing.
  await b.locator('#note-1_2').fill('from tab B');
  await b.locator('#ex-1\\.2').getByText('Saved on this device').waitFor();
  await b.locator('#done-1_2').check();
  await page.locator('#rt-notice').getByText(/open in another tab/).waitFor();
  // A keeps typing, which saves again.
  await page.locator('#note-1_1').pressSequentially(', more');
  await page.locator('#note-1_1').blur();
  await page.locator('#ex-1\\.1').getByText('Saved on this device').waitFor();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('mick.courses')).courses['ai-starts-here'].exercises);
  assert.equal(st['1.1'].note, 'from tab A, more');
  assert.equal(st['1.2'] && st['1.2'].note, 'from tab B', 'tab B note must survive tab A saving');
  assert.equal(st['1.2'].done, true);
  // Leaving the note shows tab B's work in tab A without a reload.
  assert.equal(await page.locator('#note-1_2').inputValue(), 'from tab B');
  await b.close();
});

await step('the runtime made no requests off this site and logged no errors', async () => {
  assert.deepEqual(outbound, []);
  assert.deepEqual(errors.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e)), []);
});

await browser.close();
server.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed (${fullLabel})`);
process.exit(failed ? 1 : 0);
