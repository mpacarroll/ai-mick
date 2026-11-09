import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildPack } from '../scripts/build-course-pack.mjs';

const require = createRequire(import.meta.url);
const Core = require('../courses/runtime/course-core.js');

const md = readFileSync(new URL('./fixtures/sample-course.md', import.meta.url), 'utf8');
const overlay = JSON.parse(readFileSync(new URL('./fixtures/sample-overlay.json', import.meta.url), 'utf8'));
const full = () => buildPack(md, overlay, 'full');
const preview = () => buildPack(md, overlay, 'preview');

/* A Storage stand-in with optional failure modes. */
function memStorage(init = {}, { failWrites = false, unavailable = false } = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    getItem: (k) => { if (unavailable) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (unavailable || failWrites) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: (k) => { if (unavailable) throw new Error('blocked'); m.delete(k); }
  };
}
const clock = () => new Date('2026-11-09T12:00:00Z');

test('inline() escapes markup before allowing bold and italic', () => {
  assert.equal(Core.inline('<img src=x onerror=alert(1)> **hi**'), '&lt;img src=x onerror=alert(1)&gt; <strong>hi</strong>');
  assert.equal(Core.inline('*a* "b"'), '<em>a</em> &quot;b&quot;');
});

test('safeUrl() allows https and relative links only', () => {
  assert.ok(Core.safeUrl('https://example.com/'));
  assert.ok(Core.safeUrl('../next/'));
  assert.ok(Core.safeUrl('#email'));
  assert.ok(!Core.safeUrl('javascript:alert(1)'));
  assert.ok(!Core.safeUrl('http://example.com/'));
  assert.ok(!Core.safeUrl('//evil.example/'));
});

test('validatePack() accepts built packs and names each problem', () => {
  assert.deepEqual(Core.validatePack(full(), 'sample-course'), { ok: true, errors: [] });
  assert.ok(Core.validatePack(preview(), 'sample-course').ok);
  const bad = full();
  bad.schema = 'other';
  bad.modules[1].id = 'm1';
  bad.modules[0].exercises[0].handoff = { label: 'x', url: 'javascript:alert(1)' };
  const r = Core.validatePack(bad, 'another-course');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /not a Mick course file/.test(e)));
  assert.ok(r.errors.some((e) => /not this course/.test(e)));
  assert.ok(r.errors.some((e) => /repeats the id "m1"/.test(e)));
  assert.ok(r.errors.some((e) => /not a safe web address/.test(e)));
});

test('validatePack() rejects newer pack versions and locked modules in a full pack', () => {
  const p = full(); p.version = 99;
  assert.ok(Core.validatePack(p).errors.some((e) => /newer than this page/.test(e)));
  const q = full(); q.modules[1] = { id: 'm2', title: 'x', locked: true };
  assert.ok(Core.validatePack(q).errors.some((e) => /locked inside a full course/.test(e)));
});

test('parsePackText() reports damaged and oversized files clearly', () => {
  assert.match(Core.parsePackText('{nope', 'sample-course').errors[0], /damaged/);
  assert.match(Core.parsePackText('x'.repeat(1000001), 'sample-course').errors[0], /too large/);
  assert.equal(Core.parsePackText(JSON.stringify(full()), 'sample-course').ok, true);
});

test('fresh store starts empty and saves notes, done flags and completion', () => {
  const st = memStorage();
  const s = Core.createStore(st, { clock });
  assert.equal(s.status, 'fresh');
  assert.ok(s.setNote('sample-course', '1.1', 'it told me its limits'));
  assert.ok(s.setDone('sample-course', '1.1', true));
  const saved = JSON.parse(st.map.get(Core.SAVE_KEY));
  assert.equal(saved.version, Core.SAVE_VERSION);
  assert.equal(saved.courses['sample-course'].exercises['1.1'].note, 'it told me its limits');
  assert.equal(saved.courses['sample-course'].exercises['1.1'].done, true);
  const again = Core.createStore(st, { clock });
  assert.equal(again.status, 'ok');
  assert.equal(again.course('sample-course').exercises['1.1'].done, true);
});

