// Minimal static file server — no dependencies.
// index.html uses <script type="module">, which Chrome refuses to load
// over file://. Serve the project over http:// instead:
//   node serve.js
// then open the printed URL in the browser.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath);
    // no-store: with no cache header at all, Chrome applies HEURISTIC caching
    // and keeps serving stale ES modules across reloads — an edit to a file
    // under src/ would silently not take effect, which makes it impossible to
    // trust what you are looking at while developing.
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`SkyGate rodando em http://127.0.0.1:${port}`);
});
