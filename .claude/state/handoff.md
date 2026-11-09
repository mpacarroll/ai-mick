# Session handoff

MH work on 2026-11-09, two stacked branches:

- `build/mh-course-runtime` (PR #11): course runtime and the AI Starts Here learn page. A review pass added the two-tab save fix and stricter course-file checks. Open decisions for Michael are in the #11 body (free preview scope, how buyers get the full course file).
- `build/mh-toolkit` (stacked on #11): "Save to my toolkit" on exercises and the My courses page at `courses/my/`. Merge #11 first, then retarget this PR to `main`.

Not started: the travel feeder half of the MH brief (ai-travel-planner trip brief export into TripDeputy's model). Both sessions that night were denied access to ai-travel-planner. Next step: a session with ai-travel-planner attached reads trip-deputy `src/lib/trip.js` `normalizeTrip` (read only) and builds the export there.

Also open: learn pages for Get AI to Actually Help and Spec-Driven Building need their manuscripts from `mick-services` (not reachable from these sessions).