test('a corrupt save is set aside, not lost, and the page starts fresh', () => {
  const st = memStorage({ [Core.SAVE_KEY]: '{"version":1,"courses":{' });
  const s = Core.createStore(st, { clock });
  assert.equal(s.status, 'recovered');
  assert.match(s.notice, /damaged/);
  assert.equal(JSON.parse(st.map.get(Core.CORRUPT_KEY)).raw, '{"version":1,"courses":{');
  assert.deepEqual(JSON.parse(st.map.get(Core.SAVE_KEY)), { version: 1, courses: {} });
});

test('an unversioned save is treated as damaged', () => {
  const s = Core.createStore(memStorage({ [Core.SAVE_KEY]: '[1,2,3]' }), { clock });
  assert.equal(s.status, 'recovered');
});

test('a save from a newer version is shown read-only and never overwritten', () => {
  const raw = JSON.stringify({ version: 9, courses: { 'sample-course': { exercises: { '1.1': { done: true, note: 'from the future' } } } } });
  const st = memStorage({ [Core.SAVE_KEY]: raw });
  const s = Core.createStore(st, { clock });
  assert.equal(s.status, 'newer');
  assert.equal(s.writable, false);
  assert.equal(s.course('sample-course').exercises['1.1'].note, 'from the future');
  assert.equal(s.setNote('sample-course', '1.1', 'overwrite attempt'), false);
  assert.equal(st.map.get(Core.SAVE_KEY), raw);
});

test('blocked storage falls back to memory with a warning', () => {
  const s = Core.createStore(memStorage({}, { unavailable: true }), { clock });
  assert.equal(s.status, 'memory');
  assert.match(s.notice, /export your notes/i);
  assert.equal(s.setNote('sample-course', '1.1', 'x'), false);
  assert.equal(s.course('sample-course').exercises['1.1'].note, 'x');
});

test('storage that fills up mid-session switches to the warning instead of throwing', () => {
  const st = memStorage();
  const s = Core.createStore(st, { clock });
  assert.ok(s.setNote('sample-course', '1.1', 'a'));
  st.setItem = () => { throw new Error('quota'); };
  assert.equal(s.setNote('sample-course', '1.1', 'b'), false);
  assert.equal(s.status, 'memory');
  assert.match(s.notice, /storage may be full/);
});

test('normalizeCourse() drops malformed fields and caps note length', () => {
  const c = Core.normalizeCourse({ read: { m1: true, m2: 'yes' }, exercises: { a: 'bad', b: { done: 'true', note: 'x'.repeat(Core.MAX_NOTE + 5) } }, lastModule: 5 });
  assert.deepEqual(c.read, { m1: true });
  assert.equal(c.exercises.a, undefined);
  assert.equal(c.exercises.b.done, false);
  assert.equal(c.exercises.b.note.length, Core.MAX_NOTE);
  assert.equal(c.lastModule, null);
});

test('summarize() counts open exercises and never calls a preview finished', () => {
  const s = Core.createStore(memStorage(), { clock });
  for (const id of ['1.1', '1.2']) s.setDone('sample-course', id, true);
  const pv = Core.summarize(preview(), s.course('sample-course'));
  assert.equal(pv.done, 2); assert.equal(pv.total, 2); assert.equal(pv.lockedModules, 2);
  assert.equal(pv.modules[0].complete, true);
  assert.equal(pv.complete, false);
  const f = full();
  assert.equal(Core.summarize(f, s.course('sample-course')).complete, false);
  for (const id of ['2.1', '3.d1', '3.d2']) s.setDone('sample-course', id, true);
  const done = Core.summarize(f, s.course('sample-course'));
  assert.equal(done.done, 5); assert.equal(done.total, 5); assert.equal(done.complete, true);
});

test('resumeModule() returns the saved module, then the first unfinished one', () => {
  const s = Core.createStore(memStorage(), { clock });
  const f = full();
  assert.equal(Core.resumeModule(f, null), 'm1');
  s.setDone('sample-course', '1.1', true); s.setDone('sample-course', '1.2', true);
  assert.equal(Core.resumeModule(f, s.course('sample-course')), 'm2');
  s.setLastModule('sample-course', 'm3');
  assert.equal(Core.resumeModule(f, s.course('sample-course')), 'm3');
  // A saved module that is locked in this edition is ignored.
  assert.equal(Core.resumeModule(preview(), s.course('sample-course')), 'm1');
});

