import { handleAI } from './ai/handler.js';

// Serves the site's static files and the Circuit Arena AI endpoints (/api/ai/...). The Google Search Console verification file
// is answered directly, because the static handler would redirect "/x.html" to "/x"
// and Google needs the file at its exact URL.
const VERIFY = '/google925d2939e209b3bd.html';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/ai/')) return handleAI(request, env);
    if (path === VERIFY) {
      return new Response('google-site-verification: google925d2939e209b3bd.html', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
