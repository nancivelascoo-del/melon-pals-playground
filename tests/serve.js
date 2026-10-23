// Tiny static server for the QA checks. Serves the repo under /<repo-name>/ just like GitHub Pages does.
// Usage: node tests/serve.js [port]   then open http://127.0.0.1:<port>/<repo-name>/
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = '/' + (process.env.SITE_BASE || path.basename(ROOT)) + '/';
const PORT = +(process.argv[2] || process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.txt': 'text/plain' };
const HIDDEN = /^(node_modules|tests?|test-results|playwright-report|\.git|\.github|_site)(\/|$)|^package(-lock)?\.json$|^playwright\.config\.js$|^TESTING\.md$/;
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u + '/' === BASE) { res.writeHead(302, { Location: BASE }); return res.end(); }
  if (!u.startsWith(BASE)) { res.writeHead(404); return res.end('not found'); }
  let rel = u.slice(BASE.length); if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || HIDDEN.test(rel)) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log('Serving ' + ROOT + ' at http://127.0.0.1:' + PORT + BASE));