test('checkout() fails clearly when there is no checkout link', () => {
  assert.deepEqual(Core.checkout({ 'sample-course': '' }, 'sample-course').open, false);
  assert.match(Core.checkout({}, 'sample-course').reason, /not open yet/);
  assert.match(Core.checkout(undefined, 'sample-course').reason, /not open yet/);
  assert.match(Core.checkout({ 'sample-course': 'http://insecure.example/' }, 'sample-course').reason, /not a secure web address/);
  assert.deepEqual(Core.checkout({ 'sample-course': 'https://shop.example/x' }, 'sample-course'), { open: true, url: 'https://shop.example/x' });
});

test('exportMarkdown() includes every exercise, notes and orphaned notes', () => {
  const s = Core.createStore(memStorage(), { clock });
  s.setNote('sample-course', '1.1', 'My answer'); s.setDone('sample-course', '1.1', true);
  s.setNote('sample-course', 'old.9', 'from another edition');
  const out = Core.exportMarkdown(full(), s.course('sample-course'), clock);
  assert.match(out, /^# My notebook: Sample Course/);
  assert.match(out, /Exported 2026-11-09\. 1 of 5 exercises done\./);
  assert.match(out, /### Exercise 1\.1 \(done\)\n\n> Type exactly this/);
  assert.match(out, /My answer/);
  assert.match(out, /### Exercise 1\.2 \(not done yet\)[\s\S]*_No notes yet\._/);
  assert.match(out, /## Other notes[\s\S]*old\.9[\s\S]*from another edition/);
  assert.doesNotMatch(out, /—/);
  const pv = Core.exportMarkdown(preview(), s.course('sample-course'), clock);
  assert.match(pv, /in the free preview \(2 modules are in the full course\)/);
});

test('backup round-trips and rejects the wrong file types', () => {
  const s = Core.createStore(memStorage(), { clock });
  s.setNote('sample-course', '2.1', 'kept'); s.setDone('sample-course', '2.1', true);
  const text = JSON.stringify(Core.makeBackup(s, 'sample-course', clock));
  const r = Core.readBackup(text, 'sample-course');
  assert.equal(r.ok, true);
  const t = Core.createStore(memStorage(), { clock });
  t.replaceCourse('sample-course', r.progress);
  assert.equal(t.course('sample-course').exercises['2.1'].note, 'kept');
  assert.match(Core.readBackup(text, 'other-course').errors[0], /not this course/);
  assert.match(Core.readBackup('{', 'sample-course').errors[0], /damaged/);
  assert.match(Core.readBackup(JSON.stringify(full()), 'sample-course').errors[0], /course file, not a backup/);
  const newer = JSON.parse(text); newer.version = 7;
  assert.match(Core.readBackup(JSON.stringify(newer), 'sample-course').errors[0], /newer version/);
});

test('installed packs persist per course and can be removed', () => {
  const st = memStorage();
  const s = Core.createStore(st, { clock });
  assert.equal(s.loadPack('sample-course'), null);
  assert.ok(s.savePack('sample-course', full()));
  assert.equal(s.loadPack('sample-course').pack.edition, 'full');
  st.map.set('mick.coursepack.sample-course', '{broken');
  assert.equal(s.loadPack('sample-course').ok, false);
  assert.ok(s.removePack('sample-course'));
  assert.equal(s.loadPack('sample-course'), null);
});

test('resetCourse() deletes only that course', () => {
  const s = Core.createStore(memStorage(), { clock });
  s.setNote('sample-course', '1.1', 'a'); s.setNote('other', '1.1', 'b');
  s.resetCourse('sample-course');
  assert.equal(s.state().courses['sample-course'], undefined);
  assert.equal(s.state().courses.other.exercises['1.1'].note, 'b');
});

test('safeUrl() refuses backslash and whitespace tricks that browsers read as another site', () => {
  assert.ok(!Core.safeUrl('/\\evil.example/'));
  assert.ok(!Core.safeUrl('\\\\evil.example/'));
  assert.ok(!Core.safeUrl('/ok /path'));
});

test('validatePack() rejects wrongly typed fields an imported file could carry', () => {
  const p = full();
  p.intro = 'not a list';
  p.modules[0].paragraphs = [1, 2];
  p.modules[0].number = 'one';
  p.modules[0].exercises[0].label = { x: 1 };
  p.handoffs = {};
  const r = Core.validatePack(p, 'sample-course');
  assert.equal(r.ok, false);
  for (const re of [/unreadable intro/, /has no text/, /unreadable number/, /unreadable label/, /unreadable list of links/]) {
    assert.ok(r.errors.some((e) => re.test(e)), 'missing error ' + re);
  }
});

test('parsePackText() fills optional fields so a minimal valid pack still renders', () => {
  const p = full();
  delete p.intro; delete p.closing; delete p.handoffs; delete p.subtitle;
  p.modules.forEach((m) => { delete m.number; });
  const r = Core.parsePackText(JSON.stringify(p), 'sample-course');
  assert.equal(r.ok, true, r.errors.join(' '));
  assert.deepEqual([r.pack.intro, r.pack.closing, r.pack.handoffs, r.pack.subtitle], [[], [], [], '']);
  assert.deepEqual(r.pack.modules.map((m) => m.number), r.pack.modules.map((_, i) => i + 1));
});

test('two stores on one storage (two tabs) never wipe each other', () => {
  const s = memStorage();
  const a = Core.createStore(s, { clock });
  const b = Core.createStore(s, { clock });
  assert.ok(a.setNote('c', 'x1', 'from A'));
  assert.ok(b.setNote('c', 'x2', 'from B'));
  assert.ok(b.setDone('c', 'x2', true));
  assert.ok(a.setNote('c', 'x1', 'from A, edited'));
  const saved = JSON.parse(s.getItem(Core.SAVE_KEY)).courses.c.exercises;
  assert.equal(saved.x1.note, 'from A, edited');
  assert.equal(saved.x2.note, 'from B');
  assert.equal(saved.x2.done, true);
  // Reset in one tab is respected by the other, not resurrected.
  assert.ok(b.resetCourse('c'));
  a.reload();
  assert.equal(a.state().courses.c, undefined);
});

test('a newer save written by another tab makes this tab read-only', () => {
  const s = memStorage();
  const a = Core.createStore(s, { clock });
  assert.ok(a.setNote('c', 'x1', 'old'));
  s.setItem(Core.SAVE_KEY, JSON.stringify({ version: Core.SAVE_VERSION + 1, courses: { c: { exercises: { x1: { note: 'newer' } } } } }));
  assert.equal(a.setNote('c', 'x1', 'would overwrite'), false);
  assert.equal(a.status, 'newer');
  assert.match(JSON.parse(s.getItem(Core.SAVE_KEY)).courses.c.exercises.x1.note, /newer/);
});

test('validatePack() reports, never throws, on lists that are not lists', () => {
  for (const mutate of [(p) => { p.modules = {}; }, (p) => { p.modules[0].exercises = {}; }, (p) => { p.handoffs = 'x'; }, (p) => { p.modules = [null, 5]; }]) {
    const p = full(); mutate(p);
    const r = Core.validatePack(p, 'sample-course');
    assert.equal(r.ok, false);
  }
});

const CATALOG = [
  { slug: 'c', title: 'Course C', level: 'Level 1', page: 'c/', learn: 'c/learn/' },
  { slug: 'd', title: 'Course D', level: 'Level 2', page: 'd/', learn: null }
];

test('toolkit: save, update, rename and remove an item; empty notes are refused', () => {
  const s = memStorage();
  const st = Core.createStore(s, { clock });
  assert.equal(st.saveArtifact('c', '1.1', { title: 'T', body: '   ' }), false);
  assert.ok(st.saveArtifact('c', '1.1', { title: '  My prompt  ', body: 'Ask for three versions.', source: 'Exercise 1.1' }));
  let saved = JSON.parse(s.getItem(Core.SAVE_KEY)).courses.c.artifacts['1.1'];
  assert.deepEqual(saved, { title: 'My prompt', body: 'Ask for three versions.', source: 'Exercise 1.1', savedAt: '2026-11-09T12:00:00.000Z' });
  assert.ok(st.saveArtifact('c', '1.1', { title: 'My prompt', body: 'Ask for three versions, then pick.' }));
  assert.equal(Object.keys(st.state().courses.c.artifacts).length, 1, 'saving again updates, never duplicates');
  assert.ok(st.renameArtifact('c', '1.1', 'x'.repeat(500)));
  assert.equal(st.state().courses.c.artifacts['1.1'].title.length, Core.MAX_TITLE);
  assert.equal(st.renameArtifact('c', '1.1', '  '), false);
  assert.equal(st.renameArtifact('c', 'nope', 'x'), false);
  assert.ok(st.removeArtifact('c', '1.1'));
  assert.deepEqual(st.state().courses.c.artifacts, {});
});

test('toolkit items travel in the course backup and survive a damaged item', () => {
  const st = Core.createStore(memStorage(), { clock });
  st.saveArtifact('c', '1.1', { title: 'Keep', body: 'Body' });
  const b = Core.makeBackup(st, 'c', clock);
  b.progress.artifacts.bad = { title: 'No body' };
  b.progress.artifacts.worse = 'nope';
  const r = Core.readBackup(JSON.stringify(b), 'c');
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.progress.artifacts), ['1.1']);
});

test('setSnapshot() only writes when the summary changed', () => {
  const s = memStorage();
  let writes = 0;
  const counting = { ...s, setItem: (k, v) => { if (k === Core.SAVE_KEY) writes++; s.setItem(k, v); } };
  const st = Core.createStore(counting, { clock });
  const snap = Core.snapshotFor(preview(), { lastModule: 'm1', read: {}, exercises: {} });
  assert.deepEqual(snap, { title: preview().title, edition: 'preview', done: 0, total: 2, lockedModules: 2, lastModuleTitle: preview().modules[0].title });
  assert.ok(st.setSnapshot('c', snap));
  const after = writes;
  assert.ok(st.setSnapshot('c', snap));
  assert.equal(writes, after);
});

test('myCourses() reports honest status for each course', () => {
  const st = Core.createStore(memStorage(), { clock });
  let rows = Core.myCourses(st.state(), CATALOG);
  assert.deepEqual(rows.map((r) => r.status), ['new', 'none']);
  assert.equal(rows[0].resume, 'c/learn/');
  assert.equal(rows[1].resume, null, 'no learn page means no resume link');
  st.setNote('c', '1.1', 'n');
  st.setLastModule('c', 'm2');
  st.setSnapshot('c', { title: 'Course C', edition: 'preview', done: 1, total: 2, lockedModules: 2, lastModuleTitle: 'Two' });
  st.saveArtifact('c', '1.1', { title: 'A', body: 'B' });
  rows = Core.myCourses(st.state(), CATALOG);
  assert.equal(rows[0].status, 'started');
  assert.equal(rows[0].resume, 'c/learn/#m2');
  assert.deepEqual([rows[0].done, rows[0].total, rows[0].toolkit, rows[0].lastModuleTitle], [1, 2, 1, 'Two']);
  st.markComplete('c', true);
  assert.equal(Core.myCourses(st.state(), CATALOG)[0].status, 'finished');
  // A hand-edited lastModule cannot turn into a strange link.
  st.state().courses.c.lastModule = '"><script>';
  assert.equal(Core.myCourses(st.state(), CATALOG)[0].resume, 'c/learn/');
});

test('listArtifacts() and exportToolkitMarkdown() cover every course, newest first', () => {
  let t = 0;
  const tick = () => new Date(Date.UTC(2026, 10, 9, 12, t++));
  const st = Core.createStore(memStorage(), { clock: tick });
  st.saveArtifact('c', '1.1', { title: 'Older', body: 'first', source: 'Exercise 1.1' });
  st.saveArtifact('d', '2.1', { title: 'Newer', body: 'second' });
  st.saveArtifact('gone', '9.9', { title: 'From a course not in the catalog', body: 'kept' });
  const items = Core.listArtifacts(st.state(), CATALOG);
  assert.deepEqual(items.map((i) => i.title), ['From a course not in the catalog', 'Newer', 'Older']);
  assert.equal(items[1].courseTitle, 'Course D');
  assert.equal(items[0].courseTitle, 'gone');
  const md = Core.exportToolkitMarkdown(st.state(), CATALOG, clock);
  assert.match(md, /^# My AI toolkit\n\nExported 2026-11-09\. 3 items/);
  assert.match(md, /## Older\n\n_From Course C, Exercise 1\.1\. Saved 2026-11-09\._\n\nfirst/);
  assert.match(Core.exportToolkitMarkdown(Core.createStore(memStorage()).state(), CATALOG, clock), /Nothing saved yet/);
});
