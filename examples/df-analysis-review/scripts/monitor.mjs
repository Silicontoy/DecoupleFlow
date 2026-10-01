import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadInstance, runCommand, save } from './run.mjs';
import { runtime } from './adapter.mjs';
const folder = process.argv[2], token = randomBytes(32).toString('hex');
let origin = '', lastActivity = Date.now(), archivedSince = 0, lastEvent = '';
async function snapshot() {
  const state = await loadInstance(folder);
  let result = null; try { result = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8')); } catch {}
  const lines = (await readFile(join(folder, 'events.jsonl'), 'utf8').catch(() => '')).trim().split('\n');
  const events = lines.slice(-500).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  if (lastEvent !== events.at(-1)?.id) { lastActivity = Date.now(); lastEvent = events.at(-1)?.id; }
  if (state.session.archivedAt && !archivedSince) archivedSince = Date.now();
  return { ...state, listProgress: runtime.listProgress(state.machine, state.record), events, result, instance: folder };
}
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: '仅允许本机同源访问。' });
    if (req.method === 'GET' && req.url === '/') {
      const html = await readFile(new URL('../assets/execution.html', import.meta.url));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" }); res.end(html); return;
    }
    if (req.headers['x-decoupleflow-run-token'] !== token) return send(res, 403, { error: '实例令牌无效，请通过 Skill 的 view 命令重新打开。' });
    lastActivity = Date.now();
    if (req.method === 'GET' && req.url === '/snapshot') return send(res, 200, await snapshot());
    if (req.method !== 'POST' || req.url !== '/control' || !req.headers['content-type']?.startsWith('application/json')) return send(res, 404, { error: '接口不存在。' });
    let size = 0, body = ''; for await (const chunk of req) { size += chunk.length; if (size > 8192) return send(res, 413, { error: '请求过大。' }); body += chunk; }
    const data = JSON.parse(body);
    if (!['pause', 'continue', 'step', 'archive', 'fork', 'event'].includes(data.action)) return send(res, 400, { error: '未知控制动作。' });
    const result = await runCommand(data.action === 'event' ? ['event', '--instance', folder, '--event-json', JSON.stringify(data.event)] : data.action === 'archive' || data.action === 'fork' ? [data.action, '--instance', folder, '--no-open'] : ['control', '--instance', folder, '--action', data.action]);
    send(res, 200, { result, snapshot: await snapshot() });
  } catch (e) { send(res, 409, { error: e.message }); }
});
server.listen(0, '127.0.0.1', async () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  await save(join(folder, 'monitor.json'), { origin, token, pid: process.pid });
});
const timer = setInterval(async () => {
  try { await snapshot(); if ((archivedSince && Date.now() - archivedSince > 30000) || Date.now() - lastActivity > 15 * 60 * 1000) { clearInterval(timer); server.closeAllConnections(); server.close(); await rm(join(folder, 'monitor.json'), { force: true }); } } catch { clearInterval(timer); server.closeAllConnections(); server.close(); }
}, 1000);
process.on('SIGTERM', () => { clearInterval(timer); server.closeAllConnections(); server.close(); });
