import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillBundle } from '../src/domain/compiler';
import { createDemo, DEMO_IDS, type DemoId } from '../src/domain/demos';
import { runtime, type Decision, type RunRecord } from '../src/domain/runtime';
import { TARGETS, type Target } from '../src/domain/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../examples/demos');
const exec = promisify(execFile);
const arg = (name: string) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const selection = process.argv[2];
const language = arg('--language') === 'zh' ? 'zh' : 'en';
const agent = (arg('--agent') || 'codex') as Target;
assert(['codex', 'claude', 'copilot'].includes(agent), '--agent must be codex, claude or copilot');
assert(selection === 'all' || (DEMO_IDS as readonly string[]).includes(selection), 'Usage: npm run demo -- bugfix|research|release|all [--prepare] [--agent codex|claude|copilot] [--language en|zh]');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const results: Awaited<ReturnType<typeof runDemo>>[] = [];
for (const id of selection === 'all' ? DEMO_IDS : [selection as DemoId]) results.push(await runDemo(id));
if (!process.argv.includes('--prepare')) {
  const previous = await json(join(root, 'verification.json')).catch(() => ({ demos: [] }));
  const demos = [...previous.demos.filter((row: { id: string }) => !results.some(r => r.id === row.id)), ...results];
  await save(join(root, 'verification.json'), { checkedAt: new Date().toISOString(), mode: 'offline-exported-skill', node: process.version, modelCalls: 0, note: 'Actual local Skill execution with deterministic host decisions. Research products and release CI/approval are fixtures.', demos });
}

