import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillBundle } from '../../src/domain/compiler';
import { newState, type Machine } from '../../src/domain/types';

const example = dirname(fileURLToPath(import.meta.url));
const action = process.argv[2];
const at = process.argv.indexOf('--workspace');
const workspace = resolve(at < 0 ? join(example, '.work') : process.argv[at + 1]);
const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = async (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const statePath = join(workspace, 'harness.json');
const skill = '.agents/skills/df-codex-resume-demo';
const machine: Machine = {
  schemaVersion: 1, id: 'codex-resume-demo', name: 'Invoice review', version: '1.0.0',
  purpose: 'Draft an invoice, stop the Codex process, then resume the same task to review it.', initialState: 'draft',
  visualization: { enabled: false, autoOpen: false },
  states: [
    { ...newState('task', 'draft', 'Draft invoice'), description: 'Read input.json. Write draft.json with lineTotals and total. Run node checkpoint.mjs draft. Stop after reaching review.', qualityConditions: [{ id: 'correct-total', text: 'Every line total and the sum match input.json.', required: true }] },
    { ...newState('task', 'review', 'Review invoice'), description: 'Read the persisted draft. Do not recreate it. Write review.json with approved=true, total, and itemCount. Run node checkpoint.mjs review.', qualityConditions: [{ id: 'approved', text: 'The persisted draft was independently checked against input.json.', required: true }] },
    { ...newState('end', 'done', 'Invoice approved'), description: 'Both artifacts exist and the review passed.' },
  ],
  transitions: [
    { id: 'draft-ready', from: 'draft', to: 'review', condition: 'The invoice draft is on disk and its arithmetic is correct.', requiredQuality: ['correct-total'], kind: 'normal', onUncertain: 'Check input.json again.' },
    { id: 'review-approved', from: 'review', to: 'done', condition: 'The review approves the existing draft.', requiredQuality: ['approved'], kind: 'normal', onUncertain: 'Keep the same instance and resolve discrepancies.' },
  ],
};

async function invokeCodex(args: string[], prompt: string, phase: string) {
  const log = join(workspace, `${phase}.events.jsonl`);
  let events = '', errors = '', sessionId = '';
  const child = spawn(process.env.CODEX_BIN || 'codex', args, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(prompt);
  child.stdout.on('data', chunk => { events += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60 * 1000);
  try {
    const code = await new Promise<number | null>((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit); });
    await writeFile(log, events, { mode: 0o600 });
    await writeFile(join(workspace, `${phase}.stderr.log`), errors, { mode: 0o600 });
    for (const line of events.split('\n').filter(Boolean)) {
      try { const event = JSON.parse(line); if (event.type === 'thread.started') sessionId = event.thread_id; } catch { /* non-JSON diagnostics */ }
    }
    if (sessionId) { const state = await read(statePath); await save(statePath, { ...state, codexSessionId: sessionId }); }
    assert.equal(code, 0, `Codex exited ${code}; inspect ${phase}.stderr.log and ${phase}.events.jsonl in the workspace.`);
    assert(sessionId, 'Codex did not return a persisted thread.started session ID.');
    return sessionId;
  } finally { clearTimeout(timer); }
}

if (action === 'start') {
  await mkdir(workspace, { recursive: true });
  assert(!await readFile(statePath).then(() => true, () => false), 'This workspace already has a task. Use resume, or choose a fresh --workspace.');
  const bundle = await buildSkillBundle(machine, 'en');
  for (const [path, content] of Object.entries(bundle.files)) { const target = join(workspace, skill, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); }
  await copyFile(join(example, 'checkpoint.mjs'), join(workspace, 'checkpoint.mjs'));
  await save(join(workspace, 'input.json'), { items: [{ name: 'Notebook', quantity: 2, price: 9 }, { name: 'Pen', quantity: 3, price: 8 }] });
  const runner = join(workspace, skill, 'scripts/run.mjs');
  const opened = JSON.parse(execFileSync(process.execPath, [runner, 'start', '--workspace', workspace, '--actor', 'Codex', '--visualization', 'off'], { encoding: 'utf8' }));
  await save(statePath, { instance: opened.instance, instanceId: opened.record.instanceId, runner, node: process.execPath, startedAt: new Date().toISOString() });
  console.log('Starting Codex. It will draft, commit one transition, then exit.');
  await invokeCodex(['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--json', '-'],
    `Use $df-codex-resume-demo from ${skill}/SKILL.md for this existing task. Read harness.json and input.json. The Harness has already started the instance; do not start a new one. Read the Skill instructions and call its status command using the runner, node, and instance paths in harness.json. Calculate the invoice and write draft.json as {"lineTotals":[...],"total":number}. Run the node path from harness.json with checkpoint.mjs draft; this helper verifies the real artifact and submits the transition through the Skill. Stop immediately once currentState is review. Do not review yet. This is a deliberate process-exit/resume test. Work only in this workspace; no network, delegation, or unrelated tasks.`, 'start');
  const state = await read(statePath); const record = await read(join(state.instance, 'state-record.json'));
  assert.equal(record.currentState, 'review'); assert.equal(record.revision, 1);
  await save(statePath, { ...state, closedAt: new Date().toISOString(), draftHash: sha(await readFile(join(workspace, 'draft.json'), 'utf8')) });
  console.log('Codex exited. Checkpoint: review, revision 1. Run npm run example:codex -- resume to launch a new Codex process.');
} else if (action === 'resume') {
  const state = await read(statePath); assert(state.codexSessionId, 'Run start first.');
  console.log('Launching a new Codex process with the saved session ID and Skill instance.');
  const sessionId = await invokeCodex(['exec', 'resume', '--skip-git-repo-check', '--json', state.codexSessionId, '-'],
    `Resume the existing $df-codex-resume-demo task. Read harness.json and call the Skill runner's resume --instance command using its node and runner paths. Do not start or fork a new instance. Read input.json and the existing draft.json without changing the draft. Check the arithmetic, then write review.json as {"approved":true,"total":number,"itemCount":number}. Run the node path from harness.json with checkpoint.mjs review. The helper checks your review, commits review-approved, and confirms completion. Stop after completion. Work only in this workspace; no network, delegation, or unrelated tasks.`, 'resume');
  assert.equal(sessionId, state.codexSessionId, 'Resume must keep the same Codex session.');
  await verify();
} else if (action === 'verify') await verify();
else throw new Error('Usage: npm run example:codex -- start|resume|verify [--workspace /absolute/fresh/directory]');

async function verify() {
  const state = await read(statePath), record = await read(join(state.instance, 'state-record.json')), session = await read(join(state.instance, 'session.json'));
  assert.equal(record.instanceId, state.instanceId); assert.equal(record.status, 'completed'); assert.equal(record.revision, 3);
  assert(session.archivedAt); assert.equal(sha(await readFile(join(workspace, 'draft.json'), 'utf8')), state.draftHash, 'Resume must not rewrite the draft.');
  const result = { checkedAt: new Date().toISOString(), mode: 'live-codex-cli', status: 'passed', codex: execFileSync(process.env.CODEX_BIN || 'codex', ['--version'], { encoding: 'utf8' }).trim(), sameCodexSession: true, sameSkillInstance: true, separateProcesses: true, before: { state: 'review', revision: 1 }, after: { state: record.currentState, revision: record.revision, status: record.status, archived: true }, draftUnchanged: true };
  await save(join(workspace, 'result.json'), result); console.log(JSON.stringify(result, null, 2));
}
