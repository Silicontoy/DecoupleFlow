import type { Machine, Project } from '../domain/types';
import { runtime, type RunRecord } from '../domain/runtime';
import type { RunSnapshot } from '../domain/live';

export type ArchivedInstance = { record: RunRecord; archivedAt: string; reason: string; project?: Project; snapshot?: RunSnapshot };
export function readArchives(key: string, storage: Storage = localStorage): ArchivedInstance[] {
  const parsed = JSON.parse(storage.getItem(`${key}.archives`) || '[]');
  return Array.isArray(parsed) ? parsed.filter(value => value?.record?.instanceId && value?.archivedAt) : [];
}
export function archiveInstance(key: string, value: Omit<ArchivedInstance, 'archivedAt'>, storage: Storage = localStorage) {
  const archives = readArchives(key, storage);
  const prior = archives.find(a => a.record.instanceId === value.record.instanceId);
  const entry = { ...prior, ...value, archivedAt: prior?.archivedAt || new Date().toISOString() };
  const next = [entry, ...archives.filter(a => a.record.instanceId !== value.record.instanceId)];
  storage.setItem(`${key}.archives`, JSON.stringify(next));
  const active = JSON.parse(storage.getItem(key) || 'null');
  if (active?.instanceId === value.record.instanceId) storage.removeItem(key);
  return next;
}
export function restoreInstance(machine: Machine, definitionHash: string, key: string, storage: Storage = localStorage): RunRecord {
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (saved) {
      if (saved.status === 'completed' || saved.definitionHash !== definitionHash) {
        archiveInstance(key, { record: saved, reason: saved.status === 'completed' ? '实例已完成' : '定义已变更，原实例保留' }, storage);
      } else { runtime.assertRecord(machine, saved, definitionHash); return saved; }
    }
  } catch { const original = storage.getItem(key); if (original) storage.setItem(`${key}.previous`, original); }
  return runtime.initialRecord(machine, definitionHash, crypto.randomUUID());
}
