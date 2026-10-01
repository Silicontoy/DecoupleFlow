import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createLocalServer } from '../server/app';
import { buildSkillBundle } from '../src/domain/compiler';
import { DEFAULT_DRIVER } from '../src/domain/types';
import { createTemplate } from '../src/domain/templates';
import { runtime } from '../src/domain/runtime';
import { jevResponse } from './adapter-fixtures';

let root: string, server: Server, base: string;
const upstream = vi.fn<typeof fetch>();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'df-jev-http-')); upstream.mockReset();
  server = createLocalServer({ projectRoot: root, userHome: root }, undefined, { apiKey: 'test-only-server-key', fetcher: upstream });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
async function input() {
  const { machine } = createTemplate('simple'); machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
  const bundle = await buildSkillBundle(machine);
  return { machine, record: runtime.initialRecord(machine, bundle.semanticHash), context: '输入已核实，准备工作已经完成。' };
}
async function post(body: unknown, token?: string) {
  const info = await (await fetch(base + '/api/info')).json();
  return fetch(base + '/api/adapters/jev/decide', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DecoupleFlow-Token': token ?? info.token }, body: JSON.stringify(body) });
}

describe('local Jev adapter proxy', () => {
  it('requires the local session and keeps the environment key out of responses', async () => {
    const info = await (await fetch(base + '/api/info')).json();
    expect(info.jevConfigured).toBe(true); expect(JSON.stringify(info)).not.toContain('test-only-server-key');
    const payload = await input();
    expect((await post(payload, 'invalid-session')).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    upstream.mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(init?.redirect).toBe('error');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-only-server-key');
      const request = JSON.parse(init?.body as string);
      const id = payload.machine.transitions.find(t => t.from === payload.record.currentState)!.id;
      return new Response(JSON.stringify(jevResponse(request, id)));
    });
    const response = await post(payload); const result = await response.json();
    expect(response.status).toBe(200); expect(result.status).toBe('advanced'); expect(result.record.history).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('test-only-server-key');
  });
  it('rejects other drivers and mismatched records before spending an API call', async () => {
    const payload = await input(); payload.machine.driver!.type = 'agent';
    expect((await post(payload)).status).toBe(400);
    payload.machine.driver!.type = 'jev'; payload.record.definitionHash = 'old-hash';
    expect((await post(payload)).status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not migrate on HTTP failure, invalid JSON or incomplete responses', async () => {
    const payload = await input();
    for (const response of [new Response('secret provider details', { status: 401 }), new Response('not json'), new Response('{}')]) {
      upstream.mockResolvedValueOnce(response);
      const failure = await post(payload); const text = await failure.text();
      expect(failure.status).toBe(422); expect(text).not.toContain('secret provider details'); expect(text).not.toContain('test-only-server-key');
    }
    expect(payload.record.revision).toBe(0);
  });
});
