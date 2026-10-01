import { expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtime, portableRuntimeSource } from '../src/domain/runtime';
import { buildSkillBundle, compileMarkdown, compileXml } from '../src/domain/compiler';
import { buildWorkflowBundle } from '../src/domain/workflowExport';
import { importProject } from '../src/domain/types';
import { validateMachine } from '../src/domain/validate';
import { createRunRegistry } from '../server/runs';
import { listFixture } from './list-fixture';
import { answer, jevResponse } from './adapter-fixtures';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

it('holds failed items, rejects skipped items, early exits and replayed decisions, then opens the exit', () => {
  const { machine } = listFixture();
  let record = runtime.initialRecord(machine, 'hash');
  const original = structuredClone(record);
  const first = runtime.candidates(machine, record)[0];
  expect(first).toMatchObject({ control: 'item', itemId: 'data', requiredQuality: ['verified'], to: 'work' });
  for (const decision of [answer(machine, record, 'exit'), answer(machine, record, '__item__:0:copy'), answer(machine, record, first.id, { conditionMet: false }), answer(machine, record, first.id, { evidence: '' }), answer(machine, record, first.id, { passedQuality: [] })]) {
    expect(runtime.applyDecision(machine, record, decision, 'hash')).toMatchObject({ status: 'held', record: original });
  }
  for (const [index, item] of machine.states[0].list!.items.entries()) {
    const candidate = runtime.candidates(machine, record)[0];
    expect(candidate.itemId).toBe(item.id);
    expect(candidate.condition).toContain(machine.states[0].list!.passCondition);
    expect(runtime.handoff(machine, record, '').candidates[0].entryCondition).toBe('');
    const next = runtime.applyDecision(machine, record, answer(machine, record, candidate.id, { targetEntryMet: false, evidence: `Verified ${item.id}` }), 'hash');
    expect(next.status).toBe('advanced'); expect(next.record.currentState).toBe('work');
    expect(next.record.history.at(-1)).toMatchObject({ itemId: item.id, evidence: `Verified ${item.id}` });
    record = JSON.parse(JSON.stringify(next.record));
    runtime.assertRecord(machine, record, 'hash');
    expect(runtime.listProgress(machine, record)?.completed).toBe(index + 1);
    expect(runtime.applyDecision(machine, record, answer(machine, record, candidate.id), 'hash').status).toBe('held');
  }
  expect(runtime.candidates(machine, record).map(c => c.id)).toEqual(['exit', 'again']);
  expect(runtime.applyDecision(machine, record, answer(machine, record, 'exit', { conditionMet: false }), 'hash').status).toBe('held');
  expect(runtime.applyDecision(machine, record, answer(machine, record, 'exit'), 'hash').record.currentState).toBe('done');
  const reentered = runtime.applyDecision(machine, record, answer(machine, record, 'again'), 'hash').record;
  expect(runtime.listProgress(machine, reentered)).toMatchObject({ completed: 0, currentItem: { id: 'data' } });
  expect(runtime.candidates(machine, reentered)[0].id).not.toBe(first.id);
});

it('Jev sees only the current item and checks the same gate and quality separately on every item', () => {
  const { machine } = listFixture(); let record = runtime.initialRecord(machine, 'hash');
  for (const item of machine.states[0].list!.items) {
    const request = runtime.buildJevRequest(machine, record, `Result for ${item.text}`);
    const id = runtime.candidates(machine, record)[0].id;
    expect(Object.keys(request.questions.route.criteria!)).toEqual(['__stay__', id]);
    expect(request.state.listProgress?.currentItem?.id).toBe(item.id);
    const failed = jevResponse(request, id); failed.answers['quality:verified'] = { type: 'noul', noul: 0.2 };
    expect(runtime.interpretJev(machine, record, item.text, failed, 'hash').status).toBe('held');
    record = runtime.interpretJev(machine, record, item.text, jevResponse(request, id), 'hash').record;
  }
  expect(runtime.candidates(machine, record).map(c => c.id)).toContain('exit');
});

