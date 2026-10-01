import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createRunRegistry } from '../server/runs';
import { createTemplate } from '../src/domain/templates';
import { buildSkillBundle } from '../src/domain/compiler';
import { runtime } from '../src/domain/runtime';
import { DEFAULT_DRIVER } from '../src/domain/types';
import { answer, jevResponse } from './adapter-fixtures';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
async function fixture(jev = false) {
  const { machine } = createTemplate('simple'); if (jev) machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
  const bundle = await buildSkillBundle(machine); const record = runtime.initialRecord(machine, bundle.semanticHash, 'test-instance');
  return { machine, record, decision: answer(machine, record, runtime.candidates(machine, record)[0].id) };
}
describe('live run controls and event stream', () => {
  it('streams external events, deduplicates delivery and rejects stale revisions', async () => {
    const registry = createRunRegistry(); const data = await fixture();
    const opened = await registry.open(data); const events: string[] = [];
    const unsubscribe = registry.watch(opened.snapshot.runId, s => events.push(s.events.at(-1)!.type));
    expect(registry.authorize('test-instance', opened.eventToken)).toBe(true);
    expect(registry.authorize('test-instance', 'wrong-token')).toBe(false);
    const event = { runId: 'test-instance', expectedRevision: 0, type: 'external.waiting', actor: 'My Agent', detail: '等待 job-42 完成', eventId: 'event-1' };
    const waiting = registry.event(event); expect(waiting.phase).toBe('waiting'); expect(waiting.record.pendingExternalTask).toMatchObject({ detail: event.detail });
    registry.event(event); expect(events).toEqual(['state.entered', 'external.waiting']);
    registry.event({ ...event, eventId: 'event-2', type: 'agent.completed', context: '准备完成', decision: data.decision });
    const advanced = await registry.step({ runId: 'test-instance', expectedRevision: 0 });
    expect(advanced.record.currentState).toBe('work'); expect(advanced.record.history).toHaveLength(1);
    expect(events).toContain('guard.evaluated'); expect(events).toContain('transition.taken');
    expect(() => registry.event({ ...event, eventId: 'stale' })).toThrow('已经迁移');
    unsubscribe();
  });
  it('pauses continuous processing, permits exactly one manual step, and forks independently', async () => {
    const registry = createRunRegistry(); const data = await fixture(); await registry.open(data);
    registry.control({ runId: 'test-instance', action: 'pause' });
    await expect(registry.step({ runId: 'test-instance', expectedRevision: 0, decision: data.decision, singleStep: false })).rejects.toThrow('暂停');
    const stepped = await registry.step({ runId: 'test-instance', expectedRevision: 0, decision: data.decision, singleStep: true });
    expect(stepped.phase).toBe('paused'); expect(stepped.record.revision).toBe(1);
    const child = registry.control({ runId: 'test-instance', action: 'fork' }).snapshot;
    expect(child.forkedFrom).toBe('test-instance'); expect(child.record.currentState).toBe('work'); expect(child.record.instanceId).not.toBe('test-instance');
    const path = runtime.candidates(data.machine, child.record)[0];
    await registry.step({ runId: child.runId, expectedRevision: 1, decision: answer(data.machine, child.record, path.id) });
    const parent = (await registry.open(data)).snapshot;
    expect(parent.record.currentState).toBe('work'); expect(parent.record.history).toHaveLength(1);
    expect(child.record.currentState).toBe('done');
  });
  it('discards a late Jev response after Pause and rejects concurrent steps', async () => {
    let complete!: (r: Response) => void;
    let payload: Parameters<typeof jevResponse>[0];
    const fetcher = vi.fn<typeof fetch>(async (_, init) => { payload = JSON.parse(init?.body as string); return await new Promise<Response>(resolve => { complete = resolve; }); });
    const registry = createRunRegistry({ apiKey: 'test-key', fetcher }); const data = await fixture(true); await registry.open(data);
    const pending = registry.step({ runId: 'test-instance', expectedRevision: 0, context: '准备工作已完成' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await expect(registry.step({ runId: 'test-instance', expectedRevision: 0, context: '准备工作已完成' })).rejects.toThrow('正在判断');
    registry.control({ runId: 'test-instance', action: 'pause' });
    complete(new Response(JSON.stringify(jevResponse(payload!, data.decision.transitionId!))));
    const result = await pending;
    expect(result.record.revision).toBe(0); expect(result.phase).toBe('paused'); expect(result.events.at(-1)?.type).toBe('guard.canceled'); expect(result.busy).toBe(false);
  });
});

it('automatically archives completed runs and releases capacity without allowing archived writes', async () => {
  const registry = createRunRegistry(); const data = await fixture();
  await registry.open(data);
  let snapshot = registry.snapshot(data.record.instanceId);
  while (snapshot.record.status !== 'completed') snapshot = await registry.step({ runId: data.record.instanceId, expectedRevision: snapshot.record.revision, decision: answer(data.machine, snapshot.record, runtime.candidates(data.machine, snapshot.record)[0].id) });
  expect(snapshot.archivedAt).toBeTruthy(); expect(snapshot.auto).toBe(false); expect(snapshot.events.at(-1)?.type).toBe('run.archived');
  expect(() => registry.control({ runId: snapshot.runId, action: 'continue' })).toThrow('归档');
  for (let i = 0; i < 105; i++) {
    const id = 'run-' + i; await registry.open({ machine: data.machine, record: { ...data.record, instanceId: id } });
    registry.control({ runId: id, action: 'archive' });
  }
  const next = await registry.open({ machine: data.machine, record: { ...data.record, instanceId: 'new-run' } }); expect(next.snapshot.record.currentState).toBe('prepare');
});
