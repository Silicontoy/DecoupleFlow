import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createLocalServer, type Middleware } from './app';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口。');
const production = process.argv.includes('--production');
let serve: Middleware;
const server = createLocalServer({ projectRoot: process.env.DECOUPLEFLOW_PROJECT_ROOT ? resolve(process.env.DECOUPLEFLOW_PROJECT_ROOT) : '', userHome: resolve(process.env.DECOUPLEFLOW_USER_HOME || homedir()) }, (req, res, next) => serve(req, res, next));

if (production) {
  const dist = resolve(root, 'dist');
  try { await stat(resolve(dist, 'index.html')); } catch { throw new Error('请先运行 npm run build。'); }
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };
  serve = (req, res, next) => { void (async () => {
    try {
      if (!['GET', 'HEAD'].includes(req.method ?? '')) { next(); return; }
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      const path = resolve(dist, '.' + pathname);
      if (path !== dist && !path.startsWith(dist + sep)) { next(); return; }
      let content: Buffer, file = path;
      try { content = await readFile(file); } catch {
        if (extname(pathname)) { next(); return; }
        file = resolve(dist, 'index.html'); content = await readFile(file);
      }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { next(); }
  })(); };
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server }, allowedHosts: ['localhost', '127.0.0.1'] }, appType: 'spa' });
  serve = vite.middlewares;
  server.on('close', () => { void vite.close(); });
}
server.on('error', error => { console.error(error); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`\n  DecoupleFlow\n  http://localhost:${port}\n  本地状态机编辑与 Skill 导出\n`));