it('validates required list data and preserves order in JSON, Markdown, XML and both languages', async () => {
  const project = listFixture(); const { machine } = project;
  expect(validateMachine(machine).filter(d => d.level === 'error')).toEqual([]);
  expect(validateMachine(machine).some(d => d.code === 'unbound-quality')).toBe(false);
  expect(importProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  for (const language of ['en', 'zh'] as const) {
    const md = compileMarkdown(machine, language), xml = compileXml(machine, language);
    expect(md.indexOf('1. `data`')).toBeLessThan(md.indexOf('2. `copy`'));
    expect(md.indexOf('2. `copy`')).toBeLessThan(md.indexOf('3. `links`'));
    expect(md).toContain('```mermaid'); expect(md).toContain(machine.states[0].list!.passCondition);
    expect(xml).toContain('<List order="sequential" exit="all-items-passed" reentry="restart">');
    expect(xml).toContain('<RequiredQuality>verified</RequiredQuality>');
    const skill = await buildSkillBundle(machine, language);
    expect(skill.files['SKILL.md']).toContain('handoff.listProgress');
    if (language === 'en') {
      for (const [path, text] of Object.entries(skill.files)) if (/\.(md|html|xml)$/.test(path)) expect(text, path).not.toMatch(/[\u3400-\u9fff]/);
    }
  }
  machine.states[0].list!.items[1].id = 'data';
  expect(validateMachine(machine).map(d => d.code)).toContain('list-duplicate');
  machine.states[0].list = { items: [], passCondition: '' };
  expect(validateMachine(machine).map(d => d.code)).toEqual(expect.arrayContaining(['list-empty', 'list-condition']));
  expect(runtime.candidates(machine, runtime.initialRecord(machine, 'hash'))).toEqual([]);
  await expect(buildSkillBundle(machine)).rejects.toThrow();
});

it('runs the same item-by-item contract from the portable runtime and exported Dify Code node', async () => {
  const { machine } = listFixture();
  const portable = runInNewContext(portableRuntimeSource('en') + '\nruntime;') as typeof runtime;
  const bundle = await buildWorkflowBundle(machine, 'dify', 'en');
  const dsl = JSON.parse(bundle.files['workflow.yml']);
  const main = runInNewContext(dsl.workflow.graph.nodes.find((n: { id: string }) => n.id === 'df-advance').data.code + '\nmain;');
  let record = runtime.initialRecord(machine, bundle.semanticHash);
  for (const item of machine.states[0].list!.items) {
    const id = portable.candidates(machine, record)[0].id;
    expect(portable.listProgress(machine, record)?.currentItem?.id).toBe(item.id);
    const held = main({ record_json: JSON.stringify(record), context: 'premature exit', decision_json: JSON.stringify(answer(machine, record, 'exit')) });
    expect(held.status).toBe('held');
    const decision = answer(machine, record, id);
    const result = main({ record_json: JSON.stringify(record), context: item.text, decision_json: JSON.stringify(decision) });
    expect(result.status).toBe('advanced'); expect(result.current_state).toBe('work');
    expect(JSON.parse(result.record_json)).toEqual(portable.applyDecision(machine, record, decision, bundle.semanticHash, 'agent', JSON.parse(result.record_json).history.at(-1).at).record);
    record = JSON.parse(result.record_json);
  }
  const result = main({ record_json: JSON.stringify(record), context: 'Report approved', decision_json: JSON.stringify(answer(machine, record, 'exit')) });
  expect(result.current_state).toBe('done');
});

it('streams item completion without claiming state exit and preserves progress when paused or forked', async () => {
  const { machine } = listFixture(); const bundle = await buildSkillBundle(machine);
  const registry = createRunRegistry(); const initial = runtime.initialRecord(machine, bundle.semanticHash, 'list-run');
  await registry.open({ machine, record: initial });
  registry.control({ runId: initial.instanceId, action: 'pause' });
  const snapshot = await registry.step({ runId: initial.instanceId, expectedRevision: 0, singleStep: true, decision: answer(machine, initial, runtime.candidates(machine, initial)[0].id) });
  expect(snapshot.phase).toBe('paused'); expect(snapshot.record.currentState).toBe('work');
  expect(snapshot.events.at(-1)?.type).toBe('list.item.passed');
  expect(snapshot.events.some(e => e.type === 'transition.taken')).toBe(false);
  const fork = registry.control({ runId: initial.instanceId, action: 'fork' }).snapshot;
  expect(runtime.listProgress(machine, fork.record)).toMatchObject({ completed: 1, currentItem: { id: 'copy' } });
});

it('an exported Skill resumes at its next item and archives only after the state machine finishes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'df-list-skill-'));
  try {
    const { machine } = listFixture(); const bundle = await buildSkillBundle(machine, 'en');
    for (const [path, content] of Object.entries(bundle.files)) { const target = join(root, 'skill', path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); }
    const run = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, [join(root, 'skill/scripts/run.mjs'), ...args], { timeout: 10000 })).stdout);
    const opened = await run('start', '--workspace', root, '--visualization', 'off');
    let record = opened.record;
    for (let i = 0; i < 3; i++) {
      await writeFile(join(root, 'decision.json'), JSON.stringify(answer(machine, record, runtime.candidates(machine, record)[0].id)));
      const next = await run('advance', '--instance', opened.instance, '--decision', join(root, 'decision.json'));
      record = next.record;
      const resumed = await run('resume', '--instance', opened.instance);
      expect(resumed.handoff.listProgress.completed).toBe(i + 1);
      expect(resumed.session.archivedAt).toBeUndefined();
    }
    const events = await readFile(join(opened.instance, 'events.jsonl'), 'utf8');
    expect(events.match(/list.item.passed/g)).toHaveLength(3);
    expect(events).not.toContain('transition.taken');
    for (const id of ['exit', '__finish__']) {
      await writeFile(join(root, 'decision.json'), JSON.stringify(answer(machine, record, id)));
      record = (await run('advance', '--instance', opened.instance, '--decision', join(root, 'decision.json'))).record;
    }
    expect((await run('status', '--instance', opened.instance)).session.archivedAt).toBeTruthy();
  } finally { await rm(root, { recursive: true, force: true }); }
});
