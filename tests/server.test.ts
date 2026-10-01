import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalServer } from '../server/app';
import { createTemplate } from '../src/domain/templates';

let server: Server, root: string, base: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'decoupleflow-http-'));
  server = createLocalServer({ projectRoot: root, userHome: root }, undefined, {}, { home: root, variables: {}, windowsHome: async () => undefined });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

describe('local file service boundary', () => {
  it('requires a same-origin page session to discover directories and never installs during discovery', async () => {
    const config = join(root, '.codex'); await mkdir(config);
    await writeFile(join(config, '.codex-global-state.json'), JSON.stringify({ 'electron-saved-workspace-roots': [root], unrelated: 'PRIVATE_DATA' }));
    const url = base + '/api/agents/directories';
    const { token } = await (await fetch(base + '/api/info')).json();
    const unauthorized: Record<string, string>[] = [
      {}, { 'X-DecoupleFlow-Run-Token': 'event-token' },
      { 'X-DecoupleFlow-Token': token, Origin: 'https://external.example' },
    ];
    for (const headers of unauthorized) expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })).status).toBe(403);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DecoupleFlow-Token': token, Origin: base }, body: '{}' });
    expect(response.status).toBe(200);
    const result = await response.json(); expect(result.projects[0].path).toBe(root); expect(JSON.stringify(result)).not.toContain('PRIVATE_DATA');
    expect(await readdir(root)).toEqual(['.codex']);
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DecoupleFlow-Token': token }, body: '{"userHome":"relative"}' })).status).toBe(400);
  });

  it('requires a page session token before writing any Skill', async () => {
    const payload = { machine: createTemplate().machine, target: 'codex', scope: 'project', projectRoot: root };
    const rejected = await fetch(base + '/api/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(rejected.status).toBe(403); expect(await readdir(root)).toEqual([]);
    const info = await (await fetch(base + '/api/info')).json();
    const headers = { 'Content-Type': 'application/json', 'X-DecoupleFlow-Token': info.token, Origin: base };
    const preview = await fetch(base + '/api/install/preview', { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(preview.status).toBe(200); expect((await preview.json()).status).toBe('new');
    expect(await readdir(root)).toEqual([]);
    const installed = await fetch(base + '/api/install', { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(installed.status).toBe(200); expect((await installed.json()).status).toBe('installed');
  });

  it('blocks cross-site token reads and DNS rebinding hosts', async () => {
    const cases: Record<string, string>[] = [{ Origin: 'https://external.example' }, { Host: 'external.example' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of cases) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        httpRequest(base + '/api/info', { headers }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
      });
      expect(status, JSON.stringify(headers)).toBe(403);
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects malformed bodies and does not expose an execution endpoint', async () => {
    const { token } = await (await fetch(base + '/api/info')).json();
    const headers = { 'Content-Type': 'application/json', 'X-DecoupleFlow-Token': token };
    for (const body of ['{', '{}']) expect((await fetch(base + '/api/install', { method: 'POST', headers, body })).status).toBe(400);
    expect((await fetch(base + '/api/run', { method: 'POST', headers, body: '{}' })).status).toBe(404);
    expect((await fetch(base + '/api/install', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect(await readdir(root)).toEqual([]);
  });
});
