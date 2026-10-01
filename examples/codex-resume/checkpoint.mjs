// A tiny host bridge: validate actual invoice files, then use the exported Skill.
// The Codex process writes the business artifacts. The Skill owns state/history.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const config = await read('harness.json');
const run = (...args) => JSON.parse(execFileSync(config.node, [config.runner, ...args, '--instance', config.instance], { encoding: 'utf8' }));
const input = await read('input.json');
const lineTotals = input.items.map(item => item.quantity * item.price);
const total = lineTotals.reduce((a, b) => a + b, 0);
const draft = await read('draft.json');
assert.deepEqual(draft, { lineTotals, total }, 'Draft arithmetic must match the source.');
async function commit(id, quality, artifact) {
  const bytes = await readFile(artifact);
  const decision = { transitionId: id, conditionMet: true, targetEntryMet: true, passedQuality: quality, evidence: `${artifact} checked against input.json; total=${total}; sha256=${createHash('sha256').update(bytes).digest('hex')}` };
  await writeFile('decision.json', JSON.stringify(decision));
  const result = run('advance', '--decision', join(process.cwd(), 'decision.json'));
  assert.notEqual(result.status, 'held', result.reason);
  return result;
}
const status = run('status');
if (process.argv[2] === 'draft') {
  assert.equal(status.record.currentState, 'draft');
  const result = await commit('draft-ready', ['correct-total'], 'draft.json');
  assert.equal(result.record.currentState, 'review');
  console.log('Checkpoint saved: review. Stop this Codex process now.');
} else if (process.argv[2] === 'review') {
  assert.equal(status.record.currentState, 'review');
  assert.deepEqual(await read('review.json'), { approved: true, total, itemCount: input.items.length });
  await commit('review-approved', ['approved'], 'review.json');
  const result = await commit('__finish__', [], 'review.json');
  assert.equal(result.record.status, 'completed');
  console.log('Same instance completed and archived.');
} else throw new Error('Usage: node checkpoint.mjs draft|review');
