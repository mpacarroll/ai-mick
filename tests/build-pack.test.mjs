import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseCourse, buildPack, houseStyle, extractPrompt } from '../scripts/build-course-pack.mjs';

const require = createRequire(import.meta.url);
const Core = require('../courses/runtime/course-core.js');
const md = readFileSync(new URL('./fixtures/sample-course.md', import.meta.url), 'utf8');
const overlay = JSON.parse(readFileSync(new URL('./fixtures/sample-overlay.json', import.meta.url), 'utf8'));

test('houseStyle() removes em and en dashes and curly quotes', () => {
  assert.equal(houseStyle('stop — happy'), 'stop: happy');
  assert.equal(houseStyle('2020–2021'), '2020-2021');
  assert.equal(houseStyle('“hi” ‘x’'), '"hi" \'x\'');
});

test('extractPrompt() takes the first long quoted passage only', () => {
  assert.equal(extractPrompt('Say: "Cut this to half the length please." Then read.'), 'Cut this to half the length please.');
  assert.equal(extractPrompt('Say what is wrong ("too formal") and fix it.'), null);
});

test('parseCourse() reads title, intro, modules, exercises, learning and closing', () => {
  const c = parseCourse(md);
  assert.equal(c.title, 'Sample Course');
  assert.equal(c.subtitle, 'A synthetic course used only by the tests');
  assert.equal(c.intro.length, 1);
  assert.deepEqual(c.modules.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(c.modules[0].title, 'First things');
  assert.deepEqual(c.modules[0].exercises.map((e) => e.id), ['1.1', '1.2']);
  assert.equal(c.modules[0].exercises[0].prompt, 'Tell me three things about yourself in plain words please.');
  assert.equal(c.modules[0].exercises[1].prompt, null);
  assert.equal(c.modules[0].learning, 'that the fixture parser works.');
  assert.equal(c.modules[1].paragraphs[0], 'A second lesson: with a spaced em dash to normalize.');
  assert.deepEqual(c.closing, ['Closing line one.', 'Closing line two with a link mention.']);
});

test('preview packs carry only free modules; locked ones keep a title and summary', () => {
  const p = buildPack(md, overlay, 'preview');
  assert.equal(p.edition, 'preview');
  assert.equal(p.modules[0].locked, undefined);
  assert.deepEqual(p.modules[1], { id: 'm2', number: 2, title: 'Second things', summary: 'The second module summary.', locked: true });
  assert.equal(JSON.stringify(p).includes('Interview me about one small decision'), false, 'locked lesson text must not leak into the preview');
});

test('full packs apply overlay handoffs and added plan days', () => {
  const p = buildPack(md, overlay, 'full');
  assert.equal(p.modules[0].exercises[1].handoff.url, 'https://example.com/tool/');
  assert.deepEqual(p.modules[2].exercises.map((e) => e.id), ['3.d1', '3.d2']);
  assert.equal(Core.allSteps(p).length, 5);
});

test('buildPack() refuses an unsafe overlay link', () => {
  const bad = JSON.parse(JSON.stringify(overlay));
  bad.exercises['1.2'].handoff.url = 'javascript:alert(1)';
  assert.throws(() => buildPack(md, bad, 'full'), /not a safe web address/);
});

test('the committed preview pack is valid and contains only Module 1 lesson text', () => {
  const p = JSON.parse(readFileSync(new URL('../courses/ai-starts-here/learn/preview.pack.json', import.meta.url), 'utf8'));
  assert.deepEqual(Core.validatePack(p, 'ai-starts-here'), { ok: true, errors: [] });
  assert.equal(p.edition, 'preview');
  assert.deepEqual(p.modules.filter((m) => !m.locked).map((m) => m.id), ['m1']);
  for (const m of p.modules.filter((m) => m.locked)) assert.deepEqual(Object.keys(m).sort(), ['id', 'locked', 'number', 'summary', 'title']);
  assert.doesNotMatch(JSON.stringify(p), /[—–]/);
});

/* The paid manuscript lives in a private repo. When it is checked out beside
   this one, prove the real course parses into the expected shape and that the
   committed preview matches it. Otherwise this test is skipped, not faked. */
const real = new URL('../../mick-services/courses/ai-starts-here/course.md', import.meta.url);
const realOverlay = JSON.parse(readFileSync(new URL('../scripts/course-overlays/ai-starts-here.json', import.meta.url), 'utf8'));
test('the real AI Starts Here manuscript builds into 5 modules and 13 exercises', { skip: !existsSync(real) && 'mick-services is not checked out beside this repo' }, () => {
  const src = readFileSync(real, 'utf8');
  const p = buildPack(src, realOverlay, 'full');
  assert.deepEqual(p.modules.map((m) => m.exercises.length), [2, 2, 2, 2, 5]);
  assert.equal(Core.allSteps(p).length, 13);
  assert.doesNotMatch(JSON.stringify(p), /[—–]/);
  const committed = JSON.parse(readFileSync(new URL('../courses/ai-starts-here/learn/preview.pack.json', import.meta.url), 'utf8'));
  assert.deepEqual(buildPack(src, realOverlay, 'preview'), committed, 'preview.pack.json is stale: run npm run build:preview');
});
