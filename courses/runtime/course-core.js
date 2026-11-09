/* Course runtime core: pure logic shared by the learn pages and the node tests.
   No DOM, no network. Everything a learner does is saved in this browser only.

   Two documents matter:
   - a course pack (what to learn): schema "mick.course-pack", built by
     scripts/build-course-pack.mjs. A "preview" pack ships on the site; the
     "full" pack is a file a buyer imports.
   - the save (what the learner did): one localStorage key, versioned, with
     recovery for corrupt or newer-than-this-code saves. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CourseCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PACK_SCHEMA = 'mick.course-pack';
  var PACK_VERSION = 1;
  var BACKUP_SCHEMA = 'mick.course-backup';
  var SAVE_KEY = 'mick.courses';
  var CORRUPT_KEY = 'mick.courses.corrupt';
  var SAVE_VERSION = 1;
  var MAX_NOTE = 20000;          // characters per exercise note
  var MAX_PACK_BYTES = 1000000;  // refuse anything bigger on import

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string'; }
  function nowIso(clock) { return (clock ? clock() : new Date()).toISOString(); }

  /* ---------- text ---------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Pack text allows **bold** and *italic* only. Escape first, so nothing in a
     pack can inject markup. */
  function inline(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function safeUrl(u) {
    if (!isStr(u)) return false;
    if (/^https:\/\//i.test(u)) return true;
    if (/^(\.\.?\/|\/|#)/.test(u) && !/^\/\//.test(u)) return true;
    return false;
  }

  /* ---------- packs ---------- */

  function allSteps(pack) {
    var out = [];
    (pack.modules || []).forEach(function (m) {
      if (m.locked) return;
      (m.exercises || []).forEach(function (e) { out.push({ module: m.id, id: e.id }); });
    });
    return out;
  }

  function validatePack(pack, expectedCourse) {
    var errors = [];
    if (!isObj(pack)) return { ok: false, errors: ['This is not a course file.'] };
    if (pack.schema !== PACK_SCHEMA) errors.push('This is not a Mick course file (missing "' + PACK_SCHEMA + '").');
    if (typeof pack.version !== 'number') errors.push('The course file has no version number.');
    else if (pack.version > PACK_VERSION) errors.push('This course file is newer than this page understands (version ' + pack.version + '). Reload the page to get the latest version.');
    if (!isStr(pack.course) || !/^[a-z0-9-]+$/.test(pack.course)) errors.push('The course file has no valid course id.');
    else if (expectedCourse && pack.course !== expectedCourse) errors.push('This file is for "' + pack.course + '", not this course ("' + expectedCourse + '").');
    if (!isStr(pack.title) || !pack.title.trim()) errors.push('The course file has no title.');
    if (pack.edition !== 'preview' && pack.edition !== 'full') errors.push('The course file must say whether it is the preview or the full course.');
    if (!Array.isArray(pack.modules) || !pack.modules.length) errors.push('The course file has no modules.');
    var seen = {};
    (pack.modules || []).forEach(function (m, i) {
      var where = 'Module ' + (i + 1);
      if (!isObj(m)) { errors.push(where + ' is not readable.'); return; }
      if (!isStr(m.id) || !m.id) errors.push(where + ' has no id.');
      else if (seen[m.id]) errors.push(where + ' repeats the id "' + m.id + '".');
      else seen[m.id] = true;
      if (!isStr(m.title) || !m.title.trim()) errors.push(where + ' has no title.');
      if (m.locked) {
        if (pack.edition === 'full') errors.push(where + ' is locked inside a full course file.');
        return;
      }
      if (!Array.isArray(m.paragraphs)) errors.push(where + ' has no text.');
      if (!Array.isArray(m.exercises)) { errors.push(where + ' has no exercise list.'); return; }
      m.exercises.forEach(function (e, j) {
        var ew = where + ', exercise ' + (j + 1);
        if (!isObj(e) || !isStr(e.id) || !e.id) { errors.push(ew + ' has no id.'); return; }
        if (seen['x:' + e.id]) errors.push(ew + ' repeats the id "' + e.id + '".');
        seen['x:' + e.id] = true;
        if (!isStr(e.text) || !e.text.trim()) errors.push(ew + ' has no instructions.');
        if (e.prompt != null && !isStr(e.prompt)) errors.push(ew + ' has an unreadable prompt.');
        if (e.handoff != null) checkHandoff(e.handoff, ew, errors);
      });
    });
    (pack.handoffs || []).forEach(function (h, i) { checkHandoff(h, 'Course link ' + (i + 1), errors); });
    if (pack.edition === 'full' && (pack.modules || []).length && !allSteps(pack).length) errors.push('The full course has no exercises.');
    return { ok: errors.length === 0, errors: errors };
  }

  function checkHandoff(h, where, errors) {
    if (!isObj(h) || !isStr(h.label) || !h.label.trim()) errors.push(where + ' has a link with no label.');
    else if (!safeUrl(h.url)) errors.push(where + ' has a link that is not a safe web address.');
  }

  function parsePackText(text, expectedCourse) {
    if (!isStr(text)) return { ok: false, errors: ['The file could not be read.'] };
    if (text.length > MAX_PACK_BYTES) return { ok: false, errors: ['The file is too large to be a course file.'] };
    var pack;
    try { pack = JSON.parse(text); } catch (e) { return { ok: false, errors: ['The file is damaged or is not a course file (it is not valid JSON).'] }; }
    var v = validatePack(pack, expectedCourse);
    return v.ok ? { ok: true, pack: pack, errors: [] } : { ok: false, errors: v.errors };
  }

  /* ---------- saves ---------- */

  function emptyState() { return { version: SAVE_VERSION, courses: {} }; }

  function emptyCourse(clock) {
    return { startedAt: nowIso(clock), updatedAt: null, completedAt: null, lastModule: null, read: {}, exercises: {} };
  }

  /* Keep only well-formed fields, so a hand-edited or half-written save cannot
     crash the page. Returns a fresh object. */
  function normalizeCourse(c) {
    var out = { startedAt: null, updatedAt: null, completedAt: null, lastModule: null, read: {}, exercises: {} };
    if (!isObj(c)) return out;
    ['startedAt', 'updatedAt', 'completedAt', 'lastModule'].forEach(function (k) { if (isStr(c[k])) out[k] = c[k]; });
    if (isObj(c.read)) Object.keys(c.read).forEach(function (k) { if (c.read[k] === true) out.read[k] = true; });
    if (isObj(c.exercises)) Object.keys(c.exercises).forEach(function (k) {
      var e = c.exercises[k];
      if (!isObj(e)) return;
      out.exercises[k] = {
        done: e.done === true,
        note: isStr(e.note) ? e.note.slice(0, MAX_NOTE) : '',
        updatedAt: isStr(e.updatedAt) ? e.updatedAt : null
      };
    });
    return out;
  }

  function normalizeState(s) {
    var out = emptyState();
    if (isObj(s) && isObj(s.courses)) Object.keys(s.courses).forEach(function (k) {
      if (/^[a-z0-9-]+$/.test(k)) out.courses[k] = normalizeCourse(s.courses[k]);
    });
    return out;
  }

  /* migrate(raw) handles every save shape this code has ever written. Version 1
     is the first; anything unversioned is treated as damaged. */
  function migrate(raw) {
    if (!isObj(raw) || typeof raw.version !== 'number') return { state: null, reason: 'unreadable' };
    if (raw.version > SAVE_VERSION) return { state: null, reason: 'newer' };
    return { state: normalizeState(raw), reason: null };
  }

  /* A store wraps localStorage (or anything with getItem/setItem). status:
     ok | fresh | recovered (damaged save set aside) | newer (read-only) |
     memory (storage unavailable). */
  function createStore(storage, opts) {
    opts = opts || {};
    var clock = opts.clock;
    var status = 'ok', notice = '', writable = true, state;

    function canUse() {
      try { var t = '__mick_test__'; storage.setItem(t, '1'); storage.removeItem(t); return true; } catch (e) { return false; }
    }

    if (!storage || !canUse()) {
      status = 'memory'; writable = false; state = emptyState();
      notice = 'This browser is not letting the page save. Your work will be lost when you close the tab, so export your notes before you leave.';
    } else {
      var raw = null;
      try { raw = storage.getItem(SAVE_KEY); } catch (e) { raw = null; }
      if (raw == null) { status = 'fresh'; state = emptyState(); }
      else {
        var parsed = null, ok = true;
        try { parsed = JSON.parse(raw); } catch (e) { ok = false; }
        var m = ok ? migrate(parsed) : { state: null, reason: 'unreadable' };
        if (m.state) { state = m.state; }
        else if (m.reason === 'newer') {
          status = 'newer'; writable = false;
          state = normalizeState(parsed);
          notice = 'Your progress was saved by a newer version of this page. Reload to get it. Until then, changes here will not be saved, so nothing newer is overwritten.';
        } else {
          status = 'recovered'; state = emptyState();
          try { storage.setItem(CORRUPT_KEY, JSON.stringify({ at: nowIso(clock), raw: String(raw).slice(0, 200000) })); } catch (e) { /* best effort */ }
          notice = 'Your saved progress was damaged, so the page started fresh. A copy of the damaged save was kept in this browser in case it can be repaired.';
          persist();
        }
      }
    }

    function persist() {
      if (!writable) return false;
      try { storage.setItem(SAVE_KEY, JSON.stringify(state)); return true; }
      catch (e) {
        status = 'memory'; writable = false;
        notice = 'This browser stopped letting the page save (storage may be full). Export your notes now so you do not lose them.';
        return false;
      }
    }

    function course(slug) {
      if (!state.courses[slug]) state.courses[slug] = emptyCourse(clock);
      return state.courses[slug];
    }

    function touch(c) { c.updatedAt = nowIso(clock); if (!c.startedAt) c.startedAt = c.updatedAt; }

    function exercise(slug, id) {
      var c = course(slug);
      if (!c.exercises[id]) c.exercises[id] = { done: false, note: '', updatedAt: null };
      return c.exercises[id];
    }

    return {
      get status() { return status; },
      get notice() { return notice; },
      get writable() { return writable; },
      state: function () { return state; },
      course: course,
      setNote: function (slug, id, note) {
        var e = exercise(slug, id), c = course(slug);
        e.note = String(note || '').slice(0, MAX_NOTE); e.updatedAt = nowIso(clock); touch(c);
        return persist();
      },
      setDone: function (slug, id, done) {
        var e = exercise(slug, id), c = course(slug);
        e.done = !!done; e.updatedAt = nowIso(clock); touch(c);
        return persist();
      },
      setRead: function (slug, moduleId) { var c = course(slug); c.read[moduleId] = true; touch(c); return persist(); },
      setLastModule: function (slug, moduleId) { var c = course(slug); c.lastModule = moduleId; return persist(); },
      markComplete: function (slug, done) {
        var c = course(slug);
        if (done && !c.completedAt) { c.completedAt = nowIso(clock); return persist(); }
        if (!done && c.completedAt) { c.completedAt = null; return persist(); }
        return true;
      },
      replaceCourse: function (slug, progress) { state.courses[slug] = normalizeCourse(progress); return persist(); },
      resetCourse: function (slug) { delete state.courses[slug]; return persist(); },
      /* Installed full packs live beside the save, one key per course. */
      loadPack: function (slug) {
        if (!storage) return null;
        try { var t = storage.getItem('mick.coursepack.' + slug); return t ? parsePackText(t, slug) : null; } catch (e) { return null; }
      },
      savePack: function (slug, pack) {
        try { storage.setItem('mick.coursepack.' + slug, JSON.stringify(pack)); return true; } catch (e) { return false; }
      },
      removePack: function (slug) { try { storage.removeItem('mick.coursepack.' + slug); return true; } catch (e) { return false; } }
    };
  }

  /* ---------- progress ---------- */

  function summarize(pack, courseState) {
    var c = courseState || { read: {}, exercises: {} };
    var mods = (pack.modules || []).map(function (m) {
      if (m.locked) return { id: m.id, locked: true, done: 0, total: 0, complete: false };
      var ex = m.exercises || [];
      var done = ex.filter(function (e) { return c.exercises[e.id] && c.exercises[e.id].done; }).length;
      var complete = ex.length ? done === ex.length : !!c.read[m.id];
      return { id: m.id, locked: false, done: done, total: ex.length, complete: complete };
    });
    var open = mods.filter(function (m) { return !m.locked; });
    var done = open.reduce(function (a, m) { return a + m.done; }, 0);
    var total = open.reduce(function (a, m) { return a + m.total; }, 0);
    var lockedCount = mods.length - open.length;
    return {
      modules: mods,
      done: done,
      total: total,
      lockedModules: lockedCount,
      /* Only a full course can be finished; finishing the preview is not finishing the course. */
      complete: pack.edition === 'full' && lockedCount === 0 && open.length > 0 && open.every(function (m) { return m.complete; })
    };
  }

  /* Where to resume: the saved module if it still exists and is open, else the
     first open module with unfinished work, else the first open module. */
  function resumeModule(pack, courseState) {
    var open = (pack.modules || []).filter(function (m) { return !m.locked; });
    if (!open.length) return null;
    var s = summarize(pack, courseState);
    if (courseState && courseState.lastModule && open.some(function (m) { return m.id === courseState.lastModule; })) return courseState.lastModule;
    var next = s.modules.filter(function (m) { return !m.locked && !m.complete; })[0];
    return next ? next.id : open[0].id;
  }

  /* Notes whose exercise is not in this pack (for example, written against a
     different edition). They are never dropped, only listed separately. */
  function orphanNotes(pack, courseState) {
    var known = {};
    allSteps(pack).forEach(function (s) { known[s.id] = true; });
    var out = [];
    Object.keys((courseState && courseState.exercises) || {}).forEach(function (id) {
      var e = courseState.exercises[id];
      if (!known[id] && (e.note || e.done)) out.push({ id: id, note: e.note, done: e.done });
    });
    return out;
  }

  /* ---------- checkout ---------- */

  function checkout(storeMap, slug) {
    var url = storeMap && isStr(storeMap[slug]) ? storeMap[slug].trim() : '';
    if (url && /^https:\/\//i.test(url)) return { open: true, url: url };
    return { open: false, url: '', reason: url ? 'The checkout link for this course is not a secure web address, so it is switched off.' : 'Checkout for the full course is not open yet.' };
  }

  /* ---------- export and backup ---------- */

  function plain(s) { return String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1'); }

  function exportMarkdown(pack, courseState, clock) {
    var c = courseState || { exercises: {}, read: {} };
    var s = summarize(pack, c);
    var lines = ['# My notebook: ' + pack.title, ''];
    lines.push('Exported ' + nowIso(clock).slice(0, 10) + '. ' + s.done + ' of ' + s.total + ' exercises done' +
      (s.lockedModules ? ' in the free preview (' + s.lockedModules + ' modules are in the full course).' : '.') +
      (c.completedAt ? ' Course finished ' + c.completedAt.slice(0, 10) + '.' : ''));
    lines.push('');
    (pack.modules || []).forEach(function (m) {
      if (m.locked) return;
      lines.push('## ' + m.title, '');
      (m.exercises || []).forEach(function (e) {
        var p = c.exercises[e.id] || { done: false, note: '' };
        lines.push('### ' + (e.label || ('Exercise ' + e.id)) + (p.done ? ' (done)' : ' (not done yet)'), '');
        lines.push('> ' + plain(e.text).replace(/\n/g, '\n> '), '');
        lines.push(p.note.trim() ? p.note.trim() : '_No notes yet._', '');
      });
      if (m.learning) lines.push('**You are learning:** ' + plain(m.learning), '');
    });
    var orphans = orphanNotes(pack, c);
    if (orphans.length) {
      lines.push('## Other notes', '', 'These notes belong to exercises that are not in this edition of the course.', '');
      orphans.forEach(function (o) { lines.push('### ' + o.id + (o.done ? ' (done)' : ''), '', o.note || '_No notes._', ''); });
    }
    lines.push('---', '', 'Saved on your own device by ' + pack.title + '. Nothing here was sent anywhere.');
    return lines.join('\n') + '\n';
  }

  function makeBackup(store, slug, clock) {
    return {
      schema: BACKUP_SCHEMA, version: SAVE_VERSION, course: slug, exportedAt: nowIso(clock),
      progress: normalizeCourse(store.state().courses[slug] || emptyCourse(clock))
    };
  }

  function readBackup(text, slug) {
    var b;
    try { b = JSON.parse(text); } catch (e) { return { ok: false, errors: ['The backup is damaged (it is not valid JSON).'] }; }
    if (!isObj(b) || b.schema !== BACKUP_SCHEMA) {
      if (isObj(b) && b.schema === PACK_SCHEMA) return { ok: false, errors: ['That is a course file, not a backup. Use "Import the course file" instead.'] };
      return { ok: false, errors: ['This is not a backup from this page.'] };
    }
    if (typeof b.version !== 'number' || b.version > SAVE_VERSION) return { ok: false, errors: ['This backup was made by a newer version of the page. Reload to get the latest version, then try again.'] };
    if (b.course !== slug) return { ok: false, errors: ['This backup is for "' + b.course + '", not this course.'] };
    if (!isObj(b.progress)) return { ok: false, errors: ['The backup has no progress in it.'] };
    return { ok: true, progress: normalizeCourse(b.progress), errors: [] };
  }

  return {
    PACK_SCHEMA: PACK_SCHEMA, PACK_VERSION: PACK_VERSION, BACKUP_SCHEMA: BACKUP_SCHEMA,
    SAVE_KEY: SAVE_KEY, CORRUPT_KEY: CORRUPT_KEY, SAVE_VERSION: SAVE_VERSION, MAX_NOTE: MAX_NOTE,
    escapeHtml: escapeHtml, inline: inline, safeUrl: safeUrl,
    validatePack: validatePack, parsePackText: parsePackText, allSteps: allSteps,
    migrate: migrate, normalizeCourse: normalizeCourse, createStore: createStore,
    summarize: summarize, resumeModule: resumeModule, orphanNotes: orphanNotes,
    checkout: checkout, exportMarkdown: exportMarkdown, makeBackup: makeBackup, readBackup: readBackup
  };
});
