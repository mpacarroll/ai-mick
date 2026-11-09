/* End-to-end check of the toolkit and the My courses page in a real browser.
   node tests/e2e/my.e2e.mjs      SHOTS=dir also writes screenshots there.
   Serves the repo root on a local port; touches no network. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

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
const LEARN = `${BASE}/courses/ai-starts-here/learn/`;
const MY = `${BASE}/courses/my/`;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('ok   ' + name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL ' + name + '\n     ' + String(e && e.message || e).split('\n').join('\n     ')); }
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true }); }
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mick.courses') || '{"courses":{}}').courses['ai-starts-here'] || null);

const browser = await chromium.launch();
const errors = [];
const outbound = [];
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
function watch(p) {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('request', (r) => { if (!r.url().startsWith(BASE)) outbound.push(r.url()); });
  return p;
}
const page = watch(await ctx.newPage());

await step('a first visit lists every course honestly and an empty toolkit', async () => {
  await page.goto(MY);
  await page.getByRole('heading', { level: 1, name: 'Your courses and toolkit' }).waitFor();
  const first = page.locator('#course-ai-starts-here');
  await first.getByText('Not started. Module 1 is free in your browser.').waitFor();
  assert.equal(await first.getByRole('link', { name: 'Start the free preview' }).getAttribute('href'), '../ai-starts-here/learn/');
  for (const slug of ['get-ai-to-help', 'spec-driven-building']) {
    const row = page.locator('#course-' + slug);
    await row.getByText(/Not available in the browser yet/).waitFor();
    assert.equal(await row.getByRole('link', { name: /Start|Pick up/ }).count(), 0, slug + ' must not offer a learn link it does not have');
  }
  assert.equal(await page.getByText(/Buy|Get the full course|\$\d/).count(), 0, 'no buy buttons or prices here');
  await page.getByRole('heading', { level: 2, name: 'Nothing saved yet' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Download my toolkit' }).count(), 0);
  await shot(page, '11-my-empty-desktop');
});

await step('an exercise refuses to save an empty note, then saves it to the toolkit', async () => {
  await page.goto(LEARN + '#m1');
  const card = page.locator('#ex-1\\.1');
  await card.getByRole('button', { name: 'Save to my toolkit' }).click();
  await card.getByText('Write a note first, then save it to your toolkit.').waitFor();
  assert.equal((await saved(page)) && Object.keys((await saved(page)).artifacts || {}).length, 0);
  await page.locator('#note-1_1').fill('Good at drafts and explaining. Bad at recent facts.');
  await card.getByRole('button', { name: 'Save to my toolkit' }).click();
  await card.getByText('Saved to your toolkit as "What my AI says it is good and bad at".').waitFor();
  await card.getByRole('button', { name: 'Update my toolkit copy' }).waitFor();
  assert.equal(await card.getByRole('link', { name: 'See my toolkit' }).getAttribute('href'), '../../my/#toolkit');
  await page.locator('#done-1_1').check();
  const st = await saved(page);
  assert.deepEqual(st.artifacts['1.1'].body, 'Good at drafts and explaining. Bad at recent facts.');
  assert.equal(st.artifacts['1.1'].module, 'm1');
  assert.equal(st.snapshot.done, 1);
  await shot(page, '12-exercise-saved-desktop');
});

await step('My courses shows progress, where you left off, and the saved item', async () => {
  await page.goto(MY);
  const row = page.locator('#course-ai-starts-here');
  await row.getByText('1 of 2 exercises done in the free preview').waitFor();
  await row.getByText('Last open: It is a conversation, not a program').waitFor();
  assert.equal(await row.getByRole('link', { name: 'Pick up where you left off' }).getAttribute('href'), '../ai-starts-here/learn/#m1');
  await row.getByText('1 item from this course in your toolkit.').waitFor();
  const item = page.locator('.rt-item');
  assert.equal(await item.count(), 1);
  await item.getByRole('heading', { name: 'What my AI says it is good and bad at' }).waitFor();
  await item.getByText(/^From AI Starts Here, Exercise 1\.1 · saved \d{4}-\d{2}-\d{2}$/).waitFor();
  assert.equal(await item.getByRole('link', { name: 'Open the exercise' }).getAttribute('href'), '../ai-starts-here/learn/#m1');
  await item.getByRole('button', { name: 'Copy' }).click();
  await item.getByText(/Copied|Selected/).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText().catch(() => '')), 'Good at drafts and explaining. Bad at recent facts.');
  await shot(page, '13-my-toolkit-desktop');
});

await step('rename an item, and the name survives a reload', async () => {
  const item = page.locator('.rt-item').first();
  await item.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New name').fill('  ');
  await page.getByRole('button', { name: 'Save name' }).click();
  assert.equal(await page.getByLabel('New name').count(), 1, 'an empty name is not accepted');
  await page.getByLabel('New name').fill('<img src=x onerror=alert(1)> What it is for');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByText('Renamed.').waitFor();
  await page.reload();
  await page.locator('.rt-item h3').getByText('<img src=x onerror=alert(1)> What it is for', { exact: true }).waitFor();
  assert.equal(await page.locator('.rt-item img').count(), 0, 'titles render as text');
});

await step('updating the copy from the exercise keeps the new name and the new note', async () => {
  await page.goto(LEARN + '#m1');
  const card = page.locator('#ex-1\\.1');
  await card.getByText(/In your toolkit as/).waitFor();
  await page.locator('#note-1_1').fill('Good at drafts. Bad at recent facts. Check numbers.');
  await card.getByRole('button', { name: 'Update my toolkit copy' }).click();
  await card.getByText('Updated in your toolkit.').waitFor();
  await page.goto(MY + '#toolkit');
  await page.locator('.rt-item').getByText('Good at drafts. Bad at recent facts. Check numbers.').waitFor();
  await page.locator('.rt-item h3').getByText(/What it is for/).waitFor();
});

await step('the toolkit downloads as Markdown', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my toolkit' }).click()]);
  assert.equal(dl.suggestedFilename(), 'mick-toolkit.md');
  const md = readFileSync(await dl.path(), 'utf8');
  assert.match(md, /^# My AI toolkit\n/);
  assert.match(md, /## <img src=x onerror=alert\(1\)> What it is for/);
  assert.match(md, /From AI Starts Here, Exercise 1\.1/);
  assert.match(md, /Check numbers\./);
});

await step('a save in another tab shows up here without a reload', async () => {
  const learnTab = watch(await ctx.newPage());
  await learnTab.goto(LEARN + '#m1');
  await learnTab.locator('#note-1_2').fill('It kept the ask and cut the apology.');
  await learnTab.locator('#ex-1\\.2').getByRole('button', { name: 'Save to my toolkit' }).click();
  await learnTab.locator('#ex-1\\.2').getByText(/Saved to your toolkit/).waitFor();
  await page.locator('.rt-item h3').getByText('My cut-it-in-half request').waitFor();
  assert.equal(await page.locator('.rt-item').count(), 2);
  await page.getByRole('heading', { level: 2, name: '2 things worth keeping' }).waitFor();
  await learnTab.close();
});

await step('remove an item; the note in the course stays', async () => {
  page.once('dialog', (d) => d.accept());
  const item = page.locator('.rt-item').filter({ hasText: 'My cut-it-in-half request' });
  await item.getByRole('button', { name: 'Remove' }).click();
  await page.getByText(/Removed "My cut-it-in-half request"/).waitFor();
  assert.equal(await page.locator('.rt-item').count(), 1);
  const st = await saved(page);
  assert.equal(st.exercises['1.2'].note, 'It kept the ask and cut the apology.');
  assert.equal(st.artifacts['1.2'], undefined);
});

await step('a course backup carries the toolkit through delete and restore', async () => {
  await page.goto(LEARN + '#notebook');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a backup file' }).click()]);
  const backup = join(OUT, 'toolkit-backup.json');
  await dl.saveAs(backup);
  assert.ok(JSON.parse(readFileSync(backup, 'utf8')).progress.artifacts['1.1']);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete my progress' }).click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('mick.courses')).courses['ai-starts-here']);
  await page.goto(MY);
  await page.getByRole('heading', { level: 2, name: 'Nothing saved yet' }).waitFor();
  await page.locator('#course-ai-starts-here').getByText(/Not started/).waitFor();
  await page.goto(LEARN + '#notebook');
  await page.locator('#rt-restore').setInputFiles(backup);
  await page.getByText('Backup restored.').waitFor();
  await page.goto(MY);
  await page.locator('.rt-item h3').getByText(/What it is for/).waitFor();
});

await step('a damaged toolkit item in the save is dropped, not shown broken', async () => {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mick.courses'));
    s.courses['ai-starts-here'].artifacts.junk = { title: 'no body' };
    s.courses['ai-starts-here'].artifacts.worse = 42;
    localStorage.setItem('mick.courses', JSON.stringify(s));
  });
  await page.reload();
  await page.locator('.rt-item').first().waitFor();
  assert.equal(await page.locator('.rt-item').count(), 1);
});

await step('blocked storage: the page still loads and says it cannot save', async () => {
  const c2 = await browser.newContext();
  await c2.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } }); });
  const p = watch(await c2.newPage());
  await p.goto(MY);
  await p.locator('#rt-notice').waitFor({ state: 'visible' });
  assert.match(await p.locator('#rt-notice').innerText(), /not letting the page save/);
  await p.getByRole('heading', { level: 2, name: 'Nothing saved yet' }).waitFor();
  await c2.close();
});

await step('phone layout: no sideways scroll, tap targets at least 44px', async () => {
  const state = await page.evaluate(() => localStorage.getItem('mick.courses'));
  const c3 = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c3.addInitScript((s) => { if (!localStorage.getItem('mick.courses')) localStorage.setItem('mick.courses', s); }, state);
  const p = watch(await c3.newPage());
  await p.goto(MY);
  await p.locator('.rt-item').first().waitFor();
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1], `page scrolls sideways: ${w[0]} > ${w[1]}`);
  for (const name of ['Copy', 'Rename', 'Remove']) {
    const b = await p.locator('.rt-item').first().getByRole('button', { name }).boundingBox();
    assert.ok(b.height >= 44, name + ' is ' + b.height + 'px tall');
  }
  const link = await p.locator('.rt-item').first().getByRole('link', { name: 'Open the exercise' }).boundingBox();
  assert.ok(link.height >= 44, 'Open the exercise is ' + link.height + 'px tall');
  if (SHOTS) await p.screenshot({ path: join(SHOTS, '14-my-phone.png'), fullPage: true });
  await p.goto(LEARN + '#m1');
  await p.locator('#ex-1\\.1 .rt-keep').waitFor();
  const k = await p.locator('#ex-1\\.1 .rt-keep').boundingBox();
  assert.ok(k.height >= 44, 'toolkit button is ' + k.height + 'px tall');
  const w2 = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w2[0] <= w2[1], 'learn page scrolls sideways');
  await c3.close();
});

await step('no requests off this site and no errors', async () => {
  assert.deepEqual(outbound, []);
  assert.deepEqual(errors.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e)), []);
});

await browser.close();
server.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed (toolkit and My courses)`);
process.exit(failed ? 1 : 0);
