/**
 * MPW — zero-dependency launcher for the prebuilt bundle (dist/).
 * Usage:  node server.mjs   →  http://localhost:8080
 * Requires only Node.js ≥ 18. No npm install needed.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let data;
    let served = file;
    try {
      data = await readFile(file);
    } catch {
      // SPA fallback: unknown routes serve the shell
      served = join(root, 'index.html');
      data = await readFile(served);
    }
    res.writeHead(200, {
      'content-type': MIME[extname(served).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': served.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500).end(`MPW server error: ${err instanceof Error ? err.message : err}`);
  }
}).listen(port, host, () => {
  console.log(`\n  Modular Personal Workspace`);
  console.log(`  ➜  http://localhost:${port}\n`);
  console.log(`  Data is stored locally in your browser (IndexedDB). Press Ctrl+C to stop.`);
});
