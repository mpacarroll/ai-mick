---
paths:
  - "courses/**"
  - "scripts/**"
  - "tests/**"
---
# Course runtime rules

- The full paid course text never goes in this public repo. Only `preview.pack.json` (free module only) is committed; full packs build to git-ignored `dist/`. `tests/build-pack.test.mjs` checks that locked modules carry no lesson text.
- Course manuscripts live in the private `mick-services` repo (`courses/<slug>/course.md`). Edit them there, then `npm run build:preview` here. The "preview is stale" test catches drift when mick-services is checked out beside this repo.
- No dead buy buttons: checkout state comes only from `COURSE_STORE` in `courses/store.js` via `CourseCore.checkout()`.
- Test commands: `npm test` and `npm run test:e2e` (no dependencies; Playwright is preinstalled in cloud sessions).
