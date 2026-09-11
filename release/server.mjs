/**
 * ModuDesk(MPW)— 零依赖启动器:只需 Node.js ≥ 18,无需 npm install。
 *
 * 用法:
 *   node release/server.mjs              → 启动并自动打开浏览器(默认 8080)
 *   PORT=3000 node release/server.mjs    → 指定端口
 *   MPW_NO_OPEN=1 node release/server.mjs → 不自动打开浏览器
 *
 * 自动探测预构建产物位置(依次尝试):
 *   1. ../apps/web/dist      (最新开发构建)
 *   2. release/dist          (便携发布包)
 *   3. ../apps-web-dist      (旧版发布包)
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const CANDIDATES = [
  resolve(here, '../apps/web/dist'),
  join(here, 'dist'),
  resolve(here, '../apps-web-dist'),
];
const root = CANDIDATES.find((dir) => existsSync(join(dir, 'index.html')));
if (!root) {
  console.error('\n  [错误] 未找到预构建产物(index.html)。');
  console.error('  已尝试以下目录:');
  for (const dir of CANDIDATES) console.error(`    - ${dir}`);
  console.error('\n  请先执行 npm run build 构建,或将发布包完整解压后重试。\n');
  process.exit(1);
}

const basePort = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';

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

function openBrowser(url) {
  if (process.env.MPW_NO_OPEN) return;
  import('node:child_process')
    .then(({ spawn }) => {
      const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    })
    .catch(() => {});
}

function startServer(port) {
  const server = createServer(async (req, res) => {
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
  });
  server.on('error', (err) => {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用。请打开已运行的 http://localhost:${port}，或关闭占用端口的程序后重试。为保持数据存储地址一致，不会自动更换端口。`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  });
  server.listen(port, host, () => {
    const url = `http://localhost:${port}`;
    console.log('\n  ┌─────────────────────────────────────────┐');
    console.log('  │   ModuDesk · 模块化个人工作台  v0.2.1   │');
    console.log('  └─────────────────────────────────────────┘');
    console.log(`\n  ➜  ${url}(浏览器应已自动打开,若无请手动访问)`);
    console.log(`     页面目录: ${root}`);
    console.log('     数据保存在本机浏览器中,不会上传到任何服务器。');
    console.log('     停止:按 Ctrl+C 或直接关闭本窗口。\n');
    openBrowser(url);
  });
}

startServer(basePort);
