import { answer, jevResponse } from './adapter-fixtures';
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createTemplate } from '../src/domain/templates';
import { DEFAULT_DRIVER, newState, type Machine } from '../src/domain/types';
import { portableRuntimeSource, runtime, type Decision, type RunRecord } from '../src/domain/runtime';

const evidence = '原任务 job-42 已成功完成，本次结果已检查。';

describe('adapter-independent transitions', () => {
  it('holds unknown, incomplete and unverified transitions without changing the instance', () => {
    const { machine } = createTemplate();
    const record = runtime.initialRecord(machine, 'hash');
    const edge = runtime.candidates(machine, record)[0];
    for (const decision of [answer(machine, record, 'not-a-path'), answer(machine, record, edge.id, { conditionMet: false }), answer(machine, record, edge.id, { evidence: '' }), answer(machine, record, edge.id, { transitionId: null })]) {
      const result = runtime.applyDecision(machine, record, decision, 'hash');
      expect(result.status).toBe('held'); expect(result.record).toBe(record);
    }
    edge.condition = '';
    expect(runtime.applyDecision(machine, record, answer(machine, record, edge.id), 'hash').reason).toContain('尚未定义');
  });
  it('checks path-specific quality and target entry without requiring success checks on failure routes', () => {
    const { machine } = createTemplate();
    const record = { ...runtime.initialRecord(machine, 'hash'), currentState: 'review', statePath: ['review'] };
    const approved = machine.transitions.find(t => t.id === 'approved')!;
    machine.states.find(s => s.id === approved.to)!.entryConditions = '验收通过';
    expect(runtime.applyDecision(machine, record, answer(machine, record, approved.id, { passedQuality: [] }), 'hash').status).toBe('held');
    expect(runtime.applyDecision(machine, record, answer(machine, record, approved.id, { targetEntryMet: false }), 'hash').status).toBe('held');
    const failure = machine.transitions.find(t => t.from === 'review' && t.kind === 'fallback')!;
    expect(runtime.applyDecision(machine, record, answer(machine, record, failure.id), 'hash').record.currentState).toBe(failure.to);
    const success = runtime.applyDecision(machine, record, answer(machine, record, approved.id), 'hash');
    expect(success.record.history[0]).toMatchObject({ transitionId: approved.id, evidence, adapter: 'agent' });
    expect(success.record.revision).toBe(1); expect(record.revision).toBe(0);
  });
  it('preserves distinct conditions to the same destination, loops and fresh checks on each visit', () => {
    const { machine } = createTemplate('loop');
    let record = { ...runtime.initialRecord(machine, 'hash'), currentState: 'repeat', statePath: ['repeat'] };
    const loop = machine.transitions.find(t => t.from === 'repeat' && t.loopRole === 'continue')!;
    record = runtime.applyDecision(machine, record, answer(machine, record, loop.id), 'hash').record;
    expect(record.currentState).toBe('work');
    record = { ...record, currentState: 'review', statePath: ['review'] };
    const back = machine.transitions.find(t => t.from === 'review' && t.to === 'repeat')!;
    record = runtime.applyDecision(machine, record, answer(machine, record, back.id), 'hash').record;
    expect(record.currentState).toBe('repeat');
    expect(runtime.applyDecision(machine, record, answer(machine, record, loop.id, { conditionMet: false }), 'hash').status).toBe('held');
    machine.transitions.push({ ...loop, id: 'other-condition', condition: '另一项实际条件' });
    expect(runtime.candidates(machine, record).filter(c => c.to === loop.to)).toHaveLength(2);
  });
  it('enters and returns from nested states before checking parent routes and terminal quality', () => {
    const { machine } = createTemplate('simple');
    const sub = newState('subflow', 'nested'); const end = newState('end', 'child-end');
    sub.initialState = end.id; end.parentId = sub.id;
    machine.states.push(sub, end); machine.initialState = sub.id;
    machine.transitions.push({ id: 'after-child', from: sub.id, to: 'done', condition: '内部工作完成', kind: 'normal', requiredQuality: [], onUncertain: '' });
    let record = runtime.initialRecord(machine, 'hash');
    record = runtime.applyDecision(machine, record, answer(machine, record, '__enter__'), 'hash').record;
    expect(record.statePath).toEqual(['nested', 'child-end']);
    record = runtime.applyDecision(machine, record, answer(machine, record, '__return__'), 'hash').record;
    expect(record).toMatchObject({ currentState: 'nested', phase: 'exiting' });
    expect(runtime.candidates(machine, record).map(c => c.id)).toEqual(['after-child']);
    record = runtime.applyDecision(machine, record, answer(machine, record, 'after-child'), 'hash').record;
    record = runtime.applyDecision(machine, record, answer(machine, record, '__finish__'), 'hash').record;
    expect(record.status).toBe('completed'); expect(record.history.at(-1)?.outcome).toBe('success');
  });
  it('rejects stale definitions, malformed records and incompatible phases', () => {
    const { machine } = createTemplate('simple'); const record = runtime.initialRecord(machine, 'hash');
    expect(() => runtime.assertRecord(machine, record, 'new-hash')).toThrow('版本');
    expect(() => runtime.assertRecord(machine, { ...record, statePath: [] }, 'hash')).toThrow('路径');
    expect(() => runtime.assertRecord(machine, { ...record, phase: 'exiting' }, 'hash')).toThrow('子状态机');
    expect(() => runtime.parseDecision({ transitionId: 'ready' })).toThrow('格式');
  });
  it('exports the exact same runtime as standalone JavaScript with no build dependencies', () => {
    const portable = runInNewContext(portableRuntimeSource() + '\nruntime;');
    const { machine } = createTemplate('loop'); const record = runtime.initialRecord(machine, 'hash');
    const decision = answer(machine, record, runtime.candidates(machine, record)[0].id);
    expect(JSON.parse(JSON.stringify(portable.applyDecision(machine, record, decision, 'hash', 'agent', '2026-10-01')))).toEqual(runtime.applyDecision(machine, record, decision, 'hash', 'agent', '2026-10-01'));
  });
});

