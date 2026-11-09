/* Every Mick course, for the My courses page. Paths are relative to courses/.
   "learn" is the in-browser runtime page; null means the course has no learn
   page yet, and the page says so instead of linking to nothing. */
var COURSE_CATALOG = [
  { slug: 'ai-starts-here', title: 'AI Starts Here', level: 'Level 1 · Beginner', page: 'ai-starts-here/', learn: 'ai-starts-here/learn/' },
  { slug: 'get-ai-to-help', title: 'Get AI to Actually Help', level: 'Level 2 · Practitioner', page: 'get-ai-to-help/', learn: null },
  { slug: 'spec-driven-building', title: 'Spec-Driven Building', level: 'Level 3 · Builder', page: 'spec-driven-building/', learn: null }
];
if (typeof module === 'object' && module.exports) module.exports = COURSE_CATALOG;
