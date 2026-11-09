/* My courses page: progress across every course and the learner's toolkit.
   Reads the same save as the learn pages (CourseCore). Makes no network calls. */
(function () {
  'use strict';
  var Core = window.CourseCore;
  var main = document.getElementById('rt-main');
  var noticeEl = document.getElementById('rt-notice');
  var catalog = window.COURSE_CATALOG || [];
  if (!Core || !main) return;
  var BASE = '../'; // this page lives at courses/my/
  var storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  var store = Core.createStore(storage);
  var flash = '';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function setNotice() {
    noticeEl.hidden = !store.notice;
    noticeEl.textContent = store.notice;
  }

  function download(name, type, text) {
    var blob = new Blob([text], { type: type });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function courseRow(r) {
    var kids = [
      el('h3', {}, [el('a', { href: BASE + r.page, text: r.title })]),
      el('p', { 'class': 'rt-meta', text: r.level })
    ];
    if (r.status === 'none') {
      kids.push(el('p', { text: 'Not available in the browser yet. The course page lists what is inside and whether checkout is open.' }));
      kids.push(el('p', {}, [el('a', { href: BASE + r.page, text: 'About this course' })]));
    } else if (r.status === 'new') {
      kids.push(el('p', { text: 'Not started. Module 1 is free in your browser.' }));
      kids.push(el('p', {}, [el('a', { 'class': 'btn', href: BASE + r.resume, text: 'Start the free preview' })]));
    } else {
      var label = r.total ? r.done + ' of ' + r.total + ' exercises done' + (r.edition === 'preview' ? ' in the free preview' : '') : 'Started';
      kids.push(el('div', { 'class': 'rt-progress' }, [
        el('progress', { value: String(r.done), max: String(Math.max(r.total, 1)), 'aria-label': r.title + ' progress' }),
        el('span', { text: label })
      ]));
      if (r.status === 'finished') {
        var c = store.state().courses[r.slug];
        kids.push(el('p', { 'class': 'rt-modstate', text: 'Finished ' + String((c && c.completedAt) || '').slice(0, 10) + '.' }));
        kids.push(el('p', {}, [el('a', { 'class': 'btn', href: BASE + r.learn + '#notebook', text: 'Look back through your notebook' })]));
      } else {
        if (r.lastModuleTitle) kids.push(el('p', { 'class': 'fine', text: 'Last open: ' + r.lastModuleTitle }));
        kids.push(el('p', {}, [el('a', { 'class': 'btn', href: BASE + r.resume, text: 'Pick up where you left off' })]));
      }
    }
    if (r.toolkit) kids.push(el('p', { 'class': 'fine', text: r.toolkit + (r.toolkit === 1 ? ' item' : ' items') + ' from this course in your toolkit.' }));
    return el('li', { 'class': 'rt-course is-' + r.status, id: 'course-' + r.slug }, kids);
  }

  function itemCard(a, msg) {
    var code = el('pre', { 'class': 'rt-notetext rt-body', text: a.body });
    var copyMsg = el('span', { 'class': 'rt-saved', role: 'status' });
    var learn = (catalog.filter(function (c) { return c.slug === a.course; })[0] || {}).learn;
    var titleEl = el('h3', { text: a.title });
    var card = el('article', { 'class': 'rt-ex rt-item', 'data-course': a.course, 'data-exercise': a.exercise }, [
      titleEl,
      el('p', { 'class': 'rt-meta', text: 'From ' + a.courseTitle + (a.source ? ', ' + a.source : '') + (a.savedAt ? ' · saved ' + a.savedAt.slice(0, 10) : '') }),
      code,
      el('p', { 'class': 'rt-row' }, [
        el('button', { type: 'button', 'class': 'rt-btn2', text: 'Copy', onclick: function () {
          var done = function () { copyMsg.textContent = 'Copied. Paste it into your own AI; nothing is sent from here.'; };
          var fail = function () {
            var r = document.createRange(); r.selectNodeContents(code);
            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
            copyMsg.textContent = 'Selected. Copy it with your keyboard or the share menu.';
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(a.body).then(done, fail); else fail();
        } }),
        el('button', { type: 'button', 'class': 'rt-btn2', text: 'Rename', onclick: function () { renameForm(card, titleEl, a, msg); } }),
        learn ? el('a', { href: BASE + learn + (a.module ? '#' + a.module : ''), text: 'Open the exercise' }) : null,
        el('button', { type: 'button', 'class': 'rt-btn2 rt-danger', text: 'Remove', onclick: function () {
          if (!window.confirm('Remove "' + a.title + '" from your toolkit? The note in the course stays.')) return;
          var ok = store.removeArtifact(a.course, a.exercise);
          flash = ok ? 'Removed "' + a.title + '". The note in the course is still there.' : 'Could not save the change in this browser.';
          render('#toolkit');
        } }),
        copyMsg
      ])
    ]);
    return card;
  }

  function renameForm(card, titleEl, a, msg) {
    if (card.querySelector('form')) return;
    var id = 'rename-' + a.course + '-' + a.exercise.replace(/\W/g, '_');
    var input = el('input', { type: 'text', id: id, 'class': 'field', maxlength: String(Core.MAX_TITLE) });
    input.value = a.title;
    var form = el('form', { 'class': 'rt-rename' }, [
      el('label', { 'for': id, text: 'New name' }), input,
      el('p', { 'class': 'rt-row' }, [
        el('button', { type: 'submit', 'class': 'btn', text: 'Save name' }),
        el('button', { type: 'button', 'class': 'rt-btn2', text: 'Cancel', onclick: function () { form.remove(); } })
      ])
    ]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      var ok = store.renameArtifact(a.course, a.exercise, input.value);
      flash = ok ? 'Renamed.' : 'Could not save the new name in this browser.';
      render('#toolkit');
    });
    titleEl.after(form);
    input.focus(); input.select();
  }

  function render(focusSel) {
    var state = store.state();
    var rows = Core.myCourses(state, catalog);
    var items = Core.listArtifacts(state, catalog);
    var msg = el('p', { 'class': 'status', role: 'status', text: flash });
    flash = '';
    var top = el('section', { 'class': 'label' }, [
      el('p', { 'class': 'tag', text: 'My courses' }),
      el('h1', { tabindex: '-1', text: 'Your courses and toolkit' }),
      el('p', { 'class': 'lede', text: 'What you have started, where you left off, and the things you chose to keep. All of it lives in this browser only.' }),
      el('ol', { 'class': 'rt-courses' }, rows.map(courseRow))
    ]);
    var kitKids = [
      el('p', { 'class': 'tag', text: 'My toolkit' }),
      el('h2', { tabindex: '-1', text: items.length ? items.length + (items.length === 1 ? ' thing' : ' things') + ' worth keeping' : 'Nothing saved yet' })
    ];
    if (!items.length) {
      kitKids.push(el('p', { text: 'In any course exercise, write a note, then choose "Save to my toolkit". The prompts and answers you keep here stay after the course is over.' }));
      var first = rows.filter(function (r) { return r.resume; })[0];
      if (first) kitKids.push(el('p', {}, [el('a', { href: BASE + first.resume, text: 'Go to ' + first.title })]));
    } else {
      kitKids.push(el('p', { 'class': 'rt-actions' }, [
        el('button', { type: 'button', 'class': 'btn', text: 'Download my toolkit', onclick: function () {
          download('mick-toolkit.md', 'text/markdown', Core.exportToolkitMarkdown(store.state(), catalog));
          msg.textContent = 'Toolkit downloaded as a Markdown file.';
        } })
      ]));
      items.forEach(function (a) { kitKids.push(itemCard(a, msg)); });
      kitKids.push(el('p', { 'class': 'fine', text: 'Toolkit items are copies. Editing a note in the course does not change them until you choose "Update my toolkit copy" there. Each course backup includes its toolkit items.' }));
    }
    kitKids.push(msg);
    var kit = el('section', { 'class': 'label', id: 'toolkit' }, kitKids);
    main.textContent = '';
    main.appendChild(top);
    main.appendChild(kit);
    setNotice();
    if (focusSel === '#toolkit') { var h = kit.querySelector('h2'); if (h) h.focus(); }
    else if (location.hash === '#toolkit' && focusSel === 'boot') kit.scrollIntoView();
  }

  window.addEventListener('storage', function (ev) {
    if (ev.key !== Core.SAVE_KEY) return;
    if (main.querySelector('form.rt-rename')) return; // do not throw away a name being typed
    store.reload();
    render();
  });

  window.__myCourses = { store: function () { return store; } };
  render('boot');
})();
