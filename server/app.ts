import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, webcrypto } from 'node:crypto';
import { ZodError } from 'zod';
import { InstallError, installSkill, previewInstall, type InstallEnvironment } from './installer';
import { decideWithJev, type JevEnvironment } from './jev';
import { createRunRegistry } from './runs';
import { discoverAgentDirectories, type DiscoveryEnvironment } from './agentDirectories';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
export function createLocalServer(env: InstallEnvironment, middleware?: Middleware, jev: JevEnvironment = {}, discovery: DiscoveryEnvironment = {}) {
  const token = randomBytes(32).toString('hex');
  const runs = createRunRegistry(jev);
  const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) { json(res, 403, { error: '仅允许本地访问。' }); return; }
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) { json(res, 403, { error: '拒绝跨来源请求。' }); return; }
        if (req.headers['sec-fetch-site'] === 'cross-site') { json(res, 403, { error: '拒绝跨站点请求。' }); return; }
        if (req.method === 'GET' && url.pathname === '/api/info') { json(res, 200, { token, projectRoot: env.projectRoot, userHome: env.userHome, mode: 'local', jevConfigured: !!(jev.apiKey || process.env.TYPESAFE_API_KEY) }); return; }
        const runRoute = /^\/api\/runs\/(open|watch|event|snapshot|step|control)$/.test(url.pathname);
        if (req.method !== 'POST' || (!runRoute && !['/api/install/preview', '/api/install', '/api/adapters/jev/decide', '/api/agents/directories'].includes(url.pathname))) { json(res, 404, { error: '接口不存在。' }); return; }
        const eventToken = ['/api/runs/event', '/api/runs/snapshot'].includes(url.pathname) ? req.headers['x-decoupleflow-run-token'] : undefined;
        if (req.headers['x-decoupleflow-token'] !== token && !eventToken) { json(res, 403, { error: '页面会话已失效，请刷新后重试。' }); return; }
        if (!req.headers['content-type']?.startsWith('application/json')) { json(res, 415, { error: '需要 JSON 请求。' }); return; }
        let size = 0; const parts: Buffer[] = [];
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > 2 * 1024 * 1024) throw new InstallError('请求超过 2 MB 上限。', 413);
          parts.push(bytes);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new InstallError('无法读取 JSON 请求。'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InstallError('请求参数需要 JSON 对象。');
        if (eventToken && (typeof eventToken !== 'string' || !runs.authorize((body as { runId: string }).runId, eventToken))) { json(res, 403, { error: '实例事件令牌无效。' }); return; }
        if (url.pathname === '/api/agents/directories') { json(res, 200, await discoverAgentDirectories(body, env, discovery)); return; }
        if (runRoute) {
          if (url.pathname.endsWith('/watch')) {
            const runId = (body as { runId: string }).runId;
            let ready = false;
            const close = runs.watch(runId, snapshot => {
              if (!ready) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); ready = true; }
              res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
            });
            const heartbeat = setInterval(() => { res.write(': keep-alive\n\n'); }, 20000);
            res.on('close', () => { clearInterval(heartbeat); close(); }); return;
          }
          const result = url.pathname.endsWith('/open') ? await runs.open(body) : url.pathname.endsWith('/snapshot') ? runs.snapshot((body as { runId: string }).runId) : url.pathname.endsWith('/event') ? runs.event(body) : url.pathname.endsWith('/step') ? await runs.step(body) : runs.control(body);
          json(res, 200, result); return;
        }
        const result = url.pathname === '/api/adapters/jev/decide' ? await decideWithJev(body, jev) : url.pathname.endsWith('/preview') ? await previewInstall(body, env) : await installSkill(body, env);
        json(res, 200, result); return;
      }
      if (middleware) middleware(req, res, () => { res.writeHead(404); res.end('Not found'); });
      else { res.writeHead(404); res.end('Not found'); }
    } catch (error) {
      const status = error instanceof InstallError ? error.status : error instanceof ZodError ? 400 : 500;
      const message = error instanceof ZodError ? '状态机或请求参数格式不正确。' : error instanceof Error ? error.message : '操作未完成。';
      if (!res.headersSent) json(res, status, { error: message });
      else res.end();
    }
  });
  return server;
}
