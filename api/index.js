// Vercel wraps this exported Express app as a serverless function. All
// requests — including static assets and the dynamic /:id paste routes,
// neither of which live under /api/ — are rewritten here (see
// ../vercel.json), since Vercel's zero-config static-site detection has no
// way to know server/index.js is meant to handle all of that itself.
const app = require('../server/index');

module.exports = app;
