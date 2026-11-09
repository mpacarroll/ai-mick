# Session handoff

Branch `build/mh-course-runtime` (2026-11-09): course runtime and the AI Starts Here learn page. See the PR for status. Open decisions for Michael are listed in the PR body (free preview scope, how buyers get the full course file).

The travel feeder half of the MH brief (ai-travel-planner trip brief export into TripDeputy's model) was not started: this session was denied write access to ai-travel-planner. Next step: a session with ai-travel-planner attached reads trip-deputy `src/lib/trip.js` `normalizeTrip` and builds the export there.
