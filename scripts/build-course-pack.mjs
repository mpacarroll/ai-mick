#!/usr/bin/env node
/* Turn a course manuscript (course.md) plus an overlay (links, plan days,
   locked-module summaries) into a course pack the learn page can run.

   node scripts/build-course-pack.mjs --source <course.md> --overlay <overlay.json> \
     --edition preview|full --out <file.json> [--course <slug>]

   The preview edition is safe to commit: it carries only the intro and the
   first module(s) the overlay names as free. The full edition is the paid
   course and must never be committed to this public repo (dist/ is ignored). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Core = require('../courses/runtime/course-core.js');

/* House style: no em or en dashes. A spaced dash becomes a colon; a bare one a hyphen. */
export function houseStyle(s) {
  return s.replace(/\s+[—–]\s+/g, ': ').replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/* The first quoted passage long enough to be a prompt the learner types. */
export function extractPrompt(text) {
  const re = /"([^"]{25,})"/g;
  const m = re.exec(text);
  return m ? m[1] : null;
}

export function parseCourse(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = { title: '', subtitle: '', intro: [], modules: [], closing: [] };
  let section = null; // 'intro' | module object | 'closing'
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const text = houseStyle(para.join(' ').trim());
    para = [];
    if (!text) return;
    if (section === 'intro') out.intro.push(text);
    else if (section === 'closing') out.closing.push(text.replace(/^\*(.+)\*$/, '$1'));
    else if (section && typeof section === 'object') {
      const ex = text.match(/^\*\*Exercise\s+(\d+\.\d+)\.\*\*\s*([\s\S]+)$/);
      const learn = text.match(/^\*\*You are learning:\*\*\s*([\s\S]+)$/);
      if (ex) section.exercises.push({ id: ex[1], label: 'Exercise ' + ex[1], text: ex[2].trim(), prompt: extractPrompt(ex[2]) });
      else if (learn) section.learning = learn[1].trim();
      else section.paragraphs.push(text);
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^#\s+(.+)$/)) && !out.title) { flush(); out.title = houseStyle(m[1].trim()); continue; }
    if ((m = line.match(/^###\s+(.+)$/)) && !out.subtitle && section === null) { flush(); out.subtitle = houseStyle(m[1].trim()); continue; }
    if ((m = line.match(/^##\s+Module\s+(\d+)\s*[—–:-]+\s*(.+)$/))) {
      flush();
      section = { id: 'm' + m[1], number: Number(m[1]), title: houseStyle(m[2].trim()), paragraphs: [], exercises: [], learning: '' };
      out.modules.push(section);
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) { flush(); section = 'intro'; continue; }
    if (/^---+$/.test(line)) {
      flush();
      if (section && typeof section === 'object' && section === out.modules[out.modules.length - 1] && out.modules.length) section = 'after';
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (section === 'after') section = 'closing';
    if (section === null) continue; // byline and anything before the first heading block
    para.push(line.trim());
  }
  flush();
  // Only the trailing block after the last module counts as closing; the
  // separators between modules switch to 'after' and back.
  return out;
}

export function buildPack(md, overlay, edition, courseOverride) {
  if (edition !== 'preview' && edition !== 'full') throw new Error('edition must be preview or full');
  const parsed = parseCourse(md);
  const course = courseOverride || overlay.course;
  const free = new Set((overlay.freeModules || ['m1']));
  const modules = parsed.modules.map((m) => {
    const o = (overlay.modules || {})[m.id] || {};
    const exercises = m.exercises.map((e) => {
      const eo = (overlay.exercises || {})[e.id] || {};
      return { ...e, ...(eo.handoff ? { handoff: eo.handoff } : {}), ...(eo.prompt !== undefined ? { prompt: eo.prompt } : {}), ...(eo.artifact ? { artifact: eo.artifact } : {}) };
    });
    (o.addExercises || []).forEach((e) => exercises.push({ prompt: null, ...e }));
    const full = { id: m.id, number: m.number, title: m.title, summary: o.summary || '', paragraphs: m.paragraphs, exercises, learning: m.learning };
    if (edition === 'preview' && !free.has(m.id)) return { id: m.id, number: m.number, title: m.title, summary: o.summary || '', locked: true };
    return full;
  });
  const pack = {
    schema: Core.PACK_SCHEMA,
    version: Core.PACK_VERSION,
    course,
    edition,
    title: parsed.title,
    subtitle: parsed.subtitle,
    author: overlay.author || 'Mick Cairn',
    coursePage: overlay.coursePage || '../',
    intro: parsed.intro,
    modules,
    closing: overlay.closing || parsed.closing,
    handoffs: overlay.handoffs || []
  };
  const v = Core.validatePack(pack, course);
  if (!v.ok) throw new Error('Built pack is invalid:\n- ' + v.errors.join('\n- '));
  return pack;
}

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  return a;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = args(process.argv.slice(2));
  if (!a.source || !a.overlay || !a.out || !a.edition) {
    console.error('usage: build-course-pack.mjs --source course.md --overlay overlay.json --edition preview|full --out pack.json [--course slug]');
    process.exit(2);
  }
  const pack = buildPack(readFileSync(a.source, 'utf8'), JSON.parse(readFileSync(a.overlay, 'utf8')), a.edition, a.course);
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out, JSON.stringify(pack, null, 2) + '\n');
  const steps = Core.allSteps(pack).length;
  console.log(`wrote ${a.out}: ${pack.edition} edition of "${pack.title}", ${pack.modules.length} modules, ${steps} open exercises`);
}
