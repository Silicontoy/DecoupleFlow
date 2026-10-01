import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MachineSchema, semanticMachine, type Machine } from '../src/domain/types';
import { hashText } from '../src/domain/compiler';
import { runtime, type RunRecord } from '../src/domain/runtime';
import type { RunSnapshot, RunPhase } from '../src/domain/live';
import { validateMachine } from '../src/domain/validate';
import { decideWithJev, type JevEnvironment } from './jev';
import { InstallError } from './installer';

type Entry = { machine: Machine; hash: string; snapshot: RunSnapshot; token: string; epoch: number; listeners: Set<(s: RunSnapshot) => void>; sequence: number };
const runId = z.string().regex(/^[a-zA-Z0-9-]{1,100}$/);
const eventSchema = z.object({ runId, expectedRevision: z.number().int().nonnegative(), type: z.enum(['agent.started', 'agent.completed', 'external.waiting', 'external.completed', 'human.required', 'run.failed', 'run.timeout']), actor: z.string().max(120).default('外部 Agent'), detail: z.string().max(4000).default(''), context: z.string().max(100000).optional(), decision: z.unknown().optional(), eventId: z.string().max(100).optional() });

export function createRunRegistry(jev: JevEnvironment = {}) {
  const entries = new Map<string, Entry>();
  const seen = new Map<string, Set<string>>();
  function get(id: string) { const entry = entries.get(runId.parse(id)); if (!entry) throw new InstallError('运行实例不存在，请重新打开执行界面。', 404); return entry; }
  function emit(entry: Entry, type: string, detail = '', actor = entry.snapshot.actor) {
    const s = entry.snapshot;
    s.events = [...s.events.slice(-499), { seq: ++entry.sequence, at: new Date().toISOString(), type, stateId: s.record.currentState, actor, detail }];
    for (const listener of entry.listeners) listener(s);
  }
  function phase(entry: Entry): RunPhase {
    if (entry.snapshot.record.status === 'completed') return 'completed';
    if (entry.snapshot.archivedAt) return 'archived';
    if (entry.snapshot.paused) return 'paused';
    return runtime.getState(entry.machine, entry.snapshot.record.currentState).kind === 'wait' ? 'waiting' : 'running';
  }
  function register(machine: Machine, record: RunRecord, hash: string, forkedFrom?: string) {
    if ([...entries.values()].filter(e => !e.snapshot.archivedAt).length >= 100) throw new InstallError('当前服务有 100 个活动实例，请归档不再使用的实例。', 409);
    const archived = [...entries.values()].filter(e => e.snapshot.archivedAt && !e.listeners.size);
    for (const old of archived.slice(0, Math.max(0, archived.length - 199))) { entries.delete(old.snapshot.runId); seen.delete(old.snapshot.runId); }
    const entry: Entry = { machine, hash, token: randomBytes(24).toString('hex'), epoch: 0, sequence: 0, listeners: new Set(), snapshot: { runId: record.instanceId, record, phase: 'running', paused: false, auto: false, busy: false, actor: '自己的 Agent', events: [], context: '', decision: null, evidenceSeq: 0, result: null, ...(forkedFrom ? { forkedFrom } : {}) } };
    entry.snapshot.phase = phase(entry); entries.set(record.instanceId, entry);
    emit(entry, forkedFrom ? 'run.forked' : 'state.entered', forkedFrom ? `从 ${forkedFrom} 分叉，保留当前位置和历史。` : '已载入真实实例，等待执行结果。');
    if (record.status === 'completed') archive(entry, '实例已完成');
    return entry;
  }
  function archive(entry: Entry, reason: string) {
    if (entry.snapshot.archivedAt) return;
    entry.snapshot.archivedAt = new Date().toISOString(); entry.snapshot.archiveReason = reason;
    entry.snapshot.auto = false; entry.snapshot.paused = false; entry.snapshot.phase = phase(entry); entry.epoch++;
    seen.delete(entry.snapshot.runId); emit(entry, 'run.archived', reason);
  }
  return {
    async open(raw: unknown) {
      const data = z.object({ machine: MachineSchema, record: z.object({}).passthrough() }).parse(raw);
      const machine = semanticMachine(data.machine); const record = data.record as RunRecord;
      const errors = validateMachine(machine).filter(d => d.level === 'error'); if (errors.length) throw new InstallError(errors[0].message);
      const hash = await hashText(JSON.stringify(machine, null, 2) + '\n');
      runtime.assertRecord(machine, record, hash); runId.parse(record.instanceId);
      let entry = entries.get(record.instanceId);
      if (entry && entry.hash !== hash) throw new InstallError('该实例绑定了另一份状态机定义。', 409);
      if (!entry) entry = register(machine, record, hash);
      return { snapshot: entry.snapshot, eventToken: entry.token };
    },
    watch(id: string, listener: (snapshot: RunSnapshot) => void) { const entry = get(id); entry.listeners.add(listener); listener(entry.snapshot); return () => entry.listeners.delete(listener); },
    authorize(id: string, token: string) { return get(id).token === token; },
    snapshot(id: string) { return get(id).snapshot; },
    event(raw: unknown) {
      const data = eventSchema.parse(raw); const entry = get(data.runId); const s = entry.snapshot;
      const ids = seen.get(data.runId) ?? new Set<string>();
      if (data.eventId && ids.has(data.eventId)) return s;
      if (data.expectedRevision !== s.record.revision) throw new InstallError('事件对应的状态已经迁移，请读取当前实例后再上报。', 409);
      if (s.record.status === 'completed' || s.archivedAt) throw new InstallError('实例已归档，请创建新实例。', 409);
      if (s.busy) throw new InstallError('正在判断当前证据，请等待结果后上报新事件。', 409);
      if (data.eventId) { ids.add(data.eventId); if (ids.size > 1000) ids.delete(ids.values().next().value!); seen.set(data.runId, ids); }
      const parsedDecision = data.decision === undefined ? undefined : runtime.parseDecision(data.decision);
      s.actor = data.actor;
      if (data.context !== undefined) s.context = data.context;
      if (data.decision !== undefined) s.decision = parsedDecision;
      if (['agent.completed', 'external.completed'].includes(data.type)) s.evidenceSeq++;
      if (!s.paused) s.phase = data.type === 'external.waiting' ? 'waiting' : data.type === 'human.required' ? 'human' : data.type === 'run.failed' ? 'failed' : data.type === 'run.timeout' ? 'timeout' : 'running';
      if (data.type === 'external.waiting') s.record = { ...s.record, pendingExternalTask: { detail: data.detail, actor: data.actor } };
      emit(entry, data.type, data.detail); return s;
    },
    control(raw: unknown) {
      const data = z.object({ runId, action: z.enum(['pause', 'continue', 'fork', 'archive']), expectedRevision: z.number().int().nonnegative().optional() }).parse(raw); const entry = get(data.runId); const s = entry.snapshot;
      if (data.action === 'archive') { archive(entry, '用户结束本次实例'); return { snapshot: s }; }
      if (s.archivedAt) throw new InstallError('实例已归档，只能查看；重新运行请创建新实例。', 409);
      if (data.action === 'fork') {
        if (data.expectedRevision !== undefined && data.expectedRevision !== s.record.revision) throw new InstallError('当前位置已改变，请同步界面后重新分叉。', 409);
        if (s.busy) throw new InstallError('请先暂停当前判断，再从已确认状态分叉。', 409);
        const child = register(entry.machine, { ...structuredClone(s.record), instanceId: randomUUID() }, entry.hash, s.runId);
        child.snapshot.context = s.context; child.snapshot.actor = s.actor;
        return { snapshot: child.snapshot, eventToken: child.token };
      }
      if (s.record.status === 'completed') throw new InstallError('实例已结束。', 409);
      entry.epoch++; s.paused = data.action === 'pause'; s.auto = !s.paused; s.phase = phase(entry);
      emit(entry, s.paused ? 'run.paused' : 'run.continued', s.paused ? '暂停新的状态迁移；外部业务任务由宿主控制。' : '收到新的完成事件后继续检查下一步。');
      return { snapshot: s };
    },
    async step(raw: unknown) {
      const data = z.object({ runId, expectedRevision: z.number().int().nonnegative(), context: z.string().max(100000).optional(), decision: z.unknown().optional(), apiKey: z.string().max(4096).optional(), singleStep: z.boolean().default(true) }).parse(raw);
      const entry = get(data.runId); const s = entry.snapshot;
      if (s.busy || data.expectedRevision !== s.record.revision) throw new InstallError('实例正在判断或已经迁移，请等待界面同步后再试。', 409);
      if (s.paused && !data.singleStep) throw new InstallError('实例已暂停。', 409);
      if (s.record.status === 'completed' || s.archivedAt) throw new InstallError('实例已归档，请创建新实例。', 409);
      const context = data.context ?? s.context; const decision = data.decision ?? s.decision;
      const epoch = entry.epoch; s.busy = true;
      emit(entry, 'guard.started', entry.machine.driver?.type === 'jev' ? 'Jev 正在检查条件。' : '检查 Agent 提供的路径与质量结论。');
      try {
        const result = entry.machine.driver?.type === 'jev'
          ? await decideWithJev({ machine: entry.machine, record: s.record, context, apiKey: data.apiKey }, jev)
          : runtime.applyDecision(entry.machine, s.record, decision, entry.hash);
        s.result = result;
        if (epoch !== entry.epoch) { s.result = { ...result, status: 'held', record: s.record, reason: '判断期间实例已暂停或控制方式改变，结果未用于迁移。' }; emit(entry, 'guard.canceled', s.result.reason); return s; }
        emit(entry, 'guard.evaluated', `${result.reason}${result.confidence === undefined ? '' : ` confidence=${result.confidence.toFixed(3)}`}`, entry.machine.driver?.type === 'jev' ? 'Jev' : s.actor);
        if (result.status !== 'held') {
          const from = s.record.currentState; s.record = result.record; s.context = ''; s.decision = null; s.phase = phase(entry);
          if (s.record.history.at(-1)?.itemId) emit(entry, 'list.item.passed', result.reason);
          else {
            emit(entry, 'transition.taken', `${from} → ${s.record.currentState} · ${result.decision.transitionId}`);
            emit(entry, result.status === 'completed' ? 'run.completed' : 'state.entered', runtime.getState(entry.machine, s.record.currentState).name);
          }
          if (result.status === 'completed') archive(entry, '顶层结束状态已确认完成');
        } else { s.auto = false; s.phase = s.paused ? 'paused' : runtime.getState(entry.machine, s.record.currentState).kind === 'wait' ? 'waiting' : 'human'; }
        return s;
      } catch (error) {
        s.auto = false; if (!s.paused) s.phase = 'failed';
        const message = error instanceof Error ? error.message : '判断失败，保留当前状态。'; emit(entry, 'guard.failed', message);
        throw error instanceof InstallError ? error : new InstallError(message, 422);
      } finally { s.busy = false; for (const listener of entry.listeners) listener(s); }
    },
  };
}
