import { expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { restoreInstance, readArchives, archiveInstance } from '../src/lib/instanceStore';
import { createTemplate } from '../src/domain/templates';
import { buildSkillBundle } from '../src/domain/compiler';
import { runtime } from '../src/domain/runtime';
import { answer } from './adapter-fixtures';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
function memory(): Storage { const data = new Map<string, string>(); return { get length() { return data.size; }, clear: () => data.clear(), getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); }, key: i => [...data.keys()][i] ?? null }; }
it('migrates a completed active pointer to archive and returns a new instance without losing history', async () => {
  const storage = memory(), project = createTemplate('simple'); const bundle = await buildSkillBundle(project.machine);
  let record = runtime.initialRecord(project.machine, bundle.semanticHash, 'previous');
  while (record.status !== 'completed') record = runtime.applyDecision(project.machine, record, answer(project.machine, record, runtime.candidates(project.machine, record)[0].id), bundle.semanticHash).record;
  storage.setItem('run', JSON.stringify(record));
  const next = restoreInstance(project.machine, bundle.semanticHash, 'run', storage);
  expect(next.currentState).toBe('prepare'); expect(next.instanceId).not.toBe('previous');
  expect(readArchives('run', storage)[0].record).toEqual(record); expect(storage.getItem('run')).toBeNull();
  archiveInstance('run', { record, project, reason: '完成' }, storage); expect(readArchives('run', storage)).toHaveLength(1);
});
it('resumes only an active instance of the same definition and preserves a version change in archives', async () => {
  const storage = memory(), { machine } = createTemplate('simple'), bundle = await buildSkillBundle(machine);
  const record = runtime.initialRecord(machine, bundle.semanticHash, 'active'); storage.setItem('run', JSON.stringify(record));
  expect(restoreInstance(machine, bundle.semanticHash, 'run', storage).instanceId).toBe('active');
  const next = restoreInstance(machine, 'new-definition', 'run', storage);
  expect(next.instanceId).not.toBe('active'); expect(readArchives('run', storage)[0].record).toEqual(record);
});