async function runDemo(id: DemoId) {
  const { machine } = createDemo(id, language);
  const bundle = await buildSkillBundle(machine, language);
  await mkdir(join(root, '.runs'), { recursive: true });
  const workspace = await mkdtemp(join(root, '.runs', `${id}-`));
  await cp(join(root, id, 'sample'), join(workspace, 'sample'), { recursive: true });
  await mkdir(join(workspace, 'artifacts'));
  const skillPath = join(workspace, TARGETS[agent].directory, bundle.skillName);
  for (const [path, text] of Object.entries(bundle.files)) { const output = join(skillPath, path); await mkdir(dirname(output), { recursive: true }); await writeFile(output, text); }
  const invocation = agent === 'copilot'
    ? (language === 'zh' ? `使用 ${bundle.skillName}。` : `Use ${bundle.skillName}.`)
    : TARGETS[agent].invocation.replace('SKILL_NAME', bundle.skillName);
  console.log(`\n${machine.name}\nWorkspace: ${workspace}\nSkill: ${skillPath}\nAgent command: ${invocation}`);
  if (process.argv.includes('--prepare')) {
    const prompt = await readFile(join(root, id, `prompt.${language}.txt`), 'utf8');
    await writeFile(join(workspace, 'TASK.txt'), prompt.replace(`$${bundle.skillName}`, invocation));
    console.log('Prepared. Open this workspace in your agent and paste TASK.txt. No instance or model call has been started.');
    return { id, status: 'prepared' };
  }
  const run = async (...args: string[]) => JSON.parse((await exec(process.execPath, [join(skillPath, 'scripts/run.mjs'), ...args], { timeout: 15000 })).stdout);
  const opened = await run('start', '--workspace', workspace, '--visualization', 'off', '--actor', 'Offline demo harness');
  const instance: string = opened.instance;
  let record: RunRecord = opened.record;
  const trace: { action: string; state: string; revision: number; status: string }[] = [];
  const output = (name: string, text: string) => writeFile(join(workspace, 'artifacts', name), text);
  function decision(id: string | null, evidence: string, overrides: Partial<Decision> = {}): Decision {
    const path = runtime.candidates(machine, record).find(p => p.id === id);
    return { transitionId: id, conditionMet: true, targetEntryMet: true, passedQuality: path?.requiredQuality ?? [], evidence, ...overrides };
  }
  async function advance(id: string | null, evidence: string, held = false) {
    const before = structuredClone(record);
    await save(join(workspace, 'decision.json'), decision(id, evidence, held ? { conditionMet: false, passedQuality: [] } : {}));
    const result = await run('advance', '--instance', instance, '--decision', join(workspace, 'decision.json'));
    if (held) { assert.equal(result.status, 'held'); assert.deepEqual(result.record, before); }
    else assert.notEqual(result.status, 'held', result.reason);
    record = result.record;
    trace.push({ action: id ?? 'hold', state: record.currentState, revision: record.revision, status: result.status });
    console.log(`  ${held ? 'HOLD' : 'PASS'}  ${id ?? 'no evidence'} → ${record.currentState} (revision ${record.revision})`);
  }
  async function resume() {
    const result = await run('resume', '--instance', instance);
    assert.equal(result.record.instanceId, record.instanceId); assert.deepEqual(result.record, record);
    trace.push({ action: 'resume', state: record.currentState, revision: record.revision, status: 'resumed' });
    return result;
  }
  async function event(type: string, detail: string) {
    const result = await run('event', '--instance', instance, '--event-json', JSON.stringify({ type, detail }));
    record = result.record;
  }
  await advance('__finish__', 'No work has been done. A premature completion must stay blocked.', true);
  if (id === 'bugfix') {
    const testFile = join(workspace, 'sample/cart.test.mjs'); const originalTests = await readFile(testFile, 'utf8');
    async function tests(name: string, pattern?: string) {
      const args = ['--test', ...(pattern ? ['--test-name-pattern', pattern] : []), 'sample/cart.test.mjs'];
      let passed = true, text = '';
      try { text = (await exec(process.execPath, args, { cwd: workspace, timeout: 10000 })).stdout; }
      catch (error) { const e = error as { code?: number | string; stdout?: string; stderr?: string }; assert.equal(e.code, 1, 'Expected an assertion failure, not a broken test command.'); passed = false; text = (e.stdout || '') + (e.stderr || ''); }
      await output(name, text); return passed;
    }
    assert.equal(await tests('before.tap'), false);
    await advance('reproduced', 'artifacts/before.tap: expected 42, actual 17; original assertions reproduced the bug.');
    const sourcePath = join(workspace, 'sample/cart.mjs'); const before = await readFile(sourcePath, 'utf8');
    assert(before.includes('total + item.price, 0'));
    await writeFile(sourcePath, before.replace('total + item.price, 0', 'total + item.price * (items.length === 1 ? item.quantity : 1), 0'));
    assert.equal(await readFile(testFile, 'utf8'), originalTests);
    await advance('patch-ready', 'A focused first patch handles quantity for single-product carts only; original assertions are unchanged. Verification will expose the remaining bug.');
    assert.equal(await tests('first-attempt.tap'), false);
    await advance('test-passed', 'The recorded first attempt still fails.', true);
    await advance('test-failed', 'artifacts/first-attempt.tap records failing assertions. Return to the fix state.');
    await writeFile(sourcePath, before.replace('total + item.price, 0', 'total + item.price * item.quantity, 0'));
    assert.equal(await readFile(testFile, 'utf8'), originalTests);
    await advance('patch-ready', 'Only the quantity multiplication in sample/cart.mjs changed; original test assertions are unchanged.');
    assert.equal(await tests('after.tap'), true);
    await advance('test-passed', 'artifacts/after.tap: all original assertions now pass.');
    for (const [item, pattern] of [['empty', 'empty cart'], ['single', 'single product'], ['multiple', 'multiple products']]) {
      assert.equal(runtime.listProgress(machine, record)?.currentItem?.id, item);
      assert.equal(await tests(`${item}.tap`, pattern), true);
      await advance(runtime.candidates(machine, record)[0].id, `artifacts/${item}.tap: the named assertion ran and passed.`);
    }
    await output('fix-report.md', '# Fix report\n\nCause: quantity was ignored.\n\nChange: multiply each unit price by quantity. Original tests are unchanged.\n\nBefore: 17 instead of 42. After: 42. Empty, single-product, and multiple-product regressions passed. See before.tap, first-attempt.tap, after.tap, and the individual TAP files.\n');
    await advance('regressions-passed', 'Three regressions passed and artifacts/fix-report.md was written.');
  } else if (id === 'research') {
    const brief = await readFile(join(workspace, 'sample/brief.md'), 'utf8'); assert(brief.includes('single user') && brief.includes('offline access') && brief.includes('Markdown export'));
    await output('criteria.md', 'Single user; must have offline access and Markdown export. Use only the supplied fictional sources.\n');
    await advance('scoped', 'sample/brief.md specifies the user, the required features, and the source scope.');
    const rows: { id: string; title: string; offline: string; markdown: string }[] = [];
    for (const source of ['local', 'team', 'cloud']) {
      const text = await readFile(join(workspace, `sample/sources/${source}.md`), 'utf8');
      const row = { id: source, title: text.match(/^# (.+)/m)![1], offline: text.match(/^Offline: (.+)$/m)?.[1] ?? 'unknown', markdown: text.match(/^Markdown export: (.+)$/m)?.[1] ?? 'unknown' };
      rows.push(row);
      await output('source-notes.md', rows.map(r => `## ${r.title}\n\nSource: [${r.id}](../sample/sources/${r.id}.md)\n\nOffline: ${r.offline}; Markdown export: ${r.markdown}.\n`).join('\n'));
      await advance(runtime.candidates(machine, record)[0].id, `Read sample/sources/${source}.md. Offline=${row.offline}; Markdown export=${row.markdown}. See artifacts/source-notes.md.`);
      if (source === 'local') assert.equal((await resume()).handoff.listProgress.completed, 1);
    }
    await advance('sources-read', 'All three files were read and the source notes include explicit unknowns.');
    await output('comparison.md', '# Draft for review\n\nTeam Notes supports offline use.\n');
    await advance('draft-ready', 'artifacts/comparison.md exists and is ready for checking.');
    assert.equal(rows.find(r => r.id === 'team')?.offline, 'unknown');
    await advance('approved', 'Draft claims Team Notes offline support, but sample/sources/team.md does not specify it. No citation supports the claim.', true);
    await advance('needs-revision', 'The draft lacks citations and changes an unknown capability into an unsupported claim.');
    const comparison = '# Notes tool comparison\n\nFictional demo sources; criteria: single user, offline access, Markdown export.\n\n| Option | Offline | Markdown export | Source |\n|---|---|---|---|\n' + rows.map(r => `| ${r.title} | ${r.offline} | ${r.markdown} | [${r.id}](../sample/sources/${r.id}.md) |`).join('\n') + '\n\nRecommendation: Local Notes satisfies both required features for a single user.\n\nUnknown: Team Notes does not specify offline support; confirm it before considering that alternative.\n';
    await output('comparison.md', comparison);
    for (const row of rows) assert(comparison.includes(`[${row.id}](../sample/sources/${row.id}.md)`));
    assert(comparison.includes('| Team Notes | unknown | yes |')); assert(rows.some(r => r.id === 'local' && r.offline === 'yes' && r.markdown === 'yes'));
    await advance('draft-ready', 'Revised artifacts/comparison.md contains a source-linked comparison, a supported recommendation, and an unknowns section.');
    await advance('approved', 'All three rows link to their source, Team Notes offline remains unknown, and Local Notes meets both stated criteria.');
  } else {
    const release = await json(join(workspace, 'sample/release.json'));
    assert.equal(release.fixture, true); const notes = [];
    for (const id of ['version', 'license', 'tests', 'docs']) {
      const item = release.checks[id]; assert.equal(item.status, 'passed'); assert.equal(item.candidateId, release.candidateId); assert(item.evidence);
      notes.push(`- ${id}: passed; ${release.candidateId}; ${item.evidence}`);
      await output('checklist.md', '# Demo checklist\n\nThese are fixture results, not live release checks.\n\n' + notes.join('\n') + '\n');
      await advance(runtime.candidates(machine, record)[0].id, `sample/release.json checks.${id}: ${item.evidence}; candidate=${release.candidateId}`);
      if (id === 'license') assert.equal((await resume()).handoff.listProgress.completed, 2);
    }
    await advance('checks-complete', `Four fixture checks passed; saved candidate=${release.candidateId}, job=${release.jobId}.`);
    await event('external.waiting', `Await existing job ${release.jobId} for candidate ${release.candidateId}. Do not resubmit it.`);
    await advance('ci-passed', 'The job is still pending; no completed result has been supplied.', true);
    const resumed = await resume(); assert.equal(resumed.record.currentState, 'ci'); assert(resumed.record.pendingExternalTask.detail.includes(release.jobId));
    const ci = await json(join(workspace, 'sample/ci-result.json')); assert.equal(ci.fixture, true); assert.equal(ci.jobId, release.jobId); assert.equal(ci.candidateId, release.candidateId); assert.equal(ci.status, 'succeeded');
    await event('external.completed', `Fixture result: original job ${ci.jobId} succeeded for candidate ${ci.candidateId}.`);
    await advance('ci-passed', `sample/ci-result.json: matching job ${ci.jobId}, candidate ${ci.candidateId}, succeeded.`);
    const approval = await json(join(workspace, 'sample/approval.json')); assert.equal(approval.fixture, true);
    await save(join(workspace, 'artifacts/rejected-approval.json'), { ...approval, candidateId: 'older-candidate' });
    await advance('approved', 'The first simulated approval references older-candidate, not the current candidate.', true);
    assert.equal(approval.candidateId, release.candidateId); assert.equal(approval.decision, 'approved'); assert(approval.reviewer); assert(Date.parse(approval.at) >= Date.parse(ci.completedAt));
    await advance('approved', `sample/approval.json: ${approval.reviewer} explicitly approved ${approval.candidateId} at ${approval.at}, after CI succeeded. This is a fixture approval.`);
    await output('release-ready.md', `# Release-ready record (offline fixture)\n\nCandidate: ${release.candidateId}\nVersion: ${release.version}\nCI: ${ci.jobId}, succeeded\nReviewer: ${approval.reviewer}\nApproval time: ${approval.at}\n\nFour checklist items passed in this fixture. The candidate, job, and approval match. Nothing was published, tagged, or deployed.\n`);
  }
  await advance('__finish__', 'The demo deliverables are on disk and the current end-state outcome has been achieved.');
  const final = await run('status', '--instance', instance);
  assert.equal(final.record.status, 'completed'); assert(final.session.archivedAt);
  await save(join(workspace, 'artifacts/trace.json'), trace);
  const summary = { id, status: 'passed', mode: 'offline-exported-skill', completed: true, archived: true, heldChecks: trace.filter(e => e.status === 'held').length, resumed: trace.some(e => e.action === 'resume'), revisions: record.revision, trace };
  await save(join(workspace, 'artifacts/result.json'), summary);
  console.log(`  COMPLETE · ${summary.heldChecks} checks correctly held · archived\nArtifacts: ${join(workspace, 'artifacts')}`);
  return summary;
}
