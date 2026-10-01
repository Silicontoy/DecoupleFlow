import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSkillBundle } from '../src/domain/compiler';
import { createTemplate } from '../src/domain/templates';
import { runtime } from '../src/domain/runtime';
import { answer } from './adapter-fixtures';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const exec = promisify(execFile);
let root: string, skill: string; const monitors = new Set<number>();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'df-runner-')); skill = join(root, 'skill');
  const bundle = await buildSkillBundle(createTemplate('simple').machine);
  for (const [name, content] of Object.entries(bundle.files)) { const path = join(skill, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); }
});
afterEach(async () => { for (const pid of monitors) { try { process.kill(pid); } catch {} } monitors.clear(); await rm(root, { recursive: true, force: true }); });
async function run(...args: string[]) { return JSON.parse((await exec(process.execPath, [join(skill, 'scripts/run.mjs'), ...args], { timeout: 10000 })).stdout); }
async function decision(instance: string) {
  const machine = JSON.parse(await readFile(join(instance, 'definition.json'), 'utf8')); const record = JSON.parse(await readFile(join(instance, 'state-record.json'), 'utf8'));
  const path = join(root, 'decision.json'); await writeFile(path, JSON.stringify(answer(machine, record, runtime.candidates(machine, record)[0].id))); return path;
}
it('archives completion, releases active records and starts a fresh instance on the next invocation', async () => {
  const first = await run('start', '--workspace', root, '--visualization', 'off');
  expect(first.visualization).toBe('disabled');
  const restored = await run('resume', '--instance', first.instance); expect(restored.record.instanceId).toBe(first.record.instanceId);
  for (let i = 0; i < 3; i++) await run('advance', '--instance', first.instance, '--decision', await decision(first.instance));
  const closed = await run('status', '--instance', first.instance);
  expect(closed.record.status).toBe('completed'); expect(closed.session.archivedAt).toBeTruthy();
  expect(await readdir(join(dirname(first.instance), '.active'))).toEqual([]);
  await expect(run('resume', '--instance', first.instance)).rejects.toThrow('已归档');
  const second = await run('start', '--workspace', root, '--visualization', 'off');
  expect(second.record.instanceId).not.toBe(first.record.instanceId); expect(second.record.currentState).toBe('prepare'); expect(second.record.history).toEqual([]);
  const list = await run('list', '--workspace', root); expect(list.instances).toHaveLength(2); expect(list.instances.filter((i: { archivedAt?: string }) => i.archivedAt)).toHaveLength(1);
  expect(await readdir(skill)).not.toContain('.decoupleflow');
});
it('starts a real standalone monitor, streams actual records and honors pause / one-step controls', async () => {
  const opened = await run('start', '--workspace', root, '--actor', '测试宿主', '--no-open');
  expect(opened.visualization).toBe('ready'); const monitor = JSON.parse(await readFile(join(opened.instance, 'monitor.json'), 'utf8')); monitors.add(monitor.pid);
  const headers = { 'X-DecoupleFlow-Run-Token': monitor.token, 'Content-Type': 'application/json' };
  expect((await fetch(monitor.origin + '/snapshot')).status).toBe(403);
  expect((await fetch(monitor.origin + '/snapshot', { headers: { ...headers, Origin: 'https://external.example' } })).status).toBe(403);
  expect(await (await fetch(monitor.origin)).text()).toContain('CURRENT STATE');
  const control = (action: string) => fetch(monitor.origin + '/control', { method: 'POST', headers, body: JSON.stringify({ action }) });
  expect((await control('pause')).status).toBe(200);
  const held = await run('advance', '--instance', opened.instance, '--decision', await decision(opened.instance)); expect(held.status).toBe('paused'); expect(held.record.revision).toBe(0);
  expect((await control('step')).status).toBe(200);
  const advanced = await run('advance', '--instance', opened.instance, '--decision', await decision(opened.instance)); expect(advanced.record.currentState).toBe('work');
  expect((await run('advance', '--instance', opened.instance, '--decision', await decision(opened.instance))).status).toBe('paused');
  const snapshot = await (await fetch(monitor.origin + '/snapshot', { headers })).json(); expect(snapshot.record.revision).toBe(1); expect(snapshot.events.some((e: { type: string }) => e.type === 'transition.taken')).toBe(true);
  const event = join(root, 'event.json'); await writeFile(event, JSON.stringify({ type: 'external.waiting', detail: '真实等待 job-42' }));
  await run('event', '--instance', opened.instance, '--event', event);
  expect((await (await fetch(monitor.origin + '/snapshot', { headers })).json()).record.pendingExternalTask.detail).toBe('真实等待 job-42');
  await control('archive'); expect((await (await fetch(monitor.origin + '/snapshot', { headers })).json()).session.archivedAt).toBeTruthy();
});
