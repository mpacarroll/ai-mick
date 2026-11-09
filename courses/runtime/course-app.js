/* Course runtime page. Reads the course id and preview pack from #course-root,
   then renders lessons, exercises, a notebook and the unlock state. Depends on
   course-core.js (CourseCore) and, for checkout links, store.js (COURSE_STORE).
   No network calls except fetching the preview pack from this site. */
(function () {
  'use strict';
  var Core = window.CourseCore;
  var rootEl = document.getElementById('course-root');
  var main = document.getElementById('rt-main');
  var noticeEl = document.getElementById('rt-notice');
  if (!Core || !rootEl || !main) return;

  var slug = rootEl.getAttribute('data-course');
  var previewUrl = rootEl.getAttribute('data-preview');
  var coursePage = rootEl.getAttribute('data-course-page') || '../';
  var myPage = rootEl.getAttribute('data-my-page') || '../../my/';
  var storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }

  var store = Core.createStore(storage);
  var pack = null;
  var installed = false;
  var notices = [];
  var saveTimers = {};

  /* ---------- tiny DOM helpers ---------- */

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v; // only ever given Core.inline() output
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function para(text, cls) { return el('p', { 'class': cls, html: Core.inline(text) }); }

  function setNotice() {
    var all = notices.slice();
    if (store.notice) all.unshift(store.notice);
    noticeEl.hidden = !all.length;
    noticeEl.textContent = all.join(' ');
  }

  function download(name, type, text) {
    var blob = new Blob([text], { type: type });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function readFile(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 1000000) { cb(null, 'That file is too large to be from this course.'); input.value = ''; return; }
    var r = new FileReader();
    r.onload = function () { cb(String(r.result)); input.value = ''; };
    r.onerror = function () { cb(null, 'The file could not be read. Try again.'); input.value = ''; };
    r.readAsText(f);
  }

  /* ---------- state helpers ---------- */

  function courseState() { return store.state().courses[slug] || null; }
  function summary() { return Core.summarize(pack, courseState()); }
  function moduleById(id) { return pack.modules.filter(function (m) { return m.id === id; })[0] || null; }
  function savedLabel(ok) { return ok ? 'Saved on this device' : 'Not saved. Export your notes from the notebook.'; }

  function progressBlock() {
    var s = summary();
    var label = s.total ? s.done + ' of ' + s.total + ' exercises done' : 'No exercises yet';
    if (s.lockedModules) label += ' in the free preview';
    return el('div', { 'class': 'rt-progress' }, [
      el('progress', { value: String(s.done), max: String(Math.max(s.total, 1)), 'aria-label': 'Course progress' }),
      el('span', { text: label })
    ]);
  }

  /* ---------- unlock (checkout) ---------- */

  function unlockPanel(context) {
    var co = Core.checkout(window.COURSE_STORE, slug);
    var locked = pack.modules.filter(function (m) { return m.locked; }).length;
    var kids = [
      el('p', { 'class': 'tag', text: 'The full course' }),
      el('h2', { text: context === 'module' ? 'This module is in the full course' : locked + ' more modules in the full course' })
    ];
    if (co.open) {
      kids.push(el('p', { text: 'Buy the course, then import the course file that comes with your download. Everything you did in the preview carries over.' }));
      kids.push(el('p', {}, [el('a', { 'class': 'btn', href: co.url, 'data-funnel': 'book-click', rel: 'noopener', text: 'Get the full course' })]));
    } else {
      kids.push(el('p', { 'class': 'rt-closed', text: co.reason }));
      kids.push(el('p', { text: 'There is no way to buy it today, so there is no buy button here. Leave your email on the course page and you will hear the day it opens. Your preview notes stay saved in this browser in the meantime.' }));
      kids.push(el('p', {}, [el('a', { 'class': 'btn', href: coursePage + '#email', 'data-funnel': 'email-signup', text: 'Tell me when it opens' })]));
    }
    kids.push(importPackControl());
    return el('section', { 'class': 'label rt-unlock', id: 'unlock' }, kids);
  }

  function importPackControl() {
    var msg = el('p', { 'class': 'status', role: 'status' });
    var input = el('input', { type: 'file', id: 'rt-pack-file', accept: '.json,application/json', 'class': 'rt-file' });
    input.addEventListener('change', function () {
      readFile(input, function (text, err) {
        if (err) { msg.textContent = err; return; }
        var r = Core.parsePackText(text, slug);
        if (!r.ok) { msg.textContent = 'That file did not work: ' + r.errors.join(' '); return; }
        if (r.pack.edition !== 'full') { msg.textContent = 'That is the free preview, not the full course file. Look for the .json file in your course download.'; return; }
        pack = r.pack; installed = true;
        var kept = store.savePack(slug, pack);
        notices = kept ? [] : ['The full course is open for now, but this browser would not keep the file. You will need to import it again next visit.'];
        setNotice();
        location.hash = '#' + Core.resumeModule(pack, courseState());
        render();
      });
    });
    return el('div', { 'class': 'rt-import' }, [
      el('label', { 'for': 'rt-pack-file', text: 'Already bought it? Import the course file (.json) from your download' }),
      input, msg
    ]);
  }

  /* ---------- views ---------- */

  function overview() {
    var cs = courseState();
    var s = summary();
    var resume = Core.resumeModule(pack, cs);
    var started = cs && (cs.updatedAt || Object.keys(cs.exercises).length);
    var resumeMod = moduleById(resume);
    var top = el('section', { 'class': 'label', id: 'top' }, [
      el('p', { 'class': 'tag', text: pack.edition === 'full' ? 'Your course' : 'Free preview · Module 1' }),
      el('h1', { tabindex: '-1', text: pack.title }),
      el('p', { 'class': 'lede', text: pack.subtitle }),
      progressBlock(),
      el('p', { 'class': 'rt-actions' }, [
        resumeMod ? el('a', { 'class': 'btn', href: '#' + resume, text: started ? 'Pick up where you left off: Module ' + resumeMod.number : 'Start Module ' + resumeMod.number }) : null,
        s.complete ? el('a', { href: '#done', text: 'See your finish page' }) : null
      ])
    ]);
    var intro = el('section', { 'class': 'label' }, [el('h2', { text: 'Before you start' })].concat(pack.intro.map(function (t) { return para(t); })));
    var list = el('ol', { 'class': 'rt-mods' }, pack.modules.map(function (m, i) {
      var ms = s.modules[i];
      var state = m.locked ? 'In the full course' : ms.complete ? 'Done' : ms.done ? ms.done + ' of ' + ms.total + ' done' : 'Not started';
      return el('li', { 'class': m.locked ? 'is-locked' : ms.complete ? 'is-done' : '' }, [
        el('a', { href: '#' + m.id }, [el('b', { text: m.title })]),
        el('span', { 'class': 'rt-state', text: state }),
        m.summary ? el('span', { 'class': 'rt-sum', text: m.summary }) : null
      ]);
    }));
    var mods = el('section', { 'class': 'label' }, [el('p', { 'class': 'tag', text: 'Modules' }), el('h2', { text: pack.modules.length + ' modules' }), list]);
    return [top, intro, mods, pack.edition === 'preview' ? unlockPanel('overview') : null];
  }

  function exerciseCard(e) {
    var cs = courseState();
    var p = (cs && cs.exercises[e.id]) || { done: false, note: '' };
    var status = el('span', { 'class': 'rt-saved', role: 'status' });
    var noteId = 'note-' + e.id.replace(/\W/g, '_');
    var doneId = 'done-' + e.id.replace(/\W/g, '_');
    var ta = el('textarea', { id: noteId, 'class': 'field rt-note', rows: '4', maxlength: String(Core.MAX_NOTE), placeholder: 'What did you try, and what came back? Paste the part worth keeping.' });
    ta.value = p.note;
    function flush() {
      clearTimeout(saveTimers[e.id]); saveTimers[e.id] = null;
      status.textContent = savedLabel(store.setNote(slug, e.id, ta.value));
      setNotice();
    }
    ta.addEventListener('input', function () {
      status.textContent = 'Saving…';
      clearTimeout(saveTimers[e.id]);
      saveTimers[e.id] = setTimeout(flush, 500);
    });
    ta.addEventListener('blur', function () { if (saveTimers[e.id]) flush(); });
    var cb = el('input', { type: 'checkbox', id: doneId });
    cb.checked = p.done;
    cb.addEventListener('change', function () {
      if (saveTimers[e.id]) flush();
      status.textContent = savedLabel(store.setDone(slug, e.id, cb.checked));
      setNotice();
      card.classList.toggle('is-done', cb.checked);
      refreshModuleFoot();
    });
    var kids = [
      el('h3', { text: e.label || ('Exercise ' + e.id) }),
      para(e.text)
    ];
    if (e.prompt) {
      var copyMsg = el('span', { 'class': 'rt-saved', role: 'status' });
      var code = el('code', { text: e.prompt });
      kids.push(el('div', { 'class': 'rt-prompt' }, [
        el('p', { 'class': 'tag', text: 'Type this into your AI' }), code,
        el('p', {}, [el('button', { type: 'button', 'class': 'rt-btn2', onclick: function () {
          var done = function () { copyMsg.textContent = 'Copied. Paste it into your AI.'; };
          var fail = function () {
            var r = document.createRange(); r.selectNodeContents(code);
            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
            copyMsg.textContent = 'Selected. Copy it with your keyboard or the share menu.';
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(e.prompt).then(done, fail); else fail();
        }, text: 'Copy the prompt' }), ' ', copyMsg])
      ]));
    }
    if (e.handoff) {
      kids.push(el('div', { 'class': 'rt-handoff' }, [
        el('a', { href: e.handoff.url, target: '_blank', rel: 'noopener', 'data-funnel': 'tool-try', text: e.handoff.label + ' (opens in a new tab)' }),
        e.handoff.note ? el('p', { 'class': 'fine', text: e.handoff.note }) : null
      ]));
    }
    kids.push(el('label', { 'for': noteId, 'class': 'rt-label', text: 'Your notes' }));
    kids.push(ta);
    kids.push(el('p', { 'class': 'rt-row' }, [el('label', { 'class': 'rt-check', 'for': doneId }, [cb, ' I did this']), status]));
    kids.push(toolkitRow(e, ta, function () { if (saveTimers[e.id]) flush(); }));
    var card = el('article', { 'class': 'rt-ex' + (p.done ? ' is-done' : ''), id: 'ex-' + e.id }, kids);
    return card;
  }

  /* "Save to my toolkit": keeps a copy of the note as a named item on the My
     courses page, so the useful part outlives the course. */
  function toolkitRow(e, ta, flushNote) {
    var title = (e.artifact && e.artifact.title) || e.label || ('Exercise ' + e.id);
    var msg = el('span', { 'class': 'rt-saved', role: 'status' });
    var btn = el('button', { type: 'button', 'class': 'rt-btn2 rt-keep' });
    var see = el('a', { href: myPage + '#toolkit', text: 'See my toolkit' });
    function saved() { var cs = courseState(); return cs && cs.artifacts && cs.artifacts[e.id]; }
    function paint() {
      var a = saved();
      btn.textContent = a ? 'Update my toolkit copy' : 'Save to my toolkit';
      see.hidden = !a;
      if (a && !msg.textContent) msg.textContent = 'In your toolkit as "' + a.title + '".';
    }
    btn.addEventListener('click', function () {
      flushNote();
      if (!ta.value.trim()) { msg.textContent = 'Write a note first, then save it to your toolkit.'; ta.focus(); return; }
      var a = saved();
      var ok = store.saveArtifact(slug, e.id, { title: a ? a.title : title, body: ta.value, source: e.label || ('Exercise ' + e.id), module: currentModuleId(e.id) });
      msg.textContent = ok ? (a ? 'Updated in your toolkit.' : 'Saved to your toolkit as "' + title + '".') : 'Not saved. This browser is not keeping changes; export your notes from the notebook.';
      setNotice();
      paint();
    });
    paint();
    return el('div', { 'class': 'rt-toolkit' }, [
      el('p', { 'class': 'fine', text: 'Worth keeping? Your toolkit holds a copy of this note after the course is over: ' + title + '.' }),
      el('p', { 'class': 'rt-row' }, [btn, see, msg])
    ]);
  }
  function currentModuleId(exId) {
    var m = pack.modules.filter(function (x) { return !x.locked && x.exercises.some(function (y) { return y.id === exId; }); })[0];
    return m ? m.id : '';
  }
  function snapshot() { if (pack && courseState()) store.setSnapshot(slug, Core.snapshotFor(pack, courseState())); }

  var moduleFoot = null, currentModule = null;
  function refreshModuleFoot() {
    if (!moduleFoot || !currentModule) return;
    var s = summary();
    var ms = s.modules.filter(function (x) { return x.id === currentModule.id; })[0];
    if (s.complete) store.markComplete(slug, true);
    else if (courseState() && courseState().completedAt) store.markComplete(slug, false);
    snapshot();
    moduleFoot.textContent = '';
    var idx = pack.modules.indexOf(currentModule);
    var prev = pack.modules[idx - 1], next = pack.modules[idx + 1];
    moduleFoot.appendChild(el('p', { 'class': 'rt-modstate', text: ms.complete ? 'Module done.' : ms.total ? ms.done + ' of ' + ms.total + ' exercises done in this module.' : '' }));
    moduleFoot.appendChild(el('p', { 'class': 'rt-nav' }, [
      prev ? el('a', { href: '#' + prev.id, text: 'Back: Module ' + prev.number }) : el('a', { href: '#', text: 'Course home' }),
      s.complete ? el('a', { 'class': 'btn', href: '#done', text: 'Finish the course' }) :
        next ? el('a', { 'class': 'btn', href: '#' + next.id, text: 'Next: Module ' + next.number + (next.locked ? ' (full course)' : '') }) :
        el('a', { 'class': 'btn', href: '#notebook', text: 'Open my notebook' })
    ]));
  }

  function moduleView(m) {
    store.setLastModule(slug, m.id);
    var head = el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'Module ' + m.number + ' of ' + pack.modules.length }),
      el('h1', { tabindex: '-1', text: m.title })
    ]);
    if (m.locked) {
      head.appendChild(el('p', { 'class': 'lede', text: m.summary }));
      return [head, unlockPanel('module')];
    }
    head.appendChild(progressBlock());
    m.paragraphs.forEach(function (t) { head.appendChild(para(t)); });
    var ex = el('section', { 'class': 'label' }, [el('p', { 'class': 'tag', text: 'Do it now' }), el('h2', { text: m.exercises.length === 1 ? 'Exercise' : 'Exercises' })]
      .concat(m.exercises.map(exerciseCard)));
    if (!m.exercises.length) {
      var cs = courseState();
      ex.appendChild(el('p', {}, [el('button', { type: 'button', 'class': 'rt-btn2', disabled: cs && cs.read[m.id] ? true : null, onclick: function (ev) {
        store.setRead(slug, m.id); ev.target.disabled = true; refreshModuleFoot();
      }, text: cs && cs.read[m.id] ? 'Marked as read' : 'Mark as read' })]));
    }
    if (m.learning) ex.appendChild(el('p', { 'class': 'rt-learning', html: '<strong>You are learning:</strong> ' + Core.inline(m.learning) }));
    moduleFoot = el('div', { 'class': 'rt-foot' });
    currentModule = m;
    ex.appendChild(moduleFoot);
    refreshModuleFoot();
    return [head, ex];
  }

  function notebookView() {
    var cs = courseState();
    var s = summary();
    var msg = el('p', { 'class': 'status', role: 'status' });
    var head = el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'My notebook' }),
      el('h1', { tabindex: '-1', text: 'What you tried' }),
      el('p', { 'class': 'lede', text: 'Everything here lives in this browser only. Download it to keep a copy, or to move to another device.' }),
      progressBlock()
    ]);
    var list = el('div', { 'class': 'rt-book' });
    pack.modules.forEach(function (m) {
      if (m.locked) return;
      list.appendChild(el('h2', {}, [el('a', { href: '#' + m.id, text: 'Module ' + m.number + ': ' + m.title })]));
      m.exercises.forEach(function (e) {
        var p = (cs && cs.exercises[e.id]) || { done: false, note: '' };
        list.appendChild(el('div', { 'class': 'rt-entry' }, [
          el('h3', { text: (e.label || 'Exercise ' + e.id) + (p.done ? ' · done' : '') }),
          p.note.trim() ? el('p', { 'class': 'rt-notetext', text: p.note }) : el('p', { 'class': 'fine', text: 'No notes yet.' })
        ]));
      });
    });
    var orphans = Core.orphanNotes(pack, cs);
    if (orphans.length) {
      list.appendChild(el('h2', { text: 'Other notes' }));
      list.appendChild(el('p', { 'class': 'fine', text: 'These belong to exercises that are not in this edition. They are kept, and they are in your download.' }));
      orphans.forEach(function (o) { list.appendChild(el('div', { 'class': 'rt-entry' }, [el('h3', { text: o.id }), el('p', { 'class': 'rt-notetext', text: o.note })])); });
    }
    head.appendChild(list);

    var restore = el('input', { type: 'file', id: 'rt-restore', accept: '.json,application/json', 'class': 'rt-file' });
    restore.addEventListener('change', function () {
      readFile(restore, function (text, err) {
        if (err) { msg.textContent = err; return; }
        var r = Core.readBackup(text, slug);
        if (!r.ok) { msg.textContent = 'That backup did not work: ' + r.errors.join(' '); return; }
        if (cs && Object.keys(cs.exercises).length && !window.confirm('Replace the progress in this browser with the backup? Your current notes will be overwritten.')) { msg.textContent = 'Nothing changed.'; return; }
        var ok = store.replaceCourse(slug, r.progress);
        render();
        document.querySelector('#rt-tools-status').textContent = ok ? 'Backup restored.' : 'Restored for now, but this browser would not save it.';
      });
    });
    var tools = el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'Keep a copy' }),
      el('h2', { text: 'Download, back up, restore' }),
      el('p', { 'class': 'rt-actions' }, [
        el('button', { type: 'button', 'class': 'btn', onclick: function () {
          download(slug + '-notebook.md', 'text/markdown', Core.exportMarkdown(pack, cs));
          msg.textContent = 'Notebook downloaded.';
        }, text: 'Download my notebook' }),
        el('button', { type: 'button', 'class': 'rt-btn2', onclick: function () {
          download(slug + '-backup.json', 'application/json', JSON.stringify(Core.makeBackup(store, slug), null, 2));
          msg.textContent = 'Backup downloaded. Restore it here on any device.';
        }, text: 'Download a backup file' })
      ]),
      el('p', { 'class': 'fine', text: 'The notebook is a readable Markdown file. The backup is for restoring your progress here.' }),
      el('div', { 'class': 'rt-import' }, [el('label', { 'for': 'rt-restore', text: 'Restore from a backup file' }), restore]),
      el('p', { 'class': 'status', role: 'status', id: 'rt-tools-status' }),
      msg
    ]);

    var danger = el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'Start over' }),
      el('h2', { text: 'Clear this course from this browser' }),
      el('p', { text: 'This deletes your notes and progress for this course here. It cannot be undone, so download your notebook first.' }),
      el('p', { 'class': 'rt-actions' }, [
        el('button', { type: 'button', 'class': 'rt-btn2 rt-danger', onclick: function () {
          if (!window.confirm('Delete your notes and progress for ' + pack.title + ' from this browser?')) return;
          store.resetCourse(slug);
          location.hash = '#';
          render();
        }, text: 'Delete my progress' }),
        installed ? el('button', { type: 'button', 'class': 'rt-btn2', onclick: function () {
          if (!window.confirm('Remove the full course file from this browser? Your notes stay. You can import the file again any time.')) return;
          store.removePack(slug);
          boot();
        }, text: 'Remove the course file' }) : null
      ])
    ]);
    return [head, tools, pack.edition === 'preview' ? unlockPanel('notebook') : null, danger];
  }

  function doneView() {
    var s = summary();
    if (!s.complete) {
      return [el('section', { 'class': 'label' }, [
        el('p', { 'class': 'tag', text: 'Not finished yet' }),
        el('h1', { tabindex: '-1', text: 'A few exercises to go' }),
        progressBlock(),
        el('p', {}, [el('a', { 'class': 'btn', href: '#' + Core.resumeModule(pack, courseState()), text: 'Keep going' })])
      ])];
    }
    store.markComplete(slug, true); // a restored backup can be complete without a date yet
    var cs = courseState();
    return [el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'Finished ' + (cs.completedAt || '').slice(0, 10) }),
      el('h1', { tabindex: '-1', text: 'You did all of it.' }),
      el('p', { 'class': 'lede', text: 'You are not behind. You were just being sold a reason to feel that way.' })
    ].concat(pack.closing.map(function (t) { return para(t); })).concat([
      el('p', { 'class': 'rt-actions' }, [
        el('button', { type: 'button', 'class': 'btn', onclick: function () { download(slug + '-notebook.md', 'text/markdown', Core.exportMarkdown(pack, cs)); }, text: 'Download my notebook' }),
        el('a', { href: '#notebook', text: 'Look back through it' })
      ])
    ])), el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'Where to next' }),
      el('ul', { 'class': 'rt-handoffs' }, pack.handoffs.map(function (h) {
        return el('li', {}, [el('a', { href: h.url, text: h.label }), h.note ? el('span', { text: h.note }) : null]);
      }))
    ])];
  }

  function errorView(message) {
    return [el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'Could not load' }),
      el('h1', { tabindex: '-1', text: 'The course did not load' }),
      el('p', { 'class': 'lede', text: message }),
      el('p', { 'class': 'rt-actions' }, [
        el('button', { type: 'button', 'class': 'btn', onclick: boot, text: 'Try again' }),
        el('a', { href: coursePage, text: 'Back to the course page' })
      ])
    ])];
  }

  function render(focus) {
    if (!pack) return;
    var h = location.hash.replace(/^#/, '');
    var views;
    currentModule = null; moduleFoot = null;
    if (h === 'notebook') views = notebookView();
    else if (h === 'done') views = doneView();
    else if (h === 'unlock' && pack.edition === 'preview') views = overview();
    else if (moduleById(h)) views = moduleView(moduleById(h));
    else views = overview();
    main.textContent = '';
    views.forEach(function (v) { if (v) main.appendChild(v); });
    snapshot();
    document.title = (h && moduleById(h) ? moduleById(h).title + ' · ' : h === 'notebook' ? 'My notebook · ' : '') + pack.title + ': a Mick Cairn course';
    setNotice();
    if (focus) { var h1 = main.querySelector('h1'); if (h1) h1.focus({ preventScroll: false }); }
    if (h === 'unlock') { var u = document.getElementById('unlock'); if (u) u.scrollIntoView(); }
  }

  function boot() {
    notices = [];
    installed = false;
    var saved = store.loadPack(slug);
    if (saved && saved.ok && saved.pack.edition === 'full') { pack = saved.pack; installed = true; render(); return; }
    if (saved && !saved.ok) notices.push('The course file saved in this browser is damaged, so the free preview is showing. Import your course file again to get the full course back.');
    main.setAttribute('aria-busy', 'true');
    fetch(previewUrl, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        var r = Core.parsePackText(text, slug);
        if (!r.ok) throw new Error('bad pack: ' + r.errors.join(' '));
        pack = r.pack; main.removeAttribute('aria-busy'); render();
      })
      .catch(function () {
        main.removeAttribute('aria-busy');
        main.textContent = '';
        errorView('Check your connection and try again. If you are offline, the course needs one online visit to load.').forEach(function (v) { main.appendChild(v); });
      });
  }

  window.addEventListener('hashchange', function () {
    Object.keys(saveTimers).forEach(function (k) { if (saveTimers[k]) { clearTimeout(saveTimers[k]); } });
    // Flush any note still being typed before the view is replaced.
    Array.prototype.forEach.call(main.querySelectorAll('textarea.rt-note'), function (ta) {
      var id = ta.closest('.rt-ex').id.replace(/^ex-/, '');
      if (saveTimers[id]) store.setNote(slug, id, ta.value);
    });
    saveTimers = {};
    render(true);
  });
  /* Another tab changed the save: reload it so the two tabs do not overwrite each other. */
  /* Another tab changed the save. The store merges it before every write, so
     nothing is lost; here we only bring the screen up to date. While the
     learner is typing, the page is not redrawn: the other fields update in
     place and the note being typed is left alone. */
  window.addEventListener('storage', function (ev) {
    if (ev.key !== Core.SAVE_KEY || !pack) return;
    store.reload();
    var active = document.activeElement;
    if (!(active && active.tagName === 'TEXTAREA' && active.classList.contains('rt-note'))) { render(); return; }
    var cs = courseState() || { exercises: {} };
    Array.prototype.forEach.call(main.querySelectorAll('.rt-ex'), function (card) {
      var id = card.id.replace(/^ex-/, '');
      var p = cs.exercises[id] || { done: false, note: '' };
      var ta = card.querySelector('textarea.rt-note'), cb = card.querySelector('input[type=checkbox]');
      if (ta && ta !== active && !saveTimers[id]) ta.value = p.note;
      if (cb) cb.checked = p.done;
      card.classList.toggle('is-done', p.done);
    });
    refreshModuleFoot();
    notices = ['This course is also open in another tab. Work from both tabs is kept.'];
    setNotice();
  });
  window.addEventListener('pagehide', function () {
    Array.prototype.forEach.call(main.querySelectorAll('textarea.rt-note'), function (ta) {
      var id = ta.closest('.rt-ex').id.replace(/^ex-/, '');
      if (saveTimers[id]) store.setNote(slug, id, ta.value);
    });
  });

  window.__courseRuntime = { store: function () { return store; }, pack: function () { return pack; } };
  boot();
})();
