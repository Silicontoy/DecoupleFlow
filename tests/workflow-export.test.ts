import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildWorkflowBundle } from '../src/domain/workflowExport';
import { buildSkillBundle, compileMarkdown } from '../src/domain/compiler';
import { createTemplate } from '../src/domain/templates';
import { DEFAULT_DRIVER } from '../src/domain/types';
import { runtime } from '../src/domain/runtime';
import { answer, jevResponse } from './adapter-fixtures';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

describe('strong workflow exports', () => {
  it.each(['langgraph', 'dify'] as const)('%s preserves every state, cycle, route, strategy and the complete diagram', async target => {
    const { machine } = createTemplate('loop');
    const bundle = await buildWorkflowBundle(machine, target);
    const definition = JSON.parse(bundle.files['state-machine.json']);
    expect(definition.states).toHaveLength(machine.states.length); expect(definition.transitions).toHaveLength(machine.transitions.length);
    expect(bundle.files['state-machine.md']).toBe(compileMarkdown(machine));
    expect(bundle.files['state-machine.md']).toContain('```mermaid');
    expect(JSON.parse(bundle.files['export-manifest.json']).definitionHash).toBe(bundle.semanticHash);
  });
  it('runs the Dify JavaScript Code node, enforcing quality and preserving the record on rejection', async () => {
    const { machine } = createTemplate(); const bundle = await buildWorkflowBundle(machine, 'dify');
    const dsl = JSON.parse(bundle.files['workflow.yml']);
    expect(dsl.app.mode).toBe('workflow'); expect(dsl.workflow.graph.edges).toHaveLength(2);
    const code = dsl.workflow.graph.nodes.find((n: { id: string }) => n.id === 'df-advance').data.code;
    const main = runInNewContext(code + '\nmain;');
    const record = { ...runtime.initialRecord(machine, bundle.semanticHash), currentState: 'review', statePath: ['review'] };
    const held = main({ record_json: JSON.stringify(record), context: '待核实', decision_json: JSON.stringify(answer(machine, record, 'approved', { passedQuality: [] })) });
    expect(held.status).toBe('held'); expect(JSON.parse(held.record_json)).toEqual(record);
    const ok = main({ record_json: JSON.stringify(record), context: '已验收', decision_json: JSON.stringify(answer(machine, record, 'approved')) });
    expect(ok.status).toBe('advanced'); expect(ok.current_state).toBe('done');
    const start = main({ record_json: '', context: '新任务', decision_json: '' });
    expect(JSON.parse(start.handoff_json).record.currentState).toBe(machine.initialState);
  });
  it('builds a real Jev HTTP node with an empty Dify secret, then evaluates its typed response', async () => {
    const { machine } = createTemplate('simple'); machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
    const bundle = await buildWorkflowBundle(machine, 'dify'); const dsl = JSON.parse(bundle.files['workflow.yml']);
    const nodes = dsl.workflow.graph.nodes;
    const requestNode = nodes.find((n: { id: string }) => n.id === 'df-request');
    const requestMain = runInNewContext(requestNode.data.code + '\nmain;');
    const request = requestMain({ record_json: '', context: '准备完成' });
    const payload = JSON.parse(request.request_body);
    const id = machine.transitions.find(t => t.from === machine.initialState)!.id;
    const advanceMain = runInNewContext(nodes.find((n: { id: string }) => n.id === 'df-advance').data.code + '\nmain;');
    const result = advanceMain({ record_json: request.record_json, context: '准备完成', response_body: JSON.stringify(jevResponse(payload, id)), status_code: 200 });
    expect(result.status).toBe('advanced');
    expect(() => advanceMain({ record_json: request.record_json, context: '准备完成', response_body: '{}', status_code: 401 })).toThrow('HTTP');
    expect(dsl.workflow.environment_variables[0]).toMatchObject({ value_type: 'secret', value: '', name: 'TYPESAFE_API_KEY' });
    expect(nodes.find((n: { id: string }) => n.id === 'df-jev').data.url).toBe('https://api.typesafe.ai/v1/systemone');
  });
  it('includes lifecycle helpers for all Skills and the standalone Jev CLI only for Jev', async () => {
    const { machine } = createTemplate('simple');
    expect((await buildSkillBundle(machine)).files['scripts/run.mjs']).toContain('runCommand');
    expect((await buildSkillBundle(machine)).files['scripts/decide.mjs']).toBeUndefined();
    machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
    const bundle = await buildSkillBundle(machine);
    expect(bundle.files['references/execution.md']).toContain('scripts/run.mjs advance');
    expect(bundle.files['scripts/adapter.mjs']).toContain('https://api.typesafe.ai/v1/systemone');
    expect(bundle.files['scripts/decide.mjs']).toContain('process.env.TYPESAFE_API_KEY');
    expect(bundle.files['references/state-machine.md']).toContain('最低置信度：0.8');
    const manifest = JSON.parse(bundle.files['decoupleflow-manifest.json']);
    expect(manifest.files['scripts/adapter.mjs']).toMatch(/^[a-f0-9]{64}$/);
  });
});
