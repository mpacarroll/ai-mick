# Course runtime

Runs a Mick course in the browser: lessons, exercises with copyable prompts, a
notebook of the learner's notes, progress, resume, and honest links out to the
free tools. Everything the learner does stays in their browser (localStorage).
No accounts, no server, no network calls except loading the preview pack from
this site.

## Files

| File | What it does |
|---|---|
| `course-core.js` | Pure logic, shared with the node tests: pack validation, the versioned save, recovery, progress, checkout state, Markdown export, backup and restore. |
| `course-app.js` | The page: renders views by URL hash (`#`, `#m1`, `#notebook`, `#done`). |
| `course-runtime.css` | Additions on top of `../course.css`. Same tokens. |
| `catalog.js` | Every course, for the My courses page. `learn: null` means no learn page yet, and the page says so. |
| `my-app.js` | The My courses page (`courses/my/`): progress across courses, resume links, and the toolkit. |
| `../../scripts/build-course-pack.mjs` | Turns a `course.md` manuscript plus an overlay into a pack. |
| `../../scripts/course-overlays/<slug>.json` | Per-course extras: free modules, locked-module summaries, tool links per exercise, added plan days, closing links. |

## Course packs

A pack is JSON with `schema: "mick.course-pack"`. Two editions:

- **preview**: committed at `courses/<slug>/learn/preview.pack.json`. Holds the
  intro and the free module(s) only. Locked modules carry a title and summary,
  never lesson text (a test enforces this).
- **full**: the paid course. Built to `dist/` (git-ignored) and never committed
  to this public repo. A buyer imports it on the learn page; it is stored in
  their browser under `mick.coursepack.<slug>`.

Rebuild after the manuscript changes (needs `mick-services` checked out beside this repo):

```
npm run build:preview   # refresh the committed preview
npm run build:full      # dist/ai-starts-here.course.json, the file for the buyer download
```

## Checkout

The unlock panel reads `COURSE_STORE` in `courses/store.js`, the same map the
course pages use. Empty link: the panel says checkout is not open and points to
the email form. There is no buy button. An `https://` link: the panel shows "Get
the full course". A non-https link is refused and the panel says why.

## Saves

One key, `mick.courses`, `{ version: 1, courses: { <slug>: progress } }`.

- Damaged JSON or an unversioned save: copied to `mick.courses.corrupt`, page starts fresh, learner is told.
- A save from a newer version: shown read-only, never overwritten.
- Storage blocked or full: work continues in memory with a banner to export.
- Another tab changes the save: the store re-reads the save before every write, so neither tab wipes the other. The screen refreshes; a note being typed is left alone while the other fields update in place.
- Notes for exercises missing from the current edition are kept and exported under "Other notes".

Each course record can also hold:

- `artifacts`: the toolkit. `{ <exerciseId>: { title, body, source, module, savedAt } }`, saved from an exercise with "Save to my toolkit". It is a copy of the note; "Update my toolkit copy" refreshes it. It travels in the course backup.
- `snapshot`: `{ title, edition, done, total, lockedModules, lastModuleTitle }`, written by the learn page when it changes, so the My courses page can show progress without loading every course file.

## Toolkit and My courses

An overlay can name the toolkit item an exercise produces: `"exercises": { "1.1": { "artifact": { "title": "..." } } }`. Exercises without one still save, titled with their label. `courses/my/` lists each course in `catalog.js` with an honest status (not in the browser yet, not started, in progress, finished) and every saved item with Copy, Rename, Open the exercise, Remove, and Download my toolkit (Markdown). The page is `noindex` and is not in the sitemap: it only shows what is in the visitor's own browser.

To bump the save version, add a branch to `migrate()` in `course-core.js` that
upgrades the old shape, and a test for it.

## Adding a course

1. Write `scripts/course-overlays/<slug>.json` (copy `ai-starts-here.json`).
2. Build the preview into `courses/<slug>/learn/preview.pack.json`.
3. Copy `courses/ai-starts-here/learn/index.html` and change `data-course`, the title and meta tags.
4. Add a link from the course page and a sitemap entry.
5. Set `learn` for the course in `catalog.js`.

## Tests

```
npm test            # node unit tests (core, builder, committed preview)
npm run test:e2e    # Playwright: learn page, then toolkit and My courses. Synthetic full course; FULL_PACK=dist/... for the real one; SHOTS=dir for screenshots
```
