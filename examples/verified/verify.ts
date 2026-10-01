import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildWorkflowBundle } from '../../src/domain/workflowExport';
import { buildSkillBundle } from '../../src/domain/compiler';
import { DEFAULT_DRIVER } from '../../src/domain/types';
import { runtime, type Decision, type RunRecord } from '../../src/domain/runtime';
import { requestJev } from '../../src/domain/jev';
import { verificationMachine } from './fixture';

const root = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
assert(['langgraph', 'dify', 'dify-live', 'jev'].includes(target), 'Usage: npm run example:verify -- langgraph|dify|dify-live|jev');
const machine = verificationMachine();
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), target, node: process.version, status: 'running' };
const recordDecision = (record: RunRecord, overrides: Partial<Decision> = {}): Decision => {
  const path = runtime.candidates(machine, record)[0];
  return { transitionId: path.id, conditionMet: true, targetEntryMet: true, passedQuality: path.requiredQuality, evidence: 'Integration fixture: the current artifact was checked; all release artifacts are approved.', ...overrides };
};
async function materialize(target: 'langgraph' | 'dify') {
  const bundle = await buildWorkflowBundle(machine, target, 'en');
  const folder = join(root, '.work', target);
  for (const [path, content] of Object.entries(bundle.files)) { await mkdir(dirname(join(folder, path)), { recursive: true }); await writeFile(join(folder, path), content); }
  return { bundle, folder };
}

try {
  if (target === 'langgraph') {
    const { folder } = await materialize('langgraph');
    const { createWorkflow, makeInput } = await import(pathToFileURL(join(folder, 'workflow.mjs')).href);
    const { Command } = await import('@langchain/langgraph');
    const calls: string[] = [];
    const graph = createWorkflow({
      handlers: { review: ({ item }: { item: { id: string } }) => { calls.push(item.id); return `Checked artifact ${item.id}; release report approved.`; } },
      decide: ({ record }: { record: RunRecord }) => recordDecision(record, calls.length === 1 ? { conditionMet: false } : {}),
    });
    const config = { configurable: { thread_id: 'real-langgraph-check' }, recursionLimit: 100 };
    const first = await graph.invoke(makeInput('', 'real-langgraph-check'), config);
    assert.equal(first.result.status, 'held'); assert.equal(first.record.revision, 0);
    assert.equal(first.__interrupt__[0].value.type, 'more-evidence');
    const final = await graph.invoke(new Command({ resume: { context: 'License has now been checked.', decision: recordDecision(first.record) } }), config);
    assert.equal(final.record.status, 'completed');
    assert.deepEqual(calls, ['license', 'tests', 'docs'], 'A failed gate must not rerun the business handler.');
    assert.equal(final.record.revision, 5);
    Object.assign(report, { mode: 'installed-langgraph-runtime', langgraph: '1.4.18', status: 'passed', orderedItems: calls, heldThenResumed: true, noRepeatedWork: true, finalRevision: final.record.revision });
  } else if (target === 'dify' || target === 'dify-live') {
    const { bundle } = await materialize('dify');
    const dsl = JSON.parse(bundle.files['workflow.yml']);
    const code = dsl.workflow.graph.nodes.find((n: { id: string }) => n.id === 'df-advance').data.code;
    const base = process.env.DIFY_BASE_URL?.replace(/\/$/, '');
    const key = process.env.DIFY_API_KEY;
    if (target === 'dify-live' && (!base || !key)) {
      Object.assign(report, { status: 'blocked', mode: 'live-dify-api', reason: 'Set DIFY_BASE_URL (ending in /v1) and DIFY_API_KEY for the published app importing .work/dify/workflow.yml.' });
    } else {
      if (base) assert(/^https:\/\//.test(base) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base), 'Use HTTPS, or loopback HTTP for local Dify.');
      const run = async (inputs: { record_json: string; context: string; decision_json: string }) => {
        if (target === 'dify') return runInNewContext(`${code}\nmain(input)`, { input: inputs }, { timeout: 5000 });
        const response = await fetch(`${base}/workflows/run`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs, response_mode: 'blocking', user: 'decoupleflow-verification' }), signal: AbortSignal.timeout(60000) });
        assert(response.ok, `Dify HTTP ${response.status}`);
        const body = await response.json(); assert.equal(body.data?.status, 'succeeded', 'Dify workflow must succeed.');
        return body.data.outputs;
      };
      let output = await run({ record_json: '', context: 'Begin the integration fixture.', decision_json: '' });
      let record = JSON.parse(output.record_json);
      runtime.assertRecord(machine, record, bundle.semanticHash);
      const held = await run({ record_json: output.record_json, context: 'Attempt a premature exit.', decision_json: JSON.stringify(recordDecision(record, { transitionId: 'approved' })) });
      assert.equal(held.status, 'held'); assert.deepEqual(JSON.parse(held.record_json), record);
      for (let step = 0; step < 5; step++) {
        output = await run({ record_json: JSON.stringify(record), context: 'Integration fixture: current artifact checked; complete report approved.', decision_json: JSON.stringify(recordDecision(record)) });
        assert.notEqual(output.status, 'held'); record = JSON.parse(output.record_json);
        runtime.assertRecord(machine, record, bundle.semanticHash);
      }
      assert.equal(record.status, 'completed'); assert.equal(record.revision, 5);
      Object.assign(report, { mode: target === 'dify' ? 'exported-code-node-in-node-vm' : 'live-dify-api', status: 'passed', dslVersion: dsl.version, prematureExitHeld: true, finalRevision: record.revision, deploymentImportVerified: target === 'dify-live' });
    }
  } else {
    machine.driver = { ...DEFAULT_DRIVER, type: 'jev', ...(process.env.JEV_MODEL ? { model: process.env.JEV_MODEL } : {}) };
    const bundle = await buildSkillBundle(machine, 'en');
    if (!process.env.TYPESAFE_API_KEY) Object.assign(report, { status: 'blocked', mode: 'live-jev-api', reason: 'TYPESAFE_API_KEY is not configured. No mock response is used.' });
    else {
      let record = runtime.initialRecord(machine, bundle.semanticHash, 'jev-live-verification');
      const traces = [];
      Object.assign(report, { mode: 'live-jev-api', model: machine.driver.model, traces });
      for (let step = 0; step < 5 && record.status !== 'completed'; step++) {
        const item = runtime.listProgress(machine, record)?.currentItem;
        const context = item ? `Test fixture evidence: ${item.text}. The artifact exists and was manually checked; the check passed. Evidence artifact=${item.id}, result=passed.` : 'All three release artifacts passed, the release report is approved, and the workflow is complete.';
        const payload = runtime.buildJevRequest(machine, record, context);
        const raw = await requestJev(payload, process.env.TYPESAFE_API_KEY);
        const result = runtime.interpretJev(machine, record, context, raw, bundle.semanticHash);
        traces.push({ revision: result.record.revision, status: result.status, reason: result.reason, confidence: result.confidence, probabilities: result.probabilities });
        assert.notEqual(result.status, 'held', `Jev held at step ${step}; do not lower thresholds to manufacture a pass.`);
        record = result.record;
      }
      assert.equal(record.status, 'completed');
      Object.assign(report, { mode: 'live-jev-api', status: 'passed', model: machine.driver.model, traces });
    }
  }
} catch (error) { Object.assign(report, { status: 'failed', error: error instanceof Error ? error.message : String(error) }); }
await mkdir(join(root, '.work'), { recursive: true });
await writeFile(join(root, '.work', `${target}.result.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exitCode = report.status === 'blocked' ? 2 : 1;