describe('Jev decision protocol', () => {
  it('sends typed Choice/Noul questions and holds low confidence, missing quality and uncertain decisions', () => {
    const { machine } = createTemplate(); machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
    const record = { ...runtime.initialRecord(machine, 'hash'), currentState: 'review', statePath: ['review'] };
    const request = runtime.buildJevRequest(machine, record, evidence);
    expect(request.questions.route.type).toBe('choice'); expect(request.questions['quality:coverage'].type).toBe('noul');
    const raw = jevResponse(request, 'approved');
    expect(runtime.interpretJev(machine, record, evidence, raw, 'hash').status).toBe('advanced');
    expect(runtime.interpretJev(machine, record, evidence, jevResponse(request, 'approved', 0.99, 0.5), 'hash').status).toBe('held');
    expect(runtime.interpretJev(machine, record, evidence, jevResponse(request, '__stay__'), 'hash').record).toBe(record);
    raw.answers['quality:coverage'] = { type: 'noul', noul: 0.2 };
    expect(runtime.interpretJev(machine, record, evidence, raw, 'hash').reason).toContain('质量');
  });
  it('rejects malformed, partial and unknown-route provider responses and does not invent Noul confidence', () => {
    const { machine } = createTemplate('simple'); const record = runtime.initialRecord(machine, 'hash');
    const request = runtime.buildJevRequest(machine, record, evidence); const id = runtime.candidates(machine, record)[0].id;
    for (const invalid of [{}, { answers: {} }, jevResponse(request, 'unknown'), { ...jevResponse(request, id), answers: { route: jevResponse(request, id).answers.route } }]) expect(() => runtime.interpretJev(machine, record, evidence, invalid, 'hash')).toThrow();
    expect(() => runtime.buildJevRequest(machine, record, '')).toThrow('执行结果');
    const result = runtime.interpretJev(machine, record, evidence, jevResponse(request, id), 'hash');
    expect(result.checks?.every(check => typeof check.probability === 'number')).toBe(true);
  });
  it('enforces the provider choice limit before an external request', () => {
    const { machine } = createTemplate('simple'); const edge = machine.transitions[0];
    machine.transitions = Array.from({ length: 255 }, (_, i) => ({ ...edge, id: `route-${i}` }));
    expect(() => runtime.buildJevRequest(machine, runtime.initialRecord(machine, 'hash'), evidence)).toThrow('254');
  });
});
